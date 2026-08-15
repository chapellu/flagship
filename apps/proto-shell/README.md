# proto-shell — PROTOTYPE JETABLE

**Ceci n'est pas l'app.** C'est un prototype d'UI au sens du skill `/prototype` :
du code jetable qui répond à une question de design, déployé sur
`proto.chapellu.fr` pour être jugé sur un vrai iPhone.

## La question

> À quoi ressemble le **shell multi-facettes** (décidé par
> [Workspace#36](https://github.com/chapellu/Workspace/issues/36)) — une seule
> app installée portant les facettes de vie (jardin, cuisine, …) — et quelle
> surface d'accueil pour la facette jardin ?

Trois variantes **structurellement différentes**, commutables par `?variant=`
ou la barre flottante en bas d'écran (flèches ← → au clavier aussi) :

| Clé | Nom | Pari structurel |
|---|---|---|
| `A` | Facettes | Shell à onglets classique ; chaque facette est un *lieu*. Jardin = tableau de bord (quêtes de la semaine, puis les bacs). |
| `B` | Terrasse | Le plan spatial de la terrasse EST l'accueil ; tout part d'un bac touché (bottom sheet). La cuisine n'existe que comme bannière quand un flag stock arrive. |
| `C` | Journal | Un flux chronologique unique mélange les deux facettes ; les facettes sont des *filtres*, pas des lieux. Le lien récolte → « vu, disponible » → dîner est le fil conducteur. |

## Ce que l'onglet Cuisine montre

Le constructeur de semaine est une **transcription jetable** du modèle Python
(Workspace, `prototypes/recipe-compiler/semaine_model.py`) : le modèle de
référence reste le Python, ceci est fait pour être vu sur un téléphone. Il en
porte désormais les quatre grandeurs qui manquaient — chacune parce que son
absence produisait un mensonge à l'écran :

| Ce qu'on voit | Ce que ça corrige |
|---|---|
| `↪ 200 g du congélo + 500 g du lot « … »` | le chaînage était un JETON : le même bocal couvrait autant de plats qu'on voulait, sans jamais baisser |
| **Où ça se range** — frigo / congélo / placard | la cuisine était infinie ; elle a deux plafonds par espace, les étagères et les **contenants** |
| **Faire plus, plus tôt** | un manque en aval se répare en agrandissant un lot amont — une offre, jamais une correction automatique |
| **Hors liste** (placard · déjà cuisiné · à cuisiner d'avance) | on n'achète pas ce qu'on a déjà, et on n'achète nulle part 250 g de lentilles *cuites* |
| **Sauter ce repas** | un créneau vide était une décision non prise ; « on ne mange pas là » en est une (week-ends nomades, #29) |
| Les **parts, par repas** | la semaine entière était dimensionnée sur un seul chiffre. Des amis à dîner, un midi tout seul et une gamelle à prévoir n'ont pas la même taille |
| **Fiche recette** | la carte dit ce qu'un plat coûte, jamais comment on le fait. Les quantités y sont à l'échelle des parts du créneau |
| **En stock** | le stock n'était qu'un compteur ; il se détaille, avec ce que la semaine y prend et ce qu'il en reste |
| **Rentrer les courses** | cocher, c'est dans le magasin ; rentrer, c'est à la maison. Et la case cochée ne s'efface plus au premier re-rendu |
| 🥡 **Gamelles** | on ne cuisine pas une lunchbox le matin même : le dîner de la veille doit être cuisiné plus grand |

## Règles du prototype

- Données **en mémoire, en dur** (`data.js`) pour le jardin : le vrai site de
  Francheville (Workspace#2). Côté cuisine, `cuisine-data.json` est **exporté**
  du recipe-compiler par `export_json.py` — rien n'est inventé ici, et le
  régénérer est la seule façon de mettre l'écran à jour.
- Aucune persistance, aucun backend, pas de service worker. Un seul filet :
  `e2e/smoke.mjs`, qui a déjà trouvé trois vrais bugs. Les courses rentrées et
  les parts réglées vivent **en mémoire** : recharger la page les efface, et
  c'est voulu — un proto qui gagne une persistance devient une app par la bande.
- Pas de build : HTML/CSS/JS vanilla servis par nginx. La vraie app suivra la
  stack décidée (#6 : Vite + React + TS + Dexie) — ce code ne sera **pas** promu.
- La barre de commutation reste visible en prod : le déploiement entier est le
  prototype, la cacher n'aurait pas de sens.

## Sortie

Quand une variante (ou un collage de variantes) a gagné : consigner le verdict
sur l'issue de linkage, supprimer `apps/proto-shell`, `k8s/proto-shell`,
le listener Gateway, le rrset DNS et le workflow CI.
