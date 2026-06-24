# ---------------------------------------------------------------------------
# Backups (OCI Object Storage) — bucket + lifecycle + S3-compat credentials
#
# Velero (running in the cluster) writes daily backups here through the OCI
# S3-compatible endpoint. That endpoint does NOT accept instance principals
# or API keys — it requires a Customer Secret Key (an access-key/secret-key
# pair tied to a user), created below. The secret half is only ever returned
# at creation time, so it is surfaced as a sensitive output and must be fed
# into the SOPS-encrypted Velero secret (see k8s/backup/README.md).
#
# Retention is enforced by an object lifecycle policy (delete after 7 days),
# matching the agreed RPO/retention. Velero also sets a 168h TTL on each
# backup; the bucket policy is the backstop.
# ---------------------------------------------------------------------------

data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.compartment_id
}

resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.compartment_id
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  name           = var.backup_bucket_name
  access_type    = "NoPublicAccess"
  versioning     = "Disabled"
  storage_tier   = "Standard"
}

resource "oci_objectstorage_object_lifecycle_policy" "backups" {
  bucket    = oci_objectstorage_bucket.backups.name
  namespace = data.oci_objectstorage_namespace.ns.namespace

  # Hard backstop: delete any object older than the retention window. Velero's
  # own TTL normally prunes backups first; this guarantees nothing lingers.
  rules {
    name        = "expire-after-retention"
    target      = "objects"
    action      = "DELETE"
    time_amount = var.backup_retention_days
    time_unit   = "DAYS"
    is_enabled  = true
  }

  # Clean up incomplete multipart uploads (Kopia/restic can leave these behind
  # on interrupted runs) so they don't accumulate untracked storage.
  rules {
    name        = "abort-incomplete-multipart"
    target      = "multipart-uploads"
    action      = "ABORT"
    time_amount = 3
    time_unit   = "DAYS"
    is_enabled  = true
  }
}

# S3-compatible access key for Velero. Tied to the Terraform-runner user; the
# secret_key is shown once, here, and never again.
resource "oci_identity_customer_secret_key" "velero" {
  display_name = "velero-backup-s3"
  user_id      = var.user_ocid
}
