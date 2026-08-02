# ---------------------------------------------------------------------------
# OCI Vault — secret storage for credentials the VM needs at boot.
#
# WHY: the Flux bootstrap PAT used to be rendered straight into cloud-init
# user-data, which the OCI metadata service serves unauthenticated to *any*
# local process on the instance:
#
#   curl -H "Authorization: Bearer Oracle" \
#     http://169.254.169.254/opc/v2/instance/metadata/user_data | base64 -d
#
# It was also in Terraform state, in the plan, and in this repository's CI
# environment. Moving it to Vault means the instance authenticates as *itself*
# (instance principal) and nothing is stored on the box at all.
#
# COST: everything here is Always Free. The vault is a DEFAULT (shared) vault,
# not a VIRTUAL_PRIVATE one — private vaults are billed per hour from creation.
# The key is SOFTWARE-protected, which is free and unlimited; HSM-protected key
# versions are only free for the first 20. Secrets are free up to 150.
#
# ---------------------------------------------------------------------------
# ONE-TIME MANUAL STEP — the secret VALUES are deliberately not managed here.
#
# Terraform creates the vault, the key and the access policy, but never the
# secret contents: anything Terraform knows ends up in plaintext in the state
# file in the tfstate bucket, which would just move the exposure rather than
# remove it. After the first apply, create the secrets by hand, once:
#
#   VAULT_ID=$(terraform output -raw vault_id)
#   KEY_ID=$(terraform output -raw vault_key_id)
#
#   oci vault secret create-base64 \
#     --compartment-id "$COMPARTMENT_ID" \
#     --vault-id "$VAULT_ID" --key-id "$KEY_ID" \
#     --secret-name flux-github-token \
#     --secret-content-content "$(printf %s "$PAT" | base64 -w0)"
#
# Repeat with --secret-name claude-github-pat for the Claude Code token.
# Rotating later is `oci vault secret update-base64`; the instance picks up the
# CURRENT version on next boot, so no Terraform change is needed to rotate.
# ---------------------------------------------------------------------------

resource "oci_kms_vault" "main" {
  compartment_id = var.compartment_id
  display_name   = "vault-main"
  vault_type     = "DEFAULT"
}

resource "oci_kms_key" "secrets" {
  compartment_id      = var.compartment_id
  display_name        = "vault-main-secrets"
  management_endpoint = oci_kms_vault.main.management_endpoint

  key_shape {
    algorithm = "AES"
    length    = 32
  }

  # SOFTWARE keys are Always Free; HSM would start billing past 20 key
  # versions. Software protection is sufficient here — the threat being
  # addressed is "any local process can read user-data", not extraction of
  # key material from Oracle's infrastructure.
  protection_mode = "SOFTWARE"
}

# ---------------------------------------------------------------------------
# Instance identity
#
# The dynamic group matches on a defined tag rather than on the instance OCID.
# Matching by OCID would make the group depend on the instance, while the
# instance needs the resulting policy to already exist when cloud-init runs on
# first boot — a dependency cycle. Tag matching breaks it: tag -> group ->
# policy are all created before the instance.
#
# Matching on the compartment instead would work too, but the compartment here
# is the tenancy root, so that would grant secret access to every future
# instance in the tenancy.
# ---------------------------------------------------------------------------

resource "oci_identity_tag_namespace" "ops" {
  compartment_id = var.tenancy_ocid
  name           = "ops"
  description    = "Operational tags used for IAM dynamic group matching"
}

resource "oci_identity_tag" "instance_role" {
  tag_namespace_id = oci_identity_tag_namespace.ops.id
  name             = "instance-role"
  description      = "Role of the instance, used to grant it secret access"
}

# Tag namespaces are eventually consistent: applying a defined tag to an
# instance moments after creating the namespace intermittently fails with
# "Tag namespace does not exist". Give it a moment on first apply.
resource "time_sleep" "tag_propagation" {
  depends_on      = [oci_identity_tag.instance_role]
  create_duration = "30s"
}

resource "oci_identity_dynamic_group" "vm_main" {
  compartment_id = var.tenancy_ocid
  name           = "vm-main-secrets"
  description    = "Instances allowed to read bootstrap secrets from vault-main"
  matching_rule  = "ALL {tag.ops.instance-role.value = 'vm-main'}"

  depends_on = [time_sleep.tag_propagation]
}

# read secret-bundles is what returns the secret VALUE; `read secrets` alone
# only exposes metadata. Scoped by name so this grant cannot be widened by
# dropping an unrelated secret into the same vault.
resource "oci_identity_policy" "vm_main_secrets" {
  compartment_id = var.tenancy_ocid
  name           = "vm-main-secret-access"
  description    = "Let vm-main read its own bootstrap secrets from vault-main"

  statements = [
    join(" ", [
      "Allow dynamic-group ${oci_identity_dynamic_group.vm_main.name}",
      "to read secret-bundles in tenancy where any {",
      "target.secret.name = '${var.flux_secret_name}',",
      "target.secret.name = '${var.claude_secret_name}'",
      "}",
    ])
  ]
}
