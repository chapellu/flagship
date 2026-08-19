// Les types du catalogue — ce que `export_json.py` produit, vu depuis l'app.
//
// Le modèle de référence reste le Python (Workspace, recipe-compiler) ; ce
// fichier ne décrit pas un contrat que l'app impose, il décrit une donnée
// qu'elle reçoit. D'où la règle qui gouverne tout ce qui suit :
//
//   UNE UNION EST UNE PROMESSE QUE L'EXPORT NE CHANGERA PAS.
//
// On ne la fait donc que là où le code BRANCHE sur la valeur et où une valeur
// nouvelle doit être remarquée : un `espace` inconnu casse le bilan de
// rangement, un `kind` inconnu casse le chaînage — mieux vaut échouer au
// chargement que ranger dans un quatrième espace silencieux.
//
// Partout où la valeur n'est que portée jusqu'à l'écran — l'unité d'un
// ingrédient, une famille de légumes, un profil de cuisson — c'est `string`.
// Le jour où le catalogue gagne un légume, l'app doit l'afficher, pas planter.

/** Où une sortie se range. Le bilan de rangement a un plafond par valeur. */
export type Espace = "frigo" | "congelo" | "placard";

/** Ce qu'un plat laisse derrière lui. Le chaînage branche sur cette classe. */
export type EmitKind = "base" | "parure" | "portion-bebe" | "reste-plat";

/** Lequel des deux plafonds d'un espace mord. */
export type CauseLimite = "place" | "contenant";

/** Un créneau se choisit (on y pioche un plat) ou se subit (petit-déj, goûter). */
export type NatureCreneau = "choisi" | "routine";

/** D'où sort une ligne d'ingrédient — décidé une fois, lu partout. */
export type Provenance = "placard" | "chaine" | "frigo" | "courses" | "absent";

/** L'identifiant d'un repas dans `creneaux.repas`. Piloté par la donnée : la
 *  liste des repas est configurable, seuls `dejeuner` et `diner` sont exigés
 *  (le chaînage des gamelles cherche « le dîner de la veille »). */
export type RepasId = string;

export interface Quantite {
  amount: number;
  unit: string;
}

export interface Ingredient {
  id: string;
  nom: string;
  qty: number;
  unit: string;
  /** Une base est cuisinée en amont, jamais achetée : on n'achète nulle part
   *  250 g de lentilles *cuites*. */
  base: boolean;
  assaisonnement: boolean;
}

export interface Etape {
  id: string;
  action: string;
  minutes: number;
  /** Le matériel et le geste : `bake`, `simmer`, `chop-coarse`… L'écran en
   *  dérive la chauffe ; le vocabulaire appartient au compilateur de recettes. */
  needs: string[];
  /** `false` = le temps passe sans qu'on reste devant. C'est ce qui sépare une
   *  journée de 90 minutes tenable d'une autre qui ne l'est pas. */
  surveille: boolean;
  enfant: string | null;
  /** Âge en mois à partir duquel le geste enfant est possible. */
  enfantDes: number | null;
  porteAssaisonnement: boolean;
}

export interface Emit {
  type: string;
  kind: EmitKind;
  /** `null` quand la sortie ne se chiffre pas — un reste de plat se compte en
   *  repas, pas en grammes. C'est `band` qui le mesure alors. */
  qty: Quantite | null;
  /** En repas : « 2-repas », « lunchbox ». L'unité du budget de rangement. */
  band: string;
  espace: Espace;
  note: string | null;
  gardeFrigo: number;
  congelo: boolean;
}

export interface Accept {
  /** Vise une sortie précise… */
  type: string | null;
  /** …ou toute une classe de sorties : une carte « reste réchauffé » mange le
   *  gratin d'hier comme la quiche d'avant-hier. */
  kind: EmitKind | null;
  requis: boolean;
  qty: Quantite | null;
  mere: string | null;
}

export interface Apports {
  proteine: string;
  feculent: string;
  legumes: string[];
  profil: string;
  origine?: string;
}

export interface Vaisselle {
  id: string;
  label: string;
  /** Le facteur d'échelle au-delà duquel le lot ne tient plus dans le récipient.
   *  L'analogue exact de la RAM : un lot qui n'y entre pas ne part pas. */
  facteurMax: number;
}

