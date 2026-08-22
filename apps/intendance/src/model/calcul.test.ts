import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { lireCatalogue } from "./catalogue";
import { articles, calculer, echelle, facteur, minutesParJour } from "./calcul";
import { creerJeu, SAUTE, type Jeu } from "./jeu";
import type { Catalogue } from "./types";

// UNE DATE FIXE, et c'est une correction du proto. Son smoke lisait `new Date()`
// : la fenêtre de fraîcheur du frigo, les jours de coworking et l'existence
// d'un « dîner de la veille » dépendent donc du jour où on lance les tests, et
// l'un d'eux échoue selon le jour de la semaine. Ici la semaine commence un
// lundi, toujours le même.
const LUNDI = new Date("2026-08-17T12:00:00Z");

const catalogue: Catalogue = lireCatalogue(
  JSON.parse(readFileSync("public/cuisine-data.json", "utf8")) as unknown,
);

let jeu: Jeu;
beforeEach(() => {
  jeu = creerJeu(catalogue, 7, LUNDI);
});

/** L'index du créneau (jour, repas) — les écrans le cherchent pareil. */
const creneau = (jour: number, repas: string): number => {
  const i = jeu.creneaux.findIndex((c) => c.jour === jour && c.repas === repas);
  if (i < 0) throw new Error(`pas de créneau ${repas} le jour ${jour}`);
  return i;
};

const poser = (jour: number, repas: string, rid: string) => {
  jeu.choix[creneau(jour, repas)] = rid;
};

describe("la semaine", () => {
  test("commence le lundi et porte ses créneaux dans l'ordre", () => {
    expect(jeu.jours[0]?.nom).toBe("lundi");
    expect(jeu.jours).toHaveLength(7);
    // Les créneaux sont chronologiques : le midi du jour 3 avant son soir.
    const jours = jeu.creneaux.map((c) => c.jour);
    expect([...jours].sort((a, b) => a - b)).toEqual(jours);
  });

  test("mercredi a un goûter que les autres jours n'ont pas", () => {
    const gouters = jeu.creneaux.filter((c) => c.repas === "gouter");
    expect(gouters).toHaveLength(1);
    expect(jeu.jours[gouters[0]!.jour]?.nom).toBe("mercredi");
  });

  test("chaque créneau démarre aux parts du foyer", () => {
    expect(new Set(jeu.parts)).toEqual(new Set([catalogue.foyer.parts]));
  });
});

describe("le chaînage se compte en grandeur, pas en jetons", () => {
  // Le stock porte 700 g de sauce bolognaise au congélo. Les pâtes en veulent
  // 500, les lasagnes 700 : à deux, elles réclament 1200 g sur un bocal de 700.
  test("le bocal se vide au lieu de se dupliquer", () => {
    poser(0, "diner", "pates-bolognaise");
    poser(1, "diner", "lasagnes");
    const c = calculer(jeu);

    const pates = c.chaine.find((x) => x.creneau === creneau(0, "diner"));
    const lasagnes = c.chaine.find((x) => x.creneau === creneau(1, "diner"));
    expect(pates?.pris).toBe(500);
    expect(pates?.manque).toBe(0);
    // Ce qui restait au bocal, et pas un gramme de plus.
    expect(lasagnes?.pris).toBe(200);
    expect(lasagnes?.manque).toBe(500);
  });

  test("le manque remonte en grandeur — c'est ce qui rend la semaine dimensionnable", () => {
    poser(0, "diner", "lasagnes");
    poser(1, "diner", "pates-bolognaise");
    const c = calculer(jeu);
    const m = c.manques.find((x) => x.i === creneau(1, "diner"));
    expect(m?.manque).toBe(500);
    expect(m?.unite).toBe("g");
  });

  test("la prise se raconte morceau par morceau", () => {
    poser(0, "diner", "pates-bolognaise");
    const c = calculer(jeu);
    // Le bocal vient du congélo, pas d'un lot de cette semaine.
    expect(c.chaine[0]?.recit).toContain("du congélo");
    expect(c.chaine[0]?.recit).toContain("500 g");
  });

  test("une prise qui traverse deux lots les nomme tous les deux", () => {
    // Les pâtes entament le bocal du congélo (500 sur 700). Mardi produit un
    // lot de sauce. Mercredi, les lasagnes en réclament 700 : elles finissent
    // le bocal, puis puisent dans le lot. Annoncer le total sur le premier
    // bocal serait un mensonge — c'est ce que disait le message d'avant.
    poser(0, "diner", "pates-bolognaise");
    poser(1, "diner", "sauce-bolognaise");
    poser(2, "diner", "lasagnes");
    const c = calculer(jeu);
    const lasagnes = c.chaine.find((x) => x.creneau === creneau(2, "diner"));
    expect(lasagnes?.recit).toContain("du congélo");
    expect(lasagnes?.recit).toContain("du lot «");
    expect(lasagnes?.pris).toBe(700);
    expect(lasagnes?.manque).toBe(0);
  });
});

