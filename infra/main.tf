terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }

  # Native OCI Object Storage backend (Terraform >= 1.12). Provides real
  # state locking via OCI conditional writes (the S3-compat use_lockfile
  # is broken against OCI buckets — hashicorp/terraform#36742) and reuses
  # the same OCI API-key credentials as the provider, so no Customer
  # Secret Key is needed.
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

  shape_config {
    ocpus         = 4
    memory_in_gbs = 24
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_24_04_arm64.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "vm-main"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(file("${path.module}/cloud-init.yaml"))
  }
}

# ---------------------------------------------------------------------------
# k3s + FluxCD bootstrap (runs once via SSH after the instance is ready)
# ---------------------------------------------------------------------------

resource "null_resource" "k3s_flux_bootstrap" {
  depends_on = [oci_core_instance.main]

  triggers = {
    instance_id       = oci_core_instance.main.id
    bootstrap_version = "2"
  }

  connection {
    type        = "ssh"
    user        = "ubuntu"
    private_key = var.ssh_private_key
    host        = oci_core_instance.main.public_ip
    timeout     = "15m"
  }

  provisioner "file" {
    content = templatefile("${path.module}/bootstrap.sh.tpl", {
      github_token = var.github_token
    })
    destination = "/tmp/k3s_bootstrap.sh"
  }

  provisioner "remote-exec" {
    inline = [
      "bash /tmp/k3s_bootstrap.sh",
      "rm /tmp/k3s_bootstrap.sh",
    ]
  }
}
