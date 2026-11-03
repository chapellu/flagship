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
| `communes.json` | une ligne par commune (champs de `config.fields`) + gares ; écrit chaque semaine par le CronJob `terrain-communes` (voir « Fiches communes ») |
| `grid.json` | grille régulière ~1,5 km : minutes de voiture sans trafic vers `work`/`famA`/`famB`, altitude |
| `parcels.json` | parcelles repérées et terrains mixtes (photo, contour, zone) |
| `ads.json` | annonces relevées |
| `notes.json` | textes d'analyse, en HTML |
| `img/` | photos aériennes des parcelles |
| `creches.json` | crèches (INSEE BPE) et minutes de voiture vers la plus proche, par commune et sur la grille ; facultatif, fait apparaître l'option « travail en crèche » ; écrit par le CronJob `terrain-communes` |
| `schools.json` | écoles et collèges par commune : public/privé, contrat, élèves, IPS, cantine, rythme, brevet et valeur ajoutée ; facultatif ; écrit par le CronJob `terrain-communes` |
| `train.json` | minutes porte à porte en train vers Lyon Part-Dieu et Lyon Perrache, par commune et sur la grille, et les gares utilisées ; facultatif, fait apparaître les deux lignes « → Part-Dieu / Perrache » (repères sous « Avancé ») ; écrit par le CronJob `terrain-communes` |
| `communes-legacy.json` | valeurs gelées des fiches d'origine, réappliquées par le générateur (voir « Fiches communes ») |
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
point. Ces communes voisines ont leur fiche complète depuis le générateur
hebdomadaire (ci-dessous) ; une commune qui n'en a pas encore (entrée dans la zone
depuis le dernier passage) voit sa zone verte lue sur la grille de trajets, au point
de l'annonce. Une annonce
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

## Fiches communes (chaque semaine)

`k8s/terrain/communes.yaml`, le dimanche à 3 h 15 : `k8s/terrain/communes/build.py`
recalcule **toutes** les fiches de la zone — les communes de `communes.json` et les
autres communes des mêmes départements dont le centre est dans l'emprise de
`grid.json` (la règle du relevé des annonces) — et réécrit `communes.json`, ainsi que,
pour les mêmes communes, `schools.json`, `creches.json` et `train.json`. Une commune
voisine devient une commune comme les autres : score, classement, zone verte, fiche.

Lancer à la main : `kubectl -n terrain create job --from=cronjob/terrain-communes communes-now`
(premier passage ~30 à 60 min, surtout les temps OSRM ; ensuite quelques minutes).
En local : `TERRAIN_DATA=./data TERRAIN_CACHE=./cache python3 -I k8s/terrain/communes/build.py`
(`TERRAIN_COMMUNES_SKIP=train,creches` saute des modules, leurs champs gardent la valeur précédente).

Les sources brutes, toutes publiques, sont gardées dans le volume `terrain-cache`
(jamais servi) et relues seulement quand elles changent ; les temps de voiture
sont mis en cache par couple de points (180 jours). Une source en panne ne vide
rien : ses champs gardent la valeur de la fiche précédente, une nouvelle commune
sans altitude ou temps de voiture attend la semaine suivante, l'écriture est
atomique et le job finit en erreur pour qu'on le voie. La version précédente de
`communes.json` est gardée dans le cache (`communes.prev.json`) ; `meta` dans
`communes.json` dit quand et avec quelles sources il a été construit.

Les secteurs (`sect`) suivent l'EPCI : le secteur déjà porté par les communes de cet
EPCI dans `communes.json`, sinon le nom de l'EPCI raccourci (« CC du Pays de X » →
« Pays de X »), sauf si `config.json` en impose un : `"sectors": {"<code ou nom EPCI>": "<secteur>"}`.

