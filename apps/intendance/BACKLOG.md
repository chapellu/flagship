# intendance — le vrai squelette

> **intendance** *n.f.* — la conduite d'une maison : ses stocks, ses plafonds,
> son approvisionnement, son calendrier. C'est ce que le modèle calcule ; le mot
> ne se réduit ni au jardin ni à la cuisine, et laisse la place aux facettes qui
> viendront. Dans le code, la coquille reste « la coquille » : le nom de l'app
> et le nom de son châssis n'ont pas à être le même mot.

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

- [x] **T1 — Squelette Vite + React + TS.** `apps/intendance` : Vite 5, React 18, TS
      en `strict`, Vitest, scripts npm (`dev`, `build`, `test`, `typecheck`).
      Un `App.tsx` qui rend « Le comptoir » et rien d'autre. Critère : `npm run
      build` et `npm run typecheck` passent.
- [x] **T2 — Le système de design Organic.** `src/styles/organic.css` : les
      tokens et les primitives (`.btn`, `.card`, `.tag`, la coquille) portés
      depuis `apps/proto-shell/organic.css`, cette fois en `:root` — l'app n'a
      qu'un seul système de design, le scopage sur `.co` n'avait de raison
      d'être que la cohabitation. Polices **auto-hébergées** : le proto payait
      une requête Google à chaque chargement, une PWA hors ligne ne le peut pas.
- [x] **T3 — Les types du catalogue.** `src/model/types.ts` : `Plat`,
      `Ingredient`, `Emit`, `Accept`, `Foyer`, `Creneau`, `Stock`… dérivés de
      `cuisine-data.json`. Plus un chargeur qui valide à l'entrée : un export
      qui a dérivé doit échouer bruyamment, pas produire un écran faux.
- [x] **T4 — Le cœur du modèle.** Port TS de `Stock`, `prelever`, `provenance`,
      `facteur`, `calculer`, `bilanStockage`. Tests unitaires repris des
      contrôles du smoke : le bocal qui se vide au lieu de se dupliquer, la base
      absente qui ne part pas aux courses, les deux plafonds par espace.
      Plus `npm run parite`, qui joue les mêmes semaines dans les deux modèles
      et compare tout ce que `calculer` produit — un port se prouve par
      l'égalité, pas par ses propres tests.
- [x] **T5 — Le reste du modèle.** `offresSurproduction`, `gamelles`,
      `couverture`, `categorie`, `offre`, `main`, `articles`, `parRayon`,
      `minutesParJour`. Tests sur le scoring — c'est lui qui décide ce que
      l'écran propose. `npm run parite` couvre désormais les offres et leurs
      getters, les gamelles, la couverture, le score de chaque carte sur chaque
      créneau libre, la main tirée sur trois repioches, et l'enseigne des
      51 plats.
- [x] **T6 — Dexie.** `src/db/` : schéma versionné, couche d'accès, hooks
      `useLiveQuery`. Quatre tables : `creneaux` (le plat ET les parts, qui sont
      deux décisions sur le même créneau), `courses`, `stock`, `reglages`.
      **La clé d'un créneau est (jour, repas), jamais son index** — sinon une
      semaine qui roule déplace les plats de trois jours sans que rien
      n'échoue. Pas de migration vide en v1 : elle ne s'exécuterait sur aucune
      base et on la croirait testée. À la place, un test épingle la version et
      les tables, et rougira le jour où une table s'ajoute sans migration.
- [x] **T7 — La coquille et le routeur.** Barre du bas (cockpit · cuisine ·
      jardin), sous-nav cuisine, une route par écran. Routeur écrit sur place
      plutôt qu'importé : la navigation est un ensemble FINI et plat, et une
      union discriminée fait vérifier par le compilateur qu'aucun écran n'est
      oublié — ce qu'aucune chaîne `/cuisine/:vue` ne fera. Hash et non chemin :
      un lien profond marche sans que le serveur en sache rien, y compris hors
      ligne. **Un créneau se nomme (jour, repas) dans l'URL aussi**, pour la
      même raison qu'en base. Les dix écrans existent en carton daté de leur
      ticket : une route qui mène au blanc ne se distingue pas d'une route
      cassée.

### Les écrans (portés de `comptoir.js`, un par ticket)

- [x] **T8 — Aujourd'hui.** Ce soir, le geste du jour, l'offre en attente,
      demain. Sans défilement sur un 390 × 844 : mesuré à 666 px de contenu
      pour 666 px de vue. Le geste et le rappel sont des décisions et sont
      persistés, sous une clé qui porte le JOUR — « sortir la sauce du congélo »
      est fait pour aujourd'hui, pas pour toujours.
- [x] **T9 — La semaine.** Sept journées, midi/soir, le point sauge du
      chaînage, la plomberie au doigt. La case ouverte se désigne par
      (jour, repas) comme tout le reste — c'est un regard et pas une décision,
      donc rien en base, mais une fenêtre qui glisse à minuit déplierait la
      carte du voisin. Trois écarts assumés au proto, chacun parce que le proto
      avait tort : les trois chiffres sont NOMMÉS (« 22 articles », pas « 22 »),
      la routine se dit une fois pour la semaine au lieu de sept fois, et
      « Poser un plat » vise le premier créneau libre au lieu du dernier
      touché. Corrigé au passage : la coquille avait `min-height: 100dvh` —
      le premier écran plus long qu'un téléphone emportait la barre du bas
      hors de l'écran.
- [x] **T10 — À prévoir.** Déjà enchaîné / offres ouvertes, avec leurs
      réserves. Les deux gestes de l'écran sont le même geste : agrandir un lot
      comme prévoir une gamelle, c'est **régler les parts d'un créneau amont** —
      le modèle n'a pas d'autre levier, et c'est ce qui rend ces offres
      relisibles ailleurs. La gamelle écrit DEUX décisions (le dîner grossit, le
      midi part sur le reste) : une transaction, sinon un rechargement au mauvais
      moment laisse un dîner cuisiné pour six sans personne pour en manger la
      moitié. Le compte de la pastille vient désormais d'ici — une pastille qui
      annonce un autre nombre que la liste qu'elle ouvre est pire que pas de
      pastille. Deux bugs du proto corrigés, tous deux vus au navigateur :
      l'offre s'arrondissait au demi le PLUS PROCHE et laissait 33 g de sauce
      derrière elle (« en faire 1,36× » devenait « 1,02× » au lieu de
      disparaître) ; et le constat d'une gamelle réglée recomptait la gamelle
      une seconde fois — « 7,5 parts au lieu de 5 » sur un dîner cuisiné pour 5.
- [x] **T11 — Poser un plat.** Les trois chiffres épinglés, les cartes
      consomme/produit. L'écran central de la direction : tout le reste de
      l'app existe pour que ce choix-là soit informé. Le nombre de **repioches
      est persisté** — la main est déterministe en (créneau, repioches), donc
      sans ce compteur, quitter l'écran et revenir redonne la main qu'on venait
      de refuser ; ce n'est pas une décision sur la semaine, c'est la mémoire
      d'un refus. La route `cuisiner` gagne un plat optionnel :
      `#/cuisine/cuisiner/2026-08-22/diner/lentilles-mijotees` — « Fiche »
      s'ouvre sur le CANDIDAT, pas sur ce que le créneau porte encore.
      Mesuré au navigateur : une main sur une semaine pleine coûte **55 à
      62 ms** ici (voir T17).
