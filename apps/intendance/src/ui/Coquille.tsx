// La coquille — ce qui ne change jamais d'un écran à l'autre.
//
// La direction « Le comptoir » lui donne un rôle précis : la barre du bas
// appartient à la COQUILLE, pas à la facette. C'est la seule chose qui ne bouge
// jamais, et c'est tout ce qu'on lui demande. Une facette en sommeil (le jardin
// en janvier) y reste listée, sans chiffre — on ne la désinstalle pas.
//
// La sous-navigation de cuisine, elle, appartient à la facette : elle n'existe
// que dans ses quatre vues courtes, et disparaît au cockpit comme au jardin.

import type { ReactNode } from "react";
import { chemin, dansCuisine, type Route } from "../nav/routes";
import { aller } from "../nav/useRoute";

interface Onglet {
  route: Route;
  nom: string;
  pastille?: number;
}

const SOUS_NAV: { route: Route; nom: string }[] = [
  { route: { ecran: "aujourdhui" }, nom: "Aujourd’hui" },
  { route: { ecran: "semaine" }, nom: "La semaine" },
  { route: { ecran: "prevoir" }, nom: "À prévoir" },
  { route: { ecran: "courses" }, nom: "Courses" },
];

export interface Pastilles {
  /** Ce qui attend une réponse côté cuisine : offres et gamelles. */
  cuisine: number;
  /** Ce que la journée réclame, toutes facettes confondues. */
  cockpit: number;
}

export function Coquille({
  route,
  titre,
  sous,
  pastilles,
  children,
}: {
  route: Route;
  /** Le titre de la facette, quand elle en a un. */
  titre?: string;
  sous?: string;
  pastilles: Pastilles;
  children: ReactNode;
}) {
  const cuisine = dansCuisine(route);

  return (
    <div className="coquille">
      {cuisine && titre ? (
        <>
          <div className="co-tete">
            <div>
              <div className="titre">{titre}</div>
              {sous ? <div className="sous">{sous}</div> : null}
            </div>
            <button className="btn btn-secondary" onClick={() => aller({ ecran: "cockpit" })}>
              Cockpit
            </button>
          </div>
          <nav className="co-sousnav" aria-label="Vues de la cuisine">
            {SOUS_NAV.map((o) => (
              <Lien
                key={o.route.ecran}
                onglet={{ ...o, ...(o.route.ecran === "prevoir" ? { pastille: pastilles.cuisine } : {}) }}
                actif={route.ecran === o.route.ecran}
              />
            ))}
          </nav>
        </>
      ) : null}

      {children}

      <nav className="co-barre" aria-label="Facettes">
        <Facette
          nom="Cockpit"
          couleur="var(--color-neutral-500)"
          actif={route.ecran === "cockpit"}
          pastille={pastilles.cockpit}
          onClick={() => aller({ ecran: "cockpit" })}
        />
        <Facette
          nom="Cuisine"
          couleur="var(--color-accent)"
          actif={cuisine}
          pastille={pastilles.cuisine}
          onClick={() => aller({ ecran: "aujourdhui" })}
        />
        <Facette
          nom="Jardin"
          couleur="var(--color-accent-2)"
          actif={route.ecran === "jardin"}
          pastille={0}
          onClick={() => aller({ ecran: "jardin" })}
        />
      </nav>
    </div>
  );
}

/** Un onglet de sous-navigation. C'est une VRAIE ancre : le pouce peut la
 *  garder appuyée pour copier le lien, et le geste de retour d'iOS la connaît. */
function Lien({ onglet, actif }: { onglet: Onglet; actif: boolean }) {
  return (
    <a
      href={chemin(onglet.route)}
      className={actif ? "actif" : ""}
      aria-current={actif ? "page" : undefined}
    >
      <span>{onglet.nom}</span>
      {onglet.pastille ? <span className="co-pastille">{onglet.pastille}</span> : null}
    </a>
  );
}

function Facette({
  nom,
  couleur,
  actif,
  pastille,
  onClick,
}: {
  nom: string;
  couleur: string;
  actif: boolean;
  pastille: number;
  onClick: () => void;
}) {
  return (
    <button className={actif ? "actif" : ""} onClick={onClick} aria-current={actif ? "page" : undefined}>
      <span className="point" style={{ background: couleur }} />
      <span>{nom}</span>
      {pastille ? <span className="co-pastille">{pastille}</span> : null}
    </button>
  );
}

/** Le corps d'un écran : la seule zone qui défile. */
export const Corps = ({ plat = false, children }: { plat?: boolean; children: ReactNode }) => (
  <div className={`co-corps${plat ? " plat" : ""}`}>{children}</div>
);
