// Les phrases que plusieurs écrans disent du même objet.
//
// Un manque écrit « manque 400 g de sauce » ici et « il manque 400g sauce »
// ailleurs fait douter des deux : le lecteur se demande si ce sont deux
// choses. Une phrase partagée n'est pas de la factorisation, c'est la
// condition pour qu'on lui fasse confiance.

import type { Manque } from "../model/calcul";
import { fmt } from "./format";

/**
 * Ce qui manque à un créneau, en toutes lettres et sans unité fantôme : une
 * grandeur non chiffrée (« 2 œufs ») n'a pas d'unité, et le trou qu'elle
 * laissait dans la phrase se voyait.
 */
export const phraseManque = (m: Manque): string =>
  ["manque", fmt(m.manque), m.unite, "de", m.acc.type ?? m.acc.kind]
    .filter((x): x is string => !!x)
    .join(" ");