- [x] **T12 — En cuisine.** Mode guidé, une étape par écran, chauffe et
      minuteur, la liste d'ingrédients à un bouton. Seul écran hors coquille :
      ni barre du bas ni sous-navigation, on le lit à bout de bras. **Ce qui se
      persiste ici n'est pas une décision mais un AVANCEMENT** — où l'on en est
      dans la recette, et jusqu'à quand le minuteur court. C'est le seul état
      dont la perte fasse vraiment mal : un téléphone qui se verrouille à
      l'étape 5 sur 9 avec une casserole sur le feu. Le minuteur est une
      **échéance, pas un compteur** : le proto décrémentait une seconde par
      `setInterval`, ce qui est faux dès que l'onglet passe en arrière-plan —
      les navigateurs mobiles y ralentissent les timers à un battement par
      minute, c'est-à-dire exactement quand on repose le téléphone pour
      cuisiner. Vérifié en décalant l'horloge de la page de dix minutes sans
      laisser tourner un seul battement : le minuteur sonne.
      Quinze plats du catalogue n'ont pas d'étapes ; la fiche s'ouvre alors sur
      la liste d'ingrédients, ce qui est tout ce qu'on peut en dire.
- [x] **T13 — Courses.** Deux modes (magasin / maison), le hors-liste. Le
      premier écran de la direction qui vive sur la persistance : cocher,
      fermer, rouvrir. **La liste est calculée, les marques sont stockées** —
      aucun calcul ne peut retrouver ce qu'un doigt a mis dans un caddie. Le
      mode, lui, n'est PAS persisté : c'est un endroit où l'on se trouve, et
      rouvrir l'app trois jours plus tard sur « à la maison » parce qu'on y
      était samedi serait pire que le tap qu'on économise. Ajouté au proto :
      « Tout rentrer », le geste de vider le sac — on ne rentre pas douze
      articles un par un en tenant un cabas — et le compte des marques
      orphelines (voir ci-dessous). Corrigé au proto : son aide promettait
      qu'un article rentré « rejoint le stock et le plat qui l'attendait passe
      en trouvé », ce qu'il ne faisait pas. L'app non plus, et T15 a montré
      pourquoi ce n'est pas qu'un fil manquant — voir « Rentrer une course ne
      peut pas faire un lot » ci-dessous.
