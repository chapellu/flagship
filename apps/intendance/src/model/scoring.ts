// Ce qui NOTE une semaine, par-dessus ce qui la mesure.
//
// `calcul.ts` dit ce qu'une semaine coûte. Ici on dit ce qu'elle vaut, et donc
// ce que l'écran propose : la couverture (protéines, familles de légumes), le
// score d'un plat sur un créneau donné, et la main de cartes qu'on en tire.
//
// LE SCORE EST LE VRAI DESIGN DE L'ÉCRAN. Une carte n'est pas proposée parce
// qu'elle est bonne dans l'absolu, mais parce qu'elle est bonne ICI : elle
// apporte une protéine qui manque, elle mange un reste qui allait périmer, elle
// ne répète pas le féculent d'hier. Les poids viennent du catalogue, pas d'ici
// — les changer est une décision de modèle, pas de code.
//
// Port de `apps/proto-shell/semaine.js` (`couverture`, `categorie`, `offre`,
// `main`, `alea`, `parRayon`).

import { articles, calculer, type LignePanier } from "./calcul";
import { convient, joue, type Choix, type Jeu } from "./jeu";
import { gamelles } from "./offres";
import type { Catalogue, Plat } from "./types";

/* ───────────────────────────────────────────────────────────── couverture */

export interface Couverture {
  servi: Record<string, number>;
  feculent: Record<string, number>;
  profil: Record<string, number>;
  familles: Set<string>;
  /** Protéines sous leur minimum, et de combien. */
  manques: Record<string, number>;
  /** Protéines qui ont atteint leur maximum ACHETÉ — un plat bâti sur un reste
   *  n'y compte pas, puisqu'il ne coûte rien de plus. */
  satures: Record<string, boolean>;
  famillesManquantes: number;
}

export function couverture(jeu: Jeu, choix: Choix[]): Couverture {
  const { catalogue } = jeu;
  const servi: Record<string, number> = {};
  const achete: Record<string, number> = {};
  const feculent: Record<string, number> = {};
  const profil: Record<string, number> = {};
  const familles = new Set<string>();

  choix.forEach((rid, i) => {
    if (!joue(rid)) return;
    // Les cibles se mesurent sur les repas principaux. Les plafonds ont été
    // posés contre six dîners ; les étaler sur vingt-et-un créneaux les
    // diviserait par deux sans que personne l'ait décidé.
    const c = jeu.creneaux[i];
    if (!c || !jeu.equilibreSur.includes(c.repas)) return;
    const p = jeu.plats[rid];
    if (!p) return;

    const a = p.apports;
    const surReste = p.ingredients.some((x) => x.base);
    if (a.proteine && a.proteine !== "aucune") {
      servi[a.proteine] = (servi[a.proteine] ?? 0) + 1;
      if (!surReste) achete[a.proteine] = (achete[a.proteine] ?? 0) + 1;
    }
    if (a.feculent && a.feculent !== "aucun")
      feculent[a.feculent] = (feculent[a.feculent] ?? 0) + 1;
    for (const x of a.legumes) familles.add(x);
    if (a.profil) profil[a.profil] = (profil[a.profil] ?? 0) + 1;
  });

  const cibles = catalogue.equilibre.cibles;
  const manques: Record<string, number> = {};
  const satures: Record<string, boolean> = {};
  for (const [p, c] of Object.entries(cibles.proteine)) {
    if (c.min != null && (servi[p] ?? 0) < c.min) manques[p] = c.min - (servi[p] ?? 0);
    if (c.max != null && (achete[p] ?? 0) >= c.max) satures[p] = true;
  }

  return {
    servi, feculent, profil, familles, manques, satures,
    famillesManquantes: Math.max(0, cibles.familles_legumes_min - familles.size),
  };
}

/* ─────────────────────────────────────────────────────────── la catégorie */

export type Categorie = "derive" | "souche" | "express" | "congelable" | "complet";

/** L'enseigne de la carte. DÉRIVÉE DES DONNÉES, jamais étiquetée à la main :
 *  un plat est « sur un reste » parce qu'il en accepte un, pas parce qu'on
 *  l'a rangé là. L'ordre compte — un plat peut cocher plusieurs cases, et
 *  c'est le premier trait vrai qui le nomme. */
export function categorie(p: Plat): Categorie {
  if (p.accepts.length) return "derive";
  if (p.emits.some((e) => e.kind === "base")) return "souche";
  if (p.minutes <= 25) return "express";
  if (p.emits.some((e) => e.congelo)) return "congelable";
  return "complet";
}

/* ────────────────────────────────────────────────────── noter les candidats */

