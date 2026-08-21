// Écran « Courses » — T13 du backlog.
//
// DEUX GESTES, DEUX LIEUX. Au magasin on COCHE : l'article est dans le caddie.
// À la maison on RENTRE : il est rangé. Les confondre, c'est ce que faisait le
// proto au début, et la liste s'effaçait sous le doigt au milieu d'un rayon.
// Les deux états vivent donc côte à côte sur le même article, et le mode dit
// lequel le doigt touche.
//
// C'EST LE PREMIER ÉCRAN QUI VIT VRAIMENT SUR LA PERSISTANCE. Une liste de
// courses qu'on ouvre au magasin, qu'on met en poche entre deux rayons et qui
// se vide au retour n'est pas une liste : c'est une farce. Rien ici n'est
// gardé en mémoire.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranCourses`).

import { useMemo, useState } from "react";
import { base, cocher, rentrer, rentrerLesCoches, viderCourses } from "../db";
import { useCatalogue, useCourses, useSemaine } from "../db/hooks";
import type { Calcul } from "../model/calcul";
import type { Jeu } from "../model/jeu";
import { Corps } from "../ui/Coquille";
import { fmt } from "../ui/format";
import {
  basculeDe,
  horsListe,
  marque,
  vueDesCourses,
  type Article,
  type Mode,
} from "./courses.vue";

export function Courses() {
  const { catalogue } = useCatalogue();
  const { jeu, calc } = useSemaine(catalogue);
  const etats = useCourses();
  if (!jeu || !calc || !etats) return null;
  return <Contenu jeu={jeu} calc={calc} etats={etats} />;
}

function Contenu({
  jeu,
  calc,
  etats,
}: {
  jeu: Jeu;
  calc: Calcul;
  etats: NonNullable<ReturnType<typeof useCourses>>;
}) {
  // LE MODE N'EST PAS PERSISTÉ, et c'est délibéré : c'est un endroit où l'on
  // se trouve, pas une décision. Rouvrir l'app trois jours plus tard sur « à
  // la maison » parce qu'on y était samedi serait pire que le tap qu'on
  // économise.
  const [mode, setMode] = useState<Mode>("magasin");
  const vue = useMemo(
    () => vueDesCourses(jeu.catalogue, calc.panier, etats),
    [jeu.catalogue, calc.panier, etats],
  );
  const hors = useMemo(
    () => horsListe(jeu.catalogue, calc.provenances),
    [jeu.catalogue, calc.provenances],
  );

  const magasin = mode === "magasin";
  const n = magasin ? vue.coches : vue.rentres;

  const toucher = (a: Article) => {
    const b = basculeDe(mode, a);
    void (b.rentrer ? rentrer(base, a.cle, b.valeur) : cocher(base, a.cle, b.valeur));
  };

  return (
    <>
      <div className="co-tete" style={{ paddingTop: 0 }}>
        <div className="co-kicker">
          {n} sur {vue.articles.length} {magasin ? "dans le caddie" : "rentrés"}
        </div>
        <div className="co-seg">
          <button className={magasin ? "on" : ""} onClick={() => setMode("magasin")}>
            Au magasin
          </button>
          <button className={magasin ? "" : "on"} onClick={() => setMode("maison")}>
            À la maison
          </button>
        </div>
      </div>

      <Corps>
        <div className="co-aide">
          {magasin
            ? "Au magasin, on coche : l’article est dans le caddie. Rien ne bouge d’autre tant qu’on n’est pas rentré."
            : "À la maison, on rentre : l’article est rangé, et il quitte le caddie."}
        </div>

        {/* LE GESTE DE VIDER LE SAC. On ne rentre pas douze articles un par un
            en tenant un cabas ; c'est le seul endroit de l'app où une action
            groupée est plus honnête qu'une par une. */}
        {!magasin && vue.coches > 0 ? (
          <button
            className="btn btn-primary btn-block"
            style={{ marginBottom: "var(--space-3)" }}
            onClick={() => void rentrerLesCoches(base)}
          >
            Tout rentrer — {vue.coches} article{vue.coches > 1 ? "s" : ""} du caddie
          </button>
        ) : null}

        {vue.articles.length === 0 ? (
          <div className="co-vide">
            Rien à acheter. La semaine posée tient avec ce qu’il y a déjà.
          </div>
        ) : null}

        {vue.rayons.map((r) => (
          <div key={r.nom} style={{ marginBottom: "var(--space-3)" }}>
            <div className="co-kicker" style={{ marginBottom: "var(--space-1)" }}>
              {r.nom}
            </div>
            {r.articles.map((a) => (
              <button
                key={a.cle}
                className={`co-art${marque(mode, a) ? (magasin ? " coche" : " rentre") : ""}`}
                onClick={() => toucher(a)}
              >
                <span className="puce">{marque(mode, a) ? (magasin ? "✓" : "↓") : ""}</span>
                <span style={{ flex: 1 }}>
                  <span className="nom">{a.ligne.nom}</span>
                  {/* « 3 plats » dit pourquoi la quantité est ce qu'elle est,
                      et c'est ce qui empêche de croire à une erreur. */}
                  <div className="pour">
                    {a.ligne.n > 1 ? `${a.ligne.n} plats` : "1 plat"}
                    {/* Au magasin, ce qui est déjà rentré n'a rien à faire dans
                        le caddie : on le dit plutôt que de le cacher. */}
                    {magasin && a.rentre ? " · déjà rentré" : ""}
                  </div>
                </span>
                <span className="q">
                  {fmt(a.ligne.qty)} {a.ligne.unit}
                </span>
              </button>
            ))}
          </div>
        ))}

        {calc.aVerifier.size ? (
          <div className="co-vide" style={{ marginBottom: "var(--space-3)" }}>
            <b>À vérifier au placard</b>
            <br />
            {[...calc.aVerifier.values()].join(" · ")}
          </div>
        ) : null}

        {hors.length ? (
          <div className="co-offre">
            <div className="co-kicker accent">Hors liste</div>
            <div className="co-note" style={{ marginTop: 2 }}>
              Ce que la semaine demande et qu’on n’achète pas.
            </div>
            <div className="chips">
              {hors.map(([lab, k]) => (
                <span key={lab} className="tag tag-accent">
                  {lab} : {k}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* LES ORPHELINS. La liste est recalculée à partir de la semaine ; les
            états, eux, survivent. Changer la semaine peut donc laisser derrière
            des articles cochés qui ne sont plus demandés. On les compte au lieu
            de les effacer tout seul : effacer ce que quelqu'un a coché est un
            geste qui lui appartient. */}
        {vue.orphelins > 0 || vue.coches + vue.rentres > 0 ? (
          <div className="co-note" style={{ marginTop: "var(--space-4)" }}>
            {/* Une seule marque de pluriel : « coché ou rentré » se dirait en
                quatre accords, et personne ne lit une phrase qui se
                contorsionne pour être exacte. */}
            {vue.orphelins > 0
              ? `La semaine a changé : ${vue.orphelins} article${
                  vue.orphelins > 1 ? "s gardent" : " garde"
                } une marque sans être demandé${vue.orphelins > 1 ? "s" : ""}. `
              : ""}
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12.5, padding: "2px 8px" }}
              onClick={() => void viderCourses(base)}
            >
              Repartir de zéro
            </button>
          </div>
        ) : null}
      </Corps>
    </>
  );
}
