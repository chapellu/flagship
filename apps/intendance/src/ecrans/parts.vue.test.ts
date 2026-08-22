import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { calculer } from "../model/calcul";
import { lireCatalogue } from "../model/catalogue";
import { creerJeu, SAUTE, type Jeu } from "../model/jeu";
import type { Catalogue, Plat } from "../model/types";
import {
  apercuDeLaSemaine,
  bouger,
  crans,
  cuisson,
  noteDesParts,
  partsAEcrire,
  CRANS,
  MINIMUM,
} from "./parts.vue";

const LUNDI = new Date("2026-08-17T12:00:00Z");
const catalogue: Catalogue = lireCatalogue(
  JSON.parse(readFileSync("public/cuisine-data.json", "utf8")) as unknown,
);
const FOYER = catalogue.foyer.parts; // 2,5 — deux adultes et le grand

const plat = (id: string): Plat => {
  const p = catalogue.plats.find((x) => x.id === id);
  if (!p) throw new Error(`pas de plat ${id}`);
  return p;
};

let jeu: Jeu;
beforeEach(() => {
  jeu = creerJeu(catalogue, 7, LUNDI);
});

const creneau = (jour: number, repas: string): number => {
  const i = jeu.creneaux.findIndex((c) => c.jour === jour && c.repas === repas);
  if (i < 0) throw new Error(`pas de créneau ${repas} le jour ${jour}`);
  return i;
};

describe("le pas d'un demi", () => {
  test("un cran de plus, un cran de moins", () => {
    expect(bouger(2.5, 0.5)).toBe(3);
    expect(bouger(2.5, -0.5)).toBe(2);
  });

  test("le plancher est un demi — en dessous, c'est un repas sauté", () => {
    expect(bouger(MINIMUM, -0.5)).toBe(MINIMUM);
    expect(bouger(1, -0.5)).toBe(MINIMUM);
  });

  test("une valeur hors grille y retombe", () => {
    // Une offre acceptée écrit `demi()`, mais un foyer réglé à 2,7 ou une
    // donnée d'un autre âge ne doit pas produire 3,2 parts.
    expect(bouger(2.7, 0.5)).toBe(3);
    expect(bouger(2.7, -0.5)).toBe(2);
  });
});

describe("ce qu'on écrit en base", () => {
  test("la taille du foyer s'écrit `null` — c'est « comme d'habitude »", () => {
    // Stocker 2,5 figerait un chiffre qui doit suivre le foyer : le jour où un
    // mangeur s'ajoute, les créneaux jamais touchés doivent suivre, eux seuls.
    expect(partsAEcrire(FOYER, FOYER)).toBeNull();
  });

  test("tout le reste s'écrit tel quel", () => {
    expect(partsAEcrire(4, FOYER)).toBe(4);
    expect(partsAEcrire(0.5, FOYER)).toBe(0.5);
  });
});

describe("la règle", () => {
  test("neuf crans, un seul allumé, le foyer marqué", () => {
    const r = crans(FOYER, FOYER);
    expect(r).toHaveLength(CRANS);
    expect(r.filter((c) => c.ici)).toHaveLength(1);
    expect(r.filter((c) => c.foyer)).toHaveLength(1);
    // Le foyer est au milieu quand on est chez soi.
    expect(r[4]).toMatchObject({ v: FOYER, ici: true, foyer: true });
  });

  test("elle ne descend jamais sous le demi", () => {
    for (const p of [0.5, 1, 2.5, 6]) expect(crans(p, FOYER)[0]!.v).toBeGreaterThanOrEqual(MINIMUM);
  });

  test("la valeur est TOUJOURS sur la règle, même loin du foyer", () => {
    // Le proto figeait la fenêtre sur [foyer-2, foyer+2] : à huit parts —
    // exactement le soir où l'on regarde la jauge — plus aucun cran n'était
    // allumé, et la règle affichait un voisinage où l'on n'était plus.
    for (const p of [0.5, 1.5, 2.5, 4.5, 8, 12]) {
      const r = crans(p, FOYER);
      expect(r.filter((c) => c.ici)).toHaveLength(1);
      expect(r).toHaveLength(CRANS);
    }
  });

  test("quand la valeur est très loin, c'est le foyer qui sort — pas la valeur", () => {
    const r = crans(12, FOYER);
    expect(r.some((c) => c.foyer)).toBe(false);
    expect(r.find((c) => c.ici)?.v).toBe(12);
  });
});

describe("ce que le nombre dit du foyer", () => {
  test("les trois cas", () => {
    expect(noteDesParts(FOYER, FOYER)).toBe("comme le foyer");
    expect(noteDesParts(4, FOYER)).toBe("+1,5 de plus que le foyer");
    expect(noteDesParts(1.5, FOYER)).toBe("-1 — quelqu’un mange dehors");
  });
});

