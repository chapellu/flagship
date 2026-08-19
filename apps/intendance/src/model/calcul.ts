// Le cœur : panier, chaînage, plein tarif, provenance et rangement, pour une
// semaine partielle.
//
// Port de `apps/proto-shell/semaine.js` (`provenance`, `facteur`, `echelle`,
// `calculer`, `bilanStockage`). Le comportement est celui du proto, qui est
// celui du modèle Python de référence — les tests de `calcul.test.ts` épinglent
// chaque règle, y compris celles qu'on aimerait peut-être changer un jour.
//
// CE QUE `calculer` NE FAIT PAS : les offres de surproduction. Elles vivent en
// T5, avec le reste de ce qui NOTE une semaine plutôt que de la mesurer. La
// frontière n'est pas arbitraire : ici on mesure ce qu'une semaine coûte, là
// on juge ce qu'elle vaut, et le second appelle le premier — jamais l'inverse.

import { bandRepas, Depot, qteDe, type LigneDepot, type Prise } from "./depot";
import { dateDe, joue, type Jeu } from "./jeu";
import type {
  Accept, Catalogue, CauseLimite, Espace, Ingredient, Plat, Provenance,
} from "./types";

/* ────────────────────────────────────────────────────────────── provenance */

// D'où sort une ligne d'ingrédient. Ces cas existaient déjà avant le modèle,
// mais éclatés en trois encodages sans rapport — une liste placard globale, un
// booléen par ligne, un état du stock : chaque lecteur redécidait dans son coin.
//
// `absent` ne produit PAS de ligne de courses, et c'est contre-intuitif : une
// base manquante se rattrape en cuisinant, jamais en achetant la base. On
// n'achète nulle part 250 g de lentilles *cuites*.
function provenance(
  catalogue: Catalogue,
  ing: Ingredient,
  cid: string,
  prises: Prise[],
): Provenance {
  if (ing.base) {
    const pr = prises.find((p) => p.trouve);
    if (!pr) return "absent";
    return pr.out?.from ? "chaine" : "frigo";
  }
  return catalogue.rayons.placard.includes(cid) ? "placard" : "courses";
}

const alias = (catalogue: Catalogue, id: string): string => catalogue.rayons.aliases[id] ?? id;

/* ──────────────────────────────────────────────────────── mise à l'échelle */

/** Ramène un facteur d'échelle à ce que la recette sait réellement produire.
 *  `besoin / rendement` donne 0,42 pour un foyer de 2,5 devant une recette
 *  pour 6. Pour une sauce, cuisiner 42 % du lot a un sens. Pour un plat bâti
 *  sur un objet entier, non : « faire 0,42 poulet rôti » n'est pas une
 *  quantité. */
const facteurLot = (plat: Plat, f: number): number =>
  plat.lotEntier ? Math.max(1, Math.ceil(f - 1e-9)) : f;

/** Le facteur d'échelle d'un plat pour un nombre de parts donné.
 *  Un plat qui SE GARDE se cuisine en lot entier même pour deux parts : couper
 *  un lot qui va au congélo ne fait pas gagner de place, seulement du travail. */
export function facteur(plat: Plat, besoin: number): number {
  const garde = plat.emits.some((e) => e.congelo || e.kind === "reste-plat");
  return facteurLot(plat, garde && besoin < plat.portions ? 1 : besoin / plat.portions);
}

/** Exposé pour la fiche recette : elle doit pouvoir montrer les vraies
 *  quantités d'un plat qui n'est pas encore joué. */
export const facteurAffiche = (plat: Plat, parts: number): number => facteur(plat, parts);

/** L'arrondi n'est pas cosmétique : une balance de cuisine pèse à 10 g près et
 *  personne ne compte 2,3 gousses d'ail. Une quantité qu'on ne peut pas
 *  exécuter est une quantité fausse. */
export function echelle(qty: number, unit: string, f: number): number {
  const v = qty * f;
  if (unit === "g") return Math.round(v / 10) * 10;
  if (["pièce", "gousse", "c. à s.", "c. à c.", "pincée"].includes(unit))
    return Math.round(v * 2) / 2;
  return Math.round(v * 10) / 10;
}

export const echelleTexte = (ing: Ingredient, f: number): string =>
  `${String(echelle(ing.qty, ing.unit, f)).replace(".", ",")} ${ing.unit}`;

/* ─────────────────────────────────────────────────────────── les résultats */

