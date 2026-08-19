// L'app — le shell multi-facettes (Workspace#36), habillé par la direction
// « Le comptoir » du canevas Claude Design.
//
// Ce fichier ne fait qu'une chose : brancher une route sur un écran. Toute la
// donnée passe par les hooks de `db/`, et chaque écran va la chercher lui-même
// — un App qui distribuerait les props de dix écrans deviendrait le seul
// fichier que personne ne peut plus lire.

import { useEffect } from "react";
import { base, indexDuCreneau } from "./db";
import { useCatalogue, useSemaine } from "./db/hooks";
import { amorcer } from "./db/stock";
import { gamelles } from "./model/offres";
import { offresSurproduction } from "./model/offres";
import { pleinEcran, type Route } from "./nav/routes";
import { useRoute } from "./nav/useRoute";
import { Coquille, Corps, type Pastilles } from "./ui/Coquille";
import { Aujourdhui } from "./ecrans/Aujourdhui";
import { Cockpit } from "./ecrans/Cockpit";
import { Courses } from "./ecrans/Courses";
import { Cuisiner } from "./ecrans/Cuisiner";
import { Jardin } from "./ecrans/Jardin";
import { Parts } from "./ecrans/Parts";
import { Poser } from "./ecrans/Poser";
import { Prevoir } from "./ecrans/Prevoir";
import { Semaine } from "./ecrans/Semaine";
import { Stock } from "./ecrans/Stock";
import "./styles/organic.css";

const MOIS = (d: Date) => d.toLocaleDateString("fr-FR", { month: "long" });

export function App() {
  const route = useRoute();
  const { catalogue, erreur } = useCatalogue();
  const { jeu, calc, chargement } = useSemaine(catalogue);

  // Le stock du catalogue n'entre en base qu'une fois ; à partir de là c'est le
  // foyer qui fait foi. Voir `db/stock.ts`.
  useEffect(() => {
    if (catalogue) void amorcer(base, catalogue);
  }, [catalogue]);

  if (erreur) return <Panne message={erreur.message} />;
  if (chargement || !jeu || !calc) return <Chargement />;

  // CE QUI ATTEND UNE RÉPONSE. Les offres de surproduction, plus les gamelles
  // qu'aucun dîner de la veille ne couvre encore. C'est le chiffre de la
  // pastille, et il vient du modèle — pas d'un compteur qu'on incrémenterait.
  const gam = gamelles(jeu, jeu.choix);
  const pastilles: Pastilles = {
    cuisine: offresSurproduction(jeu, jeu.choix, calc).length + gam.filter((g) => !g.fait && g.plat).length,
    // Le cockpit compte les choses à faire de la journée, toutes facettes
    // confondues. Cette liste est le sujet de T16 : la deviner ici produirait
    // un chiffre que l'écran contredirait en arrivant.
    cockpit: 0,
  };

  const j0 = jeu.jours[0]!;
  const jN = jeu.jours[jeu.jours.length - 1]!;
  const sous = `semaine du ${j0.date.getDate()} au ${jN.date.getDate()} ${MOIS(jN.date)}`;

  // « En cuisine » sort de la coquille : le mode guidé prend l'écran entier,
  // parce qu'on le lit à bout de bras avec les mains sales.
  if (pleinEcran(route)) return <div className="coquille">{rendre(route, jeu)}</div>;

  return (
    <Coquille route={route} titre="Cuisine" sous={sous} pastilles={pastilles}>
      {rendre(route, jeu)}
    </Coquille>
  );
}

function rendre(route: Route, jeu: NonNullable<ReturnType<typeof useSemaine>["jeu"]>) {
  switch (route.ecran) {
    case "cockpit": return <Cockpit />;
    case "jardin": return <Jardin />;
    case "aujourdhui": return <Aujourdhui />;
    case "semaine": return <Semaine />;
    case "prevoir": return <Prevoir />;
    case "courses": return <Courses />;
    case "stock": return <Stock />;
    // Les trois écrans qui visent un créneau. Un lien d'hier rouvert
    // aujourd'hui désigne un jour sorti de la fenêtre : on le dit, plutôt que
    // d'ouvrir l'écran sur un créneau fantôme.
    case "poser":
    case "parts":
    case "cuisiner": {
      const i = indexDuCreneau(jeu, route.creneau.jour, route.creneau.repas);
      if (i < 0) return <HorsSemaine jour={route.creneau.jour} repas={route.creneau.repas} />;
      if (route.ecran === "poser") return <Poser />;
      if (route.ecran === "parts") return <Parts />;
      return <Cuisiner />;
    }
  }
}

const Chargement = () => (
  <div className="coquille">
    <Corps plat>
      <div className="co-note">chargement…</div>
    </Corps>
  </div>
);

const Panne = ({ message }: { message: string }) => (
  <div className="coquille">
    <Corps plat>
      <div className="co-h">Le catalogue n’est pas lisible</div>
      <p className="co-note">{message}</p>
    </Corps>
  </div>
);

const HorsSemaine = ({ jour, repas }: { jour: string; repas: string }) => (
  <Corps plat>
    <div className="co-h">Ce créneau n’est plus là</div>
    <p className="co-note">
      Le {repas} du {jour} est sorti de la semaine affichée. La décision qu’il portait
      n’est pas perdue&nbsp;: elle attend son tour, rangée sous son jour.
    </p>
    <a className="btn btn-primary btn-block" href="#/cuisine/semaine" style={{ marginTop: "var(--space-3)" }}>
      Revenir à la semaine
    </a>
  </Corps>
);
