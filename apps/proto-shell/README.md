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

## Règles du prototype

- Données **en mémoire, en dur** (`data.js`) : le vrai site de Francheville
  (Workspace#2) et la sortie réelle du recipe-compiler (ticket #31).
- Aucune persistance, aucun backend, pas de service worker, pas de tests.
- Pas de build : HTML/CSS/JS vanilla servis par nginx. La vraie app suivra la
  stack décidée (#6 : Vite + React + TS + Dexie) — ce code ne sera **pas** promu.
- La barre de commutation reste visible en prod : le déploiement entier est le
  prototype, la cacher n'aurait pas de sens.

## Sortie

Quand une variante (ou un collage de variantes) a gagné : consigner le verdict
sur l'issue de linkage, supprimer `apps/proto-shell`, `k8s/proto-shell`,
le listener Gateway, le rrset DNS et le workflow CI.