export interface Carte {
  plat: Plat;
  categorie: Categorie;
  score: number;
  /** Articles que ce plat ajoute au panier de la semaine. Zéro = gratuit. */
  marginal: number;
  pourquoi: string[];
  malTransporte: boolean;
  /** Le plat exige un reste que rien ne couvre. */
  manque: boolean;
  minutes: number;
  chaine: boolean;
  depuis: string | null;
  recit: string | null;
  /** « Il y en a, mais pas assez » : le troisième cas que le booléen d'avant
   *  confondait avec « il y en a ». */
  partiel: boolean;
  plein: boolean;
}

/**
 * Tous les plats jouables sur un créneau, notés et triés.
 *
 * COÛTEUX PAR CONSTRUCTION : `calculer` est rejoué pour CHAQUE plat candidat,
 * parce que le coût marginal d'une carte ne se lit nulle part ailleurs — il
 * faut poser le plat et regarder ce que le panier devient. Le proto y met
 * 13,7 s pour remplir quatorze créneaux. C'est le sujet de T17 ; le port ne
 * corrige rien ici, sinon la parité ne voudrait plus rien dire.
 */
export function offre(jeu: Jeu, choix: Choix[], slot: number): Carte[] {
  const base = calculer(jeu, choix);
  const nBase = base.panier.size;
  const deja = new Set(choix.filter(Boolean));
  const cov = couverture(jeu, choix);
  const poids = jeu.catalogue.equilibre.poids;
  const rep = jeu.catalogue.equilibre.cibles.repetition_max;
  const cr = jeu.creneaux[slot];
  if (!cr) return [];

  // Ce créneau est-il le dîner qui précède un déjeuner de coworking encore vide ?
  const gamelleDemain =
    cr.repas === "diner"
      ? (gamelles(jeu, choix).find((g) => g.veille === slot && !g.fait)?.jour ?? null)
      : null;

  return jeu.catalogue.plats
    .filter((p) => !deja.has(p.id) && convient(jeu, p, slot))
    .map((p): Carte => {
      const essai = [...choix];
      essai[slot] = p.id;
      const apres = calculer(jeu, essai);
      const chaineIci = apres.chaine.filter((c) => c.creneau === slot);
      const pleinIci = apres.pleinTarif.filter((c) => c.creneau === slot);
      const a = p.apports;
      const surReste = p.ingredients.some((x) => x.base);
      const malTransporte = cr.emporte && p.transportable === false;

      let score = 0;
      const pourquoi: string[] = [];

      if (a.proteine && a.proteine !== "aucune") {
        if (cov.manques[a.proteine]) {
          score += poids["proteine_manquante"] ?? 0;
          pourquoi.push(`apporte ${a.proteine}, qui manque`);
        } else if (cov.satures[a.proteine] && !surReste) {
          score += poids["proteine_saturee"] ?? 0;
          pourquoi.push(`${a.proteine} déjà servi assez`);
        } else if (cov.satures[a.proteine]) {
          pourquoi.push(`${a.proteine} déjà pris, mais celle-ci est déjà payée`);
        }
      }

      const neuves = a.legumes.filter((f) => !cov.familles.has(f));
      if (neuves.length) {
        score += (poids["famille_legume_neuve"] ?? 0) * neuves.length;
        pourquoi.push("légumes nouveaux : " + neuves.join(", "));
      }

      if (a.feculent && (cov.feculent[a.feculent] ?? 0) >= (rep["feculent"] ?? Infinity))
        score += poids["repetition_feculent"] ?? 0;

      if (a.profil && (cov.profil[a.profil] ?? 0) >= (rep["profil"] ?? Infinity)) {
        score += poids["repetition_profil"] ?? 0;
        pourquoi.push(`encore du ${a.profil}`);
      }

      if (chaineIci.length) score += poids["chaine_couverte"] ?? 0;

      // Gamelle : un plat qui voyage mal n'est pas interdit, juste moins bon.
      if (malTransporte) {
        score += poids["mal_transporte"] ?? -6;
        pourquoi.push("voyage mal en gamelle");
      }

      // Le dîner de la veille d'un jour de coworking a un second métier : il
      // fabrique la gamelle. Un plat qui voyage et laisse un reste vaut mieux
      // là qu'ailleurs — même poids que le chaînage, parce que c'en est un.
      if (
        gamelleDemain &&
        p.transportable !== false &&
        p.emits.some((e) => e.kind === "reste-plat")
      ) {
        score += poids["chaine_couverte"] ?? 0;
        pourquoi.push(`laisse la gamelle de ${gamelleDemain}`);
      }

      // Un `accepts` requis que rien ne couvre reste une mauvaise idée.
      const requisNonCouvert =
        p.accepts.some((acc) => acc.requis) && !chaineIci.length && !p.sansReste;
      if (requisNonCouvert) {
        score += poids["chaine_manquante"] ?? 0;
        pourquoi.push(`demande ${p.accepts.map((acc) => acc.type ?? `un ${acc.kind}`).join(", ")}`);
      }

      const marginal = apres.panier.size - nBase;
      score += (poids["article_marginal"] ?? 0) * marginal;

      return {
        plat: p,
        categorie: categorie(p),
        score: Math.round(score * 10) / 10,
        marginal,
        pourquoi,
        malTransporte,
        manque: requisNonCouvert,
        minutes: p.minutes + (pleinIci[0]?.minutes ?? 0),
        chaine: chaineIci.length > 0,
        depuis: chaineIci[0]?.depuis ?? null,
        recit: chaineIci[0]?.recit ?? null,
        partiel: chaineIci.some((c) => c.manque > 1e-9),
        plein: pleinIci.length > 0,
      };
    })
    .sort((x, y) => y.score - x.score);
}

