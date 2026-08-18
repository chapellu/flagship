# shell — l'app

Le shell multi-facettes de [Workspace#36](https://github.com/chapellu/Workspace/issues/36) :
une seule app installée, portant les facettes de vie (cuisine, jardin, …). La
facette cuisine prend la forme de la direction « Le comptoir » du canevas
Claude Design.

**Ce n'est pas `apps/proto-shell`.** Le proto répondait à une question de design
avec du code jetable et sans persistance ; celui-ci est l'app, sur la stack
décidée par [Workspace#6](https://github.com/chapellu/Workspace/issues/6) :
Vite + React + TypeScript + Dexie.

## Faire tourner

```sh
npm install
npm run dev        # écoute sur 0.0.0.0 — l'app se juge sur un téléphone du réseau
npm run typecheck
npm test
npm run build
```

`npm run build` typecheck avant de construire : un `dist/` qui sort d'un code
qui ne compile pas n'a rien à faire dans une image.

## L'état des travaux

`BACKLOG.md` porte les vingt tickets et leur avancement. Un ticket = un commit
qui laisse l'app fonctionnelle.
