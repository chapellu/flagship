// Ce que « Aujourd'hui » lit du modèle — la part qui n'a pas besoin d'un DOM.
//
// Un seul habitant pour l'instant : LE GESTE DU JOUR. Il vivait dans
// `Aujourdhui.tsx`, ce qui allait tant qu'un seul écran le disait. Le cockpit
// le redemande (T16), et deux écrans qui déduisent chacun de leur côté « sortir
// le bocal du congélo » finissent par le déduire différemment — l'un le montre,
// l'autre pas, et on ne sait plus lequel a raison.

import type { Calcul } from "../model/calcul";
import { joue, type Jeu } from "../model/jeu";

export interface GesteDuJour {
  /** Le type de sortie à aller chercher — c'est aussi la clé du « fait ». */
  type: string;
  quand: string;
  titre: string;
}

/**
 * LE GESTE DU SOIR, dérivé du chaînage. Un plat de demain qui prend dans le
 * congélo demande une décision ce soir : sortir le lot, sinon il sera pris en
 * bloc à 19 h. Le canevas de design l'écrivait en dur ; c'est en réalité une
 * lecture du dépôt, et c'est ce qui la rend juste tous les jours.
 */
export function gesteDuJour(jeu: Jeu, calc: Calcul): GesteDuJour | null {
  for (const [i, c] of jeu.creneaux.entries()) {
    if (c.jour !== 1) continue;
    const rid = jeu.choix[i];
    if (!joue(rid ?? null)) continue;
    const ch = calc.chaine.find((x) => x.creneau === i);
    if (!ch) continue;
    const lot = calc.depot.lignes.find((l) => l.type === ch.type && l.espace === "congelo");
    if (!lot) continue;
    return { type: ch.type, quand: `${c.label} de demain`, titre: jeu.plats[rid as string]?.titre ?? "" };
  }
  return null;
}

/** Ce que le geste demande, et pourquoi. Deux écrans le disent — l'un le fait
 *  cocher, l'autre le rappelle — et ils doivent le dire avec les mêmes mots :
 *  un geste reformulé se lit comme un second geste. */
export const titreDuGeste = (g: GesteDuJour): string => `Sortir ${g.type} du congélo`;
export const detailDuGeste = (g: GesteDuJour): string => `Pour ${g.titre} — ${g.quand}`;
