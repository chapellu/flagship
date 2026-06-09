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
  description = "Compute shape to use. VM.Standard.A2.Flex (paid, Ampere Altra) or VM.Standard.A1.Flex (Always Free, Ampere A1)."
  type        = string
  default     = "VM.Standard.A1.Flex"

  validation {
    condition     = contains(["VM.Standard.A1.Flex", "VM.Standard.A2.Flex"], var.shape)
    error_message = "shape must be VM.Standard.A1.Flex or VM.Standard.A2.Flex."
  }
}
