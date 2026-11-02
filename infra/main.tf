terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }

  # Native OCI Object Storage backend (Terraform >= 1.12). Provides real
  # state locking via OCI conditional writes (the S3-compat use_lockfile
  # is broken against OCI buckets — hashicorp/terraform#36742) and reuses
  # the same OCI API-key credentials as the provider, so no Customer
  # Secret Key is needed.
  # The bucket keeps the repository's former name (cucco-team). Renaming it
  # would mean migrating live Terraform state for a cosmetic gain — the same
  # goes for the Velero backup bucket. Names outlive their reasons.
  backend "oci" {
    bucket = "tfstate-cucco-team"
    key    = "infra/terraform.tfstate"
    auth   = "APIKey"

    # namespace, region, tenancy_ocid, user_ocid, fingerprint,
    # private_key_path injected via -backend-config file in CI
    # (see terraform-apply.yml)
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

# ---------------------------------------------------------------------------
# Availability domain
# ---------------------------------------------------------------------------

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

locals {
  ad_count = length(data.oci_identity_availability_domains.ads.availability_domains)
  # Modulo keeps the index valid even in single-AD regions (e.g. eu-paris-1 has 1 AD).
  ad_name = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index % local.ad_count].name
}

# ---------------------------------------------------------------------------
# Image (Ubuntu 24.04 ARM64)
# ---------------------------------------------------------------------------

data "oci_core_images" "ubuntu_24_04_arm64" {
  compartment_id           = var.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  state                    = "AVAILABLE"
}

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_id
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "vcn-main"
  dns_label      = "vcnmain"
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "igw-main"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "rt-public"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "sl-public"

  # SSH ingress is restricted to var.ssh_ingress_cidrs. Lock this down to your
  # own IP/VPN range in terraform.tfvars; the default (0.0.0.0/0) exposes SSH
  # to the whole internet.
  dynamic "ingress_security_rules" {
    for_each = var.ssh_ingress_cidrs
    content {
      protocol    = "6" # TCP
      source      = ingress_security_rules.value
      source_type = "CIDR_BLOCK"
      description = "SSH"

      tcp_options {
        min = 22
        max = 22
      }
    }
  }

  ingress_security_rules {
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    description = "HTTP"

    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    description = "HTTPS"

    tcp_options {
      min = 443
      max = 443
    }
  }

  egress_security_rules {
    protocol         = "all"
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = "10.0.1.0/24"
  display_name               = "subnet-public"
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public.id]
  prohibit_public_ip_on_vnic = false
}

# ---------------------------------------------------------------------------
# Compute instance
# ---------------------------------------------------------------------------

resource "oci_core_instance" "main" {
  availability_domain = local.ad_name
  compartment_id      = var.compartment_id
  display_name        = "vm-main"
  shape               = var.shape

  # Destroy the boot volume together with the instance instead of leaving it
  # orphaned (which would keep consuming the Always Free block-volume quota).
  preserve_boot_volume = false

  shape_config {
    ocpus         = 4
    memory_in_gbs = 24
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_24_04_arm64.images[0].id

    # Max boot volume that still fits the Always Free 200 GB total Block
    # Volume allotment. Consumes the entire free storage quota (fine for a
    # single-node setup where everything lives on the boot disk).
    # NOTE: growing this on an already-provisioned VM resizes the volume
    # online but NOT the OS partition — reboot, or run
    # `sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1` afterwards.
    boot_volume_size_in_gbs = 200
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "vm-main"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
      github_token = var.github_token
    }))
  }

  lifecycle {
    # The OCI provider marks a change to metadata["user_data"] as ForceNew:
    #
    #   // Updates of 'ssh_authorized_keys' and 'user_data' in Instance
    #   // 'metadata' should result in Force New
    #   customdiff.ForceNewIfChange("metadata", ...)
    #
    # (the registry docs say "(Updatable)", which is wrong for these two keys).
    # Combined with the terraform-apply workflow's `paths: infra/**` trigger,
    # that made *editing cloud-init.yaml and merging to main* silently destroy
    # and recreate vm-main — and with preserve_boot_volume = false the boot
    # volume goes with it, taking /home/ubuntu, k3s and Flux. That has already
    # happened twice.
    #
    # Ignoring user_data costs nothing: cloud-init only reads it on first boot,
    # so pushing new user_data to a *running* instance has no effect anyway.
    # Edits here therefore take effect on the next deliberate rebuild:
    #
    #   terraform apply -replace=oci_core_instance.main
    #
    # which is a destructive operation — see the STATE VOLUME note in
    # cloud-init.yaml before running it.
    #
    # NOTE: ssh_authorized_keys is deliberately NOT ignored. It is ForceNew for
    # the same reason, but rotating the SSH key is rare and deserves the
    # explicit plan output rather than being silently dropped.
    ignore_changes = [metadata["user_data"]]
  }
}

# k3s + FluxCD are bootstrapped by cloud-init on the instance's first boot
# (see cloud-init.yaml, rendered with the GitHub token via user_data). The
# previous SSH remote-exec provisioner was removed: it depended on runner ->
# VM SSH reachability, had no per-command timeout (a failed k3s start hung the
# apply for hours), and never re-ran after a boot-volume re-image.