- [x] **T14 — Les parts.** Deux cibles de 64 px, pas de 0,5, l'aperçu de la
      semaine. Le levier le plus conséquent de l'app — les parts d'un créneau
      commandent le panier, les restes et le chaînage — et c'est le même que
      « À prévoir » actionne pour agrandir un lot ou prévoir une gamelle :
      rien de ce que l'app propose ne passe par un chemin qui ne se relise pas
      ici. **La taille du foyer s'écrit `null`**, jamais 2,5 : régler un
      créneau sur exactement le foyer n'est pas une décision sur ce créneau,
      c'est l'absence de décision, et y figer un chiffre priverait ce créneau
      du jour où un mangeur s'ajoute. **Le nombre bouge sous le pouce et la
      base suit** — deux cibles de 64 px sont faites pour être tapées vite, et
      sans ça deux taps rapprochés partent du même état, donc le second se
      perd ; vérifié au navigateur, cinq taps rapides font bien +2,5. Quatre
      écarts au proto : l'aperçu est CLIQUABLE (régler la semaine, c'est régler
      plusieurs créneaux d'affilée) et il contient le créneau courant, marqué,
      au lieu des six premiers de la semaine — on réglait un chiffre au-dessus
      d'une liste où il ne figurait pas ; la règle de crans suit toujours la
      valeur, alors que le proto la figeait sur foyer ± 2 et n'allumait plus
      rien à huit parts, c'est-à-dire exactement le soir où on la regarde ;
      « Cuisiné » dit POURQUOI il ne bouge pas quand on descend le nombre (un
      lot entier ne se coupe pas, un plat qui se garde se fait en entier) ; et
      le « – » se désactive au plancher au lieu de ne rien faire — un rond de
      64 px immobile se lit comme une panne. Corrigé au passage : la réserve
      annonçait « au-delà, ça ne tient pas » au moment précis où c'était déjà
      dépassé.
