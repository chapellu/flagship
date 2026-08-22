// Ce que le cockpit montre — la journée d'abord, les facettes ensuite.
//
// LA THÈSE DE L'ÉCRAN : le cockpit n'est pas un tableau de bord de la cuisine,
// c'est la porte de la maison. Il répond à une seule question — « qu'est-ce qui
// m'attend aujourd'hui ? » — et tout ce qui n'y répond pas descend d'un cran,
// dans les cartes de facette.
//
// ────────────────────────────────────────────────────────────────────────────
// LE JARDIN NE PRODUIT AUCUNE TÂCHE, ET C'EST LE PRINCIPAL ÉCART AU PROTO.
//
// `apps/proto-shell/comptoir.js` en tirait trois : « semer la mâche »,
// « observer le bac 2 », « récolter le basilic ». Elles viennent de `data.js`,
// écrites à la main pour le canevas — aucun modèle ne les calcule, aucune base
// ne les porte, et rien dans cette app ne saurait dire qu'elles sont faites.
// Un cockpit qui réclame de semer la mâche tous les jours de l'année apprend à
// ne plus lire le cockpit. Deux lignes vraies valent mieux que cinq dont trois
// sont un décor : la facette jardin garde sa carte, sans chiffre, et le dira
// quand elle aura un modèle.
// ────────────────────────────────────────────────────────────────────────────
//
// Port de `apps/proto-shell/comptoir.js` (`ecranCockpit`).

import { jourISO, type EtatCourse } from "../db";
import { minutesParJour, type Calcul } from "../model/calcul";
import type { Jeu } from "../model/jeu";
import type { Route } from "../nav/routes";
import { duree } from "../ui/format";
import { detailDuGeste, gesteDuJour, titreDuGeste } from "./aujourdhui.vue";
import { vueDesCourses } from "./courses.vue";
import { vueAPrevoir } from "./prevoir.vue";

export interface Tache {
  cle: string;
  /** La facette d'où vient la tâche — c'est la pastille de la ligne. */
  facette: "Cuisine" | "Jardin";
  titre: string;
  detail: string;
  /** Où l'on répond. Une tâche qui n'ouvre rien est une plainte. */
  route: Route;
}

export interface CarteFacette {
  /** Le mot court en haut à droite : l'état de la facette, pas un compte. */
  etat: string;
  resume: string;
  chiffres: string[];
}

export interface VueCockpit {
  taches: Tache[];
  /** La phrase sous la date. Elle compte les tâches, et rien d'autre. */
  entree: string;
  cuisine: CarteFacette;
}

export interface EtatDuJour {
  /** L'état des courses, tel que la base le porte. */
  courses: Map<string, EtatCourse>;
  /** Le geste du jour a été coché. Voir `cleGeste` : la clé porte le jour. */
  gesteFait: boolean;
}

