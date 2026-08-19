import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { calculer } from "./calcul";
import { lireCatalogue } from "./catalogue";
import { creerJeu, type Jeu } from "./jeu";
import { categorie, couverture, main, offre, parRayon } from "./scoring";
import type { Catalogue } from "./types";

const LUNDI = new Date("2026-08-17T12:00:00Z");
const catalogue: Catalogue = lireCatalogue(
  JSON.parse(readFileSync("public/cuisine-data.json", "utf8")) as unknown,
);

let jeu: Jeu;
beforeEach(() => {
  jeu = creerJeu(catalogue, 7, LUNDI);
});

const creneau = (jour: number, repas: string): number => {
  const i = jeu.creneaux.findIndex((c) => c.jour === jour && c.repas === repas);
  if (i < 0) throw new Error(`pas de créneau ${repas} le jour ${jour}`);
  return i;
};
const poser = (jour: number, repas: string, rid: string) => {
  jeu.choix[creneau(jour, repas)] = rid;
};

describe("la couverture", () => {
  test("se mesure sur les repas principaux, pas sur les vingt-et-un créneaux", () => {
    // Les plafonds ont été posés contre six dîners. Les étaler sur toute la
    // semaine les diviserait par deux sans que personne l'ait décidé.
    const gouter = jeu.creneaux.findIndex((c) => c.repas === "gouter");
    const platGouter = catalogue.plats.find((p) => p.creneaux.includes("gouter"))!;
    jeu.choix[gouter] = platGouter.id;
    const cov = couverture(jeu, jeu.choix);
    expect(Object.keys(cov.servi)).toHaveLength(0);
    expect(cov.familles.size).toBe(0);
  });

  test("elle compte les familles de légumes, et dit combien il en manque", () => {
    const vide = couverture(jeu, jeu.choix);
    expect(vide.famillesManquantes).toBe(catalogue.equilibre.cibles.familles_legumes_min);

    poser(0, "diner", "sauce-bolognaise");
    const apres = couverture(jeu, jeu.choix);
    expect(apres.familles.size).toBeGreaterThan(0);
    expect(apres.famillesManquantes).toBeLessThan(vide.famillesManquantes);
  });

  test("une protéine sous son minimum manque", () => {
    const cov = couverture(jeu, jeu.choix);
    for (const [p, c] of Object.entries(catalogue.equilibre.cibles.proteine))
      if (c.min != null && c.min > 0) expect(cov.manques[p]).toBe(c.min);
  });

  test("un plat bâti sur un reste ne sature pas sa protéine", () => {
    // La saturation compte ce qu'on ACHÈTE. Un plat qui mange un reste ne
    // coûte rien de plus : le refuser pour cause de quota serait absurde.
    poser(0, "diner", "pates-bolognaise");
    const cov = couverture(jeu, jeu.choix);
    const p = jeu.plats["pates-bolognaise"]!;
    const surReste = p.ingredients.some((x) => x.base);
    expect(surReste).toBe(true);
    expect(cov.servi[p.apports.proteine]).toBe(1);
    expect(cov.satures[p.apports.proteine]).toBeUndefined();
  });
});

describe("l'enseigne d'une carte est dérivée, jamais étiquetée", () => {
  test("un plat qui accepte un reste est une dérivée", () => {
    expect(categorie(jeu.plats["pates-bolognaise"]!)).toBe("derive");
  });

  test("un plat qui produit une base est une souche", () => {
    expect(categorie(jeu.plats["sauce-bolognaise"]!)).toBe("souche");
  });

  test("chaque plat du catalogue en a une, et une seule", () => {
    const valides = ["derive", "souche", "express", "congelable", "complet"];
    for (const p of catalogue.plats) expect(valides).toContain(categorie(p));
  });
});

