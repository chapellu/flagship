// Le dépôt : ce que la cuisine contient, et ce qu'un plat y prélève.
//
// LE CHAÎNAGE ÉTAIT UN JEU DE JETONS. Une sortie entrait en stock, on la
// TROUVAIT, et personne ne la retirait jamais : le même bocal de bolognaise
// couvrait les pâtes du mardi (500 g) ET les lasagnes du mercredi (700 g), soit
// 1200 g réclamés sur un bocal — pendant que la sauce du lundi n'était mangée
// par personne. Ce qui manquait n'était pas un contrôle mais une GRANDEUR.
//
// DEUX MESURES COEXISTENT, parce qu'elles mesurent des choses différentes.
// `qty` chiffre une BASE (700 g de sauce, 1 carcasse) : c'est en grammes que
// « y en a-t-il assez » a un sens. `band` compte des REPAS (« 2-repas ») : on
// ne mange pas 340 g de gratin, on mange une part, et c'est l'unité du budget
// de rangement. Une arête chiffrée des deux côtés se règle en grandeur ; sinon
// on retombe sur le jeton, et le prélèvement se dit `approximatif` au lieu de
// faire semblant.
//
// Port de `apps/proto-shell/semaine.js` (`Prise`, `Stock`). Deux champs que le
// JS confondait volontiers sont ici distincts, parce qu'ils ne servent pas à la
// même chose : `espace` dit OÙ ÇA SE RANGE (le budget de rangement le compte),
// `location` dit COMMENT ÇA VIEILLIT (le congélo ignore la fenêtre du frigo).

import type { Accept, Emit, EmitKind, Espace, LigneStock, Quantite } from "./types";

/** Un `accepts` vise soit une sortie précise (`type`), soit toute une CLASSE de
 *  sorties (`kind`). C'est ce qui permet à une seule carte « reste réchauffé »
 *  de manger le gratin d'hier comme la quiche d'avant-hier. */
export function accepte(out: { type: string; kind: EmitKind }, acc: Accept): boolean {
  if (acc.type) return out.type === acc.type;
  if (acc.kind) return out.kind === acc.kind;
  return false;
}

export const libelle = (acc: Accept): string => acc.type ?? `un ${acc.kind}`;

export const qteDe = (b: { qty: Quantite | null } | null | undefined): [number | null, string | null] =>
  b?.qty?.amount != null ? [b.qty.amount, b.qty.unit] : [null, null];

/** « 2-repas » → 2. Une bande illisible vaut un repas : c'est le minimum qu'une
 *  chose rangée occupe, jamais zéro. */
export function bandRepas(b: string | null | undefined): number {
  const n = Number.parseInt(String(b ?? ""), 10);
  return n > 0 ? n : 1;
}

export const fmtQte = (v: number, u: string | null): string =>
  `${Math.round(v * 10) / 10} ${u ?? ""}`.trim();

/** Une ligne du dépôt : un lot réel, présent avant la semaine ou produit par
 *  elle, avec ce qu'il en reste. */
export interface LigneDepot {
  type: string;
  kind: EmitKind;
  qty: Quantite | null;
  /** En repas — l'unité du budget de rangement. */
  band: string;
  /** Où ça se range. Commande le plafond d'espace. */
  espace: Espace;
  /** Où ça se trouve, pour le vieillissement : le congélo ignore la fenêtre. */
  location: Espace;
  born: Date | null;
  gardeFrigo: number | null;
  congelo: boolean;
  /** L'identifiant du plat qui l'a produit, s'il vient de cette semaine. */
  from: string | null;
  /** Ce qu'il en reste. `null` = lot non chiffré, qui part en entier. */
  reste: number | null;
  unite: string | null;
  epuise: boolean;
}

export interface Source {
  ligne: LigneDepot;
  /** `null` quand la ligne part en entier faute d'être chiffrée. */
  pris: number | null;
  age: number;
}

/** Ce qu'un `accepts` a réellement obtenu du dépôt. */
export class Prise {
  readonly out: LigneDepot | null;
  readonly age: number | null;
  readonly pris: number | null;
  readonly manque: number;
  readonly unite: string | null;
  readonly approximatif: boolean;
  readonly sources: Source[];

  constructor(o: Partial<Prise> = {}) {
    this.out = o.out ?? null;
    this.age = o.age ?? null;
    this.pris = o.pris ?? null;
    this.manque = o.manque ?? 0;
    this.unite = o.unite ?? null;
    this.approximatif = o.approximatif ?? false;
    this.sources = o.sources ?? [];
  }

  get trouve(): boolean {
    return this.out !== null;
  }

  get couvert(): boolean {
    return this.out !== null && this.manque <= 1e-9;
  }

