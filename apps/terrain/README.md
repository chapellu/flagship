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
kubectl -n terrain exec terrain-seed -- sh -c 'rm -rf /data/*'
tar -C ./data -cf - . | kubectl -n terrain exec -i terrain-seed -- tar -C /data -xf -
kubectl -n terrain exec terrain-seed -- chmod -R a+rX /data
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
