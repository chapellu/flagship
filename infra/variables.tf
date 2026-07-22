variable "tenancy_ocid" {
  description = "OCID of the OCI tenancy (Profile → Tenancy in the console)"
  type        = string
}

variable "user_ocid" {
  description = "OCID of the OCI user (Profile → User settings)"
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the API signing key"
  type        = string
}

variable "private_key_path" {
  description = "Path to the PEM private key used for OCI API authentication"
  type        = string
  default     = "~/.oci/oci_api_key.pem"
}

variable "region" {
  description = "OCI region identifier (e.g. eu-paris-1, eu-frankfurt-1, us-ashburn-1)"
  type        = string
}

variable "compartment_id" {
  description = "OCID of the compartment where resources will be created (use tenancy_ocid for root)"
  type        = string
}

variable "ssh_public_key" {
  description = "SSH public key to inject into the VM (contents of ~/.ssh/id_ed25519.pub or similar)"
  type        = string
}

variable "ssh_ingress_cidrs" {
  description = "CIDR blocks allowed to reach SSH (TCP 22). Restrict to your own IP or VPN range. The default 0.0.0.0/0 exposes SSH to the entire internet and is flagged by IaC security scanners — override it in terraform.tfvars."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = length(var.ssh_ingress_cidrs) > 0
    error_message = "ssh_ingress_cidrs must contain at least one CIDR block."
  }
}

variable "availability_domain_index" {
  description = "Index of the availability domain to use (0, 1, or 2). Increment if you hit 'Out of host capacity' for A1.Flex."
  type        = number
  default     = 0

  validation {
    condition     = var.availability_domain_index >= 0 && var.availability_domain_index <= 2
    error_message = "availability_domain_index must be 0, 1, or 2."
  }
}

variable "shape" {
  description = "Compute shape to use. VM.Standard.A1.Flex (Always Free, Ampere A1) or VM.Standard.A2.Flex (paid, Ampere Altra)."
  type        = string
  default     = "VM.Standard.A1.Flex"

  validation {
    condition     = contains(["VM.Standard.A1.Flex", "VM.Standard.A2.Flex"], var.shape)
    error_message = "shape must be VM.Standard.A1.Flex or VM.Standard.A2.Flex."
  }
}

variable "ssh_private_key" {
  description = "Content of the SSH private key used to connect to the VM for post-provisioning bootstrap"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub PAT (repo scope) used by FluxCD bootstrap to push gotk manifests to the repository"
  type        = string
  sensitive   = true
}

variable "dns_zone_name" {
  description = "Name of the OCI DNS zone managed by Terraform"
  type        = string
  default     = "chapellu.fr"
}

variable "dns_compartment_id" {
  description = "OCID of the compartment hosting the DNS zone. Falls back to compartment_id when left empty."
  type        = string
  default     = ""
}

variable "backup_bucket_name" {
  description = "Name of the OCI Object Storage bucket that stores Velero backups"
  type        = string
  default     = "cucco-team-backups"
}

variable "backup_retention_days" {
  description = "Number of days the bucket lifecycle policy keeps backup objects before deleting them"
  type        = number
  default     = 7
}
