// La liste de courses, telle qu'elle se lit dans un rayon.
//
// LA LISTE N'EST PAS STOCKÉE, ELLE EST CALCULÉE. Ce qui se stocke, c'est
// l'ÉTAT d'un article — coché, rentré — parce que ça, aucun calcul ne peut le
// retrouver. La conséquence, qu'il vaut mieux dire tout de suite : changer la
// semaine change la liste, et un état peut se retrouver orphelin. On les compte
// plutôt que de les cacher (voir `orphelins`).
//
// Port de `apps/proto-shell/comptoir.js` (`ecranCourses`).

import type { EtatCourse } from "../db";
import { cleDeLArticle } from "../db";
import type { LignePanier } from "../model/calcul";
import { parRayon } from "../model/scoring";
import type { Catalogue, Provenance } from "../model/types";

export type Mode = "magasin" | "maison";

export interface Article {
  cle: string;
  ligne: LignePanier;
  coche: boolean;
  rentre: boolean;
}

export interface Rayon {
  nom: string;
  articles: Article[];
}

export interface VueCourses {
  rayons: Rayon[];
  /** Tous les articles de la liste, à plat — pour compter. */
  articles: Article[];
  /** Cochés, donc dans le caddie. */
  coches: number;
  /** Rentrés, donc rangés. */
  rentres: number;
  /** Des états qui ne correspondent plus à aucun article de la liste : la
   *  semaine a changé sous eux. */
  orphelins: number;
}

export function vueDesCourses(
  catalogue: Catalogue,
  panier: Map<string, LignePanier>,
  etats: Map<string, EtatCourse>,
): VueCourses {
  const vus = new Set<string>();
  const rayons = parRayon(catalogue, panier).map(([nom, lignes]) => ({
    nom,
    articles: lignes.map((ligne) => {
      const cle = cleDeLArticle(ligne);
      vus.add(cle);
      const e = etats.get(cle);
      return { cle, ligne, coche: e?.coche ?? false, rentre: e?.rentre ?? false };
    }),
  }));

  const articles = rayons.flatMap((r) => r.articles);
  return {
    rayons,
    articles,
    coches: articles.filter((a) => a.coche).length,
    rentres: articles.filter((a) => a.rentre).length,
    orphelins: [...etats.values()].filter((e) => !vus.has(e.cle) && (e.coche || e.rentre)).length,
  };
}

/**
 * Ce que le doigt fait, selon l'endroit où l'on est.
 *
 * DEUX GESTES, DEUX LIEUX, et c'est toute la raison d'être des deux modes. Au
 * magasin, cocher veut dire « c'est dans le caddie » ; à la maison, rentrer
 * veut dire « c'est rangé ». Les confondre donnait, dans le proto, une liste
 * qui s'effaçait sous le doigt au milieu d'un rayon.
 */
export const basculeDe = (mode: Mode, a: Article): { rentrer: boolean; valeur: boolean } =>
  mode === "magasin" ? { rentrer: false, valeur: !a.coche } : { rentrer: true, valeur: !a.rentre };

/** L'état d'un article dans le mode courant — c'est lui qui allume la puce. */
export const marque = (mode: Mode, a: Article): boolean => (mode === "magasin" ? a.coche : a.rentre);

/** Ce que la semaine demande et qu'on n'achète PAS, par provenance. « À
 *  cuisiner d'avance » est le cas contre-intuitif : une base manquante ne
 *  s'achète nulle part, elle se cuisine. */
export function horsListe(
  catalogue: Catalogue,
  provenances: Partial<Record<Provenance, number>>,
): [string, number][] {
  return Object.entries(provenances)
    .filter(([p, n]) => p !== "courses" && !!n)
    .map(([p, n]) => [catalogue.provenances[p as Provenance] ?? p, n as number]);
}