/* ──────────────────────────────────────────────────────── la main de cartes */

/** Tirage pondéré DÉTERMINISTE : la même main tant qu'on ne repioche pas. Une
 *  main qui change à chaque rendu n'est pas une main, c'est une loterie — et on
 *  ne choisit pas entre des cartes qui bougent. */
function alea(graine: string): () => number {
  let h = 2166136261;
  for (const c of graine) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La main : quelques cartes tirées parmi les jouables, avec une garantie de
 * variété. Les trois enseignes garanties d'abord — une express, une souche, une
 * dérivée — puis on complète. Sans elles, le score seul servirait cinq fois la
 * même famille de plats.
 *
 * `taille` vaut 4 en dur, alors que le catalogue dit `equilibre.main.taille: 5`
 * et porte aussi `cooldown_jours`. Le proto ignore cette configuration ; le port
 * fait pareil, sinon la parité ne tiendrait pas. C'est noté au backlog.
 */
export function main(jeu: Jeu, taille = 4): Carte[] {
  const lignes = offre(jeu, jeu.choix, jeu.slot);
  if (!lignes.length) return [];

  const rnd = alea(`${jeu.slot}:${jeu.repioches[jeu.slot] ?? 0}`);
  const pris = new Set<string>();
  const main: Carte[] = [];

  const tirer = (pool: Carte[]): Carte | null => {
    const libres = pool.filter((l) => !pris.has(l.plat.id));
    if (!libres.length) return null;
    // Le score peut être négatif ; le poids ne doit jamais l'être, sinon une
    // carte mal notée deviendrait plus probable qu'une bonne.
    const poids = libres.map((l) => Math.max(0.4, l.score + 12));
    let r = rnd() * poids.reduce((a, b) => a + b, 0);
    for (let i = 0; i < libres.length; i++) {
      r -= poids[i]!;
      if (r <= 0) return libres[i]!;
    }
    return libres[libres.length - 1]!;
  };

  for (const cat of ["express", "souche", "derive"] as const) {
    const c = tirer(lignes.filter((l) => l.categorie === cat));
    if (c) {
      pris.add(c.plat.id);
      main.push(c);
    }
  }
  while (main.length < taille) {
    const c = tirer(lignes);
    if (!c) break;
    pris.add(c.plat.id);
    main.push(c);
  }
  return main.sort((a, b) => b.score - a.score);
}

/* ──────────────────────────────────────────────────────────── les courses */

/** La liste de courses, dans l'ordre où on traverse le magasin. Un article
 *  qu'aucun rayon ne réclame finit dans « autre » plutôt que de disparaître. */
export function parRayon(
  catalogue: Catalogue,
  panier: Map<string, LignePanier>,
): [string, LignePanier[]][] {
  const arts = articles(panier);
  const groupes: [string, LignePanier[]][] = [];
  const vus = new Set<string>();

  for (const rayon of catalogue.rayons.ordre) {
    const ids = catalogue.rayons.rayons[rayon] ?? [];
    const dedans = arts.filter((a) => ids.includes(a.id));
    if (dedans.length) {
      dedans.forEach((a) => vus.add(a.id));
      groupes.push([rayon, dedans.sort((x, y) => x.nom.localeCompare(y.nom))]);
    }
  }

  const reste = arts.filter((a) => !vus.has(a.id));
  if (reste.length) groupes.push(["autre", reste]);
  return groupes;
}