| Champs | Source et définition | Fiches d'origine (229) retrouvées |
|---|---|---|
| `nom`, `lat`, `lon`, `pop` | geo.api.gouv.fr : centre de la commune, population municipale | 229 / 229 |
| `alt` | IGN RGE ALTI au centre | 198 identiques, les autres à quelques mètres |
| `workcar`, `famA`, `famB`, `car` | OSRM sans trafic vers `work`, `famA`, `famB`, `city` (comme `grid.json`) | 228–229 / 229 à la minute |
| `work`, `workmode` | le plus court de `worktrain` et `workcar` × 1,4 (heure de pointe) | 229 / 229 |
| `prix`, `m2`, `eurm2`, `nv`, `big` | DVF, 3 dernières années complètes : ventes sans local, parcelles AB/S/AG/J, ≥ 300 m², 30–1 500 €/m² ; médianes, nombre, ventes ≥ 1 500 m² | prix 165, m2 159, €/m² 163, ventes 158 (207 à ±1), grands 200 identiques ; écart médian 0 |
| `fibre` | ARCEP, dernier trimestre : locaux raccordables FTTH / locaux | 167 identiques, 227 à ±1 point (trimestre plus récent) |
| `cl25`, `cl19`, `priv` | classes à la dernière rentrée et en 2019 (écoles ouvertes), écoles privées sous contrat | 229 / 229 |
| `col`, `colc`, `colkm`, `va` | collège privé sous contrat le plus proche, sa valeur ajoutée (note à l'écrit du brevet) | 229 / 229 (nom de commune parfois écrit autrement) |
| `inond`, `sech`, `mvt`, `feu`, `indus` | Géorisques : arrêtés CatNat inondation / sécheresse / mouvement de terrain ; risques feu de forêt et industriel recensés | 229 / 229 |
| `src`, `srckm` | BD TOPO : sources, sources captées, fontaines, lavoirs ; par km² | 178 identiques, jamais plus haut (gelés, voir plus bas) |
| `train`, `gare`, `tmin`, `arr`, `ntr` | horaires SNCF : voiture jusqu'à la gare + 4 min + train vers une gare à moins de 6 km de `city` + 3 min/km | écart médian 0, 2 min en valeur absolue (gelés) |
| `worktrain`, `workgare` | idem vers `work` : + 14 min, + 4 min/km de la gare d'arrivée | écart médian −1, 3 min en valeur absolue (gelés) |
| `workpr` | voiture + 7 min (pas utilisé par l'app) | 119 identiques (gelé) |

**Champs gelés.** Pour `train`, `gare`, `tmin`, `arr`, `ntr`, `worktrain`, `workgare`,
`workpr`, `src` et `srckm`, la méthode des fiches d'origine n'a pas pu être
retrouvée (autre source d'horaires, autre décompte des sources) : les constantes
ci-dessus sont calées pour que les nouvelles communes leur soient comparables, et
les 229 communes d'origine gardent leurs valeurs, gelées au premier passage dans
`data/communes-legacy.json`. Supprimer ce fichier (ou `TERRAIN_COMMUNES_LEGACY=0`)
fait tout recalculer avec les nouvelles méthodes.

### Crèches, écoles, train (même job)

- `creches.json` : BPE de l'INSEE (équipement D502), minutes de voiture vers la crèche
  la plus proche depuis chaque commune et chaque point de la grille.
- `schools.json` : data.education.gouv.fr (annuaire, effectifs, IPS, temps scolaire,
  valeur ajoutée du brevet) et BPE (RPI dispersé). Il n'existe pas de classement officiel
  des écoles primaires : la fiche école montre l'IPS (milieu social des élèves, comparé au
  département) et, pour les collèges, la valeur ajoutée du brevet (« fait mieux / moins bien
  qu'attendu »). Les lignes de car scolaire du Rhône (SYTRAL) ne sont pas en open data ;
  seul le RPI dispersé est signalé.
- `train.json` : horaires théoriques SNCF (GTFS publié sur transport.data.gouv.fr), un
  mardi type au moins une semaine après le passage. Pour chaque point : voiture sans trafic
  jusqu'à l'une des gares les plus proches (OSRM, comme `grid.json`) + 8 min pour se garer et
  rejoindre le quai + le trajet le plus court en TER / tram-train / Intercités arrivant entre
  7 h et 9 h, au plus une correspondance (5 min minimum). Pas d'attente comptée au départ :
  on prend le train qui arrange. Les gares de Lyon intra-muros terminus du tram-train
  (Saint-Paul, Gorge de Loup) et Vaise / Jean Macé sont prolongées par un trajet TCL
  forfaitaire (12 à 25 min, table `URBAIN` de `m_train.py`). TGV et cars exclus. Plus le
  trajet tout en voiture jusqu'aux deux gares : l'app y applique l'heure de pointe, ajoute
  10 min pour se garer et garde le plus rapide des deux. Dans l'app, chaque ligne a son
  seuil. Avec le bloc `commute` (trajets par personne), ce sont de simples repères sur la
  carte : la zone verte ne dépend que des trajets de chacun. Sans lui, une case « dans la
  zone verte » permet de les exiger (par défaut non).

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

## Trajets domicile-travail

`train.json` porte un bloc `commute` (calculé chaque semaine avec les fiches
communes) : pour les lieux `work` et `city`, les gares de départ utiles avec le
temps de train jusqu'au lieu (gare d'arrivée + fin de trajet à pied ou en TCL,
forfait 3 min + 4 min/km), le nombre de trains utiles entre 7 h et 9 h, les
horaires du matin et le tracé du train le plus rapide ; et pour chaque point de
la grille et chaque bourg, ses 5 gares candidates avec le temps de voiture.

L'app en tire, pour chaque personne (`config.commuters` : `{ "work": "…", "city": "…" }`),
le meilleur trajet entre tout en voiture (× heure de pointe) et voiture, marche
(gare à ≤ 2 km) ou vélo (≤ 6 km) + train. Chacun a une limite voiture et une
limite train ; un trajet mixte consomme une part de chacune : minutes au volant /
limite voiture + reste du trajet / limite train ≤ 1. Attente du train : moitié
de l'intervalle moyen entre trains du matin, plafonnée à 15 min, plus 5 min pour
se garer (3 à vélo). Ces réglages sont dans `commute.rules`. Le bouton « Trajet »
d'une annonce ou d'une parcelle détaille ce trajet et le dessine sur la carte.

Le panneau « Zone atteignable » est rangé par intention : une phrase de synthèse
(ce que veut dire la zone verte avec les réglages du moment), « Nos trajets
travail » (une carte par personne : limite en voiture, limite en train, un exemple
de trajet mixte avec ses chiffres, et le plan B crèche dans la carte de `work`, le
seul trajet qu'il change), « Famille », « Le terrain » et « Avancé » (heure de
pointe, lignes repères). Sous chaque critère : combien de communes (bourg) il
écarte, et combien seraient vertes sans lui.

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
