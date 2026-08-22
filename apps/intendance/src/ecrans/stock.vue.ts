// Ce que « L'inventaire » montre — et d'où vient chaque chiffre.
//
// C'EST LE SEUL ÉCRAN QUI PARLE DU DÉPÔT LUI-MÊME. Partout ailleurs le dépôt
// est un moyen : il dit à « La semaine » ce qui se chaîne, à « Courses » ce
// qu'on n'a pas besoin d'acheter, à « Poser un plat » ce qu'une carte
// trouverait. Ici il est le sujet, et la question devient : à quel point
// peut-on croire ces chiffres ?
//
// LA FIABILITÉ N'EST PAS UNE ÉTIQUETTE POSÉE À LA MAIN. Le canevas Claude
// Design en inventait cinq catégories ; le modèle porte la même idée sous une
// forme qu'on peut dériver — une ligne chiffrée (on l'a pesée à l'export), une
// ligne déduite d'un plat cuisiné cette semaine (on l'a calculée), une ligne
// qui n'a qu'une bande de repas (on sait seulement qu'elle existe). Trois
// états, tous vérifiables, aucun décoratif.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranStock`, `fiabilite`).

import type { BilanEspace, Calcul } from "../model/calcul";
import type { LigneDepot } from "../model/depot";
import type { Jeu } from "../model/jeu";
import type { Espace } from "../model/types";
import { fmt } from "../ui/format";
import { nomEspace } from "../ui/phrases";

/** L'ordre des espaces, du plus consulté au moins. Le même partout : une
 *  cuisine ne se relit pas dans un ordre différent d'un écran à l'autre. */
export const ESPACES: readonly Espace[] = ["frigo", "congelo", "placard"];

/** À quel point on croit un chiffre. Trois niveaux, parce qu'il y a exactement
 *  trois façons pour le dépôt de connaître une quantité. */
export type Niveau = "haute" | "moyenne" | "basse";

export interface Fiabilite {
  /** Ce qu'on en dit à l'écran. */
  label: string;
  /** La classe CSS qui le colore. Vide pour « en bloc » : rien à mettre en
   *  avant dans une quantité qu'on ne connaît pas. */
  classe: string;
  niveau: Niveau;
}

/**
 * D'où vient le chiffre d'une ligne — et dans cet ordre, qui n'est pas
 * arbitraire : un lot produit par la semaine est TOUJOURS estimé, même quand il
 * porte une quantité, parce que cette quantité est le produit d'un facteur
 * d'échelle et d'une recette, pas d'une balance. Tester `qty` d'abord dirait
 * « compté » d'un lot que personne n'a jamais vu.
 */
export function fiabilite(l: LigneDepot): Fiabilite {
  if (l.from) return { label: "estimé", classe: "estime", niveau: "moyenne" };
  if (l.qty?.amount != null) return { label: "compté", classe: "compte", niveau: "haute" };
  return { label: "en bloc", classe: "", niveau: "basse" };
}

export interface Categorie {
  espace: Espace;
  nom: string;
  /** Les lots encore là à la fin de la semaine. */
  vivants: number;
  /** Ceux que la semaine a mangés. */
  manges: number;
  /** Barres allumées sur quatre — un niveau, pas un compte exact. */
  barres: number;
  /** Le plus bas des niveaux de l'espace : un seul chiffre douteux suffit à
   *  rendre le total douteux. */
  conf: Niveau;
  note: string;
}

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * Les rangements, avec ce qu'ils portent et ce qu'on en sait.
 *
 * UN ÉCART AU PROTO, ET C'EST UNE CORRECTION. Le proto écrivait « 3 lots »
 * sous le nom du rangement en ne comptant que les lots vivants, puis listait
 * en dessous CINQ lignes — les deux mangés compris, grisées. Le compte et la
 * liste qu'il annonce ne disaient pas la même chose, ce qui est exactement le
 * défaut qu'on a corrigé sur la pastille de « À prévoir » (T10). Ici les deux
 * nombres sont dits, parce que les deux existent : ce qui reste, et ce que la
 * semaine a mangé.
 */
