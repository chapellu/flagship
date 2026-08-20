import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { lireCatalogue } from "../model/catalogue";
import { creerJeu, type Jeu } from "../model/jeu";
import { main, offre, type Carte } from "../model/scoring";
import type { Catalogue } from "../model/types";
import { classeEtat, entreesDeLaCarte, sortiesDeLaCarte } from "./poser.vue";

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
const carte = (slot: number, id: string): Carte => {
  const c = offre(jeu, jeu.choix, slot).find((x) => x.plat.id === id);
  if (!c) throw new Error(`${id} n'est pas jouable sur le créneau ${slot}`);
  return c;
};

describe("ce que la carte consomme", () => {
  test("le coût au panier est toujours la dernière ligne", () => {
    // C'est la ligne qu'on cherche : elle doit être au même endroit sur les
    // quatre cartes, sinon on la relit à chaque fois.
    for (const c of offre(jeu, jeu.choix, creneau(0, "diner")).slice(0, 8)) {
      const e = entreesDeLaCarte(c);
      expect(e.at(-1)?.etat === "à acheter" || e.at(-1)?.etat === "trouvé").toBe(true);
      expect(e.at(-1)?.texte).toMatch(/panier|rien de plus à acheter/);
    }
  });

  test("un plat gratuit le dit en « trouvé », pas en « 0 article »", () => {
    const c = offre(jeu, jeu.choix, creneau(0, "diner")).find((x) => x.marginal === 0);
    if (!c) return; // une semaine vide n'a pas toujours de plat gratuit
    const derniere = entreesDeLaCarte(c).at(-1)!;
    expect(derniere.etat).toBe("trouvé");
    expect(derniere.texte).toBe("rien de plus à acheter");
  });

  test("le pluriel des articles s'accorde", () => {
    const un = entreesDeLaCarte({ ...carte(creneau(0, "diner"), "lasagnes"), marginal: 1 });
    const deux = entreesDeLaCarte({ ...carte(creneau(0, "diner"), "lasagnes"), marginal: 2 });
    expect(un.at(-1)?.texte).toBe("1 article de plus au panier");
    expect(deux.at(-1)?.texte).toBe("2 articles de plus au panier");
  });

  test("un plat qui exige un reste introuvable dit que ça ne s'achète pas", () => {
    // `reste-de-la-veille` réclame un reste de plat et n'a pas de repli : sur
    // une semaine vide, rien ne le couvre et rien ne le vend. C'est le seul cas
    // où l'app n'a aucune solution à proposer, et il doit se distinguer d'un
    // simple manque, qui, lui, part aux courses.
    const c = carte(creneau(1, "dejeuner"), "reste-de-la-veille");
    expect(c.manque).toBe(true);
    const absent = entreesDeLaCarte(c).find((e) => e.etat === "absent");
    expect(absent?.texte).toMatch(/ça ne s’achète pas$/);
  });

  test("une base déjà cuite se dit « trouvé », une base entamée « pas assez »", () => {
    jeu.choix[creneau(0, "diner")] = "sauce-bolognaise";
    const c = carte(creneau(2, "diner"), "pates-bolognaise");
    expect(c.chaine).toBe(true);
    const ligne = entreesDeLaCarte(c)[0]!;
    expect(ligne.etat).toBe(c.partiel ? "pas assez" : "trouvé");
    expect(ligne.texte.length).toBeGreaterThan(0);
  });
});

describe("ce que la carte produit", () => {
  test("les quantités sont dites PAR LOT, pas à l'échelle du créneau", () => {
    // Le plat n'est pas encore posé et les parts peuvent encore changer :
    // annoncer 1 400 g pour en livrer 700 serait une promesse non tenue.
    const p = jeu.plats["sauce-bolognaise"]!;
    const s = sortiesDeLaCarte(p);
    const brut = p.emits[0]?.qty?.amount;
    expect(s[0]?.texte).toContain("par lot");
    expect(s[0]?.texte).toContain(String(brut).replace(".", ","));
  });

  test("un plat sans sortie n'en invente pas", () => {
    const p = jeu.plats["croque-monsieur-salade"]!;
    expect(sortiesDeLaCarte(p).filter((s) => s.icone !== "bebe")).toHaveLength(
      p.emits.length,
    );
  });

  test("un reste de plat va au frigo, même quand le plat se congèle", () => {
    const avecReste = Object.values(jeu.plats).find((p) =>
      p.emits.some((e) => e.kind === "reste-plat" && e.congelo),
    );
    if (!avecReste) return;
    const n = avecReste.emits.findIndex((e) => e.kind === "reste-plat" && e.congelo);
    expect(sortiesDeLaCarte(avecReste)[n]?.icone).toBe("frigo");
  });
});

describe("le vocabulaire fermé des états", () => {
  test("deux couleurs seulement : ce qui est là, ce qui manque", () => {
    expect(classeEtat("trouvé")).toBe("trouve");
    expect(classeEtat("pas assez")).toBe("court");
    // « À acheter » n'est pas un problème : c'est une ligne de liste.
    expect(classeEtat("à acheter")).toBe("");
    expect(classeEtat("absent")).toBe("");
  });
});

describe("la main", () => {
  test("elle ne bouge pas tant qu'on ne repioche pas", () => {
    jeu.slot = creneau(0, "diner");
    const a = main(jeu).map((c) => c.plat.id);
    const b = main(jeu).map((c) => c.plat.id);
    expect(b).toEqual(a);
  });

  test("repiocher change la main", () => {
    jeu.slot = creneau(0, "diner");
    const a = main(jeu).map((c) => c.plat.id);
    jeu.repioches[jeu.slot] = 1;
    expect(main(jeu).map((c) => c.plat.id)).not.toEqual(a);
  });

  test("chaque créneau a sa propre main", () => {
    jeu.slot = creneau(0, "diner");
    const a = main(jeu).map((c) => c.plat.id);
    jeu.slot = creneau(1, "diner");
    expect(main(jeu).map((c) => c.plat.id)).not.toEqual(a);
  });
});
