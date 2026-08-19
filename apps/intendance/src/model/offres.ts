// Faire plus, plus tôt — et la gamelle, qui est le même geste.
//
// « Tu n'as plus de bolognaise d'avance : en faire plus jeudi, et le gratin de
// samedi est déjà payé. » Une OFFRE, pas une correction : cuisiner plus grand
// engage un saladier, un tiroir de congélo et de l'argent — trois choses que le
// modèle ne sait pas arbitrer à la place de l'usager. Il propose, il ne
// redimensionne jamais tout seul.
//
// LA GAMELLE EST LA MÊME MÉCANIQUE, commandée par le calendrier au lieu d'un
// manque constaté : on ne cuisine pas une lunchbox le matin même, on la
// prélève sur le dîner de la veille — donc ce dîner doit être cuisiné plus
// grand. C'est pour ça que les deux vivent dans le même fichier, et que
// l'écran « À prévoir » les montre sous un seul en-tête.
//
// Port de `apps/proto-shell/semaine.js` (`Offre`, `offresSurproduction`,
// `gamelles`).

import { accepte, qteDe } from "./depot";
import type { BilanEspace, Calcul } from "./calcul";
import { joue, type Choix, type Jeu } from "./jeu";
import type { CauseLimite, Espace, Plat, Vaisselle } from "./types";

/** Unités qui comptent des OBJETS : on ne récupère pas 1,4 carcasse. */
const LOTS_COMPTABLES = ["pièce", "recette", "lot"];

interface ParamsOffre {
  /** Le créneau amont qu'on propose d'agrandir. */
  creneau: number;
  rid: string;
  titre: string;
  type: string;
  facteurActuel: number;
  /** Ce qu'un lot de ce plat produit de cette base. */
  parLot: number;
  manque: number;
  unite: string;
  /** Les créneaux que l'offre débloque : [jour, titre du plat]. */
  pour: [string, string][];
  gainMin: number;
  indivisible: boolean;
  calibreMax: number | null;
  vaisselle: Vaisselle | null;
  repasParLot: number;
  espace: Espace;
  placesLibres: number | null;
  cause: CauseLimite | null;
}

export class Offre {
  readonly creneau: number;
  readonly rid: string;
  readonly titre: string;
  readonly type: string;
  readonly facteurActuel: number;
  readonly parLot: number;
  manque: number;
  readonly unite: string;
  readonly pour: [string, string][];
  gainMin: number;
  readonly indivisible: boolean;
  readonly calibreMax: number | null;
  readonly vaisselle: Vaisselle | null;
  readonly repasParLot: number;
  readonly espace: Espace;
  readonly placesLibres: number | null;
  readonly cause: CauseLimite | null;

  constructor(o: ParamsOffre) {
    this.creneau = o.creneau;
    this.rid = o.rid;
    this.titre = o.titre;
    this.type = o.type;
    this.facteurActuel = o.facteurActuel;
    this.parLot = o.parLot;
    this.manque = o.manque;
    this.unite = o.unite;
    this.pour = o.pour;
    this.gainMin = o.gainMin;
    this.indivisible = o.indivisible;
    this.calibreMax = o.calibreMax;
    this.vaisselle = o.vaisselle;
    this.repasParLot = o.repasParLot;
    this.espace = o.espace;
    this.placesLibres = o.placesLibres;
    this.cause = o.cause;
  }

  get facteurBrut(): number {
    return this.facteurActuel + this.manque / this.parLot;
  }

  /** Un seul objet, pris plus gros — un poulet se choisit entre 1,2 et 2 kg.
   *  Sans ça, « lot entier » envoie rôtir DEUX poulets pour 300 g manquants,
   *  alors que le geste réel est d'en prendre un plus grand. */
  get calibre(): boolean {
    return !!this.calibreMax && this.facteurBrut <= this.calibreMax + 1e-9;
  }

  get facteurPropose(): number {
    const brut = this.facteurBrut;
    return this.indivisible && !this.calibre ? Math.ceil(brut - 1e-9) : brut;
  }

  get multiple(): number {
    return this.facteurActuel ? this.facteurPropose / this.facteurActuel : 1;
  }

