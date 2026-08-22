// Ce que « Les parts » montre — et ce qu'un cran de plus veut dire.
//
// L'ÉCRAN N'A QU'UN SEUL LEVIER, et c'est ce qui le rend lisible : un nombre
// de parts sur un créneau. Tout le reste de la page explique ce que ce nombre
// fait — combien on cuisine vraiment, si ça tient dans la vaisselle, comment
// il se compare au foyer et au reste de la semaine. C'est le même levier que
// « À prévoir » actionne pour agrandir un lot ou prévoir une gamelle ; ici on
// le tient à la main.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranParts`).

import { jourISO } from "../db";
import { facteurAffiche, type Calcul } from "../model/calcul";
import { joue, SAUTE, type Jeu } from "../model/jeu";
import type { Plat } from "../model/types";
import type { CleCreneau } from "../nav/routes";
import { fmt } from "../ui/format";
import { phraseManque } from "../ui/phrases";

/**
 * LE PAS EST D'UN DEMI, ET C'EST LA MAILLE DU MODÈLE AUTANT QUE DU BON SENS :
 * c'est la part d'un petit (le foyer compte 1 + 1 + 0,5 + bébé). Un pas plus
 * fin donnerait des parts qu'aucune recette ne sait exécuter — `echelle()`
 * arrondit déjà les grammes à la dizaine — et demanderait un geste de
 * précision à un pouce qui tient un enfant de l'autre main.
 */
export const PAS = 0.5;

/** En dessous, ce n'est plus une quantité : « personne ne mange ici » est une
 *  autre décision, et elle se dit en sautant le repas. */
export const MINIMUM = 0.5;

/** Le nombre de crans de la règle. Impair, pour que le foyer soit au milieu. */
export const CRANS = 9;

/** Un cran de plus ou de moins, ramené sur la grille du demi. Le `Math.round`
 *  n'est pas décoratif : une valeur venue d'une offre (`demi()`) ou d'un foyer
 *  à 2,5 doit retomber sur la grille, sinon les crans ne marquent plus rien. */
export const bouger = (parts: number, pas: number): number =>
  Math.max(MINIMUM, Math.round((parts + pas) * 2) / 2);

/**
 * Ce qu'on écrit en base pour une valeur affichée.
 *
 * `null` VEUT DIRE « COMME LE FOYER », pas « zéro ». Régler un créneau sur
 * exactement la taille du foyer n'est pas une décision sur ce créneau : c'est
 * l'absence de décision. Y stocker 2,5 figerait un chiffre que le foyer doit
 * pouvoir changer — le jour où un mangeur s'ajoute, les créneaux qu'on n'avait
 * jamais touchés doivent suivre, et eux seuls. Voir `db/schema.ts`.
 */
export const partsAEcrire = (v: number, foyer: number): number | null =>
  Math.abs(v - foyer) < 0.01 ? null : v;

export interface Cran {
  v: number;
  /** La valeur courante. */
  ici: boolean;
  /** La taille du foyer, le repère qu'on cherche du coin de l'œil. */
  foyer: boolean;
}

/**
 * La règle, centrée sur le foyer — et qui SUIT TOUJOURS LA VALEUR.
 *
 * Le proto posait neuf crans à partir de `foyer - 2`, définitivement. Au-delà
 * de `foyer + 2` — un dîner pour huit, ce qui est exactement le cas où l'on
 * regarde la règle — plus aucun cran n'était allumé : la règle continuait
 * d'afficher un voisinage où l'on n'était plus. Une jauge qui cesse de dire où
 * l'on est ment plus qu'elle n'informe. La fenêtre glisse donc du minimum
 * nécessaire pour contenir la valeur ; quand le foyer en sort, c'est la phrase
 * sous le nombre qui garde la comparaison.
 */
export function crans(parts: number, foyer: number, n = CRANS): Cran[] {
  const grille = (v: number): number => Math.max(MINIMUM, Math.round(v * 2) / 2);
  const large = (n - 1) * PAS;
  let debut = grille(foyer - large / 2);
  if (parts < debut) debut = grille(parts);
  if (parts > debut + large) debut = grille(parts - large);
  return Array.from({ length: n }, (_, k) => {
    const v = debut + k * PAS;
    return { v, ici: Math.abs(v - parts) < 0.01, foyer: Math.abs(v - foyer) < 0.01 };
  });
}

/** Ce que le nombre vaut par rapport au foyer, en toutes lettres. */
export const noteDesParts = (parts: number, foyer: number): string =>
  Math.abs(parts - foyer) < 0.01
    ? "comme le foyer"
    : parts > foyer
      ? `+${fmt(parts - foyer)} de plus que le foyer`
      : `${fmt(parts - foyer)} — quelqu’un mange dehors`;