- [x] **T15 — L'inventaire.** Les catégories et leur fiabilité, les deux
      plafonds par espace, les lots. **La table `stock` est entrée dans le
      calcul** : `Jeu` porte désormais son propre stock, `calculer` et
      `bilanStockage` le lisent là, et `db/stock.ts` l'y repose depuis la base
      — `creerJeu` continue de l'amorcer avec `catalogue.stock` pour qu'un jeu
      sans base reste calculable, ce qui garde `npm run parite` au vert. Le fil
      est vérifié au navigateur de bout en bout : sur un dîner de pâtes qui
      chaîne sur le bocal du congélo, la liste de courses passe de **2 à 5
      articles** quand on retire le bocal, et le budget du congélo de 16 à 18
      places libres. Trois choses que le catalogue ne permettait pas et que la
      base demande : un lot peut être **constaté sans être pesé** (`qty` à
      `null` — le dépôt le sert en entier et le dit `approximatif`, au lieu de
      faire semblant de compter), une quantité sans unité ne chiffre rien, et
      une ligne du dépôt porte une `ref` opaque — la clé de base — pour que
      l'écran retrouve la ligne qu'un doigt touche **sans faire correspondre
      deux listes par leur index**, la même erreur que la clé d'un créneau.
      L'app attend l'amorce avant de dessiner : entre le premier rendu et la
      fin de l'écriture, la table est vide, et une cuisine vide n'est pas un
      état d'attente — c'est une réponse fausse, avec des manques qui
      apparaissent puis disparaissent. **Un seul geste, et il est réversible :
      « je n'en ai plus »**, parce que c'est le mensonge que la persistance
      rendait possible — un bocal mangé hors de l'app restait au congélo pour
      toujours et l'app continuait de chaîner dessus. Il ne s'offre que sur les
      lots CONSTATÉS : ce que la semaine produit est un résultat de calcul, et
      se retire en changeant la semaine. Le lot revient avec sa date de
      naissance, pas celle d'aujourd'hui — annuler une bévue ne doit pas
      rajeunir un bocal de trois semaines. Deux écarts au proto, tous deux
      parce que le proto se contredisait ou criait dans le vide : le compte
      d'un rangement disait « 3 lots » au-dessus d'une liste qui en montrait
      cinq (les mangés comptent, ils se disent), et « dégager une étagère »
      s'affichait sous les trois rangements en permanence — un impératif qui
      est toujours là ne se distingue plus, le jour où il compte. Il ne paraît
      maintenant que quand ça déborde ou qu'il reste moins d'une place.
      Corrigé au passage : un filtre de rangement dont on retire le dernier lot
      se relâche tout seul, au lieu de laisser l'écran sur une liste vide
      titrée d'un rangement qui n'est plus offert.
