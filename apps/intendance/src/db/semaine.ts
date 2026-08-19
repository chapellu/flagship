// Les décisions de la semaine, entre la base et le modèle.
//
// Le modèle raisonne en index de créneau ; la base range par (jour, repas).
// Ce fichier est le seul endroit où les deux se rencontrent — c'est pour ça
// qu'il est petit et qu'il doit le rester : une seconde traduction ailleurs
// serait une seconde occasion de les désaligner.

import { cleCreneau, jourISO, type Base, type DecisionCreneau } from "./schema";
import type { Choix, Jeu } from "../model/jeu";

/** La clé de base d'un créneau du modèle. */
export function cleDuCreneau(jeu: Jeu, i: number): string | null {
  const c = jeu.creneaux[i];
  if (!c) return null;
  const j = jeu.jours[c.jour];
  if (!j) return null;
  return cleCreneau(jourISO(j.date), c.repas);
}

/** L'index, dans la semaine affichée, du créneau que l'URL désigne. `-1` quand
 *  il tombe hors de la fenêtre — un lien d'hier rouvert aujourd'hui. C'est la
 *  traduction inverse de `cleDuCreneau`, et elle vit ici pour la même raison :
 *  un seul endroit où les deux façons de nommer un créneau se rencontrent. */
export function indexDuCreneau(jeu: Jeu, jour: string, repas: string): number {
  return jeu.creneaux.findIndex((c, i) => {
    void c;
    return cleDuCreneau(jeu, i) === cleCreneau(jour, repas);
  });
}

/** Les décisions qui concernent la semaine affichée, par clé. */
export async function lireSemaine(base: Base, jeu: Jeu): Promise<Map<string, DecisionCreneau>> {
  const jours = jeu.jours.map((j) => jourISO(j.date));
  const debut = jours[0];
  const fin = jours.at(-1);
  if (!debut || !fin) return new Map();
  // Une plage plutôt qu'un `anyOf` : la semaine est contiguë par construction,
  // et l'index `jour` la sert d'un seul coup.
  const lignes = await base.creneaux.where("jour").between(debut, fin, true, true).toArray();
  return new Map(lignes.map((l) => [l.cle, l]));
}

/**
 * Repose les décisions sur la semaine du modèle. MUTE `jeu`, comme tout le
 * reste du modèle, et rend le jeu pour se laisser chaîner.
 *
 * Ce qui n'est pas dans la base reste ce que `creerJeu` a posé : créneau vide,
 * parts du foyer. Une décision qui vise un jour hors de la fenêtre est
 * simplement ignorée — elle n'est pas perdue, elle attend son tour de semaine.
 */
export function hydrater(jeu: Jeu, decisions: Map<string, DecisionCreneau>): Jeu {
  jeu.creneaux.forEach((_, i) => {
    const cle = cleDuCreneau(jeu, i);
    if (!cle) return;
    const d = decisions.get(cle);
    if (!d) return;
    jeu.choix[i] = d.plat as Choix;
    if (d.parts != null) jeu.parts[i] = d.parts;
  });
  return jeu;
}

/** Écrit la décision d'un créneau. `plat` à `null` efface le choix sans oublier
 *  les parts : on peut avoir réglé « 4,5 parts » avant de changer d'avis sur le
 *  plat, et retaper le chiffre serait une punition. */
export async function poser(base: Base, jeu: Jeu, i: number, plat: Choix): Promise<void> {
  const c = jeu.creneaux[i];
  const cle = cleDuCreneau(jeu, i);
  if (!c || !cle) throw new RangeError(`créneau ${i} hors de la semaine`);
  const [jour] = cle.split("|");
  const existant = await base.creneaux.get(cle);
  await base.creneaux.put({
    cle,
    jour: jour!,
    repas: c.repas,
    plat,
    parts: existant?.parts ?? null,
    maj: Date.now(),
  });
  jeu.choix[i] = plat;
}

/** Règle les parts d'un créneau. `null` remet le créneau aux parts du foyer —
 *  ce n'est pas « zéro part », c'est « comme d'habitude ». */
export async function reglerParts(
  base: Base,
  jeu: Jeu,
  i: number,
  parts: number | null,
): Promise<void> {
  const c = jeu.creneaux[i];
  const cle = cleDuCreneau(jeu, i);
  if (!c || !cle) throw new RangeError(`créneau ${i} hors de la semaine`);
  if (parts != null && parts <= 0)
    throw new RangeError("des parts valent au moins un demi — « personne ne mange » se dit en sautant le repas");
  const [jour] = cle.split("|");
  const existant = await base.creneaux.get(cle);
  await base.creneaux.put({
    cle,
    jour: jour!,
    repas: c.repas,
    plat: existant?.plat ?? null,
    parts,
    maj: Date.now(),
  });
  jeu.parts[i] = parts ?? jeu.catalogue.foyer.parts;
}

/** Oublie tout ce qui concerne un créneau — le plat ET les parts. C'est le
 *  geste « je n'ai rien décidé ici », distinct de « je saute ce repas ». */
export async function oublier(base: Base, jeu: Jeu, i: number): Promise<void> {
  const cle = cleDuCreneau(jeu, i);
  if (!cle) throw new RangeError(`créneau ${i} hors de la semaine`);
  await base.creneaux.delete(cle);
  jeu.choix[i] = null;
  jeu.parts[i] = jeu.catalogue.foyer.parts;
}

/** Les décisions passées, pour le ménage. Rien ne les efface automatiquement :
 *  une semaine écoulée est un journal, et c'est au foyer de dire quand il
 *  cesse de l'intéresser. */
export const decisionsAvant = (base: Base, jour: string): Promise<DecisionCreneau[]> =>
  base.creneaux.where("jour").below(jour).toArray();
