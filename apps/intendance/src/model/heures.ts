// L'HEURE DU REPAS N'EST PAS UNE DONNÉE DU MODÈLE, et la direction « Le
// comptoir » s'appuie beaucoup dessus : « à table 19h00 », « commencer à
// 17h25 », le rappel dix minutes avant, le compte à rebours du mode guidé.
//
// Le foyer ne porte pas ces heures — ni le catalogue, ni `cuisine-data.json`.
// On les pose ici, en hypothèse assumée et à un seul endroit. Si l'écran gagne,
// c'est au foyer de gagner des heures de repas ; ce fichier disparaîtra alors
// au profit d'un réglage, et les écrans n'auront pas à changer.

import type { RepasId } from "./types";

/** En minutes depuis minuit. */
export const HEURE: Record<RepasId, number> = {
  "petit-dejeuner": 7 * 60 + 30,
  dejeuner: 12 * 60 + 30,
  gouter: 16 * 60 + 30,
  diner: 19 * 60,
};

/** L'heure de passage à table d'un repas, avec un repli qui ne ment pas :
 *  faute de mieux, c'est celle du dîner. */
export const heureDe = (repas: RepasId): number => HEURE[repas] ?? HEURE["diner"] ?? 19 * 60;
