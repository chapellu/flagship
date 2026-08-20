// Les hooks React — la base vue depuis un écran.
//
// `useLiveQuery` réexécute la requête quand la table change, d'où qu'elle
// vienne : un autre onglet, un autre écran, une écriture en tâche de fond.
// C'est ce qui permet aux écrans de ne rien savoir les uns des autres — cocher
// une course dans « Courses » rafraîchit le compteur du cockpit sans qu'aucun
// des deux ne connaisse l'autre.
//
// LE `Jeu` EST RECONSTRUIT, JAMAIS MUTÉ EN PLACE ICI. Le modèle mute son état
// (c'est son style, et il est cohérent), mais React ne redessine que sur un
// changement d'identité. Chaque lecture de la base refabrique donc un `Jeu`
// neuf, hydraté : c'est aussi ce qui garantit qu'un rendu ne voit jamais un
// jeu à moitié écrit.

import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { calculer, type Calcul } from "../model/calcul";
import { chargerCatalogue } from "../model/catalogue";
import { creerJeu, type Choix, type Jeu } from "../model/jeu";
import type { Catalogue } from "../model/types";
import { lireCourses } from "./courses";
import { base, jourISO, type EtatCourse, type LotStock } from "./schema";
import { hydrater, oublier, poser, prevoirGamelle, reglerParts } from "./semaine";

/** Le catalogue, chargé une fois pour la vie de l'onglet. Il ne change pas en
 *  cours de route : c'est un asset, pas une donnée vivante. */
export function useCatalogue(): { catalogue: Catalogue | null; erreur: Error | null } {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [erreur, setErreur] = useState<Error | null>(null);

  useEffect(() => {
    let vivant = true;
    chargerCatalogue()
      .then((c) => vivant && setCatalogue(c))
      // Un catalogue qui a dérivé doit s'afficher comme une panne, pas se
      // rattraper en écran vide : `lireCatalogue` lève avec le chemin fautif,
      // et cette phrase est la seule chose qui permettra de le diagnostiquer
      // depuis un téléphone.
      .catch((e: unknown) => vivant && setErreur(e instanceof Error ? e : new Error(String(e))));
    return () => {
      vivant = false;
    };
  }, []);

  return { catalogue, erreur };
}

export interface SemaineVivante {
  jeu: Jeu | null;
  calc: Calcul | null;
  /** `true` tant que la base n'a pas répondu : distinct d'une semaine vide. */
  chargement: boolean;
  poserPlat: (i: number, plat: Choix) => Promise<void>;
  reglerLesParts: (i: number, parts: number | null) => Promise<void>;
  /** Le dîner de la veille grossit ET le midi part sur le reste : une seule
   *  transaction, parce que l'une sans l'autre est un dégât. */
  prevoirLaGamelle: (midi: number, veille: number, parts: number, plat: string) => Promise<void>;
  oublierCreneau: (i: number) => Promise<void>;
}

/**
 * La semaine posée, vivante : le modèle reconstruit à chaque écriture.
 *
 * `aujourdhui` est un paramètre parce que la semaine part du jour courant, et
 * qu'un test ne peut pas attendre demain pour vérifier qu'elle roule bien.
 */
export function useSemaine(catalogue: Catalogue | null, aujourdhui = new Date()): SemaineVivante {
  const jour0 = jourISO(aujourdhui);

  // Le squelette de la semaine ne dépend que du catalogue et du jour : le
  // refabriquer à chaque rendu jetterait le travail de `creerJeu` pour rien.
  const squelette = useMemo(
    () => (catalogue ? creerJeu(catalogue, 7, new Date(aujourdhui)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `jour0` EST la date, à la journée près
    [catalogue, jour0],
  );

  const bornes = useMemo(
    () => (squelette ? squelette.jours.map((j) => jourISO(j.date)) : []),
    [squelette],
  );
  const debut = bornes[0] ?? "";
  const fin = bornes.at(-1) ?? "";

  const decisions = useLiveQuery(
    async () =>
      debut ? await base.creneaux.where("jour").between(debut, fin, true, true).toArray() : [],
    [debut, fin],
  );

  const jeu = useMemo(() => {
    if (!squelette || !decisions) return null;
    const frais = creerJeu(squelette.catalogue, 7, new Date(aujourdhui));
    return hydrater(frais, new Map(decisions.map((d) => [d.cle, d])));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- même raison que ci-dessus
  }, [squelette, decisions, jour0]);

  const calc = useMemo(() => (jeu ? calculer(jeu) : null), [jeu]);

  const poserPlat = useCallback(
    async (i: number, plat: Choix) => {
      if (jeu) await poser(base, jeu, i, plat);
    },
    [jeu],
  );
  const reglerLesParts = useCallback(
    async (i: number, parts: number | null) => {
      if (jeu) await reglerParts(base, jeu, i, parts);
    },
    [jeu],
  );
  const prevoirLaGamelle = useCallback(
    async (midi: number, veille: number, parts: number, plat: string) => {
      if (jeu) await prevoirGamelle(base, jeu, midi, veille, parts, plat);
    },
    [jeu],
  );
  const oublierCreneau = useCallback(
    async (i: number) => {
      if (jeu) await oublier(base, jeu, i);
    },
    [jeu],
  );

  return {
    jeu,
    calc,
    chargement: !catalogue || decisions === undefined,
    poserPlat,
    reglerLesParts,
    prevoirLaGamelle,
    oublierCreneau,
  };
}

/** L'état des courses, vivant. `undefined` tant que la base n'a pas répondu. */
export function useCourses(): Map<string, EtatCourse> | undefined {
  const etats = useLiveQuery(() => lireCourses(base), []);
  return etats;
}

/** Le stock réel, vivant. */
export function useStock(): LotStock[] | undefined {
  return useLiveQuery(() => base.stock.toArray(), []);
}