  /** Le surplus au-delà du manque : c'est l'arrondi du lot entier qui crée du
   *  stock, et le stock n'est pas infini. */
  get portionsAStocker(): number {
    return Math.max(0, this.facteurPropose - this.facteurBrut) * this.repasParLot;
  }

  get tientVaisselle(): boolean {
    return this.vaisselle == null || this.facteurPropose <= this.vaisselle.facteurMax + 1e-9;
  }

  get tientStockage(): boolean {
    return this.placesLibres == null || this.portionsAStocker <= this.placesLibres + 1e-9;
  }

  /** Un lot indivisible se dit en LOTS, pas en multiplicateur : « ×4,8 » d'un
   *  lot déjà fractionnaire ne veut rien dire devant une casserole. */
  get combien(): string {
    const g = (n: number) => +n.toFixed(2);
    const n = this.facteurPropose;
    return this.calibre
      ? "en prendre un plus gros"
      : this.indivisible
        ? `en faire ${g(n)} lot${n > 1 ? "s" : ""} entier${n > 1 ? "s" : ""}`
        : `en faire ${g(this.multiple)}×`;
  }

  get deQuoi(): string {
    return `+${Math.round(this.manque * 10) / 10} ${this.unite} de ${this.type}`;
  }

  phrase(): string {
    const pour = this.pour.map(([j, t]) => `${j} (${t})`).join(" et ");
    const gain = this.gainMin ? `, ${this.gainMin} min gagnées` : "";
    return `${this.titre} : ${this.combien} (${this.deQuoi}) et ${pour} ne coûte plus rien${gain}.`;
  }

  /** Les deux murs de la cuisine, dits séparément : ils ne se réparent pas de
   *  la même façon. */
  reserves(): string[] {
    const r: string[] = [];
    if (this.portionsAStocker > 1e-9)
      r.push(`un lot ne se coupe pas : ${+this.portionsAStocker.toFixed(2)} portion(s) de plus à ranger`);
    if (!this.tientVaisselle && this.vaisselle)
      r.push(
        `⚠ ça ne tient pas dans ${this.vaisselle.label} ` +
          `(×${+this.vaisselle.facteurMax.toFixed(2)} maximum) — il faut deux tournées`,
      );
    if (!this.tientStockage && this.placesLibres != null)
      r.push(
        `⚠ plus ${this.cause === "place" ? "de place au" : "de contenant pour le"} ` +
          `${this.espace} (${+this.placesLibres.toFixed(1)} place(s) libre(s))`,
      );
    return r;
  }
}

/**
 * Les offres d'agrandir un lot amont, une par (créneau émetteur, base).
 *
 * Vit hors de `calculer` à dessein : `calculer` MESURE ce qu'une semaine coûte,
 * ceci PROPOSE ce qu'on pourrait en faire. Le second lit le premier, jamais
 * l'inverse — et c'est ce qui garde `calculer` utilisable par le scoring, qui
 * l'appelle une fois par plat candidat.
 */
