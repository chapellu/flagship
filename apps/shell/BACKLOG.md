# shell — le vrai squelette

**Ceci n'est pas un prototype.** `apps/proto-shell` répondait à une question de
design et sera supprimé ; ceci est l'app, sur la stack décidée par
[Workspace#6](https://github.com/chapellu/Workspace/issues/6) : **Vite + React +
TypeScript + Dexie**.

Le shell multi-facettes de [Workspace#36](https://github.com/chapellu/Workspace/issues/36) :
une seule app installée, portant les facettes de vie (cuisine, jardin, …). La
facette cuisine prend la forme de la **direction 1 « Le comptoir »** du canevas
Claude Design, déjà transcrite en vanilla dans `apps/proto-shell/comptoir.js` —
ce fichier est la **spécification exécutable** du port React : il a résolu, une
par une, toutes les questions de branchement au modèle.

## Ce qui change par rapport au proto

| Le proto | Le squelette |
|---|---|
| état en mémoire, perdu au rechargement | **Dexie**, l'état survit — c'est le point de bascule demandé |
| `semaine.js` en JS, sans types | modèle TypeScript, types dérivés de l'export |
| un `innerHTML` géant par écran | composants React, un écran par route |
| `offre()` recalculé à chaque rendu (13,7 s pour poser 14 créneaux) | mémoïsation, et le calcul hors du fil principal si besoin |
| pas de build, nginx sert des fichiers | build Vite, image, k8s, PWA installable |

## Ce que « persistance » veut dire ici

L'hypothèse, à corriger si elle est fausse : ce qui doit survivre au
rechargement, c'est **ce qu'un doigt a décidé**, pas ce qu'un calcul a déduit.

- **persisté** : la semaine posée (plat par créneau, repas sautés), les parts
  réglées, les courses cochées puis rentrées, le stock réel du foyer, les
  réglages du foyer ;
- **recalculé** : le panier, le chaînage, les manques, les offres, le bilan de
  rangement — tout ce que `calculer()` dérive. Persister un résultat de calcul,
  c'est se garantir qu'il divergera un jour de ses entrées.

## Les tickets

Un ticket = un commit qui laisse l'app fonctionnelle. `[ ]` à faire,
`[~]` en cours, `[x]` fait.

### Fondations

- [x] **T1 — Squelette Vite + React + TS.** `apps/shell` : Vite 5, React 18, TS
      en `strict`, Vitest, scripts npm (`dev`, `build`, `test`, `typecheck`).
      Un `App.tsx` qui rend « Le comptoir » et rien d'autre. Critère : `npm run
      build` et `npm run typecheck` passent.
- [x] **T2 — Le système de design Organic.** `src/styles/organic.css` : les
      tokens et les primitives (`.btn`, `.card`, `.tag`, la coquille) portés
      depuis `apps/proto-shell/organic.css`, cette fois en `:root` — l'app n'a
      qu'un seul système de design, le scopage sur `.co` n'avait de raison
      d'être que la cohabitation. Polices **auto-hébergées** : le proto payait
      une requête Google à chaque chargement, une PWA hors ligne ne le peut pas.
- [ ] **T3 — Les types du catalogue.** `src/model/types.ts` : `Plat`,
      `Ingredient`, `Emit`, `Accept`, `Foyer`, `Creneau`, `Stock`… dérivés de
      `cuisine-data.json`. Plus un chargeur qui valide à l'entrée : un export
      qui a dérivé doit échouer bruyamment, pas produire un écran faux.
- [ ] **T4 — Le cœur du modèle.** Port TS de `Stock`, `prelever`, `provenance`,
      `facteur`, `calculer`, `bilanStockage`. Tests unitaires repris des
      contrôles du smoke : le bocal qui se vide au lieu de se dupliquer, la base
      absente qui ne part pas aux courses, les deux plafonds par espace.
- [ ] **T5 — Le reste du modèle.** `offresSurproduction`, `gamelles`,
      `couverture`, `categorie`, `offre`, `main`, `articles`, `parRayon`,
      `minutesParJour`. Tests sur le scoring — c'est lui qui décide ce que
      l'écran propose.
- [ ] **T6 — Dexie.** `src/db/` : schéma versionné (`semaine`, `parts`,
      `courses`, `stock`, `foyer`), couche d'accès, hooks `useLiveQuery`.
      Une migration, même vide, dès la v1 : la première migration écrite après
      coup est toujours celle qui perd des données.
- [ ] **T7 — La coquille et le routeur.** Barre du bas (cockpit · cuisine ·
      jardin), sous-nav cuisine, une route par écran — un écran doit être
      atteignable par URL, sinon il n'est pas testable au téléphone.

### Les écrans (portés de `comptoir.js`, un par ticket)

- [ ] **T8 — Aujourd'hui.** Ce soir, le geste du jour, l'offre en attente,
      demain. Sans défilement sur un 390 × 844 : c'est la thèse de l'écran.
- [ ] **T9 — La semaine.** Sept journées, midi/soir, le point sauge du
      chaînage, la plomberie au doigt.
- [ ] **T10 — À prévoir.** Déjà enchaîné / offres ouvertes, avec leurs réserves.
- [ ] **T11 — Poser un plat.** Les trois chiffres épinglés, les cartes
      consomme/produit. L'écran central de la direction.
- [ ] **T12 — En cuisine.** Mode guidé, une étape par écran, chauffe et
      minuteur, la liste d'ingrédients à un bouton.
- [ ] **T13 — Courses.** Deux modes (magasin / maison), le hors-liste. Le
      premier écran qui prouve la persistance : cocher, fermer, rouvrir.
- [ ] **T14 — Les parts.** Deux cibles de 64 px, pas de 0,5, l'aperçu de la
      semaine.
- [ ] **T15 — L'inventaire.** Les catégories et leur fiabilité, les deux
      plafonds par espace, les lots.
- [ ] **T16 — Le cockpit.** La journée d'abord, les cartes de facette ensuite.

### Le reste

- [ ] **T17 — Perf.** Mémoïser `offre()` / `calculer()`. Cible : poser les
      quatorze créneaux sous 1 s sur un téléphone. Le proto y mettait 13,7 s.
- [ ] **T18 — PWA.** Manifeste, service worker, installable, utilisable hors
      ligne — l'app se juge sur l'écran d'accueil d'un iPhone, pas dans Safari.
- [ ] **T19 — Déploiement.** Dockerfile, `k8s/shell`, workflow d'image, rrset
      DNS, listener Gateway. À côté de `proto-shell`, pas à sa place.
- [ ] **T20 — E2E.** Playwright sur les parcours qui comptent : poser une
      semaine, la retrouver après rechargement, cocher des courses et les
      rentrer.

## Sortie

Quand le squelette porte les mêmes verdicts que le proto : supprimer
`apps/proto-shell`, `k8s/proto-shell`, son listener, son rrset et son workflow.
