import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { cleArticle, type EtatCourse } from "../db";
import { articles, calculer, type Calcul } from "../model/calcul";
import { lireCatalogue } from "../model/catalogue";
import { creerJeu, SAUTE, type Jeu } from "../model/jeu";
import type { Catalogue } from "../model/types";
import { aFaire, detailDesCourses, resumeCuisine, vueDuCockpit } from "./cockpit.vue";
import { vueAPrevoir } from "./prevoir.vue";

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

/** La vue, avec une base qui n'a rien à dire — c'est l'état d'un lundi neuf. */
const vue = (courses: Map<string, EtatCourse> = new Map(), gesteFait = false) =>
  vueDuCockpit(jeu, calculer(jeu), { courses, gesteFait });

const cles = (c: Calcul): string[] =>
  articles(c.panier).map((a) => cleArticle(a.id, a.unit));

/** Toute la liste marquée d'un coup — on ne coche pas douze articles à la main
 *  pour vérifier une phrase. */
const marquer = (c: Calcul, patch: Partial<EtatCourse>, combien = Infinity) =>
  new Map(
    cles(c)
      .slice(0, combien)
      .map((cle) => [cle, { cle, coche: false, rentre: false, maj: 0, ...patch }]),
  );

describe("ce qui vous attend aujourd'hui", () => {
  test("le jardin ne produit jamais de tâche — il n'a pas de modèle", () => {
    poser(0, "diner", "lasagnes");
    // Le proto en tirait trois de `data.js`. Aucune n'est calculée, aucune ne
    // se coche : une tâche qu'on ne peut pas finir revient tous les jours.
    expect(vue().taches.every((t) => t.facette === "Cuisine")).toBe(true);
  });

  test("un dîner de ce soir non posé est la première chose de la liste", () => {
    const t = vue().taches[0]!;
    expect(t.cle).toBe("ce-soir");
    // Elle ouvre le créneau NOMMÉ, pas un index : un lien gardé sur le
    // téléphone doit rouvrir le bon soir. Voir `nav/routes.ts`.
    expect(t.route).toEqual({
      ecran: "poser",
      creneau: { jour: "2026-08-17", repas: "diner" },
    });
  });

  test("« on ne mange pas là » est une réponse : la tâche s'en va", () => {
    jeu.choix[creneau(0, "diner")] = SAUTE;
    expect(vue().taches.find((t) => t.cle === "ce-soir")).toBeUndefined();
  });
});

describe("le geste du jour", () => {
  // Le dîner de demain prend dans le bocal de sauce, qui est au congélo : il
  // faut le sortir ce soir, sinon il sera pris en bloc à 19 h.
  beforeEach(() => {
    poser(0, "diner", "poulet-roti");
    poser(1, "diner", "pates-bolognaise");
  });

  test("il paraît au cockpit avec les mots de « Aujourd'hui »", () => {
    const t = vue().taches.find((x) => x.cle.startsWith("geste|"));
    expect(t?.titre).toBe("Sortir sauce-bolognaise du congélo");
    expect(t?.route).toEqual({ ecran: "aujourdhui" });
  });

  test("coché, il quitte la liste — sinon le cockpit réclame ce qui est fait", () => {
    expect(vue(new Map(), true).taches.find((x) => x.cle.startsWith("geste|"))).toBeUndefined();
  });
});

describe("les courses", () => {
  beforeEach(() => {
    poser(0, "diner", "lasagnes");
    poser(2, "diner", "poulet-roti");
  });

  test("la ligne dit où en est la liste, et pas autre chose", () => {
    // Le proto écrivait « rien de rentré au stock » quel que soit le nombre
    // d'articles rentrés : il lisait les cochés et concluait sur les rentrés.
    expect(detailDesCourses(12, 0, 0)).toBe("12 articles à cocher");
    expect(detailDesCourses(12, 5, 0)).toBe("5 sur 12 cochés");
    expect(detailDesCourses(12, 12, 4)).toBe("4 sur 12 rentrés au stock");
    expect(detailDesCourses(1, 0, 0)).toBe("1 article à cocher");
  });

  test("tout rentré, la tâche disparaît ; un seul article manquant, elle reste", () => {
    const calc = calculer(jeu);
    const n = articles(calc.panier).length;
    expect(n).toBeGreaterThan(1);

    expect(vue(marquer(calc, { coche: true, rentre: true })).taches.map((t) => t.cle)).not.toContain("courses");

    const presque = marquer(calc, { coche: true, rentre: true }, n - 1);
    const t = vue(presque).taches.find((x) => x.cle === "courses");
    expect(t?.detail).toBe(`${n - 1} sur ${n} rentrés au stock`);
  });

  test("une semaine vide n'envoie pas faire les courses", () => {
    jeu = creerJeu(catalogue, 7, LUNDI);
    expect(vue().taches.map((t) => t.cle)).not.toContain("courses");
  });
});