export interface Cuisson {
  facteur: number;
  /** Les parts réellement produites — pas celles qu'on a demandées. */
  produit: number;
  /**
   * POURQUOI ON EN CUISINE PLUS QUE DEMANDÉ, quand c'est le cas.
   *
   * C'est la question que pose l'écran sans y répondre : on descend le nombre
   * de 3 à 2,5 et « cuisiné » ne bouge pas. Ce n'est pas un bug, c'est
   * `facteur()` — un lot entier ne se coupe pas, un plat qui se garde se fait
   * en entier même pour deux. Les deux phrases viennent de la fiche du proto
   * (`carteFiche`), qui les disait déjà ; elles manquaient ici, à l'endroit
   * précis où l'on manipule le chiffre qui ne bouge pas.
   */
  pourquoi: string;
  tient: boolean;
  /** La réserve, au sens de « À prévoir » : ce qui cloche, ou rien. */
  reserve: string;
}

export function cuisson(plat: Plat, parts: number): Cuisson {
  const f = facteurAffiche(plat, parts);
  const produit = +(plat.portions * f).toFixed(1);
  const v = plat.vaisselle;
  const tient = !v || f <= v.facteurMax + 1e-9;
  return {
    facteur: f,
    produit,
    pourquoi:
      produit > parts + 0.05
        ? plat.lotEntier
          ? "Le lot ne se coupe pas."
          : "Ça se garde, autant faire le lot."
        : "",
    tient,
    // « Au-delà, ça ne tient pas », disait le proto — au moment précis où c'est
    // déjà dépassé. On dit ce qui est vrai maintenant, et la limite avec.
    reserve: tient
      ? v
        ? `Tient dans ${v.label}.`
        : "Rien ne borne ce plat."
      : `⚠ Ça ne tient pas dans ${v!.label} — ×${fmt(v!.facteurMax)} au plus.`,
  };
}

export interface LigneApercu {
  i: number;
  creneau: CleCreneau;
  /** « mar déjeuner » — trois lettres suffisent, la colonne est étroite. */
  quand: string;
  /** Le créneau qu'on est en train de régler. */
  ici: boolean;
  saute: boolean;
  quoi: string;
  parts: number;
  partsRegle: boolean;
  souci: string;
}

/**
 * L'aperçu de la semaine — deux écarts au proto, tous les deux parce que le
 * proto ne s'en servait pas.
 *
 * 1. IL CONTIENT LE CRÉNEAU COURANT, marqué. Le proto l'excluait : on réglait
 *    un chiffre au-dessus d'une liste où il ne figurait pas, donc sans jamais
 *    pouvoir le comparer à ce qu'on lui comparait.
 * 2. IL PART DE CE QUI EST DÉCIDÉ, pas des six premiers créneaux de la
 *    semaine. `.slice(0, 6)` montrait lundi et mardi qu'on règle le dîner de
 *    dimanche — la partie de la semaine dont on ne s'occupe pas.
 *
 * Ce qui entre : ce dont quelqu'un a dit quelque chose — un plat posé, un repas
 * sauté, des parts réglées — plus le créneau courant. Quatorze lignes « à
 * poser · 2,5 parts » n'apprendraient rien à personne.
 */
export function apercuDeLaSemaine(jeu: Jeu, calc: Calcul, courant: number): LigneApercu[] {
  const foyer = jeu.catalogue.foyer.parts;
  return jeu.creneaux
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => {
      if (c.nature !== "choisi") return false;
      if (i === courant) return true;
      return jeu.choix[i] != null || (jeu.parts[i] ?? foyer) !== foyer;
    })
    .map(({ c, i }) => {
      const j = jeu.jours[c.jour]!;
      const rid = jeu.choix[i] ?? null;
      const plat = joue(rid) ? jeu.plats[rid] ?? null : null;
      const parts = jeu.parts[i] ?? foyer;
      return {
        i,
        creneau: { jour: jourISO(j.date), repas: c.repas },
        quand: `${j.nom.slice(0, 3)} ${c.label}`,
        ici: i === courant,
        saute: rid === SAUTE,
        quoi: rid === SAUTE ? "on ne mange pas là" : (plat?.titre ?? "à poser"),
        parts,
        partsRegle: parts !== foyer,
        souci: calc.manques
          .filter((m) => m.i === i)
          .map(phraseManque)
          .join(" · "),
      };
    });
}