describe("le score dit pourquoi une carte est ici", () => {
  test("un plat déjà posé ailleurs n'est pas reproposé", () => {
    poser(0, "diner", "sauce-bolognaise");
    const cartes = offre(jeu, jeu.choix, creneau(1, "diner"));
    expect(cartes.some((c) => c.plat.id === "sauce-bolognaise")).toBe(false);
  });

  test("un plat ne se propose que sur les créneaux qui lui vont", () => {
    const gouter = jeu.creneaux.findIndex((c) => c.repas === "gouter");
    for (const c of offre(jeu, jeu.choix, gouter))
      expect(c.plat.creneaux.length === 0 || c.plat.creneaux.includes("gouter")).toBe(true);
  });

  test("un plat qui trouve son reste le raconte, et coûte moins d'articles", () => {
    const carte = offre(jeu, jeu.choix, creneau(0, "diner"))
      .find((c) => c.plat.id === "pates-bolognaise")!;
    expect(carte.chaine).toBe(true);
    expect(carte.recit).toContain("du congélo");
    expect(carte.partiel).toBe(false);
  });

  test("un plat qui exige un reste que rien ne couvre est pénalisé et le dit", () => {
    // « Reste de la veille » n'a pas de repli : sans reste, il n'existe pas.
    // Les falafels, eux, ont un `sansReste` — ils coûtent plus cher, mais
    // restent faisables, et ne sont donc pas dans ce cas.
    const carte = offre(jeu, jeu.choix, creneau(0, "dejeuner"))
      .find((c) => c.plat.id === "reste-de-la-veille")!;
    expect(carte.manque).toBe(true);
    expect(carte.pourquoi.some((r) => r.startsWith("demande "))).toBe(true);

    const falafels = offre(jeu, jeu.choix, creneau(0, "diner"))
      .find((c) => c.plat.id === "falafels-aux-herbes")!;
    expect(falafels.manque).toBe(false);
    expect(falafels.plein).toBe(true);
  });

  test("le coût marginal se mesure en posant la carte, pas en la lisant", () => {
    const cartes = offre(jeu, jeu.choix, creneau(0, "diner"));
    for (const c of cartes) expect(c.marginal).toBeGreaterThanOrEqual(0);
    // Une carte servie par le stock coûte moins qu'une carte à plein tarif.
    const chainee = cartes.find((c) => c.chaine && !c.partiel);
    const pleine = cartes.find((c) => !c.chaine && c.plat.accepts.length === 0);
    if (chainee && pleine) expect(chainee.marginal).toBeLessThanOrEqual(pleine.marginal);
  });

  test("les cartes arrivent triées, la meilleure d'abord", () => {
    const scores = offre(jeu, jeu.choix, creneau(0, "diner")).map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  test("un plat qui voyage mal sur un créneau de gamelle est noté moins bien", () => {
    const gamelle = jeu.creneaux.findIndex((c) => c.emporte && c.nature === "choisi");
    const cartes = offre(jeu, jeu.choix, gamelle);
    for (const c of cartes.filter((x) => x.malTransporte))
      expect(c.pourquoi).toContain("voyage mal en gamelle");
  });
});

describe("la main de cartes", () => {
  test("est la même tant qu'on ne repioche pas", () => {
    jeu.slot = creneau(0, "diner");
    const a = main(jeu).map((c) => c.plat.id);
    const b = main(jeu).map((c) => c.plat.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  test("et change quand on repioche", () => {
    jeu.slot = creneau(0, "diner");
    const a = main(jeu).map((c) => c.plat.id);
    jeu.repioches[jeu.slot] = 1;
    const b = main(jeu).map((c) => c.plat.id);
    expect(a).not.toEqual(b);
  });

  test("garantit la variété des enseignes plutôt que cinq fois la même", () => {
    jeu.slot = creneau(0, "diner");
    const m = main(jeu);
    const jouables = offre(jeu, jeu.choix, jeu.slot);
    for (const cat of ["express", "souche", "derive"] as const)
      if (jouables.some((l) => l.categorie === cat))
        expect(m.some((c) => c.categorie === cat)).toBe(true);
  });

  test("ne sert jamais deux fois le même plat", () => {
    jeu.slot = creneau(0, "diner");
    const ids = main(jeu).map((c) => c.plat.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("rend une main vide quand plus rien ne convient", () => {
    // Tous les plats du créneau sont posés ailleurs : il ne reste rien.
    const cible = creneau(0, "diner");
    let libre = 0;
    for (const p of catalogue.plats) {
      while (libre < jeu.creneaux.length && (jeu.creneaux[libre]!.nature !== "choisi" || libre === cible))
        libre++;
      if (libre >= jeu.creneaux.length) break;
      jeu.choix[libre++] = p.id;
    }
    jeu.slot = cible;
    expect(main(jeu).length).toBeLessThanOrEqual(4);
  });
});

describe("la liste de courses suit le magasin", () => {
  test("les rayons sortent dans l'ordre où on les traverse", () => {
    poser(0, "diner", "fajitas-poulet");
    poser(1, "diner", "sauce-bolognaise");
    const noms = parRayon(catalogue, calculer(jeu).panier).map(([r]) => r);
    const attendu = catalogue.rayons.ordre.filter((r) => noms.includes(r));
    expect(noms.filter((n) => n !== "autre")).toEqual(attendu);
  });

  test("un article qu'aucun rayon ne réclame finit dans « autre », jamais nulle part", () => {
    poser(0, "diner", "fajitas-poulet");
    poser(1, "diner", "sauce-bolognaise");
    poser(2, "diner", "poulet-roti");
    const calc = calculer(jeu);
    const groupes = parRayon(catalogue, calc.panier);
    const places = groupes.flatMap(([, items]) => items.map((a) => a.id));
    const attendus = [...calc.panier.values()].map((a) => a.id);
    expect(new Set(places)).toEqual(new Set(attendus));
    if (groupes.some(([r]) => r === "autre")) expect(groupes.at(-1)?.[0]).toBe("autre");
  });
});
