// Le mode guidé, sans son écran : la chauffe, le minuteur, la provenance.
//
// Trois choses vivent ici parce que ce sont des RÈGLES, et qu'une règle se
// vérifie sans monter un DOM : ce que `needs` dit du feu, ce qu'un minuteur
// doit faire quand le téléphone se verrouille, et d'où sort un ingrédient.
//
// Port de `apps/proto-shell/comptoir.js` (`CHAUFFE`, `ecranCuisine`).

import type { Catalogue, Etape, Ingredient } from "../model/types";

/* ───────────────────────────────────────────────────────────────── la chauffe */

export interface Chauffe {
  nom: string;
  /** 0 à 4 — les quatre barres de l'écran. Zéro veut dire « pas de feu », et
   *  c'est une information : on peut faire cette étape n'importe quand. */
  niveau: number;
}

// Le vocabulaire de `needs` appartient au compilateur de recettes ; cette table
// est la seule chose qui le traduise en quelque chose qu'une main comprenne.
const TABLE: { quand: string[]; chauffe: Chauffe }[] = [
  { quand: ["bake", "gratin"], chauffe: { nom: "Four", niveau: 3 } },
  { quand: ["boil", "simmer-large"], chauffe: { nom: "Feu vif", niveau: 4 } },
  { quand: ["pan-fry"], chauffe: { nom: "Feu moyen", niveau: 3 } },
  { quand: ["simmer"], chauffe: { nom: "Feu doux", niveau: 2 } },
  { quand: ["steam"], chauffe: { nom: "Vapeur", niveau: 2 } },
  { quand: ["reheat"], chauffe: { nom: "Réchauffe", niveau: 1 } },
];

export const SANS_FEU: Chauffe = { nom: "Sans feu", niveau: 0 };

/** La chauffe d'une étape. Le PREMIER besoin reconnu gagne : une étape qui
 *  mijote ET remue est une étape qui mijote. */
export function chauffeDe(e: Etape): Chauffe {
  return TABLE.find((t) => e.needs.some((n) => t.quand.includes(n)))?.chauffe ?? SANS_FEU;
}

/* ──────────────────────────────────────────────────────────────── le minuteur */

/**
 * L'état d'un minuteur, tel qu'il se range.
 *
 * UNE ÉCHÉANCE, PAS UN COMPTEUR. Le proto décrémentait une seconde par
 * `setInterval` ; c'est faux dès que l'onglet passe en arrière-plan, où les
 * navigateurs mobiles ralentissent les timers à un battement par minute — le
 * minuteur d'une cuisine, précisément quand on repose le téléphone. Une date de
 * fin ne se trompe jamais : elle ne compte rien, elle se compare.
 */
export type EtatMinuteur = { fin: number } | { reste: number } | null;

export interface Minuteur {
  /** En secondes. */
  reste: number;
  actif: boolean;
  sonne: boolean;
}

export function minuteur(etat: EtatMinuteur, minutes: number, maintenant: number): Minuteur {
  if (etat && "fin" in etat) {
    const reste = Math.max(0, Math.ceil((etat.fin - maintenant) / 1000));
    return { reste, actif: reste > 0, sonne: reste === 0 };
  }
  if (etat) return { reste: etat.reste, actif: false, sonne: false };
  return { reste: minutes * 60, actif: false, sonne: false };
}

/** Ce que fait le doigt : lancer, mettre en pause, reprendre, relancer. Un
 *  minuteur qui a sonné se relance depuis le début — c'est la seule chose
 *  qu'on puisse vouloir d'un minuteur terminé. */
export function basculerMinuteur(
  etat: EtatMinuteur,
  minutes: number,
  maintenant: number,
): EtatMinuteur {
  const m = minuteur(etat, minutes, maintenant);
  if (m.actif) return { reste: m.reste };
  if (etat && "reste" in etat) return { fin: maintenant + etat.reste * 1000 };
  return { fin: maintenant + minutes * 60 * 1000 };
}

/* ─────────────────────────────────────────────────────────── les ingrédients */

export interface Provenance {
  label: string;
  /** Vrai quand la ligne finit sur la liste de courses. */
  acheter: boolean;
}

/**
 * D'où sort un ingrédient, vu de la fiche.
 *
 * Version courte de `calcul.provenance` : ici on n'a pas le dépôt sous la main,
 * et on ne prétend pas savoir si le lot existe. « base » veut dire « ça vient
 * d'un autre plat » — la fiche dit quoi acheter, la semaine dit si c'est là.
 */
export function provenanceIngredient(catalogue: Catalogue, ing: Ingredient): Provenance {
  if (ing.base) return { label: "base", acheter: true };
  const cid = catalogue.rayons.aliases[ing.id] ?? ing.id;
  return catalogue.rayons.placard.includes(cid)
    ? { label: "placard", acheter: false }
    : { label: "à acheter", acheter: true };
}

/* ──────────────────────────────────────────────────────────────── l'avancement */

/** Ce qu'il reste à faire, et sur combien. Les minutes des étapes DÉJÀ faites
 *  ne comptent plus : c'est la seule façon que « reste 25 min sur 50 » veuille
 *  dire quelque chose devant une casserole. */
export function avancement(steps: Etape[], etape: number): { reste: number; total: number } {
  return {
    reste: steps.slice(etape).reduce((a, x) => a + x.minutes, 0),
    total: steps.reduce((a, x) => a + x.minutes, 0),
  };
}
