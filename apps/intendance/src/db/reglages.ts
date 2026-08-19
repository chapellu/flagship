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

export async function poserReglage(cle: string, valeur: unknown): Promise<void> {
  if (valeur === false || valeur == null) await base.reglages.delete(cle);
  else await base.reglages.put({ cle, valeur, maj: Date.now() });
}

/** `undefined` tant que la base n'a pas répondu — distinct de « pas coché ». */
export function useDrapeau(cle: string | null): boolean | undefined {
  const r = useLiveQuery(async () => (cle ? ((await base.reglages.get(cle)) ?? null) : null), [cle]);
  if (r === undefined) return undefined;
  return r !== null;
}
