import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { base, prevoirGamelle } from "../db";
import { calculer } from "../model/calcul";
import { lireCatalogue } from "../model/catalogue";
import { creerJeu, type Jeu } from "../model/jeu";
import type { Catalogue } from "../model/types";
import { virgules } from "../ui/format";
import {
  constatDeLaGamelle,
  freinsDeLaGamelle,
  partsDeLaGamelle,
  partsPourLOffre,
  vueAPrevoir,
} from "./prevoir.vue";

const LUNDI = new Date("2026-08-17T12:00:00Z");
const catalogue: Catalogue = lireCatalogue(
  JSON.parse(readFileSync("public/cuisine-data.json", "utf8")) as unknown,
);

let jeu: Jeu;
beforeEach(async () => {
  jeu = creerJeu(catalogue, 7, LUNDI);
  await base.creneaux.clear();
});

const creneau = (jour: number, repas: string): number => {
  const i = jeu.creneaux.findIndex((c) => c.jour === jour && c.repas === repas);
  if (i < 0) throw new Error(`pas de créneau ${repas} le jour ${jour}`);
  return i;
};
const poser = (jour: number, repas: string, rid: string) => {
  jeu.choix[creneau(jour, repas)] = rid;
};
const vue = () => vueAPrevoir(jeu, calculer(jeu));

/** Une semaine qui réclame plus de sauce qu'il n'en existe. */
const semaineEnManqueDeSauce = () => {
  poser(0, "diner", "sauce-bolognaise");
  poser(1, "dejeuner", "pates-bolognaise");
  poser(1, "diner", "lasagnes");
  poser(2, "dejeuner", "pates-bolognaise");
  poser(2, "diner", "lasagnes");
  poser(3, "diner", "lasagnes");
};

describe("ce qui attend une réponse", () => {
  test("une semaine vide ne demande rien", () => {
    const v = vue();
    expect(v.enAttente).toBe(0);
    expect(v.offres).toHaveLength(0);
    expect(v.faites).toHaveLength(0);
  });

  test("le compte est exactement celui de la pastille", () => {
    semaineEnManqueDeSauce();
    const v = vue();
    expect(v.enAttente).toBe(v.ouvertes.length + v.offres.length);
    expect(v.offres.length).toBeGreaterThan(0);
  });

  test("une gamelle réglée quitte la liste des demandes pour celle des constats", () => {
    // Le mardi midi part en gamelle (`creneaux.emporte` du catalogue), et les
    // lasagnes du lundi soir laissent de quoi la remplir.
    poser(0, "diner", "lasagnes");
    expect(vue().ouvertes.map((o) => o.g.i)).toContain(creneau(1, "dejeuner"));

    poser(1, "dejeuner", "reste-de-la-veille");
    const v = vue();
    expect(v.ouvertes.map((o) => o.g.i)).not.toContain(creneau(1, "dejeuner"));
    expect(v.faites.map((g) => g.i)).toContain(creneau(1, "dejeuner"));
  });
});

describe("les freins d'une gamelle", () => {
  test("un dîner de la veille non posé ne se voit rien reprocher", () => {
    // `transportable` et `laisseReste` valent alors `null`, et `null` n'est pas
    // « non » : on ne sait pas encore.
    const g = {
      transportable: null,
      laisseReste: null,
      tientVaisselle: true,
      plat: null,
      total: 5,
    };
    expect(freinsDeLaGamelle(g as never)).toEqual([]);
  });

  test("un plat qui ne laisse pas de reste le dit, et ne se propose pas", () => {
    // La sauce bolognaise émet une BASE, pas un reste de plat : il n'y a rien
    // à mettre dans une gamelle le lendemain midi.
    poser(0, "diner", "sauce-bolognaise");
    const o = vue().ouvertes.find((x) => x.g.veille === creneau(0, "diner"));
    expect(o?.freins).toContain("⚠ il ne laisse pas de reste réutilisable");
    // Et alors il n'y a pas de bouton : proposer un geste qu'on sait mauvais
    // est pire que ne rien proposer.
    expect(o?.g.actionnable).toBe(false);
  });

  test("un plat qui voyage mal le dit aussi", () => {
    poser(0, "diner", "chiffonnade-chou-frise-cantal");
    const o = vue().ouvertes.find((x) => x.g.veille === creneau(0, "diner"));
    expect(o?.freins).toContain("⚠ ce plat voyage mal");
  });

  test("un plat qui laisse un reste transportable est proposé", () => {
    poser(0, "diner", "lasagnes");
    const o = vue().ouvertes.find((x) => x.g.veille === creneau(0, "diner"));
    expect(o?.g.actionnable).toBe(true);
  });
});

