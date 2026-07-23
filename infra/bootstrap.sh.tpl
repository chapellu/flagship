#!/bin/bash
set -euo pipefail

# Wait for cloud-init to finish so apt locks are released before k3s installs.
sudo cloud-init status --wait || true

# cloud-init enables ufw allowing only 22/tcp. ufw is the *host* firewall
# (distinct from the OCI Security Lists, which are the cloud-network firewall):
# with its default deny-incoming policy it would drop k3s ingress on 80/443
# once the cluster is up. Open them explicitly. Idempotent — safe to re-run.
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Install k3s — Traefik disabled, servicelb (Klipper) kept for LoadBalancer → HostPort
if ! systemctl is-active --quiet k3s 2>/dev/null; then
  # kubeconfig holds cluster-admin credentials — keep it root-only (0600),
  # not world-readable. We copy it to the ubuntu user with restricted perms below.
  curl -sfL https://get.k3s.io \
    | sudo INSTALL_K3S_EXEC='server --disable traefik --write-kubeconfig-mode 600' sh -
fi

# Copy kubeconfig for the ubuntu user
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
chmod 600 "$HOME/.kube/config"

# Wait for node to be ready
until kubectl get nodes >/dev/null 2>&1; do
  echo "waiting for k3s to start..."
  sleep 5
done
kubectl wait --for=condition=Ready nodes --all --timeout=120s

# Install flux CLI
if ! command -v flux >/dev/null 2>&1; then
  curl -s https://fluxcd.io/install.sh | sudo bash
fi

# Bootstrap FluxCD — idempotent, safe to re-run
export GITHUB_TOKEN='${github_token}'
flux bootstrap github \
  --owner=chapellu \
  --repository=cucco-team \
  --branch=main \
  --path=k8s/flux \
  --personal \
  --token-auth