describe("la provenance décide ce qu'on achète", () => {
  test("une base absente ne part pas aux courses", () => {
    // Les falafels demandent 500 g de pois chiches CUITS. On n'en achète
    // nulle part : la base se rattrape en cuisinant, jamais au magasin.
    poser(0, "diner", "falafels-aux-herbes");
    const c = calculer(jeu);
    expect(c.provenances.absent).toBeGreaterThan(0);
    expect([...c.panier.values()].some((a) => a.id === "pois-chiches-cuits-ing")).toBe(false);
  });

  test("ce qu'on a déjà au placard se vérifie au lieu de s'acheter", () => {
    // La sauce demande huile d'olive et sel : deux choses qu'on a toujours.
    poser(0, "diner", "sauce-bolognaise");
    const c = calculer(jeu);
    expect(c.aVerifier.size).toBeGreaterThan(0);
    for (const id of c.aVerifier.keys())
      expect([...c.panier.values()].some((a) => a.id === id)).toBe(false);
  });

  test("une base trouvée au congélo ne s'achète pas non plus", () => {
    poser(0, "diner", "pates-bolognaise");
    const c = calculer(jeu);
    expect(c.provenances.frigo ?? c.provenances.chaine).toBeGreaterThan(0);
  });
});

describe("le plein tarif", () => {
  test("un plat qui ne trouve pas son reste paie ses ingrédients et ses minutes", () => {
    // Rien en stock ne couvre le poulet cuit des fajitas.
    poser(0, "diner", "fajitas-poulet");
    const c = calculer(jeu);
    expect(c.pleinTarif).toHaveLength(1);
    expect(c.pleinTarif[0]?.minutes).toBeGreaterThan(0);
    // Les ingrédients du plein tarif entrent au panier, eux.
    const plat = jeu.plats["fajitas-poulet"]!;
    const achete = plat.sansReste!.ingredients[0]!.id;
    expect([...c.panier.values()].some((a) => a.id === achete)).toBe(true);
  });

  test("le même plat servi par un reste ne paie rien de plus", () => {
    poser(0, "diner", "pates-bolognaise");
    const c = calculer(jeu);
    expect(c.pleinTarif).toHaveLength(0);
  });
});

describe("un repas sauté est une décision, pas un trou", () => {
  test("il ne coûte ni courses ni minutes", () => {
    jeu.choix[creneau(0, "diner")] = SAUTE;
    const c = calculer(jeu);
    expect(c.panier.size).toBe(0);
    expect(minutesParJour(jeu)[0]).toBe(0);
  });

  test("et il ne se confond pas avec un créneau vide", () => {
    const avant = calculer(jeu).panier.size;
    jeu.choix[creneau(0, "diner")] = SAUTE;
    expect(calculer(jeu).panier.size).toBe(avant);
    // Mais la décision, elle, est bien là.
    expect(jeu.choix[creneau(0, "diner")]).toBe(SAUTE);
  });
});

