import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lireCatalogue } from "../model/catalogue";
import type { Catalogue, Etape } from "../model/types";
import {
  avancement,
  basculerMinuteur,
  chauffeDe,
  minuteur,
  provenanceIngredient,
  SANS_FEU,
  type EtatMinuteur,
} from "./cuisiner.vue";

const catalogue: Catalogue = lireCatalogue(
  JSON.parse(readFileSync("public/cuisine-data.json", "utf8")) as unknown,
);

const etape = (needs: string[], minutes = 0): Etape => ({
  id: "e", action: "", minutes, needs, surveille: true,
  enfant: null, enfantDes: null, porteAssaisonnement: false,
});

describe("la chauffe", () => {
  test("le vocabulaire des recettes devient quelque chose qu'une main comprend", () => {
    expect(chauffeDe(etape(["bake"])).nom).toBe("Four");
    expect(chauffeDe(etape(["boil"])).niveau).toBe(4);
    expect(chauffeDe(etape(["reheat"])).niveau).toBe(1);
  });

  test("une étape sans feu le dit, et c'est une information", () => {
    // Zéro barre veut dire « faisable n'importe quand » : c'est ce qui permet
    // de décaler une étape sans risque.
    expect(chauffeDe(etape(["chop-coarse"]))).toEqual(SANS_FEU);
    expect(chauffeDe(etape([])).niveau).toBe(0);
  });

  test("le premier besoin reconnu gagne : mijoter et remuer, c'est mijoter", () => {
    expect(chauffeDe(etape(["stir", "simmer"])).nom).toBe("Feu doux");
  });

  test("toutes les étapes du catalogue tombent quelque part", () => {
    // Aucun `needs` ne doit produire d'écran vide : au pire « Sans feu ».
    for (const p of catalogue.plats)
      for (const e of p.steps) expect(chauffeDe(e).nom.length).toBeGreaterThan(0);
  });
});

describe("le minuteur", () => {
  const T0 = 1_800_000_000_000;

  test("neuf, il affiche la durée de l'étape sans rien compter", () => {
    expect(minuteur(null, 12, T0)).toEqual({ reste: 720, actif: false, sonne: false });
  });

  test("lancé, il court", () => {
    const e = basculerMinuteur(null, 12, T0);
    expect(minuteur(e, 12, T0 + 60_000)).toEqual({ reste: 660, actif: true, sonne: false });
  });

  test("UNE ÉCHÉANCE, PAS UN COMPTEUR : le temps passe même écran éteint", () => {
    // C'EST LE TEST QUI JUSTIFIE LA FORME. Le proto décrémentait une seconde
    // par battement de `setInterval` ; les navigateurs mobiles ralentissent ces
    // battements à un par minute en arrière-plan, c'est-à-dire exactement quand
    // on repose le téléphone pour cuisiner. Ici rien ne compte : on compare.
    const e = basculerMinuteur(null, 12, T0);
    expect(minuteur(e, 12, T0 + 13 * 60_000)).toEqual({ reste: 0, actif: false, sonne: true });
  });

  test("mis en pause, il garde ce qu'il reste et ne bouge plus", () => {
    const lance = basculerMinuteur(null, 12, T0);
    const pause = basculerMinuteur(lance, 12, T0 + 2 * 60_000);
    expect(pause).toEqual({ reste: 600 });
    expect(minuteur(pause, 12, T0 + 99 * 60_000)).toEqual({
      reste: 600, actif: false, sonne: false,
    });
  });

  test("repris, il repart de là où il s'était arrêté", () => {
    const pause: EtatMinuteur = { reste: 600 };
    const repris = basculerMinuteur(pause, 12, T0);
    expect(minuteur(repris, 12, T0 + 60_000).reste).toBe(540);
  });

  test("sonné, il se relance depuis le début", () => {
    // C'est la seule chose qu'on puisse vouloir d'un minuteur terminé.
    const fini = basculerMinuteur(null, 12, T0 - 20 * 60_000);
    expect(minuteur(fini, 12, T0).sonne).toBe(true);
    expect(minuteur(basculerMinuteur(fini, 12, T0), 12, T0).reste).toBe(720);
  });
});

describe("la provenance vue de la fiche", () => {
  const ing = (id: string, base = false) =>
    ({ id, nom: id, qty: null, base, assaisonnement: false }) as never;

  test("ce qui dort au placard ne part pas aux courses", () => {
    const p = catalogue.plats.find((x) => x.id === "sauce-bolognaise")!;
    const huile = p.ingredients.find((x) => x.id === "huile-olive")!;
    expect(provenanceIngredient(catalogue, huile)).toEqual({ label: "placard", acheter: false });
  });

  test("une base vient d'un autre plat, et se marque comme telle", () => {
    const p = catalogue.plats.find((x) => x.id === "pates-bolognaise")!;
    const base = p.ingredients.find((x) => x.base)!;
    expect(provenanceIngredient(catalogue, base).label).toBe("base");
    // Une base « s'achète » au sens de la fiche : elle n'est pas au placard. La
    // semaine, elle, sait qu'on ne l'achète pas — voir `calcul.provenance`.
    expect(provenanceIngredient(catalogue, base).acheter).toBe(true);
  });

  test("un alias de rayon désigne la même chose que sa cible", () => {
    // « oignons » et « oignon » ne doivent pas tomber dans deux rayons
    // différents, sinon la moitié d'une liste se dédouble.
    const [id, cible] = Object.entries(catalogue.rayons.aliases)[0]!;
    expect(provenanceIngredient(catalogue, ing(id))).toEqual(
      provenanceIngredient(catalogue, ing(cible)),
    );
  });

  test("le reste part aux courses", () => {
    expect(provenanceIngredient(catalogue, ing("pates"))).toEqual({
      label: "à acheter", acheter: true,
    });
  });
});

describe("l'avancement", () => {
  test("les minutes déjà faites ne comptent plus", () => {
    // « reste 25 min sur 50 » ne veut dire quelque chose que si « reste »
    // décroît vraiment à mesure qu'on avance.
    const steps = [etape([], 10), etape([], 20), etape([], 5)];
    expect(avancement(steps, 0)).toEqual({ reste: 35, total: 35 });
    expect(avancement(steps, 1)).toEqual({ reste: 25, total: 35 });
    expect(avancement(steps, 2)).toEqual({ reste: 5, total: 35 });
  });
});
