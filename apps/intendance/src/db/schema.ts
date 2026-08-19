// La base locale — Dexie sur IndexedDB.
//
// CE QUI EST PERSISTÉ, ET POURQUOI SEULEMENT ÇA
// Survit au rechargement ce qu'un DOIGT a décidé : le plat posé sur un créneau,
// le repas sauté, les parts réglées, la course cochée puis rentrée, le stock
// réel, les réglages du foyer. Est recalculé tout ce que `calculer()` dérive —
// panier, chaînage, manques, offres, bilan de rangement. Persister un résultat
// de calcul, c'est se garantir qu'il divergera un jour de ses entrées, et que
// personne ne saura laquelle des deux valeurs est la vraie.
//
// ────────────────────────────────────────────────────────────────────────────
// LA CLÉ D'UN CRÉNEAU EST (JOUR, REPAS), JAMAIS SON INDEX.
//
// Le modèle manipule `choix[4]` : l'index d'un créneau dans une semaine
// construite à partir d'aujourd'hui. Persister cet index serait le bug le plus
// coûteux qu'on puisse écrire ici — il ne se voit pas le jour où on l'écrit.
// Ouvrez l'app mardi, posez un gratin sur le dîner de mercredi (index 8) ;
// rouvrez-la jeudi, et la semaine recommence à jeudi : l'index 8 désigne
// maintenant le dîner de samedi. Le gratin a déménagé de trois jours, sans que
// rien n'échoue, sans qu'aucun test ne rougisse.
//
// Une décision appartient à « mercredi 19 août, dîner ». C'est ce couple qui
// est stocké, et c'est au chargement qu'on le remet en face du bon index.
// ────────────────────────────────────────────────────────────────────────────

import Dexie, { type EntityTable } from "dexie";
import type { EmitKind, Espace, RepasId } from "../model/types";

/** Un créneau décidé. Absent de la table = pas encore décidé, ce qui n'est pas
 *  la même chose que décidé vide (voir `plat: SAUTE`). */
export interface DecisionCreneau {
  /** `${jour}|${repas}` — voir `cleCreneau`. */
  cle: string;
  /** Date locale en `AAAA-MM-JJ`. */
  jour: string;
  repas: RepasId;
  /** Un identifiant de plat, `SAUTE`, ou `null` pour effacer sans oublier les
   *  parts qu'on avait réglées. */
  plat: string | null;
  /** `null` = les parts du foyer, quelles qu'elles soient au moment du calcul.
   *  Stocker la valeur du foyer figerait un chiffre qui doit suivre le foyer. */
  parts: number | null;
  maj: number;
}

/** Une ligne de la liste de courses, et où elle en est.
 *
 *  DEUX ÉTATS, PAS UN : cocher, c'est dans le magasin ; rentrer, c'est à la
 *  maison. Seul le second change ce qu'on a. Les confondre ferait entrer au
 *  stock un article encore dans le caddie. */
export interface EtatCourse {
  /** `${id}|${unit}` — l'article agrégé du panier. */
  cle: string;
  coche: boolean;
  rentre: boolean;
  maj: number;
}

/** Un lot réellement présent chez soi. Le catalogue en fournit l'amorce ; à
 *  partir de là c'est la base qui fait foi, parce que c'est elle qu'un doigt
 *  corrige. */
export interface LotStock {
  id?: number;
  type: string;
  kind: EmitKind;
  qty: number | null;
  unite: string | null;
  /** En repas — l'unité du budget de rangement. */
  band: string;
  espace: Espace;
  /** Date locale `AAAA-MM-JJ` : le jour où le lot est né. */
  born: string;
  /** Le plat qui l'a produit, si c'est nous. */
  origine: string | null;
  maj: number;
}

/** Les réglages, en clé-valeur. Un tableau typé par réglage obligerait une
 *  migration à chaque nouveau bouton ; ici la forme vit dans le code qui lit. */
export interface Reglage {
  cle: string;
  valeur: unknown;
  maj: number;
}

/* ──────────────────────────────────────────────────────────── les versions */

// LA DISCIPLINE DES VERSIONS, écrite avant d'en avoir besoin.
//
// Dexie applique les versions dans l'ordre, une seule fois par base. Pour
// changer le schéma :
//
//   1. ajouter une entrée à `SCHEMAS` avec le numéro suivant, jamais modifier
//      une entrée existante — une base déjà migrée ne rejouera pas la v1 ;
//   2. si les données doivent être transformées, chaîner un `.upgrade()` sur
//      la nouvelle version dans `Base` ci-dessous ;
//   3. le test `schema.test.ts` épingle la version et les tables. Il rougira,
//      et c'est là qu'on se souviendra de l'étape 2.
//
// La v1 n'a pas d'`upgrade` : il ne s'exécuterait sur aucune base existante,
// puisqu'il n'en existe aucune. Une migration vide écrite « pour la forme »
// est une migration qu'on croit avoir testée.
export const VERSION = 1;

const SCHEMAS: Record<number, Record<string, string>> = {
  1: {
    // `jour` est indexé : la semaine se lit par plage de dates, pas par clé.
    creneaux: "cle, jour",
    courses: "cle",
    stock: "++id, type, espace",
    reglages: "cle",
  },
};

export class Base extends Dexie {
  creneaux!: EntityTable<DecisionCreneau, "cle">;
  courses!: EntityTable<EtatCourse, "cle">;
  stock!: EntityTable<LotStock, "id">;
  reglages!: EntityTable<Reglage, "cle">;

  constructor(nom = "intendance") {
    super(nom);
    for (const [n, stores] of Object.entries(SCHEMAS)) this.version(Number(n)).stores(stores);
  }
}

export const schemaDeclare = (): Record<string, string> => SCHEMAS[VERSION] ?? {};

/** L'instance de l'app. Les tests construisent la leur, sous un autre nom, pour
 *  ne pas se marcher dessus. */
export const base = new Base();

/* ───────────────────────────────────────────────────────────────── les clés */

/**
 * Le jour d'une date, en LOCAL.
 *
 * `toISOString()` serait faux ici et le serait discrètement : il convertit en
 * UTC, si bien qu'un mardi minuit à Paris (UTC+2) se raconte « lundi 22 h ».
 * Une décision posée sur le dîner de mardi se retrouverait rangée sous lundi,
 * une nuit sur deux selon l'heure d'été.
 */
export function jourISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const jj = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${jj}`;
}

export const cleCreneau = (jour: string, repas: RepasId): string => `${jour}|${repas}`;

export const cleArticle = (id: string, unit: string): string => `${id}|${unit}`;
