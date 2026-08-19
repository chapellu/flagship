// Le chargeur du catalogue, et sa porte d'entrée.
//
// POURQUOI VALIDER ICI ET NULLE PART AILLEURS
// `cuisine-data.json` est un export : il change quand le catalogue Python
// change, sans que ce dépôt en sache rien. Un champ renommé en amont ne produit
// pas une erreur, il produit un `undefined` qui traverse le modèle et ressort à
// l'écran en « NaN parts » ou en créneau vide — c'est-à-dire en mensonge
// plausible. Le seul endroit où l'attraper est la frontière.
//
// CE QU'ON VÉRIFIE, ET CE QU'ON NE VÉRIFIE PAS
// Pas un schéma exhaustif : une bibliothèque de validation qui décrit chaque
// champ décrit surtout le passé, et ce sont ses règles qu'on maintient ensuite.
// On vérifie ce dont le modèle DÉPEND pour ne pas mentir — les grandeurs, les
// vocabulaires sur lesquels il branche, les invariants qui rendent un calcul
// possible. Un champ qu'aucun calcul ne lit peut manquer sans dommage.

import type {
  Accept, Catalogue, Emit, EmitKind, Espace, Etape, Foyer, Ingredient,
  LigneStock, Plat, Provenance, Quantite,
} from "./types";

const ESPACES: readonly Espace[] = ["frigo", "congelo", "placard"];
const EMIT_KINDS: readonly EmitKind[] = ["base", "parure", "portion-bebe", "reste-plat"];
const PROVENANCES: readonly Provenance[] = ["placard", "chaine", "frigo", "courses", "absent"];

/** Les deux repas que le code nomme en dur : `gamelles()` cherche « le dîner de
 *  la veille », et l'équilibre se mesure sur les repas principaux. Le reste de
 *  la configuration est libre. */
const REPAS_REQUIS = ["dejeuner", "diner"] as const;

/** Une donnée d'entrée qui ne tient pas ses promesses. Le message porte le
 *  chemin : « plats[12].emits[0].espace », pas « champ invalide ». */
export class CatalogueInvalide extends Error {
  constructor(chemin: string, attendu: string, recu: unknown) {
    super(`${chemin} : attendu ${attendu}, reçu ${JSON.stringify(recu)?.slice(0, 80)}`);
    this.name = "CatalogueInvalide";
  }
}

/* ─────────────────────────────────────────────────────────── les primitives */

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function obj(v: unknown, ou: string): Record<string, unknown> {
  if (!estObjet(v)) throw new CatalogueInvalide(ou, "un objet", v);
  return v;
}

function tableau(v: unknown, ou: string): unknown[] {
  if (!Array.isArray(v)) throw new CatalogueInvalide(ou, "un tableau", v);
  return v;
}

function texte(v: unknown, ou: string): string {
  if (typeof v !== "string") throw new CatalogueInvalide(ou, "une chaîne", v);
  return v;
}

function texteOuNull(v: unknown, ou: string): string | null {
  if (v === null) return null;
  return texte(v, ou);
}

// Un nombre, et pas seulement `typeof v === "number"` : `NaN` passe ce test et
// contamine ensuite chaque somme qu'il touche, sans jamais lever.
function nombre(v: unknown, ou: string): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new CatalogueInvalide(ou, "un nombre fini", v);
  return v;
}

function nombreOuNull(v: unknown, ou: string): number | null {
  if (v === null) return null;
  return nombre(v, ou);
}

function booleen(v: unknown, ou: string): boolean {
  if (typeof v !== "boolean") throw new CatalogueInvalide(ou, "un booléen", v);
  return v;
}

function parmi<T extends string>(v: unknown, valeurs: readonly T[], ou: string): T {
  if (typeof v !== "string" || !(valeurs as readonly string[]).includes(v))
    throw new CatalogueInvalide(ou, `l'une de ${valeurs.join(" | ")}`, v);
  return v as T;
}

const listeDeTextes = (v: unknown, ou: string): string[] =>
  tableau(v, ou).map((x, i) => texte(x, `${ou}[${i}]`));

/* ────────────────────────────────────────────────────────── les grandeurs */

function quantite(v: unknown, ou: string): Quantite {
  const o = obj(v, ou);
  return { amount: nombre(o["amount"], `${ou}.amount`), unit: texte(o["unit"], `${ou}.unit`) };
}

function quantiteOuNull(v: unknown, ou: string): Quantite | null {
  return v === null || v === undefined ? null : quantite(v, ou);
}

