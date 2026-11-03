# terrain — outil de recherche de terrain, à deux

Carte interactive, classement des communes, parcelles repérées et annonces,
servis sur `terrain.chapellu.fr` derrière la connexion Google (deux comptes
autorisés, voir `k8s/terrain/securitypolicy.yaml`).

## Ce qui est ici, et ce qui n'y est pas

Ce dossier ne contient **que la coquille** : HTML, CSS, JS génériques. Aucun
lieu, aucune personne, aucune parcelle. Le dépôt est public.

Les données vivent **dans le cluster**, dans le volume `terrain/terrain-data`
(PVC, `k8s/terrain/pvc.yaml`), monté en lecture seule dans le pod. L'app les
lit en `fetch` :

| Fichier | Contenu |
|---|---|
| `config.json` | lieux de référence (`work`, `famA`, `famB`, `home`, `city`), prénoms, titre, liste des champs de `communes.json` |
| `communes.json` | une ligne par commune (champs de `config.fields`) + gares |
| `grid.json` | grille régulière ~1,5 km : minutes de voiture sans trafic vers `work`/`famA`/`famB`, altitude |
| `parcels.json` | parcelles repérées et terrains mixtes (photo, contour, zone) |
| `ads.json` | annonces relevées |
| `notes.json` | textes d'analyse, en HTML |
| `img/` | photos aériennes des parcelles |
| `creches.json` | crèches (INSEE BPE) et minutes de voiture vers la plus proche, par commune et sur la grille ; facultatif, fait apparaître l'option « travail en crèche » |
| `schools.json` | écoles et collèges par commune : public/privé, contrat, élèves, IPS, cantine, rythme, brevet et valeur ajoutée ; facultatif |
| `train.json` | minutes porte à porte en train vers Lyon Part-Dieu et Lyon Perrache, par commune et sur la grille, et les gares utilisées ; facultatif, fait apparaître les deux lignes « Train → » et leurs cases « dans la zone verte » |
| `market.json` | relevé quotidien des annonces et leur historique (première/dernière vue, prix, départ) ; écrit par le CronJob `terrain-refresh` |

