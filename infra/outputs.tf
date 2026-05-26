output "public_ip" {
  description = "Public IP address of the VM"
  value       = oci_core_instance.main.public_ip
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ubuntu@${oci_core_instance.main.public_ip}"
}
