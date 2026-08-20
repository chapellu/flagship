// Les routes — dix écrans, et de quoi les nommer dans une URL.
//
// UN ROUTEUR ÉCRIT ICI PLUTÔT QU'IMPORTÉ, et ce n'est pas de la fierté mal
// placée. La navigation de cette app est un ENSEMBLE FINI et plat : dix écrans,
// aucun imbriqué, un seul paramètre. React Router apporterait des `Outlet`, des
// `loader`, un `Provider` et vingt kilo-octets pour une chose qu'un
// `hashchange` et une union discriminée font mieux — parce qu'ici le
// compilateur vérifie qu'on n'a pas oublié un écran, ce qu'aucune chaîne
// « /cuisine/:vue » ne fera jamais.
//
// Le jour où une route s'imbrique vraiment, l'échange est contenu : tout passe
// par `useRoute()` et `chemin()`, et rien d'autre ne lit le hash.
//
// POURQUOI LE HASH ET PAS LE CHEMIN. Une PWA servie en statique doit renvoyer
// index.html sur n'importe quelle profondeur d'URL, sinon un lien profond
// rouvert depuis l'écran d'accueil tombe sur un 404 du serveur. Le hash
// n'atteint jamais le serveur : le lien marche avant que nginx en sache rien,
// et il marchera encore le jour où l'app est ouverte hors ligne.
//
// ────────────────────────────────────────────────────────────────────────────
// UN CRÉNEAU SE NOMME (JOUR, REPAS) DANS L'URL AUSSI.
//
// Même raison qu'en base (voir `db/schema.ts`) : `#/cuisine/poser/8` désigne le
// dîner de mercredi aujourd'hui, et celui de samedi après-demain. Une URL qu'on
// s'envoie à soi-même pour la rouvrir sur le téléphone est exactement le cas
// où le décalage se produit — et exactement celui où on ne le remarquerait pas.
// ────────────────────────────────────────────────────────────────────────────

import type { RepasId } from "../model/types";

/** Un créneau, tel qu'une URL et une base savent le nommer. */
export interface CleCreneau {
  /** `AAAA-MM-JJ`, local. */
  jour: string;
  repas: RepasId;
}

export type Route =
  | { ecran: "cockpit" }
  | { ecran: "jardin" }
  | { ecran: "aujourdhui" }
  | { ecran: "semaine" }
  | { ecran: "prevoir" }
  | { ecran: "courses" }
  | { ecran: "stock" }
  | { ecran: "poser"; creneau: CleCreneau }
  | { ecran: "parts"; creneau: CleCreneau }
  // « En cuisine » peut viser un plat qui n'est pas (encore) celui du créneau :
  // la fiche s'ouvre depuis une carte qu'on n'a pas posée, pour la lire avant
  // de choisir. Sans `plat`, c'est le plat du créneau qui s'affiche.
  | { ecran: "cuisiner"; creneau: CleCreneau; plat?: string };

export type Ecran = Route["ecran"];

/** L'écran d'ouverture. Le cockpit montre la journée, pas la facette : c'est la
 *  promesse de la coquille, et donc ce qu'on voit en lançant l'app. */
export const ROUTE_DEFAUT: Route = { ecran: "cockpit" };

/** Les écrans qui appartiennent à la facette cuisine — ceux qui portent
 *  l'en-tête et la sous-navigation. */
const DANS_CUISINE: ReadonlySet<Ecran> = new Set<Ecran>([
  "aujourdhui", "semaine", "prevoir", "courses", "stock", "poser", "parts",
]);

export const dansCuisine = (r: Route): boolean => DANS_CUISINE.has(r.ecran);

/** « En cuisine » sort de la coquille : le mode guidé prend l'écran entier,
 *  parce qu'on le lit à bout de bras avec les mains sales. */
export const pleinEcran = (r: Route): boolean => r.ecran === "cuisiner";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

const SANS_PARAM: Record<string, Ecran> = {
  "": "cockpit",
  cockpit: "cockpit",
  jardin: "jardin",
  "cuisine": "aujourdhui",
  "cuisine/semaine": "semaine",
  "cuisine/prevoir": "prevoir",
  "cuisine/courses": "courses",
  "cuisine/stock": "stock",
};

const AVEC_CRENEAU: Record<string, Extract<Ecran, "poser" | "parts" | "cuisiner">> = {
  "cuisine/poser": "poser",
  "cuisine/parts": "parts",
  "cuisine/cuisiner": "cuisiner",
};

/** Le chemin d'une route, hash compris — la seule façon d'en fabriquer un. */
export function chemin(r: Route): string {
  switch (r.ecran) {
    case "cockpit": return "#/cockpit";
    case "jardin": return "#/jardin";
    case "aujourdhui": return "#/cuisine";
    case "semaine": return "#/cuisine/semaine";
    case "prevoir": return "#/cuisine/prevoir";
    case "courses": return "#/cuisine/courses";
    case "stock": return "#/cuisine/stock";
    case "poser": return `#/cuisine/poser/${r.creneau.jour}/${r.creneau.repas}`;
    case "parts": return `#/cuisine/parts/${r.creneau.jour}/${r.creneau.repas}`;
    case "cuisiner":
      return `#/cuisine/cuisiner/${r.creneau.jour}/${r.creneau.repas}${r.plat ? `/${r.plat}` : ""}`;
  }
}

/**
 * Lit une route dans un hash. Tout ce qui ne se comprend pas retombe sur
 * l'écran d'ouverture : une URL tapée de travers ne doit pas produire un écran
 * blanc, elle doit produire le cockpit.
 */
export function lireRoute(hash: string): Route {
  const brut = hash.replace(/^#\/?/, "").replace(/\/+$/, "");

  const simple = SANS_PARAM[brut];
  if (simple) return { ecran: simple } as Route;

  const morceaux = brut.split("/");
  // La fiche d'un plat qu'on n'a pas encore posé : un segment de plus.
  if (morceaux.length === 5 && `${morceaux[0]}/${morceaux[1]}` === "cuisine/cuisiner") {
    const [, , jour, repas, plat] = morceaux as [string, string, string, string, string];
    if (JOUR.test(jour) && repas && plat) return { ecran: "cuisiner", creneau: { jour, repas }, plat };
  }
  if (morceaux.length === 4) {
    const [a, b, jour, repas] = morceaux as [string, string, string, string];
    const ecran = AVEC_CRENEAU[`${a}/${b}`];
    // Le jour doit ressembler à un jour, sinon la clé de base qu'on en tirera
    // ne désignera rien et l'écran s'ouvrira sur un créneau fantôme.
    if (ecran && JOUR.test(jour) && repas) return { ecran, creneau: { jour, repas } };
  }
  return ROUTE_DEFAUT;
}

/** Deux routes qui désignent le même écran. Sert à la navigation : la barre du
 *  bas s'allume sur « cuisine » quel que soit l'écran de cuisine ouvert. */
export const memeEcran = (a: Route, b: Route): boolean => a.ecran === b.ecran;