describe("le compte de la journée", () => {
  test("la pastille est la liste, pas un compte refait à côté", () => {
    poser(0, "diner", "poulet-roti");
    poser(1, "diner", "pates-bolognaise");
    const v = vue();
    expect(aFaire(v)).toBe(v.taches.length);
    // Et la phrase d'entrée compte la même chose que la pastille.
    expect(v.entree).toBe(`${v.taches.length} choses vous attendent aujourd'hui.`);
  });

  test("les offres se comptent là où l'on y répond", () => {
    // Une semaine qui réclame plus de sauce qu'il n'en existe : le modèle
    // propose d'agrandir le lot amont. Voir `prevoir.vue.test.ts`.
    poser(0, "diner", "sauce-bolognaise");
    poser(1, "dejeuner", "pates-bolognaise");
    poser(1, "diner", "lasagnes");
    poser(2, "dejeuner", "pates-bolognaise");
    poser(2, "diner", "lasagnes");

    const calc = calculer(jeu);
    const n = vueAPrevoir(jeu, calc).enAttente;
    expect(n).toBeGreaterThan(1);
    const t = vueDuCockpit(jeu, calc, { courses: new Map(), gesteFait: false }).taches.find(
      (x) => x.cle === "prevoir",
    );
    // Un seul endroit sait compter les offres, et c'est l'écran qui y répond.
    expect(t?.titre).toBe(`${n} offres attendent une réponse`);
    expect(t?.route).toEqual({ ecran: "prevoir" });
  });

  test("une journée sans rien le dit, plutôt que de montrer une liste vide", () => {
    // Tout est répondu, rien à acheter : le seul cockpit qui n'a rien à dire.
    for (const [i, c] of jeu.creneaux.entries()) if (c.nature === "choisi") jeu.choix[i] = SAUTE;
    const v = vue();
    expect(v.taches).toEqual([]);
    expect(v.entree).toBe("Rien ne vous attend aujourd'hui.");
  });
});

describe("la carte de la cuisine", () => {
  test("elle compte les créneaux RÉPONDUS, pas les créneaux de la semaine", () => {
    // Le proto affichait « 14 créneaux » — un nombre qui ne bougeait jamais.
    const total = jeu.creneaux.filter((c) => c.nature === "choisi").length;
    expect(vue().cuisine.etat).toBe(`0/${total} répondus`);
    poser(0, "diner", "lasagnes");
    jeu.choix[creneau(1, "diner")] = SAUTE;
    expect(vue().cuisine.etat).toBe(`2/${total} répondus`);
  });

  test("elle n'annonce pas une semaine posée quand il reste des créneaux", () => {
    expect(resumeCuisine(3, "dimanche", 0)).toBe("3 créneaux restent à poser d'ici dimanche.");
    expect(resumeCuisine(1, "dimanche", 0)).toBe("Un créneau reste à poser d'ici dimanche.");
    expect(resumeCuisine(0, "dimanche", 0)).toBe("La semaine est répondue jusqu'à dimanche.");
    expect(resumeCuisine(0, "dimanche", 2)).toContain("2 offres attendent votre réponse.");
  });

  test("le dernier jour est celui de la fenêtre, pas « dimanche » en dur", () => {
    // La semaine part d'aujourd'hui. Ouverte un mercredi, elle finit un mardi —
    // et le proto promettait quand même « posée jusqu'à dimanche ».
    jeu = creerJeu(catalogue, 7, new Date("2026-08-19T12:00:00Z"));
    expect(jeu.jours.at(-1)!.nom).toBe("mardi");
    expect(vue().cuisine.resume).toContain("d'ici mardi");
  });
});

describe("les chiffres de la carte", () => {
  test("une semaine vide n'affiche aucun chiffre plutôt que des zéros", () => {
    // Vu au navigateur : « 0 article » et « 0 min de cuisine » en pastilles,
    // trois choses à lire pour n'en dire aucune.
    expect(vue().cuisine.chiffres).toEqual([]);
  });

  test("posée, elle dit ce qu'il y a à acheter et à cuisiner", () => {
    poser(0, "diner", "lasagnes");
    const c = vue().cuisine.chiffres;
    expect(c.some((x) => /\d+ articles?$/.test(x))).toBe(true);
    expect(c.some((x) => x.endsWith("de cuisine"))).toBe(true);
  });
});
