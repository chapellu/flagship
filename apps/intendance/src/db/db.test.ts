import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { lireCatalogue } from "../model/catalogue";
import { creerJeu, SAUTE, type Jeu } from "../model/jeu";
import type { Catalogue } from "../model/types";
import { Base, VERSION, cleCreneau, jourISO, schemaDeclare } from "./schema";
import { cocher, lireCourses, rentrer, rentrerLesCoches, viderCourses } from "./courses";
import { hydrater, lireSemaine, oublier, poser, reglerParts } from "./semaine";
import { ajouterLot, amorcer, auModele, corrigerLot, hydraterStock, lireStock, reamorcer, retirerLot } from "./stock";
import { calculer } from "../model/calcul";

const catalogue: Catalogue = lireCatalogue(
  JSON.parse(readFileSync("public/cuisine-data.json", "utf8")) as unknown,
);
const MARDI = new Date(2026, 7, 18, 12, 0, 0); // 18 août 2026, en heure locale
const JEUDI = new Date(2026, 7, 20, 12, 0, 0);

let base: Base;
let jeu: Jeu;
let n = 0;

beforeEach(async () => {
  base = new Base(`test-${++n}`);
  await base.open();
  jeu = creerJeu(catalogue, 7, MARDI);
});
afterEach(async () => {
  await base.delete();
});

const creneau = (j: Jeu, jour: number, repas: string): number => {
  const i = j.creneaux.findIndex((c) => c.jour === jour && c.repas === repas);
  if (i < 0) throw new Error(`pas de créneau ${repas} le jour ${jour}`);
  return i;
};
const recharger = async (depuis: Date): Promise<Jeu> => {
  const j = creerJeu(catalogue, 7, depuis);
  return hydrater(j, await lireSemaine(base, j));
};

describe("le schéma", () => {
  test("déclare sa version et ses tables, et un test les épingle", () => {
    // Ce test n'a l'air de rien : sa seule raison d'être est de rougir le jour
    // où quelqu'un ajoute une table sans monter la version. C'est à ce
    // moment-là qu'il faut se souvenir d'écrire la migration.
    expect(VERSION).toBe(1);
    expect(Object.keys(schemaDeclare()).sort()).toEqual([
      "courses", "creneaux", "reglages", "stock",
    ]);
  });

  test("le jour se calcule en local, pas en UTC", () => {
    // Minuit un mardi à Paris (UTC+2) se raconte « lundi 22 h » en UTC. Une
    // décision posée sur mardi serait rangée sous lundi, une nuit sur deux.
    const minuit = new Date(2026, 7, 18, 0, 30, 0);
    expect(jourISO(minuit)).toBe("2026-08-18");
    expect(jourISO(new Date(2026, 0, 1, 23, 59, 0))).toBe("2026-01-01");
  });
});

// LE TEST QUI JUSTIFIE TOUTE LA CONCEPTION DE LA CLÉ.
describe("une décision appartient à un jour, pas à un index", () => {
  test("elle reste sur son jour quand la semaine roule", async () => {
    // Mardi : on pose un gratin sur le dîner de MERCREDI.
    const mercrediSoir = creneau(jeu, 1, "diner");
    await poser(base, jeu, mercrediSoir, "sauce-bolognaise");
    expect(jeu.jours[1]?.nom).toBe("mercredi");

    // Jeudi : la semaine recommence à jeudi. L'index 1 ne désigne plus le même
    // jour du tout — et le plat, lui, n'a pas bougé de mercredi… donc il est
    // sorti de la fenêtre, et aucun créneau ne le porte.
    const depuisJeudi = await recharger(JEUDI);
    expect(depuisJeudi.jours[0]?.nom).toBe("jeudi");
    expect(depuisJeudi.choix.filter(Boolean)).toHaveLength(0);

    // La preuve qu'il n'est pas perdu : il est toujours en base, sous son jour.
    const garde = await base.creneaux.get(cleCreneau("2026-08-19", "diner"));
    expect(garde?.plat).toBe("sauce-bolognaise");
  });

  test("et se retrouve intacte quand on rouvre le même jour", async () => {
    const soir = creneau(jeu, 0, "diner");
    await poser(base, jeu, soir, "pates-bolognaise");
    await reglerParts(base, jeu, soir, 4.5);

    const relu = await recharger(MARDI);
    expect(relu.choix[soir]).toBe("pates-bolognaise");
    expect(relu.parts[soir]).toBe(4.5);
  });

  test("un décalage d'un jour retrouve la décision au bon endroit", async () => {
    // Posé mardi sur le dîner de jeudi (index 5) ; relu jeudi, c'est le dîner
    // du jour (index bien plus petit) qui doit le porter.
    const jeudiSoirDepuisMardi = creneau(jeu, 2, "diner");
    await poser(base, jeu, jeudiSoirDepuisMardi, "poulet-roti");

    const depuisJeudi = await recharger(JEUDI);
    const jeudiSoir = creneau(depuisJeudi, 0, "diner");
    expect(jeudiSoir).not.toBe(jeudiSoirDepuisMardi);
    expect(depuisJeudi.choix[jeudiSoir]).toBe("poulet-roti");
  });
});

