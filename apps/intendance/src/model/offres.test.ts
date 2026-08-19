import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { calculer } from "./calcul";
import { lireCatalogue } from "./catalogue";
import { creerJeu, SAUTE, type Jeu } from "./jeu";
import { gamelles, offresSurproduction } from "./offres";
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
const offres = () => offresSurproduction(jeu, jeu.choix, calculer(jeu));

/** Une semaine qui réclame plus de sauce qu'il n'en existe : le bocal du
 *  congélo (700 g) et le lot de lundi (1400 g) contre 3 100 g demandés. */
const semaineEnManqueDeSauce = () => {
  poser(0, "diner", "sauce-bolognaise");
  poser(1, "dejeuner", "pates-bolognaise");
  poser(1, "diner", "lasagnes");
  poser(2, "dejeuner", "pates-bolognaise");
  poser(2, "diner", "lasagnes");
  poser(3, "diner", "lasagnes");
};

describe("faire plus, plus tôt", () => {
  test("le manque remonte vers le plat amont qui émet la chose", () => {
    // Lundi produit un lot de sauce ; mercredi en réclame plus qu'il n'en
    // reste. L'offre vise lundi, parce qu'il est déjà au menu et déjà allumé.
    semaineEnManqueDeSauce();
    const o = offres();
    expect(o).toHaveLength(1);
    expect(o[0]?.creneau).toBe(creneau(0, "diner"));
    expect(o[0]?.type).toBe("sauce-bolognaise");
  });

  test("sans plat amont qui la produise, il n'y a rien à offrir", () => {
    // Les falafels réclament des pois chiches cuits que rien ne cuisine.
    // Un manque sans émetteur en amont n'est pas une offre : c'est un manque.
    poser(0, "diner", "falafels-aux-herbes");
    expect(offres()).toHaveLength(0);
  });

  test("deux plats qui réclament la même base au même émetteur font UNE offre", () => {
    semaineEnManqueDeSauce();
    const c = calculer(jeu);
    // Deux créneaux distincts manquent de sauce…
    expect(c.manques).toHaveLength(2);

    // …et pourtant une seule offre : le manque s'ADDITIONNE. Deux offres
    // arrondies chacune de son côté proposeraient un lot de trop.
    const o = offres();
    expect(o).toHaveLength(1);
    expect(o[0]!.manque).toBe(c.manques.reduce((a, m) => a + m.manque, 0));
    expect(o[0]!.pour).toHaveLength(2);
  });

  test("l'offre se dit en multiplicateur pour un lot qui se coupe", () => {
    semaineEnManqueDeSauce();
    const o = offres()[0]!;
    expect(o.indivisible).toBe(false);
    expect(o.combien).toMatch(/^en faire [\d.,]+×$/);
    expect(o.facteurPropose).toBeGreaterThan(o.facteurActuel);
  });

  test("un lot qui ne se coupe pas se dit en lots entiers, ou se prend plus gros", () => {
    // « ×4,8 » d'un lot déjà fractionnaire ne veut rien dire devant une
    // casserole. Un poulet, lui, se choisit entre 1,2 et 2 kg : c'est le
    // calibre, et c'est pour ça qu'on n'en rôtit pas deux pour 300 g manquants.
    poser(0, "diner", "poulet-roti");
    poser(1, "diner", "soupe-de-poule");
    poser(2, "diner", "soupe-de-poule");
    const o = offres().find((x) => x.rid === "poulet-roti");
    expect(o).toBeDefined();
    expect(o!.indivisible).toBe(true);
    expect(o!.combien).toMatch(/lot|plus gros/);
    if (!o!.calibre) expect(Number.isInteger(o!.facteurPropose)).toBe(true);
  });

  test("une offre porte ses réserves — les deux murs se réparent différemment", () => {
    semaineEnManqueDeSauce();
    const o = offres()[0]!;
    // Chaque réserve nomme un mur : le récipient, ou la place où ranger.
    for (const r of o.reserves())
      expect(r).toMatch(/ne se coupe pas|ne tient pas dans|plus de (place|contenant)/);
    // Et la phrase reste lisible d'un trait.
    expect(o.phrase()).toContain(o.titre);
    expect(o.phrase()).toContain("ne coûte plus rien");
  });

  test("le surplus d'un arrondi se compte, parce que le stock n'est pas infini", () => {
    semaineEnManqueDeSauce();
    const o = offres()[0]!;
    // Un lot divisible ne crée pas de surplus : on en fait exactement ce qu'il
    // faut. C'est l'ARRONDI d'un lot entier qui produit du stock à ranger.
    expect(o.indivisible).toBe(false);
    expect(o.portionsAStocker).toBeCloseTo(0, 9);
  });
});

