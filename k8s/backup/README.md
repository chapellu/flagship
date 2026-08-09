# Backups — Velero on OCI Object Storage

Velero takes a **daily** backup of the whole cluster (API objects **and** PV
file contents via Kopia File System Backup), stores it in an OCI bucket through
the S3-compatible endpoint, and keeps **7 days** of history. The `monitoring`
namespace is excluded (short-retention, reproducible data).

```
┌────────── cluster ──────────┐        ┌──────── OCI ────────┐
│ velero + node-agent (Kopia) │ ─S3──▶ │ bucket cucco-team-  │
│ Schedule daily, ttl 168h    │        │ backups (lifecycle  │
│ excludes: monitoring, velero│        │ delete > 7 days)    │
└─────────────────────────────┘        └─────────────────────┘
```

The bucket, its lifecycle policy and the S3 access key are managed in
`infra/` (`backups.tf`).

## One-time setup

### 1. Apply the Terraform

```bash
cd infra
terraform apply           # creates the bucket, lifecycle policy, secret key
terraform output backup_bucket_name
terraform output backup_s3_endpoint
terraform output backup_s3_region
terraform output -raw velero_s3_access_key_id   # sensitive
terraform output -raw velero_s3_secret_key      # sensitive, shown once
```

### 2. age key for SOPS (also your DR escrow)

Flux decrypts the secrets in this folder with an age key held in the cluster.
**Generate it once, keep the private key OFFLINE** (password manager) — it is
what you'll need to bootstrap a rebuilt cluster.

```bash
age-keygen -o age.agekey                 # store age.agekey in your password manager
PUB=$(grep -oP 'public key: \K.*' age.agekey)

# Put the public key into .sops.yaml (replace the placeholder recipient).

# Create the decryption secret Flux looks for:
kubectl create secret generic sops-age \
  -n flux-system \
  --from-file=age.agekey=age.agekey
```

The data key **must** end in `.agekey` — kustomize-controller ignores every
other entry in the Secret.

#### Restoring the key from a password manager

Most password managers store the whole `age-keygen` file as a single value and
give it back with the newlines collapsed into spaces. The result is one long
line starting with `#`, which age reads as a single comment: it loads **zero**
identities and every SOPS decryption fails.

age only needs the private key line — the `# created:` and `# public key:`
comments are decoration. So rebuild the file from whatever the password manager
pasted, instead of trusting its line breaks:

```bash
# clipboard.txt is the raw dump from the password manager, line breaks or not.
grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' clipboard.txt > age.agekey
chmod 600 age.agekey

kubectl create secret generic sops-age \
  -n flux-system \
  --from-file=age.agekey=age.agekey
```

If the malformed Secret is already in the cluster, repair it in place. The key
never leaves the pipeline, so this is safe to run over a shared terminal:

```bash
kubectl -n flux-system get secret sops-age -o jsonpath='{.data.age\.agekey}' \
  | base64 -d \
  | grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' \
  | kubectl -n flux-system create secret generic sops-age \
      --from-file=age.agekey=/dev/stdin --dry-run=client -o yaml \
  | kubectl apply -f -

flux reconcile kustomization infrastructure-config --with-source
```

**Reading the symptom.** Two failures look alike and are not. Both sit under the
same outer `Failed to get the data key required to decrypt the SOPS file` /
`Group 0: FAILED` banner, so read the indented line underneath:

| Inner message | Meaning |
| --- | --- |
| `failed to load age identities. Did not find keys in locations ...` | The Secret was read but yielded no usable identity — almost always the one-line paste above. |
| `no identity matched any of the recipients` | An identity loaded fine, but it is not the recipient in `.sops.yaml`. |

The first one says nothing about whether you hold the *right* key. Checking that
the public key embedded in the file matches `.sops.yaml` will not catch it —
that comment can be perfectly correct while the file is still unparseable.

### 3. Encrypt the two secrets

```bash
cd k8s/backup

cp cloud-credentials.enc.yaml.example cloud-credentials.enc.yaml
# paste velero_s3_access_key_id / velero_s3_secret_key, then:
sops --encrypt --in-place cloud-credentials.enc.yaml

cp repo-credentials.enc.yaml.example repo-credentials.enc.yaml
# paste a strong passphrase (openssl rand -base64 32) AND save it in your
# password manager — it encrypts the backup repository, then:
sops --encrypt --in-place repo-credentials.enc.yaml
```

### 4. Provide the S3 coordinates to Flux

The HelmRelease references `${velero_bucket}`, `${velero_s3_url}` and
`${velero_s3_region}`, substituted from a ConfigMap:

```bash
kubectl create configmap velero-vars -n flux-system \
  --from-literal=velero_bucket="$(terraform -chdir=../../infra output -raw backup_bucket_name)" \
  --from-literal=velero_s3_url="$(terraform -chdir=../../infra output -raw backup_s3_endpoint)" \
  --from-literal=velero_s3_region="$(terraform -chdir=../../infra output -raw backup_s3_region)"
```

### 5. Commit and reconcile

`k8s/flux/backup.yaml` is auto-discovered by the bootstrap Kustomization (Flux
includes every `.yaml` under `k8s/flux`), so once the encrypted secrets and the
`velero-vars` ConfigMap exist, just push:

```bash
git add . && git commit -m "backup: add Velero" && git push
flux reconcile kustomization flux-system --with-source
flux reconcile kustomization backup --with-source
```

## Verify

```bash
velero version
velero backup-location get          # default should be "Available"
velero schedule get                 # "daily" present
velero backup create test-now --wait
velero backup describe test-now --details
```

## Restore (disaster recovery — full node loss)

1. `terraform apply` rebuilds the VM, k3s, Flux bootstrap, DNS, bucket.
2. Recreate the `sops-age` secret from your **offline** `age.agekey`
   (step 2 above) and the `velero-vars` ConfigMap (step 4). Flux then decrypts
   the secrets and reinstalls Velero pointed at the existing bucket.
3. Restore:

   ```bash
   velero backup get                 # pick the most recent
   velero restore create --from-backup <backup-name> --wait
   ```

Because the Kopia repository is encrypted with the passphrase from
`repo-credentials`, that passphrase (kept in your password manager) is required
to read the backups — losing both it and the cluster means the backups are
unreadable.

## What's excluded

- `monitoring` namespace (VictoriaMetrics/Logs/Traces data) — short retention,
  rebuilt from GitOps.
- `velero` namespace itself.
- Per-volume opt-out is possible with the
  `backup.velero.io/backup-volumes-excludes` pod annotation.