/** Ce qu'un plat coûte quand il ne trouve pas le reste qu'il attendait.
 *  Ses lignes arrivent sans `base` ni `assaisonnement` : le chargeur les pose à
 *  faux, parce que ce qu'on achète faute de reste n'est ni l'un ni l'autre. */
export interface SansReste {
  minutes: number;
  ingredients: Ingredient[];
}

export interface Plat {
  id: string;
  titre: string;
  minutes: number;
  portions: number;
  apports: Apports;
  ingredients: Ingredient[];
  steps: Etape[];
  bebe: string | null;
  actifMin: number | null;
  accepts: Accept[];
  /** Les créneaux qui lui vont ; vide vaut « repas principal ». */
  creneaux: RepasId[];
  transportable: boolean;
  sansReste: SansReste | null;
  emits: Emit[];
  /** Un lot qui ne se coupe pas : « faire 0,42 poulet rôti » n'est pas une
   *  quantité. */
  lotEntier: boolean;
  /** Un seul objet, pris plus gros — un poulet se choisit entre 1,2 et 2 kg. */
  calibreMax: number | null;
  vaisselle: Vaisselle | null;
  gainChainage: number;
  cuisinable: boolean;
}

export interface Mangeur {
  id: string;
  genre: string;
  parts: number;
  bebe: boolean;
}

/** Un espace a DEUX plafonds, tous deux réels : les étagères et les contenants.
 *  Le plus bas commande, et `cause` dit lequel — dégager une étagère et laver
 *  des boîtes ne sont pas le même geste. */
export interface EspaceConfig {
  places: number;
  contenants: number;
  limite: number;
  cause: CauseLimite;
}

export interface Contenant {
  id: string;
  label: string;
  nombre: number;
  portions: number;
  espaces: Espace[];
  consommable: boolean;
}

export interface Recipient {
  id: string;
  label: string;
  contenance: number;
  exemplaires: number;
}

export interface Foyer {
  nom: string;
  parts: number;
  /** Jours au bout desquels un reste au frigo cesse d'être proposé. */
  fenetreFrigo: number;
  tiroirs: number;
  mangeurs: Mangeur[];
  espaces: Record<Espace, EspaceConfig>;
  contenants: Contenant[];
  vaisselle: Recipient[];
}

export interface Repas {
  label: string;
  nature: NatureCreneau;
  minutes: number;
}

export interface ConfigCreneaux {
  repas: Record<RepasId, Repas>;
  jours: {
    defaut: RepasId[];
    exceptions?: Record<string, RepasId[]>;
  };
  /** Les repas qui partent en gamelle, par jour : `{ dejeuner: ["mardi"] }`. */
  emporte: Record<RepasId, string[]>;
  equilibre_sur: RepasId[];
}

export interface ConfigRayons {
  ordre: string[];
  /** Deux identifiants d'ingrédient qui désignent la même course. */
  aliases: Record<string, string>;
  rayons: Record<string, string[]>;
  /** Ce qu'on a toujours, et qu'on vérifie au lieu de l'acheter. */
  placard: string[];
}

export interface Equilibre {
  cibles: {
    proteine: Record<string, { min?: number; max?: number }>;
    familles_legumes_min: number;
    repetition_max: Record<string, number>;
  };
  poids: Record<string, number>;
  congelateur: Record<string, number | boolean>;
  main: {
    taille: number;
    cooldown_jours: number;
    garantir: string[];
  };
}

export interface LigneStock {
  type: string;
  kind: EmitKind;
  qty_band: string;
  qty: Quantite;
  /** ISO `YYYY-MM-DD`. Converti en `Date` par le modèle, pas ici : le
   *  catalogue est du texte, la fraîcheur est un calcul. */
  born: string;
  location: Espace;
  note?: string;
}

export interface Conservation {
  id: string;
  label: string;
  acquis: boolean;
  manque: string | null;
  noeud: string | null;
  acideSeulement: boolean;
}

export interface Catalogue {
  foyer: Foyer;
  plats: Plat[];
  creneaux: ConfigCreneaux;
  rayons: ConfigRayons;
  equilibre: Equilibre;
  conservation: Conservation[];
  stock: LigneStock[];
  provenances: Record<Provenance, string>;
  /** Les provenances qui ne produisent pas de ligne de courses. */
  horsCourses: Provenance[];
}