describe("poser, régler, oublier", () => {
  test("un repas sauté se persiste comme une décision, pas comme un vide", async () => {
    const soir = creneau(jeu, 0, "diner");
    await poser(base, jeu, soir, SAUTE);
    const relu = await recharger(MARDI);
    expect(relu.choix[soir]).toBe(SAUTE);
  });

  test("changer de plat ne fait pas oublier les parts qu'on avait réglées", async () => {
    const soir = creneau(jeu, 0, "diner");
    await reglerParts(base, jeu, soir, 5);
    await poser(base, jeu, soir, "poulet-roti");
    const relu = await recharger(MARDI);
    expect(relu.parts[soir]).toBe(5);
    expect(relu.choix[soir]).toBe("poulet-roti");
  });

  test("effacer le plat garde les parts, oublier le créneau efface tout", async () => {
    const soir = creneau(jeu, 0, "diner");
    await poser(base, jeu, soir, "poulet-roti");
    await reglerParts(base, jeu, soir, 5);

    await poser(base, jeu, soir, null);
    let relu = await recharger(MARDI);
    expect(relu.choix[soir]).toBeNull();
    expect(relu.parts[soir]).toBe(5);

    await oublier(base, jeu, soir);
    relu = await recharger(MARDI);
    expect(relu.choix[soir]).toBeNull();
    expect(relu.parts[soir]).toBe(catalogue.foyer.parts);
  });

  test("des parts à null valent « comme le foyer », pas zéro", async () => {
    const soir = creneau(jeu, 0, "diner");
    await reglerParts(base, jeu, soir, 6);
    await reglerParts(base, jeu, soir, null);
    const relu = await recharger(MARDI);
    expect(relu.parts[soir]).toBe(catalogue.foyer.parts);
  });

  test("zéro part est refusé — « personne ne mange » se dit en sautant", async () => {
    const soir = creneau(jeu, 0, "diner");
    await expect(reglerParts(base, jeu, soir, 0)).rejects.toThrow(/sautant/);
  });

  test("un créneau hors de la semaine est une erreur, pas un silence", async () => {
    await expect(poser(base, jeu, 999, "poulet-roti")).rejects.toThrow(/hors de la semaine/);
  });

  test("la semaine ne lit que sa fenêtre, pas toute la base", async () => {
    await poser(base, jeu, creneau(jeu, 0, "diner"), "poulet-roti");
    // Une décision très ancienne, qui ne doit pas remonter.
    await base.creneaux.put({
      cle: cleCreneau("2020-01-01", "diner"), jour: "2020-01-01",
      repas: "diner", plat: "lasagnes", parts: null, maj: Date.now(),
    });
    const lues = await lireSemaine(base, jeu);
    expect(lues.size).toBe(1);
  });
});

describe("les courses : cocher n'est pas rentrer", () => {
  test("cocher met dans le caddie et rien d'autre", async () => {
    await cocher(base, "comte|g", true);
    const e = (await lireCourses(base)).get("comte|g")!;
    expect(e.coche).toBe(true);
    expect(e.rentre).toBe(false);
  });

  test("rentrer sort du caddie et entre au stock", async () => {
    await cocher(base, "comte|g", true);
    await rentrer(base, "comte|g", true);
    const e = (await lireCourses(base)).get("comte|g")!;
    expect(e.coche).toBe(false);
    expect(e.rentre).toBe(true);
  });

  test("vider le sac rentre tout ce qui est coché, et rien de plus", async () => {
    await cocher(base, "a|g", true);
    await cocher(base, "b|g", true);
    await cocher(base, "c|g", false);
    expect(await rentrerLesCoches(base)).toBe(2);
    const etats = await lireCourses(base);
    expect(etats.get("a|g")?.rentre).toBe(true);
    expect(etats.get("b|g")?.rentre).toBe(true);
    expect(etats.get("c|g")?.rentre).toBe(false);
  });

  test("l'état survit au rechargement — c'est tout l'enjeu au milieu d'un rayon", async () => {
    await cocher(base, "comte|g", true);
    await base.close();
    const rouvert = new Base(base.name);
    await rouvert.open();
    expect((await lireCourses(rouvert)).get("comte|g")?.coche).toBe(true);
    await rouvert.close();
    await base.open();
  });

  test("vider les courses efface l'état, pas la liste — la liste est un calcul", async () => {
    await cocher(base, "comte|g", true);
    await viderCourses(base);
    expect((await lireCourses(base)).size).toBe(0);
  });
});

