import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { base, cleDeLArticle, cocher, lireCourses, rentrer, rentrerLesCoches } from "../db";
import { articles, calculer, type Calcul } from "../model/calcul";
import { lireCatalogue } from "../model/catalogue";
import { creerJeu, type Jeu } from "../model/jeu";
import type { Catalogue } from "../model/types";
import { basculeDe, horsListe, marque, vueDesCourses } from "./courses.vue";

const LUNDI = new Date("2026-08-17T12:00:00Z");
const catalogue: Catalogue = lireCatalogue(
  JSON.parse(readFileSync("public/cuisine-data.json", "utf8")) as unknown,
);

let jeu: Jeu;
let calc: Calcul;
beforeEach(async () => {
  jeu = creerJeu(catalogue, 7, LUNDI);
  const i = jeu.creneaux.findIndex((c) => c.jour === 0 && c.repas === "diner");
  jeu.choix[i] = "lasagnes";
  const j = jeu.creneaux.findIndex((c) => c.jour === 1 && c.repas === "diner");
  jeu.choix[j] = "poulet-roti";
  calc = calculer(jeu);
  await base.courses.clear();
});

const vue = async () => vueDesCourses(catalogue, calc.panier, await lireCourses(base));

describe("la liste", () => {
  test("elle est calculée, pas stockée : rien en base ne la fabrique", async () => {
    const v = await vue();
    expect(v.articles.length).toBe(articles(calc.panier).length);
    expect(await base.courses.count()).toBe(0);
  });

  test("elle suit l'ordre du magasin, et personne ne disparaît", async () => {
    const v = await vue();
    expect(v.rayons.length).toBeGreaterThan(1);
    // Chaque article de la liste appartient à exactement un rayon.
    expect(v.rayons.flatMap((r) => r.articles).length).toBe(v.articles.length);
  });
});

describe("cocher n'est pas rentrer", () => {
  test("au magasin, le doigt coche ; à la maison, il rentre", () => {
    const a = { cle: "x", ligne: {} as never, coche: false, rentre: false };
    expect(basculeDe("magasin", a)).toEqual({ rentrer: false, valeur: true });
    expect(basculeDe("maison", a)).toEqual({ rentrer: true, valeur: true });
    // Et la puce s'allume sur l'état du mode où l'on est, pas sur l'autre.
    expect(marque("magasin", { ...a, coche: true })).toBe(true);
    expect(marque("maison", { ...a, coche: true })).toBe(false);
  });

  test("rentrer un article le sort du caddie", async () => {
    const cle = cleDeLArticle(articles(calc.panier)[0]!);
    await cocher(base, cle, true);
    expect((await vue()).coches).toBe(1);
    await rentrer(base, cle, true);
    const v = await vue();
    expect(v.coches).toBe(0);
    expect(v.rentres).toBe(1);
  });

  test("« tout rentrer » vide le caddie d'un coup", async () => {
    const arts = articles(calc.panier).slice(0, 3);
    for (const a of arts) await cocher(base, cleDeLArticle(a), true);
    expect(await rentrerLesCoches(base)).toBe(3);
    const v = await vue();
    expect(v.coches).toBe(0);
    expect(v.rentres).toBe(3);
  });

  test("les deux états survivent au rechargement — c'est tout le sujet", async () => {
    // Une liste qu'on met en poche entre deux rayons et qui se vide au retour
    // n'est pas une liste.
    const cle = cleDeLArticle(articles(calc.panier)[0]!);
    await cocher(base, cle, true);
    const relu = await lireCourses(base);
    expect(relu.get(cle)?.coche).toBe(true);
  });
});

describe("les orphelins", () => {
  test("un état qui ne correspond plus à aucun article se compte", async () => {
    await cocher(base, "quelque-chose-de-la-semaine-derniere|g", true);
    const v = await vue();
    expect(v.orphelins).toBe(1);
    // Et il ne se glisse pas dans la liste affichée.
    expect(v.articles.some((a) => a.cle.startsWith("quelque-chose"))).toBe(false);
  });

  test("un état ni coché ni rentré n'est pas un orphelin, c'est un vide", async () => {
    await cocher(base, "vieux|g", true);
    await cocher(base, "vieux|g", false);
    expect((await vue()).orphelins).toBe(0);
  });
});

describe("le hors-liste", () => {
  test("ce qui ne s'achète pas est nommé en français, jamais « courses »", () => {
    const h = horsListe(catalogue, calc.provenances);
    expect(h.length).toBeGreaterThan(0);
    for (const [label, n] of h) {
      expect(label).not.toBe("courses");
      expect(n).toBeGreaterThan(0);
      // Le libellé vient du catalogue, pas d'un identifiant recraché tel quel.
      expect(Object.values(catalogue.provenances)).toContain(label);
    }
  });

  test("une provenance à zéro ne s'affiche pas", () => {
    expect(horsListe(catalogue, { placard: 0, frigo: 2 })).toEqual([
      [catalogue.provenances.frigo, 2],
    ]);
  });
});