// LES LIGNES DE `sansReste` N'ONT PAS LA MÊME FORME, et c'est ce chargeur qui
// l'a appris : l'export omet `base` et `assaisonnement` sur elles. Le proto en
// JS ne s'en apercevait pas — `ing.base` valait `undefined`, donc faux, donc la
// bonne réponse par accident. Ici on le dit : ce qu'un plat achète faute de
// reste n'est par construction ni une base (une base se cuisine, elle ne
// s'achète pas) ni un assaisonnement. L'absence VAUT faux, elle ne l'approxime
// pas — mais elle ne vaut faux que sur ces lignes-là, d'où le paramètre.
function ingredient(v: unknown, ou: string, defauts = false): Ingredient {
  const o = obj(v, ou);
  const drapeau = (cle: "base" | "assaisonnement") =>
    o[cle] === undefined && defauts ? false : booleen(o[cle], `${ou}.${cle}`);
  return {
    id: texte(o["id"], `${ou}.id`),
    nom: texte(o["nom"], `${ou}.nom`),
    qty: nombre(o["qty"], `${ou}.qty`),
    unit: texte(o["unit"], `${ou}.unit`),
    base: drapeau("base"),
    assaisonnement: drapeau("assaisonnement"),
  };
}

function etape(v: unknown, ou: string): Etape {
  const o = obj(v, ou);
  return {
    id: texte(o["id"], `${ou}.id`),
    action: texte(o["action"], `${ou}.action`),
    minutes: nombre(o["minutes"], `${ou}.minutes`),
    needs: listeDeTextes(o["needs"] ?? [], `${ou}.needs`),
    surveille: booleen(o["surveille"], `${ou}.surveille`),
    enfant: texteOuNull(o["enfant"] ?? null, `${ou}.enfant`),
    enfantDes: nombreOuNull(o["enfantDes"] ?? null, `${ou}.enfantDes`),
    porteAssaisonnement: booleen(o["porteAssaisonnement"], `${ou}.porteAssaisonnement`),
  };
}

function emit(v: unknown, ou: string): Emit {
  const o = obj(v, ou);
  return {
    type: texte(o["type"], `${ou}.type`),
    kind: parmi(o["kind"], EMIT_KINDS, `${ou}.kind`),
    qty: quantiteOuNull(o["qty"], `${ou}.qty`),
    band: texte(o["band"], `${ou}.band`),
    espace: parmi(o["espace"], ESPACES, `${ou}.espace`),
    note: texteOuNull(o["note"] ?? null, `${ou}.note`),
    gardeFrigo: nombre(o["gardeFrigo"], `${ou}.gardeFrigo`),
    congelo: booleen(o["congelo"], `${ou}.congelo`),
  };
}

function accept(v: unknown, ou: string): Accept {
  const o = obj(v, ou);
  const type = texteOuNull(o["type"] ?? null, `${ou}.type`);
  const kind = o["kind"] == null ? null : parmi(o["kind"], EMIT_KINDS, `${ou}.kind`);
  // Un `accepts` qui ne vise ni une sortie ni une classe n'accepte rien : le
  // plat serait proposé comme dérivé et ne trouverait jamais son reste.
  if (type === null && kind === null)
    throw new CatalogueInvalide(ou, "un `type` ou un `kind`", o);
  return {
    type, kind,
    requis: booleen(o["requis"], `${ou}.requis`),
    qty: quantiteOuNull(o["qty"], `${ou}.qty`),
    mere: texteOuNull(o["mere"] ?? null, `${ou}.mere`),
  };
}