describe("ce que répondre « oui » écrit", () => {
  test("la gamelle : la veille grossit du total, au demi près", () => {
    poser(0, "diner", "lasagnes");
    const g = vue().ouvertes.find((x) => x.g.veille === creneau(0, "diner"))!.g;
    expect(partsDeLaGamelle(g)).toBe(g.partsVeille + g.partsGamelle);
    expect(partsDeLaGamelle(g) * 2).toBe(Math.round(partsDeLaGamelle(g) * 2));
  });

  test("l'offre : agrandir un lot, c'est régler les parts du créneau amont", () => {
    semaineEnManqueDeSauce();
    const o = vue().offres[0]!;
    const avant = jeu.parts[o.creneau] ?? jeu.catalogue.foyer.parts;
    const apres = partsPourLOffre(jeu, o);
    expect(apres).toBeGreaterThan(avant);
    expect(apres * 2).toBe(Math.round(apres * 2));
  });

  test("une offre ne rétrécit jamais un créneau déjà réglé plus grand", () => {
    // Des invités mardi soir : accepter l'offre ne doit pas les désinviter.
    semaineEnManqueDeSauce();
    const o = vue().offres[0]!;
    jeu.parts[o.creneau] = 99;
    expect(partsPourLOffre(jeu, o)).toBe(99);
  });

  test("l'offre s'arrondit AU-DESSUS : un manque ne doit pas revenir en miettes", () => {
    // Le proto arrondissait au plus proche et laissait 33 g de sauce derrière
    // lui : l'offre se reproposait, plus petite, indéfiniment.
    semaineEnManqueDeSauce();
    const o = vue().offres[0]!;
    const p = jeu.plats[o.rid]!;
    expect(partsPourLOffre(jeu, o)).toBeGreaterThanOrEqual(o.facteurPropose * p.portions - 1e-9);
  });

  test("accepter l'offre fait disparaître le manque qui la motivait", () => {
    semaineEnManqueDeSauce();
    const o = vue().offres[0]!;
    jeu.parts[o.creneau] = partsPourLOffre(jeu, o);
    expect(vue().offres.find((x) => x.type === o.type && x.creneau === o.creneau)).toBeUndefined();
  });
});

describe("le français des phrases du modèle", () => {
  test("le point décimal devient une virgule, et seulement lui", () => {
    expect(virgules("en faire 1.36×")).toBe("en faire 1,36×");
    expect(virgules("+33.3 g de sauce")).toBe("+33,3 g de sauce");
    // Une fin de phrase n'est pas un séparateur décimal.
    expect(virgules("il en reste 2. Et c'est tout.")).toBe("il en reste 2. Et c'est tout.");
  });
});

describe("la gamelle en base", () => {
  test("les deux décisions arrivent ensemble", async () => {
    poser(0, "diner", "lasagnes");
    const g = vue().ouvertes.find((x) => x.g.veille === creneau(0, "diner"))!.g;
    await prevoirGamelle(base, jeu, g.i, g.veille, partsDeLaGamelle(g), "reste-de-la-veille");

    const lignes = await base.creneaux.toArray();
    expect(lignes.find((l) => l.cle === "2026-08-17|diner")?.parts).toBe(partsDeLaGamelle(g));
    expect(lignes.find((l) => l.cle === "2026-08-18|dejeuner")?.plat).toBe("reste-de-la-veille");
  });

  test("après quoi la gamelle est un constat, plus une demande", async () => {
    poser(0, "diner", "lasagnes");
    const g = vue().ouvertes.find((x) => x.g.veille === creneau(0, "diner"))!.g;
    await prevoirGamelle(base, jeu, g.i, g.veille, partsDeLaGamelle(g), "reste-de-la-veille");
    // `prevoirGamelle` repose aussi le modèle en mémoire — c'est ce que voit
    // l'écran avant même que Dexie ait notifié quoi que ce soit.
    expect(vue().faites.map((x) => x.i)).toContain(g.i);
  });

  test("le constat annonce exactement ce qui a été écrit", async () => {
    // L'INVARIANT QUI COMPTE. Le proto rejouait `partsVeille + partsGamelle`
    // sur l'état d'APRÈS et annonçait « 7,5 parts au lieu de 5 » sur un dîner
    // cuisiné pour 5 : il recomptait la gamelle une seconde fois.
    poser(0, "diner", "lasagnes");
    const g = vue().ouvertes.find((x) => x.g.veille === creneau(0, "diner"))!.g;
    const ecrit = partsDeLaGamelle(g);
    await prevoirGamelle(base, jeu, g.i, g.veille, ecrit, "reste-de-la-veille");

    const faite = vue().faites.find((x) => x.i === g.i)!;
    expect(constatDeLaGamelle(faite).cuisinees).toBe(ecrit);
    expect(faite.total).not.toBe(ecrit);
  });
});