export function offresSurproduction(jeu: Jeu, choix: Choix[], calc: Calcul): Offre[] {
  const offres = new Map<string, Offre>();

  for (const m of calc.manques) {
    if (!m.unite || m.manque <= 0) continue;
    // On remonte du manque vers le plat le plus proche EN AMONT qui émet la
    // chose : c'est celui qu'il coûte le moins cher d'agrandir, il est déjà au
    // menu, déjà allumé, déjà payé en temps.
    for (let j = m.i - 1; j >= 0; j--) {
      const rid = choix[j] ?? null;
      if (!joue(rid)) continue;
      const p = jeu.plats[rid];
      if (!p) continue;
      const e = p.emits.find((x) => {
        const [amount, unit] = qteDe(x);
        return accepte(x, m.acc) && amount != null && amount > 0 && unit === m.unite;
      });
      if (!e) continue;

      const cle = `${j}|${e.type}`;
      const deja = offres.get(cle);
      if (deja) {
        // Deux plats qui réclament la même base au même émetteur = UNE offre.
        // Seul le manque s'additionne ; le facteur se recalcule dessus, sinon
        // on arrondirait deux fois et on proposerait un lot de trop.
        deja.manque += m.manque;
        deja.pour.push([nomDuJour(jeu, m.i), m.titre]);
        deja.gainMin += m.gainMin;
      } else {
        const bilan: BilanEspace | undefined = calc.stockage[e.espace];
        const [parLot] = qteDe(e);
        offres.set(
          cle,
          new Offre({
            creneau: j,
            rid,
            titre: p.titre,
            type: e.type,
            facteurActuel: calc.facteurs[j] ?? 1,
            parLot: parLot ?? 1,
            manque: m.manque,
            unite: m.unite,
            pour: [[nomDuJour(jeu, m.i), m.titre]],
            gainMin: m.gainMin,
            indivisible: p.lotEntier || LOTS_COMPTABLES.includes(qteDe(e)[1] ?? ""),
            calibreMax: p.calibreMax,
            vaisselle: p.vaisselle,
            repasParLot: bandRepasDe(e.band),
            espace: e.espace,
            placesLibres: bilan?.libre ?? null,
            cause: bilan?.cause ?? null,
          }),
        );
      }
      break;
    }
  }
  return [...offres.values()];
}

const nomDuJour = (jeu: Jeu, i: number): string => {
  const c = jeu.creneaux[i];
  return c ? (jeu.jours[c.jour]?.nom ?? "") : "";
};

const bandRepasDe = (b: string): number => {
  const n = Number.parseInt(b, 10);
  return n > 0 ? n : 1;
};

/* ────────────────────────────────── la gamelle se cuisine la veille au soir */

const dinerDeLaVeille = (jeu: Jeu, i: number): number => {
  for (let j = i - 1; j >= 0; j--) if (jeu.creneaux[j]?.repas === "diner") return j;
  return -1;
};

export interface Gamelle {
  /** Le déjeuner qui part en gamelle. */
  i: number;
  /** Le dîner de la veille, qui doit être cuisiné plus grand. */
  veille: number;
  jour: string;
  jourVeille: string;
  plat: Plat | null;
  partsVeille: number;
  partsGamelle: number;
  total: number;
  /** `null` quand le dîner de la veille n'est pas encore posé : on ne peut rien
   *  dire du plat qui n'existe pas. */
  transportable: boolean | null;
  laisseReste: boolean | null;
  tientVaisselle: boolean;
  fait: boolean;
  actionnable: boolean;
}

export function gamelles(jeu: Jeu, choix: Choix[], parts = jeu.parts): Gamelle[] {
  const out: Gamelle[] = [];
  jeu.creneaux.forEach((c, i) => {
    if (!c.emporte || c.nature !== "choisi") return;
    const veille = dinerDeLaVeille(jeu, i);
    if (veille < 0) return;

    const ridVeille = choix[veille] ?? null;
    const p = joue(ridVeille) ? (jeu.plats[ridVeille] ?? null) : null;
    const dejaPris = joue(choix[i] ?? null);
    const partsVeille = parts[veille] ?? jeu.catalogue.foyer.parts;
    const partsGamelle = parts[i] ?? jeu.catalogue.foyer.parts;
    const total = partsVeille + partsGamelle;

    // Trois choses peuvent clocher, et ce ne sont pas les mêmes gestes : le
    // plat ne voyage pas, il ne laisse rien à emporter, ou le lot ne tient pas
    // dans le récipient une fois agrandi.
    const transportable = p ? p.transportable !== false : null;
    const laisseReste = p ? p.emits.some((e) => e.kind === "reste-plat") : null;
    const tientVaisselle = p?.vaisselle
      ? total / p.portions <= p.vaisselle.facteurMax + 1e-9
      : true;

    out.push({
      i, veille,
      jour: jeu.jours[c.jour]?.nom ?? "",
      jourVeille: jeu.jours[jeu.creneaux[veille]!.jour]?.nom ?? "",
      plat: p,
      partsVeille, partsGamelle, total,
      transportable, laisseReste, tientVaisselle,
      fait: dejaPris,
      actionnable: !!p && !dejaPris && !!transportable && !!laisseReste,
    });
  });
  return out;
}
