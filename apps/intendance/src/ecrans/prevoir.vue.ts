// Ce que « À prévoir » montre — et ce que répondre « oui » veut dire.
//
// L'écran ne contient que deux gestes, et ils se ressemblent plus qu'il n'y
// paraît : AGRANDIR UN LOT et PRÉVOIR UNE GAMELLE sont tous les deux « régler
// les parts d'un créneau amont ». C'est heureux, et c'est même la raison pour
// laquelle ces offres sont honnêtes : le modèle n'a pas d'autre levier qu'un
// nombre de parts, donc rien ne se passe ici qui ne se relise ailleurs. Un
// facteur d'échelle caché, lui, ne s'expliquerait sur aucun autre écran.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranPrevoir`, `[data-gamelle]`,
// `[data-offre]`).

import type { Calcul } from "../model/calcul";
import type { Jeu } from "../model/jeu";
import { gamelles, offresSurproduction, type Gamelle, type Offre } from "../model/offres";
import { fmt } from "../ui/format";

/**
 * Les parts se règlent au demi près — c'est la maille du modèle, et celle du
 * bon sens : personne ne cuisine 4,3 parts.
 *
 * AU DEMI SUPÉRIEUR, ET C'EST TOUT LE SUJET. Le proto arrondissait au plus
 * proche, et une offre qui demandait 8,02 parts en écrivait 8 : le manque
 * revenait, plus petit, avec sa pastille et son bouton. Vu au navigateur —
 * « en faire 1,36× » devenait « en faire 1,02× » au lieu de disparaître. Une
 * offre promet de couvrir le manque ; elle ne peut pas s'arrondir en dessous
 * de sa propre promesse. (L'epsilon évite qu'un 8,0 flottant devienne 8,5.)
 */
const demi = (n: number): number => Math.ceil(n * 2 - 1e-9) / 2;

export interface GamelleOuverte {
  g: Gamelle;
  /** Ce qui cloche, dit en toutes lettres. Trois choses possibles, et ce ne
   *  sont pas les mêmes gestes pour les réparer. */
  freins: string[];
}

export interface VuePrevoir {
  /** Les gamelles qui attendent une réponse. */
  ouvertes: GamelleOuverte[];
  /** Les offres d'agrandir un lot amont. */
  offres: Offre[];
  /** Ce qui s'enchaîne déjà : un constat, pas une demande. */
  faites: Gamelle[];
  /** Ce qui attend une réponse — le chiffre de la pastille, à l'unité près. */
  enAttente: number;
}

export function vueAPrevoir(jeu: Jeu, calc: Calcul): VuePrevoir {
  const gam = gamelles(jeu, jeu.choix);
  const ouvertes = gam
    .filter((g) => !g.fait && g.plat)
    .map((g) => ({ g, freins: freinsDeLaGamelle(g) }));
  const offres = offresSurproduction(jeu, jeu.choix, calc);
  return {
    ouvertes,
    offres,
    faites: gam.filter((g) => g.fait && g.plat),
    enAttente: ouvertes.length + offres.length,
  };
}

/**
 * Ce qui cloche dans une gamelle. `transportable` et `laisseReste` valent
 * `null` quand le dîner de la veille n'est pas encore posé : on ne reproche
 * rien à un plat qui n'existe pas, donc `=== false` et non `!`.
 */
export function freinsDeLaGamelle(g: Gamelle): string[] {
  const f: string[] = [];
  if (g.transportable === false) f.push("⚠ ce plat voyage mal");
  if (g.laisseReste === false) f.push("⚠ il ne laisse pas de reste réutilisable");
  if (!g.tientVaisselle && g.plat?.vaisselle)
    f.push(`⚠ ${fmt(g.total)} parts ne tiennent pas dans ${g.plat.vaisselle.label}`);
  return f;
}

/** Ce que « Prévoir la gamelle » écrit sur le dîner de la veille. */
export const partsDeLaGamelle = (g: Gamelle): number => demi(g.total);

/**
 * Ce qu'on dit d'une gamelle DÉJÀ enchaînée.
 *
 * `total` n'a plus de sens une fois le geste fait : la veille a grossi, donc
 * `partsVeille + partsGamelle` recompte la gamelle une seconde fois et annonce
 * un agrandissement qui n'aura pas lieu. Le proto affichait ainsi « 7,5 parts
 * au lieu de 5 » sur un dîner cuisiné pour 5. Ce qui est vrai après coup, c'est
 * ce que la veille cuisine et ce que le midi y prend.
 */
export const constatDeLaGamelle = (g: Gamelle): { cuisinees: number; pourLeMidi: number } => ({
  cuisinees: g.partsVeille,
  pourLeMidi: g.partsGamelle,
});

/**
 * Ce que « Agrandir le lot » écrit sur le créneau amont.
 *
 * JAMAIS MOINS QU'AUJOURD'HUI : l'offre propose un lot qui couvre le manque,
 * mais si le foyer a déjà réglé ce dîner plus grand pour une autre raison —
 * des invités —, accepter l'offre ne doit pas le rétrécir dans son dos.
 */
export function partsPourLOffre(jeu: Jeu, o: Offre): number {
  const p = jeu.plats[o.rid];
  const actuel = jeu.parts[o.creneau] ?? jeu.catalogue.foyer.parts;
  if (!p) return actuel;
  return Math.max(actuel, demi(o.facteurPropose * p.portions));
}
