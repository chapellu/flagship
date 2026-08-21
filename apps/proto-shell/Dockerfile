# Prototype statique — pas de build : nginx sert les fichiers tels quels.
# nginx-unprivileged écoute sur 8080 et tourne en uid 101, ce qui satisfait le
# runAsNonRoot + readOnlyRootFilesystem du deployment sans conf sur mesure.
FROM nginxinc/nginx-unprivileged:1.29-alpine
# On copie TOUT le prototype, moins ce que `.dockerignore` retire. La liste
# explicite qui était ici a coûté un déploiement : `deroule.js` n'y figurait
# pas, l'image partait sans lui, et l'écran de recette était injoignable en
# prod alors que tout passait en local — où le serveur sert le dossier, pas
# l'image. Ajouter un fichier au proto ne doit plus demander d'y penser ici.
COPY . /usr/share/nginx/html/