describe("le stock", () => {
  test("s'amorce depuis le catalogue, une seule fois", async () => {
    expect(await amorcer(base, catalogue)).toBe(true);
    const apres = await lireStock(base);
    expect(apres).toHaveLength(catalogue.stock.length);

    // Une seconde amorce ne doit rien dupliquer : un ré-export du catalogue ne
    // doit pas écraser ce que le foyer a constaté de ses propres yeux.
    expect(await amorcer(base, catalogue)).toBe(false);
    expect(await lireStock(base)).toHaveLength(catalogue.stock.length);
  });

  test("un lot corrigé le reste après une nouvelle amorce", async () => {
    await amorcer(base, catalogue);
    const lot = (await lireStock(base))[0]!;
    await corrigerLot(base, lot.id!, { qty: 42 });
    await amorcer(base, catalogue);
    expect((await base.stock.get(lot.id!))?.qty).toBe(42);
  });

  test("on ajoute et on retire des lots constatés", async () => {
    const id = await ajouterLot(base, {
      type: "comte", kind: "base", qty: 200, unite: "g",
      band: "1-repas", espace: "frigo", origine: null,
    });
    const lot = await base.stock.get(id);
    expect(lot?.qty).toBe(200);
    // La date de naissance par défaut est aujourd'hui : la fraîcheur se compte
    // depuis l'arrivée, pas depuis un jour qu'on aurait oublié de saisir.
    expect(lot?.born).toBe(jourISO(new Date()));

    await retirerLot(base, id);
    expect(await base.stock.get(id)).toBeUndefined();
  });

  test("un lot de la base arrive au modèle avec de quoi le retrouver", async () => {
    await amorcer(base, catalogue);
    const lot = (await lireStock(base))[0]!;
    const vu = auModele(lot);
    expect(vu).toMatchObject({
      type: lot.type,
      kind: lot.kind,
      qty_band: lot.band,
      born: lot.born,
      location: lot.espace,
      ref: String(lot.id),
    });
    expect(vu.qty).toEqual({ amount: lot.qty, unit: lot.unite });
  });

  test("une quantité sans unité ne chiffre rien — le lot part en bloc", async () => {
    // « 3 » face à « 400 g » n'est pas une comparaison. Le dépôt le sait faire
    // (il sert la ligne entière) à condition qu'on ne lui mente pas sur ce
    // qu'on connaît.
    const id = await ajouterLot(base, {
      type: "bocal-mystere", kind: "base", qty: 3, unite: null,
      band: "1-repas", espace: "placard", origine: null,
    });
    expect(auModele((await base.stock.get(id))!).qty).toBeNull();
  });

  test("retirer un lot le retire du calcul, pas seulement de l'écran", async () => {
    // LE FIL DE T15, DE BOUT EN BOUT. La table est semée, le jeu l'emporte, le
    // dépôt la sert ; un lot retiré cesse d'exister pour le chaînage. Tant que
    // `calculer` lisait `catalogue.stock`, ce test passait au vert sans que
    // rien ne marche.
    await amorcer(base, catalogue);
    const i = creneau(jeu, 0, "diner");
    jeu.choix[i] = "pates-bolognaise";

    hydraterStock(jeu, await lireStock(base));
    expect(calculer(jeu).chaine).toHaveLength(1);

    const bocal = (await lireStock(base)).find((l) => l.type === "sauce-bolognaise")!;
    await retirerLot(base, bocal.id!);
    hydraterStock(jeu, await lireStock(base));
    expect(calculer(jeu).chaine).toHaveLength(0);
  });

  test("ré-amorcer jette ce que le foyer a constaté, et le dit en le faisant", async () => {
    await amorcer(base, catalogue);
    await ajouterLot(base, {
      type: "trouvé au fond du placard", kind: "base", qty: 1, unite: "pièce",
      band: "1-repas", espace: "placard", origine: null,
    });
    expect(await lireStock(base)).toHaveLength(catalogue.stock.length + 1);

    await reamorcer(base, catalogue);
    expect(await lireStock(base)).toHaveLength(catalogue.stock.length);
  });
});
