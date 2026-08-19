import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { calculer } from "../model/calcul";
import { lireCatalogue } from "../model/catalogue";
import { creerJeu, SAUTE, type Jeu } from "../model/jeu";
import type { Catalogue } from "../model/types";
// Le format des durées appartient à l'écran, pas à ce test : on le rejoue
// plutôt que de recopier « 1 h 50 », sinon c'est le format qu'on épingle.
import { duree } from "../ui/format";
import { chiffresDeLaSemaine, prochainVide, routinesDeFond, vueDeLaSemaine } from "./semaine.vue";

const LUNDI = new Date("2026-08-17T12:00:00Z");
const MARDI = new Date("2026-08-18T12:00:00Z");
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
const vue = () => vueDeLaSemaine(jeu, calculer(jeu));

describe("la grille", () => {
  test("sept journées, deux créneaux choisis chacune", () => {
    const j = vue();
    expect(j).toHaveLength(7);
    for (const jour of j) expect(jour.slots.map((s) => s.label)).toEqual(["déjeuner", "dîner"]);
  });

  test("les routines sont listées à part, jamais dans la grille", () => {
    // Le petit-déj est une routine tous les jours ; le mercredi ajoute le
    // goûter. Ni l'un ni l'autre ne se choisit, et aucun ne compte de minutes.
    const j = vue();
    expect(j[0]?.routines).toEqual(["petit-déj"]);
    expect(j[2]?.routines).toEqual(["petit-déj", "goûter"]);
  });

  test("le déjeuner qui part en gamelle est marqué comme tel", () => {
    // mardi et jeudi, d'après `creneaux.emporte` du catalogue.
    const j = vue();
    expect(j[1]?.slots.find((s) => s.label === "déjeuner")?.emporte).toBe(true);
    expect(j[0]?.slots.find((s) => s.label === "déjeuner")?.emporte).toBe(false);
  });

  test("le fond de routine est ce que toutes les journées partagent", () => {
    // Le petit-déj est de tous les jours ; le goûter n'est que du mercredi, et
    // c'est justement ce qu'on veut voir ressortir.
    const j = vue();
    expect(routinesDeFond(j)).toEqual(["petit-déj"]);
    expect(j[2]?.routines.filter((r) => !routinesDeFond(j).includes(r))).toEqual(["goûter"]);
  });
});

describe("l'identité d'un créneau", () => {
  test("l'id porte le jour et le repas, pas l'index", () => {
    const j = vue();
    expect(j[2]?.slots[1]?.id).toBe("2026-08-19|diner");
    expect(j[2]?.slots[1]?.creneau).toEqual({ jour: "2026-08-19", repas: "diner" });
  });

  test("le même dîner de mercredi garde son id quand la semaine glisse", () => {
    // C'EST LE TEST QUI JUSTIFIE TOUT LE RESTE. Le dîner du 19 est le
    // quatrième créneau choisi d'une semaine qui part du lundi, et le deuxième
    // d'une semaine qui part du mardi. Son identité, elle, ne bouge pas — et
    // c'est elle qui décide quelle carte est dépliée à l'écran.
    const depuisLundi = vue().flatMap((j) => j.slots);
    jeu = creerJeu(catalogue, 7, MARDI);
    const depuisMardi = vue().flatMap((j) => j.slots);

    const a = depuisLundi.find((s) => s.id === "2026-08-19|diner");
    const b = depuisMardi.find((s) => s.id === "2026-08-19|diner");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.i).not.toBe(b?.i);
  });
});

describe("ce que la case dit", () => {
  test("un créneau qui donne quelque chose est lié", () => {
    poser(0, "diner", "sauce-bolognaise");
    const s = vue()[0]?.slots[1];
    expect(s?.lie).toBe(true);
    expect(s?.donne.map((e) => e.type)).toContain("sauce-bolognaise");
  });

  test("un créneau qui reçoit d'un autre jour est lié aussi", () => {
    poser(0, "diner", "sauce-bolognaise");
    poser(2, "diner", "pates-bolognaise");
    const s = vue()[2]?.slots[1];
    expect(s?.lie).toBe(true);
    expect(s?.recoit.map((x) => x.type)).toContain("sauce-bolognaise");
  });

  test("un créneau vide ne tient à rien", () => {
    expect(vue()[3]?.slots[0]?.lie).toBe(false);
  });

  test("un manque s'écrit sans unité fantôme", () => {
    // `falafels-aux-herbes` réclame des pois chiches cuits que rien ne cuisine.
    poser(0, "diner", "falafels-aux-herbes");
    const souci = vue()[0]?.slots[1]?.souci ?? "";
    expect(souci).toMatch(/^manque /);
    expect(souci).not.toMatch(/ {2}/);
  });

  test("les parts ne s'affichent que réglées", () => {
    poser(0, "diner", "sauce-bolognaise");
    expect(vue()[0]?.slots[1]?.partsRegle).toBe(false);
    jeu.parts[creneau(0, "diner")] = 6;
    expect(vue()[0]?.slots[1]?.partsRegle).toBe(true);
    expect(vue()[0]?.slots[1]?.parts).toBe(6);
  });
});

describe("la journée lourde", () => {
  test("au-delà d'une heure et demie, la journée se signale", () => {
    poser(0, "diner", "samoussas-legumes-rotis"); // 112 min
    const j = vue()[0];
    expect(j?.minutes).toBe(112);
    expect(j?.lourde).toBe(true);
  });

  test("une journée ordinaire ne se signale pas", () => {
    poser(0, "diner", "sauce-bolognaise"); // 60 min
    expect(vue()[0]?.lourde).toBe(false);
  });

  test("une journée vide ne compte aucune minute — les routines n'en sont pas", () => {
    expect(vue()[4]?.minutes).toBe(0);
  });
});

describe("où poser le prochain plat", () => {
  test("sur une semaine vide, c'est le premier créneau choisi", () => {
    expect(prochainVide(jeu)).toEqual({ jour: "2026-08-17", repas: "dejeuner" });
  });

  test("un repas sauté est une décision : on passe au suivant", () => {
    jeu.choix[creneau(0, "dejeuner")] = SAUTE;
    expect(prochainVide(jeu)).toEqual({ jour: "2026-08-17", repas: "diner" });
  });

  test("une semaine posée n'a plus de prochain créneau", () => {
    for (const [i, c] of jeu.creneaux.entries())
      if (c.nature === "choisi") jeu.choix[i] = SAUTE;
    expect(prochainVide(jeu)).toBeNull();
  });
});

describe("les trois chiffres", () => {
  test("ils sont nommés, et s'accordent", () => {
    // Une semaine vide ne demande rien — « 0 article », au singulier, comme le
    // veut le français — mais le placard du foyer porte déjà plusieurs lots.
    const c = chiffresDeLaSemaine(jeu, calculer(jeu));
    expect(c.map((x) => x.cle)).toEqual(["article", "de cuisine", "lots"]);
    expect(c[0]?.valeur).toBe("0");
    expect(Number(c[2]?.valeur)).toBeGreaterThan(1);
  });

  test("ils comptent ce que la semaine posée demande", () => {
    poser(0, "diner", "sauce-bolognaise");
    poser(1, "diner", "lasagnes");
    const c = chiffresDeLaSemaine(jeu, calculer(jeu));
    expect(Number(c[0]?.valeur)).toBeGreaterThan(0);
    expect(c[1]?.valeur).toBe(duree(60 + 50));
    expect(c[1]?.cle).toBe("de cuisine");
  });
});