export interface LigneChaine {
  creneau: number;
  type: string;
  depuis: string | null;
  age: number | null;
  pris: number | null;
  unite: string | null;
  manque: number;
  recit: string;
}

export interface Manque {
  /** Le créneau qui réclame. */
  i: number;
  acc: Accept;
  manque: number;
  unite: string | null;
  titre: string;
  gainMin: number;
}

export interface PleinTarif {
  creneau: number;
  minutes: number;
}

/** Une ligne du panier — l'agrégat d'un ingrédient sur toute la semaine. */
export interface LignePanier {
  id: string;
  nom: string;
  qty: number;
  unit: string;
  /** Combien de plats la réclament. */
  n: number;
}

/** Le bilan d'un espace : ce qu'il portait, ce que la semaine y met, ce qu'elle
 *  y prend, et lequel de ses deux plafonds mord. */
export interface BilanEspace {
  places: number;
  contenants: number;
  limite: number;
  cause: CauseLimite;
  debut: number;
  entre: number;
  sort: number;
  fin: number;
  libre: number;
  deborde: boolean;
}

export interface Calcul {
  panier: Map<string, LignePanier>;
  /** Ce qu'on a déjà et qu'on vérifie au lieu de l'acheter. */
  aVerifier: Map<string, string>;
  chaine: LigneChaine[];
  pleinTarif: PleinTarif[];
  manques: Manque[];
  provenances: Partial<Record<Provenance, number>>;
  facteurs: number[];
  depot: Depot;
  stockage: Record<Espace, BilanEspace>;
}

/* ────────────────────────────────────────────────────────────── le calcul */

export function calculer(
  jeu: Jeu,
  choix = jeu.choix,
  jetes: string[] = [],
  parts = jeu.parts,
): Calcul {
  const { catalogue } = jeu;
  const depot = new Depot(
    catalogue.foyer.fenetreFrigo,
    catalogue.stock.filter((o) => !jetes.includes(o.type)),
  );

  const panier = new Map<string, LignePanier>();
  const aVerifier = new Map<string, string>();
  const chaine: LigneChaine[] = [];
  const pleinTarif: PleinTarif[] = [];
  const manques: Manque[] = [];
  const provenances: Partial<Record<Provenance, number>> = {};
  const facteurs = choix.map(() => 1);

  choix.forEach((rid, i) => {
    if (!joue(rid)) return;
    const p = jeu.plats[rid];
    if (!p) return;
    const date = dateDe(jeu, i);
    let plein = false;
    const prises: Prise[] = [];

    // 7 Wonders : un `accepts` non couvert est un PRIX, pas une barrière.
    for (const acc of p.accepts) {
      const pr = depot.prelever(acc, date);
      prises.push(pr);
      if (pr.trouve)
        chaine.push({
          creneau: i,
          type: pr.out!.type,
          depuis: pr.out!.from,
          age: pr.age,
          pris: pr.pris,
          unite: pr.unite,
          manque: pr.manque,
          recit: pr.raconte(),
        });
      // Ce qui manque EN GRANDEUR remonte : c'est ce qui rend la semaine
      // dimensionnable, un plat amont pouvant être cuisiné plus grand exprès.
      if (pr.manque > 1e-9)
        manques.push({
          i, acc, manque: pr.manque, unite: pr.unite,
          titre: p.titre, gainMin: p.gainChainage,
        });
      if (pr.couvert || (pr.trouve && pr.approximatif)) continue;
      if (p.sansReste) {
        plein = true;
        pleinTarif.push({ creneau: i, minutes: p.sansReste.minutes });
      }
    }

    const f = facteur(p, parts[i] ?? catalogue.foyer.parts);
    facteurs[i] = f;
    const lignes = [...p.ingredients];
    if (plein && p.sansReste) lignes.push(...p.sansReste.ingredients);

    for (const ing of lignes) {
      const cid = alias(catalogue, ing.id);
      const prov = provenance(catalogue, ing, cid, prises);
      provenances[prov] = (provenances[prov] ?? 0) + 1;
      if (catalogue.horsCourses.includes(prov)) continue;
      if (prov === "placard") {
        aVerifier.set(cid, ing.nom);
        continue;
      }
      const cle = `${cid}|${ing.unit}`;
      const slot = panier.get(cle) ?? { nom: ing.nom, qty: 0, n: 0, id: cid, unit: ing.unit };
      slot.qty += echelle(ing.qty, ing.unit, f);
      slot.n += 1;
      panier.set(cle, slot);
    }

    for (const e of p.emits) {
      const [amount, unit] = qteDe(e);
      depot.ajouter(
        { ...e, qty: amount == null ? null : { amount: amount * f, unit: unit! } },
        { born: date, source: rid, location: "frigo" },
      );
    }
  });

  return {
    panier, aVerifier, chaine, pleinTarif, manques, provenances, facteurs, depot,
    stockage: bilanStockage(jeu, choix, jetes, facteurs, depot),
  };
}