describe("ce qu'on cuisine vraiment", () => {
  test("un lot entier ne se coupe pas, et le dit", () => {
    // Le poulet rôti fait six parts ; en demander 2,5 n'en fait pas 2,5.
    const c = cuisson(plat("poulet-roti"), 2.5);
    expect(c.produit).toBe(6);
    expect(c.pourquoi).toBe("Le lot ne se coupe pas.");
  });

  test("un plat qui se garde se fait en entier, et le dit autrement", () => {
    const c = cuisson(plat("lentilles-mijotees"), 2.5);
    expect(c.produit).toBeGreaterThan(2.5);
    expect(c.pourquoi).toBe("Ça se garde, autant faire le lot.");
  });

  test("sans surplus, rien à expliquer", () => {
    // À la taille du lot, ce qu'on cuisine est ce qu'on demande.
    expect(cuisson(plat("lentilles-mijotees"), 4).pourquoi).toBe("");
  });

  test("la vaisselle borne, et la phrase dit la limite au lieu de la promettre", () => {
    // La sauteuse tient un lot d'escalopes, pas un lot et demi.
    const p = plat("escalopes-emmental-champignons");
    expect(cuisson(p, 6).tient).toBe(true);
    const trop = cuisson(p, 9);
    expect(trop.tient).toBe(false);
    expect(trop.reserve).toContain("sauteuse 28 cm");
    expect(trop.reserve).toContain("×1 au plus");
  });

  test("un plat que rien ne borne le dit aussi", () => {
    expect(cuisson(plat("poulet-roti"), 2.5).reserve).toBe("Rien ne borne ce plat.");
  });
});

describe("l'aperçu de la semaine", () => {
  const vue = (i: number) => apercuDeLaSemaine(jeu, calculer(jeu), i);

  test("une semaine vierge ne montre que le créneau courant", () => {
    const i = creneau(0, "diner");
    const a = vue(i);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ i, ici: true, quoi: "à poser", partsRegle: false });
  });

  test("le créneau courant y est TOUJOURS, et marqué une seule fois", () => {
    jeu.choix[creneau(1, "diner")] = "lentilles-mijotees";
    const i = creneau(0, "dejeuner");
    const a = vue(i);
    expect(a.filter((l) => l.ici)).toHaveLength(1);
    expect(a.find((l) => l.ici)?.i).toBe(i);
  });

  test("n'entre que ce dont quelqu'un a dit quelque chose", () => {
    // Quatorze lignes « à poser · 2,5 parts » n'apprendraient rien.
    const pose = creneau(1, "diner");
    const regle = creneau(3, "dejeuner");
    const saute = creneau(4, "diner");
    jeu.choix[pose] = "lentilles-mijotees";
    jeu.parts[regle] = 6;
    jeu.choix[saute] = SAUTE;

    const i = creneau(0, "diner");
    expect(vue(i).map((l) => l.i)).toEqual([i, pose, regle, saute]);
  });

  test("les routines n'y sont pas : elles ne se choisissent pas", () => {
    const petitDej = jeu.creneaux.findIndex((c) => c.nature === "routine");
    expect(petitDej).toBeGreaterThanOrEqual(0);
    jeu.parts[petitDej] = 6;
    expect(vue(creneau(0, "diner")).some((l) => l.i === petitDej)).toBe(false);
  });

  test("un repas sauté se dit, et ne montre pas de parts", () => {
    const i = creneau(2, "dejeuner");
    jeu.choix[i] = SAUTE;
    jeu.parts[i] = 6;
    const l = vue(creneau(0, "diner")).find((x) => x.i === i)!;
    expect(l.saute).toBe(true);
    expect(l.quoi).toBe("on ne mange pas là");
  });

  test("chaque ligne porte de quoi ouvrir ses propres parts", () => {
    jeu.choix[creneau(1, "diner")] = "lentilles-mijotees";
    for (const l of vue(creneau(0, "diner"))) {
      expect(l.creneau.jour).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(l.creneau.repas).toBeTruthy();
      expect(l.quand).toMatch(/^\w{3} /);
    }
  });

  test("un manque se lit sur la ligne du créneau qui le réclame", () => {
    // `falafels-aux-herbes` réclame des pois chiches cuits que rien ne
    // cuisine. Le manque est dit avec les mêmes mots que sur « La semaine ».
    const i = creneau(1, "dejeuner");
    jeu.choix[i] = "falafels-aux-herbes";
    const l = vue(creneau(0, "diner")).find((x) => x.i === i)!;
    expect(l.souci).toContain("manque");
  });
});
