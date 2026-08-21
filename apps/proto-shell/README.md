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
| **Créneau dessert** | les six desserts du catalogue étaient planifiables, achetables et **injoignables** : ils se déclaraient `[gouter]`, or la semaine n'a qu'un goûter et il est `routine`, donc jamais distribué |

### Le dessert, et la troisième nature de créneau

Trouvé en pilotant ce proto en prod, pas en raisonnant. Aucun geste de l'écran ne
pouvait poser un dessert dans une semaine. La réparation évidente — ajouter
`diner` aux créneaux d'un dessert — est la mauvaise : il devient candidat plat
principal et ses `apports` (ni protéine ni légume) tirent la couverture vers le
bas, ce que `[gouter]` évitait justement. Le plat n'est pas mal rangé, **c'est le
créneau qui manquait**.

`creneaux.yaml` porte donc un repas `dessert` à 20 h 15, tous les jours, dont la
nature n'est ni `choisi` ni `routine` :

| nature | vide, c'est… | distribué ? | rempli d'office ? |
|---|---|---|---|
| `choisi` | un **trou** dont la semaine se plaint | oui | oui |
| `routine` | rien — compté et acheté, jamais choisi | non | non |
| `optionnel` | rien — mais sélectionnable, et il distribue | oui | non |

Un créneau qui **existe sans être un manque**. À l'écran ça se voit : vide, il se
réduit à une ligne basse pointillée sous les repas ; rempli, il redevient une
carte pleine. Trois cases vides de la taille d'un dîner se liraient comme trois
décisions en retard.

**Et ça a exhumé une divergence.** `creerJeu()` triait les créneaux d'une journée
par ordre de déclaration dans `cuisine-data.json`, là où le Python trie sur
l'**heure** depuis qu'`anticipation.py` existe. Les deux ne divergeaient que le
mercredi — le seul jour à goûter, déclaré après le dîner, donc rangé après
19 h 30 alors qu'il est à 16 h. L'ordre porte la sémantique (le chaînage marche
les créneaux vers l'avant), donc c'était « hier soir nourrit ce midi » qui était
faux, pas seulement l'affichage. Ajouter un cinquième repas est ce qui l'a rendu
visible ; le tri se fait maintenant sur l'heure des deux côtés.

### Le déroulé guidé — un écran, un geste

`deroule.js`, ouvert par le ▸ d'un créneau rempli ou par le bouton de la fiche.
La fiche est une **page de livre** : tout d'un coup, les quantités en haut, la
marche à suivre en bas. Elle se lit avant de cuisiner. Les mains dans la farine,
il faut l'inverse — le geste courant en gros, ce qu'il réclame et rien d'autre,
le minuteur déjà armé. C'est ce que fait un appareil de cuisson guidée, et le
déroulé s'arrête là où s'arrête l'analogie.

Ce que ce foyer a et qu'un robot n'a pas, et qu'il a donc fallu construire :

- **Des gestes en parallèle.** Un robot fait une chose à la fois, donc son
  déroulé est une file. Ici la pâte se pétrit *pendant* que la poêlée refroidit,
  et le modèle le sait déjà (`parallel_with`, exporté en `enParallele`).
- **Plusieurs minuteurs à la fois.** Corollaire : ils vivent dans une barre qui
  **survit à la navigation, au changement de plat et à la fermeture** de
  l'écran. Le four ne s'arrête pas parce qu'on est passé à autre chose.
- **Un bébé.** Le prélèvement non salé est une étape à part entière, injectée là
  où la recette dit qu'il reste du nature à prendre.

**Ce que cet écran a fait tomber, et c'est sa justification.** Le four est une
ressource **exclusive**, et rien dans le modèle ne le sait : `minutesSurPlace` et
`avanceMin` sont calculés plat par plat, comme si chacun cuisinait seul. Deux
plats le même soir, et l'écran de soirée le montre — le clafoutis (1 h à 150 °C)
et la tourte (45 min à 180 °C + gril) se disputaient **34 minutes** de four à
deux températures différentes. Les heures affichées sont **déjà corrigées** ;
l'encadré ne dit plus que ce qui a bougé et pourquoi. Afficher deux heures qui ne
peuvent pas coexister et laisser la soustraction au lecteur, devant son four,
n'aurait servi à rien.

Deux manques nommés au passage, tous deux côté modèle :

- **Aucune étape ne peut dire qu'elle *règle* l'appareil** plutôt qu'elle s'en
  sert. « Préchauffer à 180 °C » réclame `bake` exactement comme « enfourner
  45 min ». Le déroulé tranche au **seuil** (≤ 2 min = un tour de bouton), ce qui
  est une heuristique, pas une donnée — et le même trou fait qu'aucune
  température n'est lisible ailleurs que dans la phrase.
- **Aucun champ ne porte un interdit d'âge et sa raison.** Le clafoutis n'a pas
  de portion bébé, délibérément (miel, rhum, extrait d'amande amère), et le
  modèle ne sait le dire que par **absence** — ce qui ne se distingue pas de
  « personne n'y a pensé ». L'écran l'écrit en toutes lettres faute de mieux.

## Règles du prototype

- Données **en mémoire, en dur** (`data.js`) pour le jardin : le vrai site de
  Francheville (Workspace#2). Côté cuisine, `cuisine-data.json` est **exporté**
  du recipe-compiler par `export_json.py` — rien n'est inventé ici, et le
  régénérer est la seule façon de mettre l'écran à jour.
- Aucune persistance, aucun backend, pas de service worker. Un seul filet :
  `e2e/smoke.mjs`, qui a déjà trouvé trois vrais bugs. Les courses rentrées et
  les parts réglées vivent **en mémoire** : recharger la page les efface, et
  c'est voulu — un proto qui gagne une persistance devient une app par la bande.
- **Ajouter un fichier ne demande rien de plus.** Le `Dockerfile` copie tout le
  dossier moins ce que `.dockerignore` retire. Il énumérait ses fichiers un par
  un, et ça a coûté un déploiement : `deroule.js` n'y figurait pas, l'image
  partait sans lui, l'import à la demande échouait **en silence** et le mode
  recette était injoignable — alors que le smoke local était vert, parce qu'en
  local le serveur sert le *dossier* et en prod nginx sert une *image*. Le smoke
  commence donc maintenant par suivre les imports depuis `app.js` et vérifier
  que chaque module répond 200 **là où on le vise**.
- Pas de build : HTML/CSS/JS vanilla servis par nginx. La vraie app suivra la
  stack décidée (#6 : Vite + React + TS + Dexie) — ce code ne sera **pas** promu.
- La barre de commutation reste visible en prod : le déploiement entier est le
  prototype, la cacher n'aurait pas de sens.

## Sortie

Quand une variante (ou un collage de variantes) a gagné : consigner le verdict
sur l'issue de linkage, supprimer `apps/proto-shell`, `k8s/proto-shell`,
le listener Gateway, le rrset DNS et le workflow CI.
