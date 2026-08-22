// Écran « Le cockpit » — T16 du backlog.
//
// La journée d'abord, les cartes de facette ensuite. C'est l'écran d'ouverture
// de l'app (voir `ROUTE_DEFAUT`) : ce qu'on voit en la lançant n'est pas une
// facette, c'est la journée — la promesse du shell multi-facettes de
// Workspace#36. Une app qui s'ouvrirait sur la cuisine ferait de la cuisine la
// seule chose qui compte, et le jour où le jardin existera, il faudrait la
// rouvrir ailleurs.
//
// Tout ce que l'écran DIT vit dans `cockpit.vue.ts` ; ce fichier ne fait que
// le dessiner, et brancher les deux lectures de base qui manquent au modèle :
// l'état des courses, et le geste du jour coché.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranCockpit`).

import { jourISO } from "../db";
import { useCatalogue, useCourses, useSemaine } from "../db/hooks";
import { cleGeste, useDrapeau } from "../db/reglages";
import type { Calcul } from "../model/calcul";
import type { Jeu } from "../model/jeu";
import { chemin } from "../nav/routes";
import { Corps } from "../ui/Coquille";
import { majuscule } from "../ui/format";
import { gesteDuJour } from "./aujourdhui.vue";
import { vueDuCockpit, type CarteFacette, type Tache, type VueCockpit } from "./cockpit.vue";

/**
 * La vue du cockpit, montée sur la base.
 *
 * `null` tant que la base n'a pas répondu — et c'est ce que `App` attend pour
 * la pastille de la barre du bas. Un compte provisoire à zéro, remplacé une
 * fraction de seconde plus tard par un trois, se lit comme un bug : mieux vaut
 * une pastille qui apparaît qu'une pastille qui se corrige.
 */
export function useCockpit(jeu: Jeu, calc: Calcul): VueCockpit | null {
  const courses = useCourses();
  const geste = gesteDuJour(jeu, calc);
  const jour0 = jeu.jours[0];
  // La clé porte le jour : « sortir la sauce du congélo » est fait pour
  // aujourd'hui, pas pour toujours. `null` quand il n'y a pas de geste — le
  // hook doit s'appeler à tous les rendus, même ceux où il n'a rien à lire.
  const fait = useDrapeau(geste && jour0 ? cleGeste(jourISO(jour0.date), geste.type) : null);
  if (!courses || fait === undefined) return null;
  return vueDuCockpit(jeu, calc, { courses, gesteFait: fait });
}

export function Cockpit() {
  const { catalogue } = useCatalogue();
  const { jeu, calc } = useSemaine(catalogue);
  if (!jeu || !calc) return null;
  return <Contenu jeu={jeu} calc={calc} />;
}

function Contenu({ jeu, calc }: { jeu: Jeu; calc: Calcul }) {
  const vue = useCockpit(jeu, calc);
  const jour0 = jeu.jours[0]!;

  return (
    <Corps plat>
      <div className="co-h">
        {majuscule(jour0.nom)} {jour0.date.getDate()}{" "}
        {jour0.date.toLocaleDateString("fr-FR", { month: "long" })}
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-700)", margin: "var(--space-1) 0 0" }}>
        {/* Rien tant que la base n'a pas répondu : « Rien ne vous attend
            aujourd'hui » suivi d'une liste de trois lignes est un mensonge
            court, mais c'en est un. */}
        {vue ? vue.entree : "…"}
      </p>

      <div style={{ margin: "var(--space-4) 0 var(--space-6)" }}>
        {vue?.taches.map((t) => (
          <Ligne key={t.cle} tache={t} />
        ))}
      </div>

      <div className="co-kicker" style={{ marginBottom: "var(--space-2)" }}>
        Vos facettes
      </div>

      <Facette nom="Cuisine" classe="cuisine" href={chemin({ ecran: "aujourdhui" })} carte={vue?.cuisine} />

      {/* Le jardin garde sa carte et n'annonce aucun chiffre : voir
          `cockpit.vue.ts`. Une facette qui existe sans modèle le dit — c'est
          plus honnête que trois quêtes de décor, et ça se voit tout autant. */}
      <Facette
        nom="Jardin"
        classe="jardin"
        href={chemin({ ecran: "jardin" })}
        carte={{
          etat: "sans modèle",
          resume:
            "La facette est ouverte, son modèle n'est pas écrit. Elle n'annoncera rien tant qu'elle n'aura pas de quoi le dire.",
          chiffres: [],
        }}
      />

      <div className="co-facette dort">
        <span className="tete">
          <span className="nom">Maison</span>
          <span className="etat">en sommeil</span>
        </span>
        <span className="resume">
          Facette pas encore ouverte. Elle reste ici, sans chiffre, jusqu'au jour où elle servira.
        </span>
      </div>

      <div className="co-note" style={{ marginTop: "var(--space-4)" }}>
        La barre du bas suit partout : elle appartient à la coquille, pas à la facette.
      </div>
    </Corps>
  );
}

/** Une chose qui vous attend. C'est une ANCRE : une tâche qui ne s'ouvre pas
 *  est une plainte, et le pouce n'a pas à chercher l'onglet correspondant. */
function Ligne({ tache }: { tache: Tache }) {
  return (
    <a className="co-tache" href={chemin(tache.route)} style={{ textDecoration: "none", color: "inherit" }}>
      <span className={`p${tache.facette === "Jardin" ? " jardin" : ""}`}>{tache.facette}</span>
      <span style={{ flex: 1 }}>
        <span className="t" style={{ display: "block" }}>
          {tache.titre}
        </span>
        <span className="d" style={{ display: "block" }}>
          {tache.detail}
        </span>
      </span>
      <span style={{ fontSize: 15, color: "var(--color-neutral-700)" }}>›</span>
    </a>
  );
}

function Facette({
  nom,
  classe,
  href,
  carte,
}: {
  nom: string;
  classe: string;
  href: string;
  carte: CarteFacette | undefined;
}) {
  return (
    <a className={`co-facette ${classe}`} href={href} style={{ textDecoration: "none" }}>
      <span className="tete">
        <span className="nom">{nom}</span>
        <span className="etat">{carte?.etat ?? ""}</span>
      </span>
      <span className="resume">{carte?.resume ?? ""}</span>
      {carte?.chiffres.length ? (
        <span className="chiffres">
          {carte.chiffres.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </span>
      ) : null}
    </a>
  );
}
