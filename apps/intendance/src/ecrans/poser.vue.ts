// Ce qu'une carte jouable montre.
//
// LE GESTE CENTRAL DE LA DIRECTION : le coût pendant qu'on choisit, pas après.
// Une carte dit ce qu'elle CONSOMME et ce qu'elle PRODUIT — d'un côté ce
// qu'elle prend au dépôt et ce qu'elle ajoute au panier, de l'autre ce qu'elle
// laissera aux jours suivants. C'est la seule vue de l'app où les deux se
// lisent ensemble, et c'est ce qui permet de choisir autrement qu'à l'envie.
//
// Les quatre états sont un VOCABULAIRE FERMÉ, et c'est délibéré : « trouvé »,
// « pas assez », « absent », « à acheter » se retiennent en une semaine
// d'usage. Une phrase par cas ne se retiendrait jamais.
//
// Port de `apps/proto-shell/comptoir.js` (`carteJouable`).

import type { Carte } from "../model/scoring";
import type { Plat } from "../model/types";
import { fmt } from "../ui/format";
import { iconeEspace, type NomIcone } from "../ui/icones";

export type EtatEntree = "trouvé" | "pas assez" | "absent" | "à acheter";

export interface Entree {
  etat: EtatEntree;
  texte: string;
}

export interface Sortie {
  icone: NomIcone;
  texte: string;
}

/** La classe CSS d'un état. Deux couleurs seulement : le sauge pour ce qui est
 *  là, le terracotta pour ce qui manque. « À acheter » n'est ni l'un ni
 *  l'autre — ce n'est pas un problème, c'est une ligne de plus sur la liste. */
export const classeEtat = (e: EtatEntree): string =>
  e === "trouvé" ? "trouve" : e === "pas assez" ? "court" : "";

/** Ce que la carte consomme. La dernière ligne est toujours le coût au panier :
 *  c'est celle qu'on cherche, donc elle est toujours au même endroit. */
export function entreesDeLaCarte(c: Carte): Entree[] {
  const p = c.plat;
  const e: Entree[] = [];

  if (c.chaine)
    e.push({
      etat: c.partiel ? "pas assez" : "trouvé",
      texte: c.recit || "base déjà cuite",
    });

  // « Ça ne s'achète pas » n'est pas une formule : un `accepts` sans
  // équivalent au magasin ne se répare qu'en cuisinant le plat amont.
  if (c.manque)
    e.push({
      etat: "absent",
      texte: `demande ${p.accepts.map((a) => a.type ?? `un ${a.kind}`).join(", ")} — ça ne s’achète pas`,
    });

  if (c.plein && p.sansReste)
    e.push({
      etat: "pas assez",
      texte: `sans le reste : +${p.sansReste.minutes} min et ${p.sansReste.ingredients
        .map((x) => x.nom)
        .join(", ")}`,
    });

  e.push({
    etat: c.marginal === 0 ? "trouvé" : "à acheter",
    texte:
      c.marginal === 0
        ? "rien de plus à acheter"
        : `${c.marginal} article${c.marginal > 1 ? "s" : ""} de plus au panier`,
  });

  return e;
}

/**
 * Ce que la carte produit — ce qu'elle laissera derrière elle.
 *
 * Les quantités s'écrivent « par lot » et NON à l'échelle du créneau : à ce
 * moment-là le plat n'est pas encore posé, et les parts peuvent encore changer.
 * Annoncer 1 400 g pour en livrer 700 serait une promesse qu'on ne tient pas.
 */
export function sortiesDeLaCarte(p: Plat): Sortie[] {
  const s: Sortie[] = p.emits.map((e) => ({
    // Un reste de plat va au frigo, quoi qu'il arrive : on ne congèle pas une
    // assiette de la veille sans le décider.
    icone: iconeEspace(e.kind === "reste-plat" ? "frigo" : e.congelo ? "congelo" : "frigo"),
    texte: `${e.type}${e.qty?.amount != null ? ` · ${fmt(e.qty.amount)} ${e.qty.unit} par lot` : ""}`,
  }));
  if (p.bebe) s.push({ icone: "bebe", texte: `portion bébé — ${p.bebe}` });
  return s;
}
