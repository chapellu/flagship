# Monitoring (observability stack)

Full **VictoriaMetrics ecosystem + Grafana**, GitOps-managed by Flux, exposed
publicly behind the shared Envoy Gateway with TLS and Google OIDC.

| Signal  | Component(s)                                              | Retention                |
|---------|----------------------------------------------------------|--------------------------|
| Metrics | VictoriaMetrics single-node + vmagent + vmalert          | 15 d (cap 20 Gi PVC)     |
| Logs    | VictoriaLogs + Vector DaemonSet                          | 7 d / 8 GiB (cap 10 Gi)  |
| Traces  | VictoriaTraces + OpenTelemetry Collector *(isolated)*    | 7 d / 4 GiB (cap 5 Gi)   |
| Viz     | Grafana (anonymous Admin, login form disabled)           | — (ephemeral)            |

Edge: **cert-manager** (Let's Encrypt, HTTP-01 via Gateway API) issues the TLS
cert for `grafana.chapellu.eu.org`; **Envoy Gateway `SecurityPolicy`** enforces
Google OIDC *at the gateway* — Grafana itself trusts the gateway and runs as
anonymous Admin. Future apps get the same protection by attaching their own
`SecurityPolicy` to their route.

## Layout

```
k8s/infrastructure/         cert-manager (HelmRelease) + Envoy Gateway
k8s/infrastructure-config/  ClusterIssuer (letsencrypt-prod) + Gateway "eg"
k8s/monitoring/             metrics + logs + grafana + route + OIDC policy
k8s/monitoring-traces/      VictoriaTraces + OTel Collector  (delete to remove)
k8s/flux/monitoring.yaml         Flux Kustomization (SOPS + substitute)
k8s/flux/monitoring-traces.yaml  Flux Kustomization (traces, isolated)
```

Reconcile order (via Flux `dependsOn`):
`infrastructure` → `infrastructure-config` → `monitoring` → `monitoring-traces`.

## One-time setup

DNS is already handled: `grafana.chapellu.eu.org` → VM public IP is managed in
`infra/dns.tf`. The OCI security list already allows 80/443.

### 1. Google OAuth 2.0 client

Google Cloud Console → *APIs & Services* → *Credentials* → *Create OAuth client
ID* → **Web application**.

- Authorized redirect URI: `https://grafana.chapellu.eu.org/oauth2/callback`
- Note the **Client ID** and **Client secret**.

### 2. Non-secret client ID — `monitoring-vars` ConfigMap

The client ID is not sensitive; it is injected via Flux `postBuild`
substitution. Create it once in the cluster:

```bash
kubectl -n flux-system create configmap monitoring-vars \
  --from-literal=oidc_google_client_id='<YOUR_GOOGLE_CLIENT_ID>'
```

(To change it later: `kubectl -n flux-system create configmap monitoring-vars
--from-literal=oidc_google_client_id='...' --dry-run=client -o yaml | kubectl
apply -f -`.)

### 3. Secret client secret — SOPS

```bash
cp k8s/monitoring/oidc-google.enc.yaml.example k8s/monitoring/oidc-google.enc.yaml
# paste the Google client secret into stringData.client-secret, then:
sops --encrypt --in-place k8s/monitoring/oidc-google.enc.yaml
git add k8s/monitoring/oidc-google.enc.yaml
git commit -m "monitoring: add SOPS-encrypted Google OIDC client secret"
git push
```

Until this encrypted file exists, the `monitoring` Kustomization will not
reconcile (it references `oidc-google.enc.yaml`) — so nothing is exposed
without auth. That gate is intentional.

### 4. Reconcile

```bash
flux reconcile kustomization flux-system --with-source
flux get kustomizations
flux get helmreleases -n monitoring
```

## Verify

```bash
kubectl -n monitoring get pods
kubectl -n monitoring get svc                 # confirm victoria-logs / victoria-traces names
kubectl -n envoy-gateway-system get certificate,gateway
# Browse https://grafana.chapellu.eu.org → Google login → Grafana as Admin.
```

In Grafana, *Connections → Data sources* should list **VictoriaMetrics**
(default), **VictoriaLogs**, and **VictoriaTraces**. If the logs/traces
datasource URLs are wrong, reconcile the actual Service names from
`kubectl -n monitoring get svc` and update the datasource ConfigMaps.

## Notes / decisions

- **Access control**: the gateway denies by default and allows only
  `civ.odul74@gmail.com` (matched on the Google ID token `email`
  claim in `grafana-securitypolicy.yaml`). Any other Google account that logs
  in gets a 403. Grant more accounts by adding addresses under
  `spec.authorization.rules[].principal.jwt.claims[].values`.
- **Alerting**: vmalert evaluates the default rule set; alerts are visible in
  Grafana but no Alertmanager is deployed and no notifications are sent.
- **Backups**: the `monitoring` namespace is excluded from Velero backups
  (short-retention, reproducible data).
- **Disk budget**: PVC requests total ~35 Gi, well under both the monitoring
  budget and the 200 GB boot disk; each store also has a hard size cap so it
  can never run away.
- **k3s scrape targets**: etcd / scheduler / controller-manager / kube-proxy
  scraping is disabled — k3s doesn't expose them like a kubeadm cluster.

## Removing tracing

VictoriaTraces is young and deliberately isolated. To remove it entirely:

```bash
git rm k8s/flux/monitoring-traces.yaml
git commit -m "monitoring: drop tracing layer" && git push
```

Flux prunes VictoriaTraces, the OTel Collector and the traces datasource.
Metrics and logs are untouched. `k8s/monitoring-traces/` can then be deleted
at leisure.
