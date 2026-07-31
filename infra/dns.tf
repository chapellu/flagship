# ---------------------------------------------------------------------------
# DNS (OCI DNS) — full management of the chapellu.fr zone
#
# For a brand-new domain, Terraform creates the zone on first apply. If the
# zone was already created in the OCI console (to grab the OCI nameservers and
# set them at the OVH registrar before applying), import it into state first
# instead — see the README / terraform-import workflow. Either way, from then
# on Terraform is the source of truth for the zone.
#
# System records (SOA, apex NS delegation, DNSKEY) are generated and managed
# by OCI itself and are intentionally NOT declared as rrsets here — they are
# left untouched. DNSSEC is enabled on the zone, so we pin dnssec_state to
# ENABLED to keep Terraform from trying to unsign it.
# ---------------------------------------------------------------------------

locals {
  dns_compartment_id = var.dns_compartment_id != "" ? var.dns_compartment_id : var.compartment_id
}

resource "oci_dns_zone" "chapellu" {
  compartment_id = local.dns_compartment_id
  name           = var.dns_zone_name
  zone_type      = "PRIMARY"
  scope          = "GLOBAL"
  dnssec_state   = "ENABLED"
}

# A record for Grafana, pointing at the VM's public IP. This replaces the
# previously-manual console step.
resource "oci_dns_rrset" "blog_a" {
  zone_name_or_id = oci_dns_zone.chapellu.id
  domain          = "blog.${var.dns_zone_name}"
  rtype           = "A"
  compartment_id  = local.dns_compartment_id

  items {
    domain = "blog.${var.dns_zone_name}"
    rtype  = "A"
    ttl    = 300
    rdata  = oci_core_instance.main.public_ip
  }
}

resource "oci_dns_rrset" "grafana_a" {
  zone_name_or_id = oci_dns_zone.chapellu.id
  domain          = "grafana.${var.dns_zone_name}"
  rtype           = "A"
  compartment_id  = local.dns_compartment_id

  items {
    domain = "grafana.${var.dns_zone_name}"
    rtype  = "A"
    ttl    = 300
    rdata  = oci_core_instance.main.public_ip
  }
}
