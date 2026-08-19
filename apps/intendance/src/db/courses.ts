// Les courses : cocher, puis rentrer.
//
// DEUX GESTES, DEUX LIEUX. Cocher se fait dans le magasin, l'article part dans
// le caddie ; rentrer se fait à la maison, et c'est seulement là que le stock
// change. Le proto les avait d'abord confondus, et la liste s'effaçait sous le
// doigt au milieu d'un rayon parce qu'un re-rendu passait par là.
//
// La liste elle-même n'est pas stockée : elle est recalculée par `calculer()` à
// partir de la semaine posée. Ce qui est stocké, c'est l'ÉTAT d'un article —
// coché, rentré — parce que ça, aucun calcul ne peut le retrouver.

import { cleArticle, type Base, type EtatCourse } from "./schema";
import type { LignePanier } from "../model/calcul";

export const cleDeLArticle = (a: LignePanier): string => cleArticle(a.id, a.unit);

export async function lireCourses(base: Base): Promise<Map<string, EtatCourse>> {
  const lignes = await base.courses.toArray();
  return new Map(lignes.map((l) => [l.cle, l]));
}

async function majEtat(base: Base, cle: string, patch: Partial<EtatCourse>): Promise<void> {
  const e = await base.courses.get(cle);
  await base.courses.put({
    cle,
    coche: patch.coche ?? e?.coche ?? false,
    rentre: patch.rentre ?? e?.rentre ?? false,
    maj: Date.now(),
  });
}

export const cocher = (base: Base, cle: string, coche: boolean): Promise<void> =>
  majEtat(base, cle, { coche });

/** Rentrer un article : il quitte le caddie ET la liste. Décocher au retour
 *  serait un geste de plus pour rien — on ne le remet pas dans le caddie. */
export const rentrer = (base: Base, cle: string, rentre: boolean): Promise<void> =>
  majEtat(base, cle, rentre ? { rentre: true, coche: false } : { rentre: false });

/** Rentre d'un coup tout ce qui est coché : le geste de vider le sac. */
export async function rentrerLesCoches(base: Base): Promise<number> {
  const coches = await base.courses.filter((e) => e.coche && !e.rentre).toArray();
  const maj = Date.now();
  await base.courses.bulkPut(coches.map((e) => ({ ...e, coche: false, rentre: true, maj })));
  return coches.length;
}

/**
 * Efface l'état des courses. À faire quand la semaine change — sinon un article
 * rentré la semaine dernière rendrait invisible le même article cette semaine,
 * et la liste mentirait par omission, ce qui est la pire façon de mentir pour
 * une liste de courses.
 */
export const viderCourses = (base: Base): Promise<void> => base.courses.clear();
