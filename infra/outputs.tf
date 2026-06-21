output "public_ip" {
  description = "Public IP address of the VM"
  value       = oci_core_instance.main.public_ip
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ubuntu@${oci_core_instance.main.public_ip}"
}

output "grafana_fqdn" {
  description = "FQDN of the Grafana endpoint (A record managed in dns.tf)"
  value       = oci_dns_rrset.grafana_a.domain
}