describe("les parts commandent le panier", () => {
  test("doubler les parts d'un créneau double ce qu'il achète", () => {
    poser(0, "diner", "fajitas-poulet");
    const i = creneau(0, "diner");
    const petit = [...calculer(jeu).panier.values()].reduce((a, x) => a + x.qty, 0);
    jeu.parts[i] = catalogue.foyer.parts * 2;
    const grand = [...calculer(jeu).panier.values()].reduce((a, x) => a + x.qty, 0);
    expect(grand).toBeGreaterThan(petit);
  });

  test("un plat qui se garde se cuisine en lot entier même pour deux parts", () => {
    // Sous ses portions, un plat congelable ne se coupe pas : le facteur reste
    // à 1, parce que couper un lot qui va au congélo ne gagne pas de place.
    const p = jeu.plats["sauce-bolognaise"]!;
    expect(facteur(p, 1)).toBe(1);
    expect(facteur(p, p.portions)).toBe(1);
    expect(facteur(p, p.portions * 2)).toBe(2);
  });

  test("un lot entier s'arrondit au lot supérieur", () => {
    const p = jeu.plats["poulet-roti"]!;
    expect(p.lotEntier).toBe(true);
    expect(facteur(p, p.portions + 0.5)).toBe(2);
  });
});

describe("les quantités sont exécutables", () => {
  test("les grammes s'arrondissent à ce qu'une balance sait peser", () => {
    expect(echelle(140, "g", 0.42)).toBe(60);
    expect(echelle(1000, "g", 1)).toBe(1000);
  });

  test("les unités qui ne se coupent pas s'arrondissent au demi", () => {
    expect(echelle(3, "gousse", 0.42)).toBe(1.5);
    expect(echelle(1, "pincée", 0.3)).toBe(0.5);
  });

  test("et la liste de courses arrondit au-dessus : on n'achète pas 2,4 œufs", () => {
    poser(0, "diner", "fajitas-poulet");
    for (const a of articles(calculer(jeu).panier))
      if (["pièce", "gousse"].includes(a.unit)) expect(Number.isInteger(a.qty)).toBe(true);
  });
});

describe("la cuisine n'est pas infinie", () => {
  test("chaque espace porte ses deux plafonds et dit lequel mord", () => {
    const { stockage } = calculer(jeu);
    for (const e of ["frigo", "congelo", "placard"] as const) {
      expect(stockage[e].places).toBeGreaterThan(0);
      expect(stockage[e].contenants).toBeGreaterThan(0);
      expect(["place", "contenant"]).toContain(stockage[e].cause);
    }
  });

  test("ce que la semaine range monte le niveau", () => {
    const avant = calculer(jeu).stockage.congelo.entre;
    poser(0, "diner", "sauce-bolognaise");
    expect(calculer(jeu).stockage.congelo.entre).toBeGreaterThan(avant);
  });

  test("ce que la semaine mange rend sa place — un niveau ne monte pas seulement", () => {
    poser(0, "diner", "pates-bolognaise");
    const c = calculer(jeu);
    // Le bocal du congélo est entamé, pas épuisé : 500 g pris sur 700.
    expect(c.stockage.congelo.debut).toBeGreaterThan(0);
    poser(1, "diner", "lasagnes");
    const apres = calculer(jeu);
    expect(apres.stockage.congelo.sort).toBeGreaterThan(0);
  });

  test("un espace qui dépasse son plafond le dit", () => {
    const { stockage } = calculer(jeu);
    for (const e of ["frigo", "congelo", "placard"] as const)
      expect(stockage[e].deborde).toBe(stockage[e].fin > stockage[e].limite);
  });
});

// Ces deux règles-là ne sont pas jolies. On les épingle pour qu'une évolution
// future soit une DÉCISION, avec un test rouge à regarder, et non un effet de
// bord découvert un mois plus tard sur un écran faux.
describe("le vieillissement, tel que le modèle le fait aujourd'hui", () => {
  test("le congélo ignore la fenêtre de fraîcheur du frigo", () => {
    // La sauce est née le 20 juillet, soit bien au-delà des quatre jours du
    // frigo. Elle reste servie, parce qu'elle est au congélo.
    poser(0, "diner", "pates-bolognaise");
    expect(calculer(jeu).chaine).toHaveLength(1);
  });

  test("un reste au frigo trop vieux n'est plus proposé", () => {
    // Les lentilles sont nées le 6 août : onze jours avant ce lundi, pour une
    // fenêtre de quatre. Aucun plat ne peut les trouver.
    const c = calculer(jeu);
    const lentilles = c.depot.lignes.find((l) => l.type === "lentilles-vertes-cuites");
    expect(lentilles?.epuise).toBe(false);
    poser(0, "diner", "burgers-de-lentilles");
    expect(calculer(jeu).provenances.absent).toBeGreaterThan(0);
  });

  test("une sortie congelable posée cette semaine vieillit au frigo, pas hors du temps", () => {
    // Conséquence de `location: \"frigo\"` sur tout ce qu'on cuisine : le lot
    // n'est pas encore AU congélo, il refroidit. Un plat très en aval ne le
    // trouvera donc plus. C'est discutable — et c'est pour ça que c'est écrit.
    poser(0, "diner", "sauce-bolognaise");
    const lot = calculer(jeu).depot.lignes.find((l) => l.from === "sauce-bolognaise");
    expect(lot?.espace).toBe("congelo");
    expect(lot?.location).toBe("frigo");
  });
});