function plat(v: unknown, ou: string): Plat {
  const o = obj(v, ou);
  const portions = nombre(o["portions"], `${ou}.portions`);
  // Le facteur d'échelle divise par les portions : à zéro, chaque quantité de
  // la recette devient infinie, et l'écran affiche « Infinity g de riz ».
  if (portions <= 0) throw new CatalogueInvalide(`${ou}.portions`, "un nombre > 0", portions);

  const apports = obj(o["apports"], `${ou}.apports`);
  const origine = apports["origine"];
  const vaisselleBrute = o["vaisselle"];

  return {
    id: texte(o["id"], `${ou}.id`),
    titre: texte(o["titre"], `${ou}.titre`),
    minutes: nombre(o["minutes"], `${ou}.minutes`),
    portions,
    apports: {
      proteine: texte(apports["proteine"], `${ou}.apports.proteine`),
      feculent: texte(apports["feculent"], `${ou}.apports.feculent`),
      legumes: listeDeTextes(apports["legumes"], `${ou}.apports.legumes`),
      profil: texte(apports["profil"], `${ou}.apports.profil`),
      ...(origine === undefined ? {} : { origine: texte(origine, `${ou}.apports.origine`) }),
    },
    ingredients: tableau(o["ingredients"], `${ou}.ingredients`)
      .map((x, i) => ingredient(x, `${ou}.ingredients[${i}]`)),
    steps: tableau(o["steps"] ?? [], `${ou}.steps`).map((x, i) => etape(x, `${ou}.steps[${i}]`)),
    bebe: texteOuNull(o["bebe"] ?? null, `${ou}.bebe`),
    actifMin: nombreOuNull(o["actifMin"] ?? null, `${ou}.actifMin`),
    accepts: tableau(o["accepts"], `${ou}.accepts`).map((x, i) => accept(x, `${ou}.accepts[${i}]`)),
    creneaux: listeDeTextes(o["creneaux"] ?? [], `${ou}.creneaux`),
    transportable: booleen(o["transportable"], `${ou}.transportable`),
    sansReste: o["sansReste"] == null ? null : (() => {
      const s = obj(o["sansReste"], `${ou}.sansReste`);
      return {
        minutes: nombre(s["minutes"], `${ou}.sansReste.minutes`),
        ingredients: tableau(s["ingredients"], `${ou}.sansReste.ingredients`)
          .map((x, i) => ingredient(x, `${ou}.sansReste.ingredients[${i}]`, true)),
      };
    })(),
    emits: tableau(o["emits"], `${ou}.emits`).map((x, i) => emit(x, `${ou}.emits[${i}]`)),
    lotEntier: booleen(o["lotEntier"], `${ou}.lotEntier`),
    calibreMax: nombreOuNull(o["calibreMax"] ?? null, `${ou}.calibreMax`),
    vaisselle: vaisselleBrute == null ? null : (() => {
      const w = obj(vaisselleBrute, `${ou}.vaisselle`);
      return {
        id: texte(w["id"], `${ou}.vaisselle.id`),
        label: texte(w["label"], `${ou}.vaisselle.label`),
        facteurMax: nombre(w["facteurMax"], `${ou}.vaisselle.facteurMax`),
      };
    })(),
    gainChainage: nombre(o["gainChainage"], `${ou}.gainChainage`),
    cuisinable: booleen(o["cuisinable"], `${ou}.cuisinable`),
  };
}

function foyer(v: unknown, ou: string): Foyer {
  const o = obj(v, ou);
  const espacesBruts = obj(o["espaces"], `${ou}.espaces`);
  const espaces = {} as Foyer["espaces"];
  for (const e of ESPACES) {
    const c = obj(espacesBruts[e], `${ou}.espaces.${e}`);
    espaces[e] = {
      places: nombre(c["places"], `${ou}.espaces.${e}.places`),
      contenants: nombre(c["contenants"], `${ou}.espaces.${e}.contenants`),
      limite: nombre(c["limite"], `${ou}.espaces.${e}.limite`),
      cause: parmi(c["cause"], ["place", "contenant"] as const, `${ou}.espaces.${e}.cause`),
    };
  }

  const parts = nombre(o["parts"], `${ou}.parts`);
  if (parts <= 0) throw new CatalogueInvalide(`${ou}.parts`, "un nombre > 0", parts);

  return {
    nom: texte(o["nom"], `${ou}.nom`),
    parts,
    fenetreFrigo: nombre(o["fenetreFrigo"], `${ou}.fenetreFrigo`),
    tiroirs: nombre(o["tiroirs"], `${ou}.tiroirs`),
    mangeurs: tableau(o["mangeurs"], `${ou}.mangeurs`).map((x, i) => {
      const m = obj(x, `${ou}.mangeurs[${i}]`);
      return {
        id: texte(m["id"], `${ou}.mangeurs[${i}].id`),
        genre: texte(m["genre"], `${ou}.mangeurs[${i}].genre`),
        parts: nombre(m["parts"], `${ou}.mangeurs[${i}].parts`),
        bebe: booleen(m["bebe"], `${ou}.mangeurs[${i}].bebe`),
      };
    }),
    espaces,
    contenants: tableau(o["contenants"], `${ou}.contenants`).map((x, i) => {
      const c = obj(x, `${ou}.contenants[${i}]`);
      return {
        id: texte(c["id"], `${ou}.contenants[${i}].id`),
        label: texte(c["label"], `${ou}.contenants[${i}].label`),
        nombre: nombre(c["nombre"], `${ou}.contenants[${i}].nombre`),
        portions: nombre(c["portions"], `${ou}.contenants[${i}].portions`),
        espaces: tableau(c["espaces"], `${ou}.contenants[${i}].espaces`)
          .map((e, j) => parmi(e, ESPACES, `${ou}.contenants[${i}].espaces[${j}]`)),
        consommable: booleen(c["consommable"], `${ou}.contenants[${i}].consommable`),
      };
    }),
    vaisselle: tableau(o["vaisselle"], `${ou}.vaisselle`).map((x, i) => {
      const w = obj(x, `${ou}.vaisselle[${i}]`);
      return {
        id: texte(w["id"], `${ou}.vaisselle[${i}].id`),
        label: texte(w["label"], `${ou}.vaisselle[${i}].label`),
        contenance: nombre(w["contenance"], `${ou}.vaisselle[${i}].contenance`),
        exemplaires: nombre(w["exemplaires"], `${ou}.vaisselle[${i}].exemplaires`),
      };
    }),
  };
}