- [x] **T16 — Le cockpit.** La journée d'abord, les cartes de facette ensuite.
      L'écran d'ouverture de l'app : ce qu'on voit en la lançant n'est pas une
      facette, c'est la journée — sinon la cuisine devient la seule chose qui
      compte, et le jour où le jardin existe il faut rouvrir l'app ailleurs.
      **Le jardin ne produit aucune tâche, et c'est le principal écart au
      proto** : ses trois lignes (« semer la mâche », « observer le bac 2 »,
      « récolter le basilic ») viennent de `data.js`, écrites à la main pour le
      canevas. Aucun modèle ne les calcule, aucune base ne les porte, rien ne
      saurait dire qu'elles sont faites — et un cockpit qui réclame de semer la
      mâche tous les jours de l'année apprend à ne plus lire le cockpit. La
      facette garde sa carte et dit qu'elle n'a pas de modèle. **La pastille de
      la barre du bas est la liste elle-même**, comme celle de « À prévoir »
      depuis T10 : `App` monte la coquille dans un composant à part pour
      pouvoir lire la base au-dessus d'elle, plutôt que de deviner un compte
      que l'écran contredirait. Ajouté au proto : « Poser le dîner de ce soir »
      — le proto pré-remplissait sa semaine au démarrage et ne voyait donc
      jamais un créneau vide, alors que c'est le premier état d'une app qu'on
      installe ; et « on ne mange pas là » retire la ligne, parce que c'est une
      réponse et pas un trou. Le geste du jour a déménagé dans
      `aujourdhui.vue.ts` : deux écrans le disent maintenant, et deux écrans qui
      déduisent chacun de leur côté « sortir le bocal du congélo » finissent par
      le déduire différemment. Trois phrases du proto corrigées, toutes fausses
      pour la même raison — elles décrivaient un état sans le lire : « La
      semaine est posée jusqu'à dimanche » était écrit en dur (faux dès le
      premier créneau vide, et son « dimanche » l'était dès qu'on ouvrait l'app
      un mardi — la fenêtre part d'aujourd'hui) ; « 14 créneaux » comptait les
      créneaux CHOISISSABLES de la semaine, une constante déguisée en chiffre,
      là où ce qui bouge est le nombre de créneaux répondus ; et la ligne des
      courses annonçait « rien de rentré au stock » quel que soit le nombre
      d'articles rentrés — elle lisait les cochés et concluait sur les rentrés.
      Corrigé au navigateur : sur une semaine vide, la carte cuisine affichait
      « 0 article » et « 0 min de cuisine » en pastilles — trois choses à lire
      pour n'en dire aucune. Vérifié au navigateur sur une semaine de cinq
      plats : trois tâches, pastille à 3, et chaque ligne ouvre l'écran qui y
      répond.

### Trouvé en portant, à décider

- [ ] **Le modèle écrit du français.** `Offre.combien`, `deQuoi` et
      `reserves()` rendent des phrases toutes faites — « en faire 1.36× », « un
      lot ne se coupe pas : 0.5 portion(s) de plus à ranger ». Elles portent le
      point décimal anglais et un pluriel entre parenthèses ; l'écran les
      repasse par `virgules()` faute de mieux, parce que la parité avec le proto
      se joue sur ces chaînes exactes. À trancher : le modèle rend-il des
      NOMBRES et l'écran les phrases, ou garde-t-il la parole ? Le premier est
      plus propre et casse la parité ; le second demande d'y écrire un français
      correct. À faire quand `apps/proto-shell` disparaîtra, pas avant.

- [ ] **Le catalogue configure la main, le code l'ignore.** `equilibre.main`
      porte `taille: 5`, `cooldown_jours: 10` et `garantir: [express, souche,
      derive]` ; `main()` code en dur une taille de 4 et les mêmes trois
      enseignes, et ne lit jamais le cooldown. Le port garde ce comportement,
      sinon la parité ne voudrait rien dire. Reste à trancher : la
      configuration a-t-elle raison, ou faut-il la retirer du catalogue ?

- [ ] **Rentrer une course ne peut pas faire un lot.** T15 a branché la table
      `stock` sur le calcul, et la promesse du proto — « l'article rejoint le
      stock, et le plat qui l'attendait passe en trouvé » — reste pourtant
      intenable. Ce n'est pas un fil qui manque, c'est que les deux bouts ne
      parlent pas de la même chose : une ligne de courses est un INGRÉDIENT
      (`oignon`, `pâtes longues`, 140 identifiants), un lot du dépôt est une
      SORTIE de plat (`sauce-bolognaise`, `lentilles-vertes-cuites`, 40 types),
      et les `accepts` ne visent que les secondes. Sur les 140 identifiants
      d'ingrédient du catalogue, un seul coïncide avec un `accepts.type`
      (`parures-legumes`), et il ne s'achète pas. La règle du modèle le dit
      d'ailleurs autrement : une base manquante est `absent`, « à cuisiner
      d'avance », et `absent` ne produit pas de ligne de courses — on n'achète
      nulle part 250 g de lentilles *cuites*. Trancher : ou bien rentrer une
      course écrit un lot d'ingrédient BRUT que le dépôt ne sait pas encore
      servir (et il faudrait alors que `calculer` prélève aussi sur les
      ingrédients, ce qui est une autre modèle), ou bien la phrase du proto
      était fausse et il faut la retirer d'où elle traîne encore. Question pour
      le modèle Python.