export function vueDuCockpit(jeu: Jeu, calc: Calcul, etat: EtatDuJour): VueCockpit {
  const courses = vueDesCourses(jeu.catalogue, calc.panier, etat.courses);
  const enAttente = vueAPrevoir(jeu, calc).enAttente;
  // LE DERNIER JOUR DE LA FENÊTRE, pas « dimanche » : la semaine part
  // d'aujourd'hui. Aucune valeur de repli ici — un nom de jour inventé serait
  // exactement le bug du proto, en plus discret.
  const dernier = jeu.jours.at(-1)!.nom;

  const minutes = minutesParJour(jeu, jeu.choix).reduce((a, b) => a + b, 0);

  const choisis = jeu.creneaux.map((c, i) => ({ c, i })).filter((x) => x.c.nature === "choisi");
  // UN CRÉNEAU RÉPONDU, ce n'est pas un créneau qui porte un plat : « on ne
  // mange pas là » est une réponse, et elle ne réclame plus rien.
  const repondus = choisis.filter((x) => jeu.choix[x.i] != null).length;
  const aPoser = choisis.length - repondus;

  const taches: Tache[] = [];

  // 1. CE SOIR. C'est la seule chose de la liste dont l'échéance est ce soir :
  // elle passe donc devant, y compris devant les courses.
  const soir = jeu.creneaux.findIndex((c) => c.jour === 0 && c.repas === "diner");
  const jour0 = jeu.jours[0];
  if (soir >= 0 && jour0 && jeu.choix[soir] == null)
    taches.push({
      cle: "ce-soir",
      facette: "Cuisine",
      titre: "Poser le dîner de ce soir",
      detail: "Rien n'est posé — « Poser un plat » en propose quatre.",
      route: {
        ecran: "poser",
        creneau: { jour: jourISO(jour0.date), repas: jeu.creneaux[soir]!.repas },
      },
    });

  // 2. LE GESTE DU JOUR. Il concerne demain, mais il se fait ce soir : un lot
  // sorti demain matin est encore un bloc à 19 h.
  const geste = gesteDuJour(jeu, calc);
  if (geste && !etat.gesteFait)
    taches.push({
      cle: `geste|${geste.type}`,
      facette: "Cuisine",
      titre: titreDuGeste(geste),
      detail: detailDuGeste(geste),
      route: { ecran: "aujourdhui" },
    });

  // 3. LES COURSES. Le proto écrivait « rien de rentré au stock » quel que soit
  // le nombre d'articles rentrés — il lisait les cochés et concluait sur les
  // rentrés. Une ligne qui contredit l'écran qu'elle ouvre ne se rattrape pas.
  if (courses.articles.length && courses.rentres < courses.articles.length)
    taches.push({
      cle: "courses",
      facette: "Cuisine",
      titre: "Les courses",
      detail: detailDesCourses(courses.articles.length, courses.coches, courses.rentres),
      route: { ecran: "courses" },
    });

  // 4. CE QUI ATTEND UNE RÉPONSE. Le compte vient de « À prévoir », comme la
  // pastille de la sous-navigation : un seul endroit sait compter les offres.
  if (enAttente)
    taches.push({
      cle: "prevoir",
      facette: "Cuisine",
      titre: enAttente > 1 ? `${enAttente} offres attendent une réponse` : "Une offre attend une réponse",
      detail: "Agrandir un lot d'avance, ou prévoir une gamelle pour un midi.",
      route: { ecran: "prevoir" },
    });

  return {
    taches,
    entree: entree(taches.length),
    cuisine: {
      // Le proto affichait « 14 créneaux » — le nombre de créneaux
      // CHOISISSABLES de la semaine, qui ne bouge jamais. Un chiffre constant
      // déguisé en état ; ce qui bouge, c'est ce à quoi on a répondu.
      etat: `${repondus}/${choisis.length} répondus`,
      resume: resumeCuisine(aPoser, dernier, enAttente),
      // UN ZÉRO N'EST PAS UN CHIFFRE À AFFICHER. Vu au navigateur sur une
      // semaine vide : « 0 article » et « 0 min de cuisine » en pastilles, ce
      // qui donne trois choses à lire pour n'en dire aucune. Le proto ne
      // pouvait pas le voir, sa semaine était pré-remplie au démarrage.
      chiffres: [
        ...(courses.articles.length
          ? [`${courses.articles.length} ${courses.articles.length > 1 ? "articles" : "article"}`]
          : []),
        ...(minutes ? [`${duree(minutes)} de cuisine`] : []),
        ...(enAttente ? [enAttente > 1 ? `${enAttente} offres ouvertes` : "1 offre ouverte"] : []),
      ],
    },
  };
}

/** Où en est la liste, dit dans l'ordre où on la vit : on coche au magasin,
 *  puis on range à la maison. */
export function detailDesCourses(total: number, coches: number, rentres: number): string {
  if (rentres) return `${rentres} sur ${total} rentrés au stock`;
  if (coches) return `${coches} sur ${total} cochés`;
  return `${total} ${total > 1 ? "articles à cocher" : "article à cocher"}`;
}

const entree = (n: number): string =>
  n === 0
    ? "Rien ne vous attend aujourd'hui."
    : n === 1
      ? "Une chose vous attend aujourd'hui."
      : `${n} choses vous attendent aujourd'hui.`;

/**
 * L'état de la semaine, en une phrase.
 *
 * Le proto écrivait « La semaine est posée jusqu'à dimanche » en dur, quoi
 * qu'elle porte — la phrase était fausse dès le premier créneau vide, et son
 * « dimanche » l'était dès qu'on ouvrait l'app un mardi : la fenêtre part
 * d'aujourd'hui et finit sept jours plus tard, pas au bout du calendrier.
 */
export function resumeCuisine(aPoser: number, dernier: string, enAttente: number): string {
  const semaine =
    aPoser === 0
      ? `La semaine est répondue jusqu'à ${dernier}.`
      : aPoser === 1
        ? `Un créneau reste à poser d'ici ${dernier}.`
        : `${aPoser} créneaux restent à poser d'ici ${dernier}.`;
  const offres =
    enAttente === 0 ? "" : enAttente > 1 ? ` ${enAttente} offres attendent votre réponse.` : " Une offre attend votre réponse.";
  return semaine + offres;
}

/** Ce qui compte pour la pastille du cockpit : la liste elle-même. Un compte
 *  refait ailleurs finirait par annoncer un autre nombre que l'écran qu'il
 *  ouvre — c'est la leçon de T10, et elle vaut pour la barre du bas. */
export const aFaire = (v: VueCockpit): number => v.taches.length;
