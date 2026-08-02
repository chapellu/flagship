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

# ---------------------------------------------------------------------------
# Backups — values needed to wire Velero (see k8s/backup/README.md)
# ---------------------------------------------------------------------------

output "backup_bucket_name" {
  description = "Name of the Object Storage bucket Velero writes to"
  value       = oci_objectstorage_bucket.backups.name
}

output "backup_s3_endpoint" {
  description = "S3-compatible endpoint URL for the backup bucket (Velero s3Url)"
  value       = "https://${data.oci_objectstorage_namespace.ns.namespace}.compat.objectstorage.${var.region}.oraclecloud.com"
}

output "backup_s3_region" {
  description = "OCI region identifier used as the S3 region by Velero"
  value       = var.region
}

output "velero_s3_access_key_id" {
  description = "S3-compat access key id for Velero (goes into the SOPS cloud-credentials secret)"
  value       = oci_identity_customer_secret_key.velero.id
  sensitive   = true
}

output "velero_s3_secret_key" {
  description = "S3-compat secret key for Velero — shown only once. Put it in the SOPS cloud-credentials secret."
  value       = oci_identity_customer_secret_key.velero.key
  sensitive   = true
}

# Needed for the one-time, out-of-band creation of the secret values — see the
# header of vault.tf. Neither is sensitive: they are OCIDs, not key material.
output "vault_id" {
  description = "OCID of vault-main, for `oci vault secret create-base64 --vault-id`"
  value       = oci_kms_vault.main.id
}

output "vault_key_id" {
  description = "OCID of the software master key that encrypts the secrets in vault-main"
  value       = oci_kms_key.secrets.id
}