function ligneStock(v: unknown, ou: string): LigneStock {
  const o = obj(v, ou);
  const born = texte(o["born"], `${ou}.born`);
  // La fraîcheur d'un reste se calcule sur cette date. Une date que `Date` ne
  // sait pas lire donne un âge `NaN`, et un `NaN` compare faux partout : le
  // reste ne serait ni frais ni périmé, simplement invisible.
  if (Number.isNaN(new Date(born).getTime()))
    throw new CatalogueInvalide(`${ou}.born`, "une date ISO lisible", born);
  const note = o["note"];
  return {
    type: texte(o["type"], `${ou}.type`),
    kind: parmi(o["kind"], EMIT_KINDS, `${ou}.kind`),
    qty_band: texte(o["qty_band"], `${ou}.qty_band`),
    qty: quantite(o["qty"], `${ou}.qty`),
    born,
    location: parmi(o["location"], ESPACES, `${ou}.location`),
    ...(note === undefined || note === null ? {} : { note: texte(note, `${ou}.note`) }),
  };
}

/* ──────────────────────────────────────────────────────────── le catalogue */

/**
 * Valide un JSON déjà analysé et le rend typé. Lève `CatalogueInvalide` au
 * premier manquement, avec le chemin fautif.
 */
export function lireCatalogue(brut: unknown): Catalogue {
  const o = obj(brut, "catalogue");

  const creneauxBruts = obj(o["creneaux"], "creneaux");
  const repasBruts = obj(creneauxBruts["repas"], "creneaux.repas");
  const repas: Catalogue["creneaux"]["repas"] = {};
  for (const [id, v] of Object.entries(repasBruts)) {
    const r = obj(v, `creneaux.repas.${id}`);
    repas[id] = {
      label: texte(r["label"], `creneaux.repas.${id}.label`),
      nature: parmi(r["nature"], ["choisi", "routine"] as const, `creneaux.repas.${id}.nature`),
      minutes: nombre(r["minutes"], `creneaux.repas.${id}.minutes`),
    };
  }
  for (const requis of REPAS_REQUIS) {
    if (!repas[requis])
      throw new CatalogueInvalide("creneaux.repas", `un repas « ${requis} »`, Object.keys(repas));
  }

  const joursBruts = obj(creneauxBruts["jours"], "creneaux.jours");
  const exceptionsBrutes = joursBruts["exceptions"];
  const exceptions: Record<string, string[]> = {};
  if (exceptionsBrutes != null)
    for (const [j, v] of Object.entries(obj(exceptionsBrutes, "creneaux.jours.exceptions")))
      exceptions[j] = listeDeTextes(v, `creneaux.jours.exceptions.${j}`);

  const emporteBrut = obj(creneauxBruts["emporte"] ?? {}, "creneaux.emporte");
  const emporte: Record<string, string[]> = {};
  for (const [r, v] of Object.entries(emporteBrut))
    emporte[r] = listeDeTextes(v, `creneaux.emporte.${r}`);

  const rayonsBruts = obj(o["rayons"], "rayons");
  const rayonsParNom: Record<string, string[]> = {};
  for (const [nom, v] of Object.entries(obj(rayonsBruts["rayons"], "rayons.rayons")))
    rayonsParNom[nom] = listeDeTextes(v, `rayons.rayons.${nom}`);
  const aliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(rayonsBruts["aliases"] ?? {}, "rayons.aliases")))
    aliases[k] = texte(v, `rayons.aliases.${k}`);

  const equilibreBrut = obj(o["equilibre"], "equilibre");
  const cibles = obj(equilibreBrut["cibles"], "equilibre.cibles");
  const cibleProteine: Record<string, { min?: number; max?: number }> = {};
  for (const [p, v] of Object.entries(obj(cibles["proteine"], "equilibre.cibles.proteine"))) {
    const c = obj(v, `equilibre.cibles.proteine.${p}`);
    cibleProteine[p] = {
      ...(c["min"] === undefined ? {} : { min: nombre(c["min"], `equilibre.cibles.proteine.${p}.min`) }),
      ...(c["max"] === undefined ? {} : { max: nombre(c["max"], `equilibre.cibles.proteine.${p}.max`) }),
    };
  }
  const poids: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(equilibreBrut["poids"], "equilibre.poids")))
    poids[k] = nombre(v, `equilibre.poids.${k}`);
  const repetition: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(cibles["repetition_max"], "equilibre.cibles.repetition_max")))
    repetition[k] = nombre(v, `equilibre.cibles.repetition_max.${k}`);
  const congelateur: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(obj(equilibreBrut["congelateur"] ?? {}, "equilibre.congelateur")))
    congelateur[k] = typeof v === "boolean" ? v : nombre(v, `equilibre.congelateur.${k}`);
  const mainBrute = obj(equilibreBrut["main"], "equilibre.main");

  const provenancesBrutes = obj(o["provenances"], "provenances");
  const provenances = {} as Catalogue["provenances"];
  for (const p of PROVENANCES)
    provenances[p] = texte(provenancesBrutes[p], `provenances.${p}`);

  const plats = tableau(o["plats"], "plats").map((x, i) => plat(x, `plats[${i}]`));
  if (plats.length === 0) throw new CatalogueInvalide("plats", "au moins un plat", plats);

  // Deux plats sous le même identifiant, et la carte jouée n'est pas celle que
  // le doigt a touchée : `plats[rid]` en garde une seule.
  const vus = new Set<string>();
  for (const p of plats) {
    if (vus.has(p.id)) throw new CatalogueInvalide("plats", "des identifiants uniques", p.id);
    vus.add(p.id);
  }

  return {
    foyer: foyer(o["foyer"], "foyer"),
    plats,
    creneaux: {
      repas,
      jours: {
        defaut: listeDeTextes(joursBruts["defaut"], "creneaux.jours.defaut"),
        ...(Object.keys(exceptions).length ? { exceptions } : {}),
      },
      emporte,
      equilibre_sur: listeDeTextes(creneauxBruts["equilibre_sur"], "creneaux.equilibre_sur"),
    },
    rayons: {
      ordre: listeDeTextes(rayonsBruts["ordre"], "rayons.ordre"),
      aliases,
      rayons: rayonsParNom,
      placard: listeDeTextes(rayonsBruts["placard"] ?? [], "rayons.placard"),
    },
    equilibre: {
      cibles: {
        proteine: cibleProteine,
        familles_legumes_min: nombre(cibles["familles_legumes_min"], "equilibre.cibles.familles_legumes_min"),
        repetition_max: repetition,
      },
      poids,
      congelateur,
      main: {
        taille: nombre(mainBrute["taille"], "equilibre.main.taille"),
        cooldown_jours: nombre(mainBrute["cooldown_jours"], "equilibre.main.cooldown_jours"),
        garantir: listeDeTextes(mainBrute["garantir"], "equilibre.main.garantir"),
      },
    },
    conservation: tableau(o["conservation"] ?? [], "conservation").map((x, i) => {
      const c = obj(x, `conservation[${i}]`);
      return {
        id: texte(c["id"], `conservation[${i}].id`),
        label: texte(c["label"], `conservation[${i}].label`),
        acquis: booleen(c["acquis"], `conservation[${i}].acquis`),
        manque: texteOuNull(c["manque"] ?? null, `conservation[${i}].manque`),
        noeud: texteOuNull(c["noeud"] ?? null, `conservation[${i}].noeud`),
        acideSeulement: booleen(c["acideSeulement"], `conservation[${i}].acideSeulement`),
      };
    }),
    stock: tableau(o["stock"] ?? [], "stock").map((x, i) => ligneStock(x, `stock[${i}]`)),
    provenances,
    horsCourses: tableau(o["horsCourses"], "horsCourses")
      .map((x, i) => parmi(x, PROVENANCES, `horsCourses[${i}]`)),
  };
}

/** Le catalogue est un asset, pas un module : il vit dans `public/`, se met en
 *  cache tout seul et se remplace sans reconstruire l'app. */
export const CHEMIN_CATALOGUE = "/cuisine-data.json";

export async function chargerCatalogue(chemin = CHEMIN_CATALOGUE): Promise<Catalogue> {
  const r = await fetch(chemin);
  if (!r.ok) throw new Error(`${chemin} : ${r.status} ${r.statusText}`);
  return lireCatalogue(await r.json());
}
