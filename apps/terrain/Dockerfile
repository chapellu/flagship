# Coquille statique — pas de build : nginx sert les fichiers tels quels.
# Les DONNÉES ne sont pas dans l'image : elles sont montées depuis le serveur
# sur /usr/share/nginx/html/data (voir k8s/terrain/deployment.yaml). L'image
# est publique, les données ne le sont pas.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY . /usr/share/nginx/html/