describe("la gamelle se cuisine la veille au soir", () => {
  test("un déjeuner qui part en gamelle pointe vers le dîner de la veille", () => {
    const g = gamelles(jeu, jeu.choix);
    expect(g.length).toBeGreaterThan(0);
    for (const x of g) {
      expect(jeu.creneaux[x.i]?.emporte).toBe(true);
      expect(jeu.creneaux[x.veille]?.repas).toBe("diner");
      expect(x.veille).toBeLessThan(x.i);
    }
  });

  test("elle demande que le dîner de la veille soit cuisiné plus grand", () => {
    const g0 = gamelles(jeu, jeu.choix)[0]!;
    jeu.choix[g0.veille] = "fajitas-poulet";
    const g = gamelles(jeu, jeu.choix).find((x) => x.i === g0.i)!;
    expect(g.total).toBe(g.partsVeille + g.partsGamelle);
    expect(g.total).toBeGreaterThan(g.partsVeille);
  });

  test("sans dîner posé la veille, il n'y a rien à proposer", () => {
    const g = gamelles(jeu, jeu.choix)[0]!;
    expect(g.plat).toBeNull();
    expect(g.actionnable).toBe(false);
    // Et on ne prétend rien savoir d'un plat qui n'existe pas.
    expect(g.transportable).toBeNull();
    expect(g.laisseReste).toBeNull();
  });

  test("un plat qui ne laisse pas de reste ne peut pas fournir la gamelle", () => {
    const g0 = gamelles(jeu, jeu.choix)[0]!;
    const sansReste = catalogue.plats.find(
      (p) => !p.emits.some((e) => e.kind === "reste-plat") && p.creneaux.includes("diner"),
    )!;
    jeu.choix[g0.veille] = sansReste.id;
    const g = gamelles(jeu, jeu.choix).find((x) => x.i === g0.i)!;
    expect(g.laisseReste).toBe(false);
    expect(g.actionnable).toBe(false);
  });

  test("un plat qui voyage mal non plus", () => {
    const g0 = gamelles(jeu, jeu.choix)[0]!;
    const voyageMal = catalogue.plats.find(
      (p) => p.transportable === false && p.creneaux.includes("diner"),
    );
    if (!voyageMal) return; // le catalogue n'en porte pas aujourd'hui
    jeu.choix[g0.veille] = voyageMal.id;
    const g = gamelles(jeu, jeu.choix).find((x) => x.i === g0.i)!;
    expect(g.transportable).toBe(false);
    expect(g.actionnable).toBe(false);
  });

  test("une gamelle déjà servie est faite, pas à faire", () => {
    const g0 = gamelles(jeu, jeu.choix)[0]!;
    jeu.choix[g0.veille] = "fajitas-poulet";
    jeu.choix[g0.i] = "reste-de-la-veille";
    const g = gamelles(jeu, jeu.choix).find((x) => x.i === g0.i)!;
    expect(g.fait).toBe(true);
    expect(g.actionnable).toBe(false);
  });

  test("un midi sauté reste une gamelle à prévoir — sauter n'est pas servir", () => {
    const g0 = gamelles(jeu, jeu.choix)[0]!;
    jeu.choix[g0.i] = SAUTE;
    const g = gamelles(jeu, jeu.choix).find((x) => x.i === g0.i)!;
    expect(g.fait).toBe(false);
  });
});
