// Les réglages, et les petits « fait » du quotidien.
//
// La table `reglages` est un clé-valeur, et c'est délibéré : un tableau typé
// par réglage obligerait une migration à chaque nouveau bouton. La forme vit
// donc dans le code qui lit — chaque clé a son helper juste ici, pour que
// personne n'invente la sienne dans un écran.

import { useLiveQuery } from "dexie-react-hooks";
import { base } from "./schema";

/** Un geste du jour marqué fait. La clé porte le JOUR : « sortir la sauce du
 *  congélo » est fait pour aujourd'hui, pas pour toujours — demain le même
 *  geste se reposera, et cochera à nouveau. */
export const cleGeste = (jour: string, type: string): string => `geste|${jour}|${type}`;

/** Un rappel armé sur un créneau. Ce n'est pas encore une notification : le
 *  jour où c'en sera une, c'est cette clé qui dira lesquelles sont armées. */
export const cleRappel = (jour: string, repas: string): string => `rappel|${jour}|${repas}`;

/**
 * Le nombre de fois qu'on a repioché sur un créneau.
 *
 * POURQUOI ÇA SE PERSISTE, alors qu'une main n'est pas une décision : la main
 * est déterministe en (créneau, repioches), donc sans ce compteur, quitter
 * l'écran et y revenir redonne la main qu'on venait justement de refuser. Ce
 * n'est pas une décision sur la semaine, c'est la mémoire d'un refus — et c'est
 * la seule chose qui rende le bouton crédible.
 */
export const cleRepioche = (jour: string, repas: string): string => `repioche|${jour}|${repas}`;

export async function poserReglage(cle: string, valeur: unknown): Promise<void> {
  if (valeur === false || valeur == null) await base.reglages.delete(cle);
  else await base.reglages.put({ cle, valeur, maj: Date.now() });
}

/** Un réglage qui compte. `undefined` tant que la base n'a pas répondu, et
 *  l'appelant DOIT attendre : tirer une main sur un zéro provisoire la
 *  recalculerait entièrement une seconde fois, et c'est le calcul le plus cher
 *  de l'app. */
export function useNombre(cle: string | null): number | undefined {
  const r = useLiveQuery(async () => (cle ? ((await base.reglages.get(cle)) ?? null) : null), [cle]);
  if (r === undefined) return undefined;
  return typeof r?.valeur === "number" ? r.valeur : 0;
}

/** `undefined` tant que la base n'a pas répondu — distinct de « pas coché ». */
export function useDrapeau(cle: string | null): boolean | undefined {
  const r = useLiveQuery(async () => (cle ? ((await base.reglages.get(cle)) ?? null) : null), [cle]);
  if (r === undefined) return undefined;
  return r !== null;
}
