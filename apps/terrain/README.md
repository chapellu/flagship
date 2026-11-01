# terrain — outil de recherche de terrain, à deux

Carte interactive, classement des communes, parcelles repérées et annonces,
servis sur `terrain.chapellu.fr` derrière la connexion Google (deux comptes
autorisés, voir `k8s/terrain/securitypolicy.yaml`).

## Ce qui est ici, et ce qui n'y est pas

Ce dossier ne contient **que la coquille** : HTML, CSS, JS génériques. Aucun
lieu, aucune personne, aucune parcelle. Le dépôt est public.

Les données vivent **sur le serveur**, dans `/srv/terrain/data` sur `vm-main`,
montées en lecture seule dans le pod (`hostPath`). L'app les lit en `fetch` :

| Fichier | Contenu |
|---|---|
| `config.json` | lieux de référence (`work`, `famA`, `famB`, `home`, `city`), prénoms, titre, liste des champs de `communes.json` |
| `communes.json` | une ligne par commune (champs de `config.fields`) + gares |
| `grid.json` | grille régulière ~1,5 km : minutes de voiture sans trafic vers `work`/`famA`/`famB`, altitude |
| `parcels.json` | parcelles repérées et terrains mixtes (photo, contour, zone) |
| `ads.json` | annonces relevées |
| `notes.json` | textes d'analyse, en HTML |
| `img/` | photos aériennes des parcelles |

**Les données ne sont pas sauvegardées par Velero** (un `hostPath` n'est pas
un volume) et ne survivent pas à une recréation de la VM. Elles se
régénèrent depuis les scripts de la session qui les a produites ; en garder une
copie ailleurs si elles prennent de la valeur.

## Isochrones

La zone verte et les lignes de trajet sont des contours `d3.contours` calculés
dans le navigateur sur `grid.json`, à chaque mouvement de curseur. Le temps
vers `work` est multiplié par le facteur « heure de pointe » ; la zone verte est
l'ensemble des points où le pire des rapports valeur/seuil vaut au plus 1.

## Jouer à deux

Chaque profil (« Lui », « Elle ») garde ses poids dans le navigateur.
« Envoyer mon réglage » produit un lien `#r=…` ; l'autre l'ouvre et l'enregistre
dans le profil correspondant, puis « Compromis » classe sur la moyenne et
montre l'écart entre les deux scores.

## Tester en local

Copier ce dossier et un dossier `data/` à côté, puis servir le tout.
