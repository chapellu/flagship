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

/**
 * Un point décimal anglais, dans une phrase déjà écrite par le modèle.
 *
 * `Offre.combien` et `Offre.reserves()` sortent du français tout fait — « en
 * faire 1.36× » — parce que le modèle Python le faisait avant eux. On ne les
 * corrige pas à la source : la parité avec `apps/proto-shell/semaine.js` se
 * joue sur ces chaînes exactes, et c'est elle qui prouve le port. L'écran, lui,
 * écrit en français. Le point n'est remplacé QU'ENTRE DEUX CHIFFRES, pour ne
 * pas manger une fin de phrase.
 */
export const virgules = (s: string): string => s.replace(/(\d)\.(\d)/g, "$1,$2");

export const mmss = (t: number): string =>
  `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

const MAJ = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export { MAJ as majuscule };