  /** D'où sort ce que le plat a pris, MORCEAU PAR MORCEAU. Annoncer le total
   *  sur le premier bocal quand la prise a traversé deux lots est un mensonge,
   *  et c'est exactement ce que disait le message d'avant. */
  raconte(): string {
    return this.sources
      .map((s) => {
        const ou = s.ligne.from
          ? `du lot « ${s.ligne.from} »`
          : s.ligne.location === "congelo"
            ? "du congélo"
            : `du frigo (J-${s.age})`;
        return `${s.pris == null ? s.ligne.type : fmtQte(s.pris, this.unite)} ${ou}`;
      })
      .join(" + ");
  }
}

interface Ajout {
  born?: Date;
  source?: string;
  location?: Espace;
}

export class Depot {
  readonly lignes: LigneDepot[] = [];

  constructor(
    /** Jours au bout desquels un reste au frigo cesse d'être proposé. */
    private readonly fenetre: number,
    initial: LigneStock[] = [],
  ) {
    for (const o of initial) {
      this.lignes.push({
        type: o.type,
        kind: o.kind,
        qty: o.qty,
        band: o.qty_band,
        espace: o.location,
        location: o.location,
        born: new Date(o.born),
        gardeFrigo: null,
        congelo: o.location === "congelo",
        from: null,
        reste: o.qty.amount,
        unite: o.qty.unit,
        epuise: false,
      });
    }
  }

  /** Range une sortie de plat. `location` vaut « frigo » par défaut, et c'est
   *  volontaire : ce qu'on vient de cuisiner refroidit au frigo, même quand il
   *  se congèle — le congeler est un geste qu'on n'a pas encore fait. La
   *  conséquence est réelle : un lot congelable posé cette semaine vieillit
   *  dans la fenêtre du frigo, pas hors du temps. Le port la garde telle
   *  quelle ; la changer serait changer le modèle, pas le traduire. */
  ajouter(sortie: Emit, { born, source, location }: Ajout = {}): LigneDepot {
    const [amount, unit] = qteDe(sortie);
    const l: LigneDepot = {
      type: sortie.type,
      kind: sortie.kind,
      qty: sortie.qty,
      band: sortie.band,
      espace: sortie.espace,
      location: location ?? "frigo",
      born: born ?? null,
      gardeFrigo: sortie.gardeFrigo,
      congelo: sortie.congelo,
      from: source ?? null,
      reste: amount,
      unite: unit,
      epuise: false,
    };
    this.lignes.push(l);
    return l;
  }

  private age(ligne: LigneDepot, date: Date): number | null {
    if (!ligne.born) return null;
    const age = Math.round((date.getTime() - ligne.born.getTime()) / 86_400_000);
    return ligne.location === "congelo" || age <= this.fenetre ? age : null;
  }

  private *candidats(acc: Accept, date: Date): Generator<[LigneDepot, number]> {
    for (const l of this.lignes) {
      if (l.epuise || !accepte(l, acc)) continue;
      const age = this.age(l, date);
      if (age !== null) yield [l, age];
    }
  }

  /** Sonde NON destructive : proposer une carte n'est pas la jouer, donc rien
   *  ne se consomme ici. C'est `calculer` qui prélève pour de bon. */
  disponible(acc: Accept, date: Date): [LigneDepot, number] | [null, null] {
    for (const c of this.candidats(acc, date)) return c;
    return [null, null];
  }

  prelever(acc: Accept, date: Date): Prise {
    const [besoin, unite] = qteDe(acc);
    let premier: LigneDepot | null = null;
    let premierAge: number | null = null;
    let total = 0;
    const sources: Source[] = [];

    for (const [l, age] of this.candidats(acc, date)) {
      if (besoin == null || l.reste == null || l.unite !== unite) {
        // Une des deux faces ne chiffre rien : la ligne entière part. C'est le
        // cas des restes de plat, comptés en repas et pas en grammes.
        l.epuise = true;
        return new Prise({
          out: l, age, approximatif: true, unite,
          sources: [{ ligne: l, pris: null, age }],
        });
      }
      const pris = Math.min(besoin - total, l.reste);
      if (pris <= 0) continue;
      l.reste -= pris;
      if (l.reste <= 1e-9) l.epuise = true;
      total += pris;
      sources.push({ ligne: l, pris, age });
      if (premier === null) {
        premier = l;
        premierAge = age;
      }
      if (total >= besoin - 1e-9) break;
    }

    if (premier === null) return new Prise({ manque: besoin ?? 0, unite });
    return new Prise({
      out: premier,
      age: premierAge,
      pris: total,
      unite,
      sources,
      manque: Math.max(0, (besoin ?? 0) - total),
    });
  }
}
