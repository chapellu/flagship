// La semaine, et ce qu'un doigt y a posé.
//
// LA SEMAINE EST FAITE DE CRÉNEAUX, PAS DE JOURS.
// Un créneau = (jour, repas). Les trois repas sont planifiés, une vingtaine par
// semaine. L'ordre chronologique porte la sémantique : le midi du jour 3 est
// calculé AVANT le soir du jour 3, donc il ne peut voir que ce que le jour 2 a
// laissé derrière lui.
//
// Port de `apps/proto-shell/semaine.js` (`creerJeu`, `SAUTE`, `joue`), lui-même
// transcrit du modèle Python de référence (Workspace, recipe-compiler). Le
// comportement ne change pas ici — c'est un port, pas une refonte. Ce que le
// port ajoute, ce sont les types, et deux ou trois endroits où le JS se
// reposait sur `undefined` là où TypeScript demande une décision.

import type { LotInitial } from "./depot";
import type { Catalogue, NatureCreneau, Plat, RepasId } from "./types";

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/** UN REPAS SAUTÉ N'EST PAS UN REPAS VIDE. « On ne mange pas là » (restaurant,
 *  chez des amis, week-end nomade) est une DÉCISION ; un créneau vide est une
 *  décision qui n'a pas encore été prise. Les confondre laissait la semaine se
 *  plaindre de trous qu'on avait choisis. */
export const SAUTE = "__saute";

/** Ce qu'un créneau porte : un identifiant de plat, la décision de sauter, ou
 *  rien encore. */
export type Choix = string | typeof SAUTE | null;

/** Vrai seulement pour un plat réellement joué — ni vide, ni sauté. */
export const joue = (rid: Choix): rid is string => !!rid && rid !== SAUTE;

export interface JourSemaine {
  nom: string;
  date: Date;
}

export interface CreneauSemaine {
  /** Index dans `jeu.jours`. */
  jour: number;
  repas: RepasId;
  label: string;
  nature: NatureCreneau;
  /** Ce repas part en gamelle : il doit voyager, et il se cuisine la veille. */
  emporte: boolean;
}

export interface Jeu {
  catalogue: Catalogue;
  /**
   * CE QUE LA CUISINE PORTE DÉJÀ — et pas ce que le catalogue en disait le jour
   * de l'export.
   *
   * `creerJeu` l'amorce avec `catalogue.stock`, parce qu'un jeu construit sans
   * base doit rester calculable : c'est ce que font les tests du modèle et
   * `npm run parite`, et c'est ce qui garde le port comparable au proto. Mais
   * dès qu'il y a une base, c'est elle qui l'écrase (voir `db/stock.ts`) : un
   * lot qu'on a fini n'existe plus, quoi qu'en dise l'export.
   */
  stock: LotInitial[];
  /** Les plats par identifiant — `catalogue.plats` est une liste, et l'écran
   *  fait des lookups par id à chaque rendu. */
  plats: Record<string, Plat>;
  jours: JourSemaine[];
  creneaux: CreneauSemaine[];
  equilibreSur: RepasId[];
  choix: Choix[];
  /** Les parts se règlent PAR REPAS, pas une fois pour la semaine. Un dîner
   *  avec des amis, un midi tout seul et une gamelle à prévoir n'ont pas la
   *  même taille, et c'est la taille qui commande le panier et les restes. */
  parts: number[];
  slot: number;
  repioches: number[];
}

export function creerJeu(catalogue: Catalogue, nJours = 7, aujourdhui = new Date()): Jeu {
  const cfg = catalogue.creneaux;
  const ordre = Object.keys(cfg.repas);
  const jours: JourSemaine[] = Array.from({ length: nJours }, (_, i) => {
    const d = new Date(aujourdhui);
    d.setDate(d.getDate() + i);
    // `getDay()` compte à partir du dimanche ; la semaine commence lundi ici.
    return { nom: JOURS[(d.getDay() + 6) % 7] as string, date: d };
  });

  const creneaux: CreneauSemaine[] = [];
  jours.forEach((j, i) => {
    const duJour = cfg.jours.exceptions?.[j.nom] ?? cfg.jours.defaut;
    [...duJour]
      .sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b))
      .forEach((repas) => {
        const r = cfg.repas[repas];
        // Un jour qui réclame un repas absent de la configuration : le JS
        // produisait un créneau sans label ni nature, qui traversait tout le
        // modèle. On l'ignore, parce qu'un créneau sans repas n'est pas un
        // créneau — et le chargeur a déjà validé les repas qui existent.
        if (!r) return;
        creneaux.push({
          jour: i,
          repas,
          label: r.label,
          nature: r.nature,
          emporte: (cfg.emporte[repas] ?? []).includes(j.nom),
        });
      });
  });

  return {
    catalogue,
    stock: [...catalogue.stock],
    plats: Object.fromEntries(catalogue.plats.map((p) => [p.id, p])),
    jours,
    creneaux,
    equilibreSur: cfg.equilibre_sur.length ? cfg.equilibre_sur : ["dejeuner", "diner"],
    choix: Array<Choix>(creneaux.length).fill(null),
    parts: Array<number>(creneaux.length).fill(catalogue.foyer.parts),
    // On démarre sur le premier créneau réellement choisi : personne ne pioche
    // une carte pour son petit-déjeuner.
    slot: Math.max(0, creneaux.findIndex((c) => c.nature === "choisi")),
    repioches: Array<number>(creneaux.length).fill(0),
  };
}

/** La date du créneau `i`. Le chaînage en dépend : un reste ne se propose que
 *  dans sa fenêtre de fraîcheur, comptée depuis le jour où il est né. */
export function dateDe(jeu: Jeu, i: number): Date {
  const c = jeu.creneaux[i];
  if (!c) throw new RangeError(`créneau ${i} hors de la semaine`);
  const j = jeu.jours[c.jour];
  if (!j) throw new RangeError(`jour ${c.jour} hors de la semaine`);
  return j.date;
}

/** Le plat d'un créneau, ou `null` s'il est vide ou sauté. */
export function platDe(jeu: Jeu, i: number): Plat | null {
  const rid = jeu.choix[i];
  return joue(rid ?? null) ? (jeu.plats[rid as string] ?? null) : null;
}

/** Un plat déclare les créneaux qui lui vont ; le silence vaut « repas
 *  principal ». */
export function convient(jeu: Jeu, plat: Plat, i: number): boolean {
  const c = jeu.creneaux[i];
  if (!c) return false;
  const ok = plat.creneaux.length ? plat.creneaux : ["dejeuner", "diner"];
  return ok.includes(c.repas);
}