`config.json` porte aussi le bloc `search` lu par le relevé :
`{"minM2": 300, "bienici": {"zoneIds": ["-4850451", "-4850450", "-7420"]}}`
(identifiants Bien'ici des départements, via `res.bienici.com/suggest.json?q=Rhône`).
Le relevé ne filtre pas le prix (un ancien `maxPrice` est ignoré) : le budget se règle
avec le curseur de l'app, dont la position la plus à droite veut dire « sans limite ».

## Relevé quotidien des annonces

`k8s/terrain/cronjob.yaml`, chaque matin à 6 h 30 : `k8s/terrain/refresh/refresh.py`
interroge chaque source (`src_<nom>.py`, liste dans `TERRAIN_SOURCES` : Bien'ici, immobilier.notaires.fr, ParuVendu), garde les
annonces de la zone de recherche, et met à jour `market.json`. La zone, ce sont les
communes de `communes.json` **et** les autres communes des mêmes départements dont le
centre tombe dans l'emprise de `grid.json` (geo.api.gouv.fr) : une commune voisine
laissée hors de l'étude ne fait plus disparaître ses annonces. Les codes INSEE de
communes déléguées (communes nouvelles) sont ramenés à la commune actuelle ; une
annonce sans code est rattachée par son nom, ou par la commune la plus proche de son
point. Dans l'app, ces annonces de communes voisines n'ont ni score ni fiche ; leur
zone verte est lue sur la grille de trajets, au point de l'annonce. Une annonce
absente d'un relevé **complet** est notée partie ce jour-là ; un relevé incomplet ne
marque rien. Les doublons entre sites (même commune, surface et prix à quelques %
près) sont fusionnés. L'onglet Annonces en tire « Le marché » : nouvelles, baisses de
prix, ce qui part vite, ce qui traîne, par secteur.

**Leboncoin et SeLoger** bloquent la lecture automatique (DataDome, robots.txt).
On passe par leurs alertes e-mail, reçues sur notre propre domaine :

- adresse unique et difficile à deviner `…@in.chapellu.fr`, chiffrée par SOPS
  dans `k8s/terrain/mailin.enc.yaml` (lire : `sops -d k8s/terrain/mailin.enc.yaml`) ;
- MX `in.chapellu.fr` → le nœud (`infra/dns.tf`), port 25 ouvert dans la
  security list OCI et ufw (`infra/main.tf`, `infra/cloud-init.yaml`) ;
- `apps/mailin` (aiosmtpd) : n'accepte que cette adresse, refuse tout le
  reste (pas un relais), messages ≤ 3 Mo, boîte plafonnée, STARTTLS avec un
  certificat cert-manager. Chaque message devient un `.eml` dans le volume
  `terrain-inbox` ;
- `src_alertes.py` lit ces fichiers (30 derniers jours, purge à 60 jours).

Une alerte ne signale pas les retraits : sans nouvelle alerte depuis 45 jours,
l'annonce passe en « statut inconnu ».

Lancer un relevé à la main : `kubectl -n terrain create job --from=cronjob/terrain-refresh refresh-now`.

Le job tourne en utilisateur 101 (comme nginx) : le dossier `/data` du volume doit lui
appartenir (`chown 101:101 /data` depuis le pod temporaire ci-dessous, une fois).

## Crèches et écoles

Calculés à la main, une fois par an suffit (sources publiques, rien de personnel) :

```bash
curl -O https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.zip
python3 tools/creches.py BPE25.zip ./data   # ~5 min (OSRM, serveur de démonstration)
python3 tools/ecoles.py  BPE25.zip ./data
```

### Lignes train (Part-Dieu, Perrache)

```bash
curl -o sncf.zip https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip
python3 tools/train.py sncf.zip ./data [AAAAMMJJ]   # ~2 min (OSRM) ; à refaire au changement de service (décembre)
```

Horaires théoriques SNCF (GTFS publié sur transport.data.gouv.fr), un jour de semaine
type (par défaut le premier mardi une semaine après le début de validité). Pour chaque
point : voiture sans trafic jusqu'à l'une des 6 gares les plus proches (OSRM, comme
`grid.json`) + 8 min pour se garer et rejoindre le quai + le trajet le plus court en
TER / tram-train / Intercités arrivant entre 7 h et 9 h, au plus une correspondance
(5 min minimum). Pas d'attente comptée au départ : on prend le train qui arrange.
Les gares de Lyon intra-muros terminus du tram-train (Saint-Paul, Gorge de Loup) et
Vaise / Jean Macé sont prolongées par un trajet TCL forfaitaire (12 à 25 min, table
`URBAIN` du script). TGV et cars exclus. Dans l'app, chaque ligne a son seuil ; la
zone verte ne l'exige que si sa case est cochée (par défaut non).

Il n'existe pas de classement officiel des écoles primaires : la fiche école montre
l'IPS (milieu social des élèves, comparé au département) et, pour les collèges, la
valeur ajoutée du brevet (« fait mieux / moins bien qu'attendu »). Les lignes de car
scolaire du Rhône (SYTRAL) ne sont pas en open data ; seul le RPI dispersé est signalé.

**Sauvegarde.** Velero sauvegarde le volume chaque nuit (Kopia, 7 jours),
avec le reste du cluster. Jusqu'au 2026-11-02 c'était un `hostPath`
(`/srv/terrain/data`), que Velero ignore : la recréation du disque de `vm-main`
l'a effacé, et les données ont été reconstruites depuis l'artefact « Terrain
ouest lyonnais » (voir plus bas).

**Remplacer les données.** Le pod les monte en lecture seule ; on passe par un
pod temporaire qui monte le même volume en écriture :

```bash
kubectl -n terrain run terrain-seed --restart=Never --image=busybox:1.37 \
  --overrides='{"spec":{"containers":[{"name":"s","image":"busybox:1.37","command":["sleep","3600"],
    "volumeMounts":[{"name":"d","mountPath":"/data"}]}],
    "volumes":[{"name":"d","persistentVolumeClaim":{"claimName":"terrain-data"}}]}}'
kubectl -n terrain wait --for=condition=Ready pod/terrain-seed
# on garde market.json : c'est l'historique du marché, il ne se reconstruit pas
kubectl -n terrain exec terrain-seed -- sh -c 'find /data -mindepth 1 -maxdepth 1 ! -name market.json -exec rm -rf {} +'
tar -C ./data -cf - . | kubectl -n terrain exec -i terrain-seed -- tar -C /data -xf -
kubectl -n terrain exec terrain-seed -- chmod -R a+rX /data
kubectl -n terrain exec terrain-seed -- chown 101:101 /data   # le relevé quotidien écrit ici
kubectl -n terrain delete pod terrain-seed
```

**Restaurer après une perte du nœud.** Flux recrée un volume vide, et Velero
ne remplace pas un objet existant. Il faut donc, une fois Velero prêt :

```bash
flux suspend kustomization terrain
kubectl delete namespace terrain
velero restore create --from-backup <dernière sauvegarde> --include-namespaces terrain --wait
flux resume kustomization terrain
```

**D'où viennent les fichiers reconstruits (2026-11-02).** `communes.json`,
`parcels.json`, `ads.json`, `notes.json` et `img/` sont extraits tels quels de
l'artefact ; seuls les noms de champs ont changé (`qgcar` → `workcar`,
`tassin` → `famA`, `cogny` → `famB`…). `grid.json` est recalculé à
l'identique de la méthode d'origine (OSRM sans trafic, altitude IGN RGE ALTI) :
sur les 229 communes, les temps recalculés tombent à la minute près sur ceux
de l'artefact. Les contours de parcelles (`ring`) viennent d'apicarto.ign.fr.
L'artefact ne gardait que les 8 annonces mises en avant, pas les 53 du relevé
du 28 octobre ; leur position sur la carte est celle du bourg.

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
