# ---------------------------------------------------------------------------
# DNS (OCI DNS) — full management of the chapellu.eu.org zone
#
# The zone pre-exists in OCI and is imported into Terraform state (see the
# README for the `terraform import` command). From then on Terraform is the
# source of truth for the zone.
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