- [ ] **Rien n'efface les marques de courses quand la semaine tourne.** Un
      article coché la semaine dernière garde sa marque, et la liste peut
      mentir par omission — la pire façon de mentir pour une liste de courses.
      T13 les compte et offre « Repartir de zéro » plutôt que d'effacer tout
      seul : effacer ce que quelqu'un a coché est un geste qui lui appartient.
      Reste à trancher s'il faut une règle automatique — et alors la table
      `courses` a besoin d'un marqueur de semaine, ce qu'elle n'a pas (elle
      porte `maj`, un horodatage, et la fenêtre de sept jours glisse chaque
      jour : « avant lundi » ne veut rien dire ici).

- [ ] **Le catalogue n'a pas de nom lisible pour ce qu'il produit.** Un `emit`
      porte un `type` (`lentilles-vertes-cuites`, `puree-lentilles-carottes`) et
      une catégorie d'équilibre porte un id (`legumineuse`) — jamais de libellé.
      Les écrans les affichent donc tels quels, identifiants compris : « apporte
      legumineuse, qui manque », « puree-lentilles-carottes » — alors que les
      INGRÉDIENTS, eux, portent un `nom` lisible, ce qui prouve que le format
      sait le faire. Les
      dé-tiretiser produirait du faux français (« puree » sans accent), ce qui
      est pire qu'un jeton qui s'assume. C'est une donnée qui manque au modèle
      Python : un `label` par type et par catégorie, et les huit écrans en
      profitent le même jour.

- [ ] **Un lot congelable posé cette semaine vieillit au frigo.** `calculer`
      range TOUTE sortie avec `location: "frigo"` — le lot n'est pas encore AU
      congélo, il refroidit — mais du coup il sort de la fenêtre de fraîcheur au
      bout de `fenetreFrigo` jours, alors que son `espace` dit congélo. Un plat
      très en aval ne le trouve donc plus. Épinglé par un test dans
      `calcul.test.ts` : le changer sera une décision, pas un effet de bord.
      C'est une question pour le modèle Python, pas pour l'app.

### Le reste

- [ ] **T17 — Perf.** **La cible est peut-être déjà atteinte, et c'est à
      vérifier avant d'optimiser.** T11 a mesuré le pire cas au navigateur :
      tirer une main sur une semaine pleine — donc 51 appels à `calculer` —
      coûte 55 à 62 ms sur cette machine, soit ~0,85 s pour quatorze créneaux
      là où le proto mettait 13,7 s. Reste à mesurer sur un vrai téléphone,
      trois à cinq fois plus lent : si un créneau y coûte 300 ms, l'écran est
      bon et il n'y a rien à mémoïser. Ne pas optimiser avant ce chiffre — la
      mémoïsation de `calculer` coûterait une invalidation à tenir juste, et on
      ne paie pas ça pour un problème qu'on n'a plus.
- [ ] **T18 — PWA.** Manifeste, service worker, installable, utilisable hors
      ligne — l'app se juge sur l'écran d'accueil d'un iPhone, pas dans Safari.
- [ ] **T19 — Déploiement.** Dockerfile, `k8s/intendance`, workflow d'image, rrset
      DNS, listener Gateway. À côté de `proto-shell`, pas à sa place.
- [ ] **T20 — E2E.** Playwright sur les parcours qui comptent : poser une
      semaine, la retrouver après rechargement, cocher des courses et les
      rentrer.

## Sortie

Quand le squelette porte les mêmes verdicts que le proto : supprimer
`apps/proto-shell`, `k8s/proto-shell`, son listener, son rrset et son workflow.