describe("les minutes se comptent par journée", () => {
  test("trois plats tenables séparément peuvent faire une journée intenable", () => {
    poser(0, "dejeuner", "pates-bolognaise");
    poser(0, "diner", "poulet-roti");
    const m = minutesParJour(jeu);
    const attendu = jeu.plats["pates-bolognaise"]!.minutes + jeu.plats["poulet-roti"]!.minutes;
    expect(m[0]).toBe(attendu);
    expect(m[1]).toBe(0);
  });
});

// T15 : la table `stock` entre dans le calcul. Ces tests disent la chose la
// plus simple et la plus facile à casser du ticket — le dépôt part de
// `jeu.stock`, et rien d'autre. Le jour où quelqu'un relit `catalogue.stock`
// « pour simplifier », un lot retiré de l'inventaire réapparaîtra dans le
// chaînage sans que rien d'autre ne rougisse.
describe("le dépôt part de ce que le foyer a constaté", () => {
  test("un lot retiré du stock du jeu ne se chaîne plus", () => {
    poser(0, "diner", "pates-bolognaise");
    expect(calculer(jeu).chaine).toHaveLength(1);

    jeu.stock = jeu.stock.filter((o) => o.type !== "sauce-bolognaise");
    const c = calculer(jeu);
    expect(c.chaine).toHaveLength(0);
    // Et ce qui n'est plus trouvé se paie : les pâtes passent au plein tarif.
    expect(c.pleinTarif.length + c.manques.length).toBeGreaterThan(0);
  });

  test("un lot ajouté au stock du jeu se chaîne, sans toucher au catalogue", () => {
    // Les lentilles du catalogue sont trop vieilles (voir ci-dessus). Un bocal
    // constaté aujourd'hui les remplace, et le plat les trouve.
    poser(0, "diner", "burgers-de-lentilles");
    expect(calculer(jeu).provenances.absent).toBeGreaterThan(0);

    jeu.stock = [
      ...jeu.stock,
      {
        type: "lentilles-vertes-cuites",
        kind: "base",
        qty: { amount: 800, unit: "g" },
        qty_band: "2-repas",
        born: "2026-08-17",
        location: "frigo",
      },
    ];
    expect(calculer(jeu).chaine.some((l) => l.type === "lentilles-vertes-cuites")).toBe(true);
    // Le catalogue, lui, n'a pas bougé : c'est un asset, pas un état.
    expect(catalogue.stock).toHaveLength(2);
  });

  test("le budget de rangement compte le stock du jeu, pas celui de l'export", () => {
    const avant = calculer(jeu).stockage;
    jeu.stock = [];
    const apres = calculer(jeu).stockage;
    expect(avant.congelo.debut).toBeGreaterThan(0);
    expect(apres.congelo.debut).toBe(0);
    expect(apres.frigo.debut).toBe(0);
  });

  test("un lot constaté sans être pesé part en entier, et le dit", () => {
    // Ce que la base permet et que le catalogue ne permettait pas : `qty` à
    // `null`. Le dépôt ne fait pas semblant de compter — il sert la ligne
    // entière et marque la prise `approximatif`.
    jeu.stock = [
      {
        type: "sauce-bolognaise",
        kind: "base",
        qty: null,
        qty_band: "2-repas",
        born: "2026-08-17",
        location: "congelo",
      },
    ];
    poser(0, "diner", "pates-bolognaise");
    const c = calculer(jeu);
    expect(c.chaine).toHaveLength(1);
    expect(c.chaine[0]?.pris).toBeNull();
    expect(c.chaine[0]?.manque).toBe(0);
    expect(c.depot.lignes[0]?.epuise).toBe(true);
  });
});
