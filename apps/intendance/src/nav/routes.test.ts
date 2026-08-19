import { describe, expect, test } from "vitest";
import { chemin, dansCuisine, lireRoute, pleinEcran, ROUTE_DEFAUT, type Route } from "./routes";

const TOUTES: Route[] = [
  { ecran: "cockpit" },
  { ecran: "jardin" },
  { ecran: "aujourdhui" },
  { ecran: "semaine" },
  { ecran: "prevoir" },
  { ecran: "courses" },
  { ecran: "stock" },
  { ecran: "poser", creneau: { jour: "2026-08-19", repas: "diner" } },
  { ecran: "parts", creneau: { jour: "2026-08-19", repas: "dejeuner" } },
  { ecran: "cuisiner", creneau: { jour: "2026-08-19", repas: "diner" } },
];

describe("les routes", () => {
  test("chaque écran fait l'aller-retour sans rien perdre", () => {
    // Si ce test passe pour les dix, aucune URL de l'app ne peut mentir sur
    // l'écran qu'elle désigne.
    for (const r of TOUTES) expect(lireRoute(chemin(r))).toEqual(r);
  });

  test("les dix écrans ont des chemins distincts", () => {
    const chemins = TOUTES.map(chemin);
    expect(new Set(chemins).size).toBe(chemins.length);
  });

  test("une URL de travers retombe sur le cockpit, jamais sur un écran blanc", () => {
    for (const mauvais of ["", "#", "#/", "#/nimporte", "#/cuisine/quoi", "#/cuisine/poser"])
      expect(lireRoute(mauvais)).toEqual(ROUTE_DEFAUT);
  });

  test("un jour qui n'en est pas un est refusé", () => {
    // Sans ça, l'écran s'ouvrirait sur un créneau fantôme : la clé tirée de
    // l'URL ne désignerait aucune ligne de la base.
    expect(lireRoute("#/cuisine/poser/demain/diner")).toEqual(ROUTE_DEFAUT);
    expect(lireRoute("#/cuisine/poser/2026-8-19/diner")).toEqual(ROUTE_DEFAUT);
    expect(lireRoute("#/cuisine/parts/2026-08-19/")).toEqual(ROUTE_DEFAUT);
  });

  test("la racine ouvre le cockpit — la coquille montre la journée, pas la facette", () => {
    expect(lireRoute("#/")).toEqual({ ecran: "cockpit" });
    expect(ROUTE_DEFAUT.ecran).toBe("cockpit");
  });

  test("un créneau se nomme (jour, repas) dans l'URL, jamais par son index", () => {
    // Même raison qu'en base : `#/cuisine/poser/8` désignerait le dîner de
    // mercredi aujourd'hui et celui de samedi après-demain. Une URL qu'on
    // s'envoie pour la rouvrir sur le téléphone est exactement le cas où le
    // décalage se produit.
    const c = chemin({ ecran: "poser", creneau: { jour: "2026-08-19", repas: "diner" } });
    expect(c).toBe("#/cuisine/poser/2026-08-19/diner");
    expect(c).not.toMatch(/\/\d+$/);
  });

  test("la sous-navigation cuisine sait qui lui appartient", () => {
    expect(dansCuisine({ ecran: "aujourdhui" })).toBe(true);
    expect(dansCuisine({ ecran: "stock" })).toBe(true);
    expect(dansCuisine({ ecran: "cockpit" })).toBe(false);
    expect(dansCuisine({ ecran: "jardin" })).toBe(false);
    // « En cuisine » sort de la coquille : on le lit à bout de bras.
    expect(dansCuisine({ ecran: "cuisiner", creneau: { jour: "2026-08-19", repas: "diner" } })).toBe(false);
    expect(pleinEcran({ ecran: "cuisiner", creneau: { jour: "2026-08-19", repas: "diner" } })).toBe(true);
    expect(pleinEcran({ ecran: "semaine" })).toBe(false);
  });

  test("un chemin traînant une barre finale désigne le même écran", () => {
    expect(lireRoute("#/cuisine/semaine/")).toEqual({ ecran: "semaine" });
  });
});
