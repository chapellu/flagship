// Les formats de l'écran. Un seul endroit, parce qu'un même nombre écrit de
// deux façons dans deux vues fait douter des deux.

/** 2,5 et non 2.5 : c'est un nombre de parts, pas une mesure d'ingénieur. */
export const fmt = (n: number): string => String(+(+n).toFixed(1)).replace(".", ",");

/** Une durée de cuisine. Au-delà de l'heure on écrit « 1 h 35 » : « 95 min »
 *  oblige le lecteur à diviser, et personne ne divise devant une casserole. */
export const duree = (m: number): string =>
  m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? String(m % 60).padStart(2, "0") : ""}`.trim() : `${m} min`;

/** Une heure de la journée, en minutes depuis minuit. */
export const hhmm = (m: number): string =>
  `${Math.floor((((m % 1440) + 1440) % 1440) / 60)}h${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

export const mmss = (t: number): string =>
  `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

const MAJ = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export { MAJ as majuscule };