/* ─────────────────────────────────────── la cuisine n'est pas infinie */

// DEUX PLAFONDS PAR ESPACE, tous deux réels : les ÉTAGÈRES et les CONTENANTS.
// Le plus bas commande, et savoir lequel mord change le geste — dégager une
// étagère, ou laver des boîtes. Dans une vraie cuisine, la contrainte n'est
// presque jamais « le congélateur est plein » : c'est « les six boîtes sont au
// frigo avec la ratatouille de mardi dedans ».
export function bilanStockage(
  jeu: Jeu,
  choix: Jeu["choix"],
  jetes: string[],
  facteurs: number[],
  depot: Depot,
): Record<Espace, BilanEspace> {
  const { catalogue } = jeu;
  const debut: Partial<Record<Espace, number>> = {};
  const entre: Partial<Record<Espace, number>> = {};
  const sort: Partial<Record<Espace, number>> = {};
  const add = (acc: Partial<Record<Espace, number>>, e: Espace, n: number) => {
    acc[e] = (acc[e] ?? 0) + n;
  };

  for (const o of catalogue.stock) {
    if (jetes.includes(o.type)) continue;
    add(debut, o.location, bandRepas(o.qty_band));
  }

  choix.forEach((rid, i) => {
    if (!joue(rid)) return;
    const p = jeu.plats[rid];
    if (!p) return;
    for (const e of p.emits) add(entre, e.espace, bandRepas(e.band) * (facteurs[i] ?? 1));
  });

  // Ce que la semaine MANGE rend sa place ET son contenant. Sans ce terme, le
  // rangement ne serait qu'un compteur qui monte — et un niveau qu'on ne mesure
  // qu'à la hausse n'est pas un niveau.
  for (const l of depot.lignes) {
    if (!l.epuise) continue;
    add(sort, espaceDe(l), bandRepas(l.band));
  }

  const bilan = {} as Record<Espace, BilanEspace>;
  for (const [espace, cfg] of Object.entries(catalogue.foyer.espaces) as [Espace, Catalogue["foyer"]["espaces"][Espace]][]) {
    const fin = (debut[espace] ?? 0) + (entre[espace] ?? 0) - (sort[espace] ?? 0);
    bilan[espace] = {
      ...cfg,
      debut: debut[espace] ?? 0,
      entre: entre[espace] ?? 0,
      sort: sort[espace] ?? 0,
      fin,
      libre: Math.max(0, cfg.limite - fin),
      deborde: fin > cfg.limite,
    };
  }
  return bilan;
}

/** Où une ligne du dépôt compte, pour le budget de rangement. */
export const espaceDe = (l: LigneDepot): Espace => l.espace;

/* ──────────────────────────────────────────────────────── lectures dérivées */

/** Le panier, prêt pour la liste de courses. Les unités qui ne se coupent pas
 *  s'arrondissent au-dessus : on n'achète pas 2,4 œufs. */
export function articles(panier: Map<string, LignePanier>): LignePanier[] {
  return [...panier.values()].map((s) => ({
    ...s,
    qty: ["pièce", "gousse"].includes(s.unit) ? Math.ceil(s.qty - 1e-9) : s.qty,
  }));
}

/** Minutes de cuisine par JOUR — pas par créneau. C'est la journée qui fatigue,
 *  pas le repas : trois plats qui tiennent chacun dans leur budget peuvent
 *  faire une journée intenable. */
export function minutesParJour(jeu: Jeu, choix = jeu.choix): number[] {
  const parJour = jeu.jours.map(() => 0);
  choix.forEach((rid, i) => {
    if (!joue(rid)) return;
    const p = jeu.plats[rid];
    const c = jeu.creneaux[i];
    if (!p || !c) return;
    parJour[c.jour] = (parJour[c.jour] ?? 0) + p.minutes;
  });
  return parJour;
}