export function categories(lignes: readonly LigneDepot[]): Categorie[] {
  const vue = (espace: Espace, dedans: LigneDepot[]): Categorie => {
    const vivants = dedans.filter((l) => !l.epuise).length;
    const manges = dedans.length - vivants;
    const niveaux = dedans.map((l) => fiabilite(l).niveau);
    const etats = [...new Set(dedans.map((l) => fiabilite(l).label))];
    return {
      espace,
      nom: nomEspace(espace),
      vivants,
      manges,
      barres: Math.min(4, vivants),
      conf: niveaux.includes("basse")
        ? "basse"
        : niveaux.every((n) => n === "haute")
          ? "haute"
          : "moyenne",
      note: [
        pluriel(vivants, "lot"),
        manges ? `${manges} mangé${manges > 1 ? "s" : ""}` : "",
        ...etats,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  };

  return ESPACES.map((espace) => [espace, lignes.filter((l) => l.espace === espace)] as const)
    .filter(([, dedans]) => dedans.length > 0)
    .map(([espace, dedans]) => vue(espace, dedans));
}

export interface Plafond {
  nom: string;
  /** Ce qu'il reste sous ce plafond-là. Jamais négatif : « −2 libres » n'est
   *  pas une quantité, et le débordement se dit en toutes lettres. */
  libres: number;
  /** Le remplissage, en pourcentage, borné à 100. */
  part: number;
  /** Le plafond qui mord — celui qui décide du geste. */
  commande: boolean;
}

export interface EspaceVue {
  espace: Espace;
  nom: string;
  /** Les étagères, puis les contenants. */
  plafonds: Plafond[];
  deborde: boolean;
  /**
   * Quoi faire, quand il y a quelque chose à faire.
   *
   * ÉCART AU PROTO, PARCE QUE LE PROTO CRIAIT TOUT LE TEMPS. Il affichait
   * « dégager une étagère » sous les trois rangements en permanence, débordant
   * ou pas : trois impératifs qui ne s'adressaient à personne. Un conseil qui
   * est toujours là n'est plus un conseil, et le jour où il compte vraiment il
   * ne se distingue plus des deux autres. Il ne paraît donc que quand la place
   * manque ou va manquer.
   */
  geste: string;
}

/** Le geste que réclame le plafond qui mord. Laver deux bocaux n'est pas
 *  dégager une étagère — c'est toute la raison d'avoir deux plafonds. */
const gesteDe = (s: BilanEspace): string =>
  s.cause === "contenant" ? "laver des boîtes" : "dégager une étagère";

const part = (n: number, max: number): number =>
  Math.max(0, Math.min(100, Math.round((n / (max || 1)) * 100)));

const libres = (max: number, fin: number): number => Math.max(0, +(max - fin).toFixed(1));

/** Les trois rangements sont garantis : le chargeur du catalogue exige les
 *  trois espaces, et `bilanStockage` en produit un bilan pour chacun. */
export function espaces(stockage: Record<Espace, BilanEspace>): EspaceVue[] {
  return ESPACES.map((espace) => {
    const s = stockage[espace];
    const boites = s.cause === "contenant";
    return {
      espace,
      nom: nomEspace(espace),
      plafonds: [
        { nom: "étagères", libres: libres(s.places, s.fin), part: part(s.fin, s.places), commande: !boites },
        {
          nom: "contenants",
          libres: libres(s.contenants, s.fin),
          part: part(s.fin, s.contenants),
          commande: boites,
        },
      ],
      deborde: s.deborde,
      geste: s.deborde
        ? `⚠ ça déborde — ${gesteDe(s)}`
        : s.libre < 1
          ? `au plus juste — ${gesteDe(s)}`
          : "",
    };
  });
}

export interface LotVue {
  /** Stable dans un rendu : la clé de base pour un lot constaté, sa place dans
   *  le dépôt pour ce que la semaine produit. */
  cle: string;
  espace: Espace;
  /** L'identifiant de la sortie, tel quel. Le catalogue n'a pas de libellé
   *  lisible pour ce que produit un plat — c'est noté au backlog, et le
   *  dé-tiretiser ici produirait du faux français. */
  nom: string;
  /** D'où il sort et ce qu'il en reste, en une phrase. */
  ou: string;
  quantite: string;
  fiabilite: Fiabilite;
  epuise: boolean;
  /**
   * La clé de base, quand ce lot en a une.
   *
   * ELLE DIT CE QU'UN DOIGT PEUT TOUCHER. Un lot constaté appartient au foyer :
   * on peut dire qu'il n'existe plus. Un lot que la semaine produit est un
   * RÉSULTAT DE CALCUL — le retirer ne voudrait rien dire, il reviendrait au
   * rendu suivant. Ce qu'on veut alors, c'est changer la semaine, et ça se fait
   * ailleurs.
   */
  ref: string | null;
}

export function lots(jeu: Jeu, lignes: readonly LigneDepot[], filtre: Espace | null): LotVue[] {
  return lignes
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !filtre || l.espace === filtre)
    .map(({ l, i }) => {
      const q = l.qty?.amount ?? null;
      const entame = l.reste != null && q != null && l.reste < q - 1e-9;
      return {
        cle: l.ref ?? `d${i}`,
        espace: l.espace,
        nom: l.type,
        ou: [
          nomEspace(l.espace),
          l.from ? `cuisiné cette semaine (${jeu.plats[l.from]?.titre ?? l.from})` : "déjà là avant la semaine",
          entame ? `reste ${fmt(l.reste!)} ${l.unite ?? ""}`.trim() : "",
          l.epuise ? "mangé par la semaine" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        quantite: q != null ? `${fmt(q)} ${l.unite ?? ""}`.trim() : l.band || "—",
        fiabilite: fiabilite(l),
        epuise: l.epuise,
        ref: l.ref,
      };
    });
}

export interface Inventaire {
  categories: Categorie[];
  espaces: EspaceVue[];
  lots: LotVue[];
  /**
   * Le rangement réellement ouvert.
   *
   * PAS TOUJOURS CELUI QU'ON A DEMANDÉ : retirer le dernier lot d'un rangement
   * fait disparaître son bouton, et l'écran resterait filtré sur une catégorie
   * qui n'est plus offerte — une liste vide, un titre qui nomme un rangement,
   * et plus rien pour en sortir que le bouton « Tout voir ». Un filtre sans
   * contenu se relâche tout seul.
   */
  filtre: Espace | null;
  /** Le rangement ouvert, en toutes lettres, ou `null`. */
  nomDuFiltre: string | null;
  /** Les lots que la base porte — ceux dont le foyer répond. Zéro veut dire
   *  que tout ce qu'on voit sort de la semaine, ce qui est une information. */
  constates: number;
}

export function vueDeLInventaire(jeu: Jeu, calc: Calcul, voulu: Espace | null): Inventaire {
  const lignes = calc.depot.lignes;
  const cats = categories(lignes);
  const filtre = cats.some((c) => c.espace === voulu) ? voulu : null;
  return {
    categories: cats,
    espaces: espaces(calc.stockage),
    lots: lots(jeu, lignes, filtre),
    filtre,
    nomDuFiltre: filtre ? nomEspace(filtre) : null,
    constates: lignes.filter((l) => l.ref !== null).length,
  };
}
