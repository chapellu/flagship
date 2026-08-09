# Prototype statique — pas de build : nginx sert les fichiers tels quels.
# nginx-unprivileged écoute sur 8080 et tourne en uid 101, ce qui satisfait le
# runAsNonRoot + readOnlyRootFilesystem du deployment sans conf sur mesure.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY index.html style.css app.js data.js manifest.json /usr/share/nginx/html/
