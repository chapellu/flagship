// Écran « À prévoir » — T10 du backlog.
//
// LA THÈSE DE L'ÉCRAN : des offres, jamais des reproches. Le modèle sait
// beaucoup de choses désagréables sur une semaine — ce qui manque, ce qui
// coûte, ce qu'on aurait pu faire mieux. Cet écran n'en dit qu'une catégorie :
// celles où il existe un geste qui améliore la situation, et il le propose
// tout fait. Un manque sans geste n'a rien à faire ici ; il est déjà écrit sur
// la case du créneau qui le réclame.
//
// Ce qui s'enchaîne tout seul ne se demande pas : ça se constate, et ça se
// constate EN BAS. Le proto le mettait en premier ; une pastille qui annonce
// « 1 offre à répondre » ne doit pas ouvrir sur trois cartes réglées.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranPrevoir`).

import { useMemo } from "react";
import { useCatalogue, useSemaine } from "../db/hooks";
import type { Calcul } from "../model/calcul";
import type { Jeu } from "../model/jeu";
import type { Gamelle, Offre } from "../model/offres";
import { Corps } from "../ui/Coquille";
import { fmt, virgules } from "../ui/format";
import { Icone } from "../ui/icones";
import {
  constatDeLaGamelle,
  partsDeLaGamelle,
  partsPourLOffre,
  vueAPrevoir,
  type GamelleOuverte,
} from "./prevoir.vue";

export function Prevoir() {
  const { catalogue } = useCatalogue();
  const { jeu, calc, reglerLesParts, prevoirLaGamelle } = useSemaine(catalogue);
  if (!jeu || !calc) return null;
  return (
    <Contenu
      jeu={jeu}
      calc={calc}
      agrandir={(o) => void reglerLesParts(o.creneau, partsPourLOffre(jeu, o))}
      enchainer={(g) =>
        void prevoirLaGamelle(g.i, g.veille, partsDeLaGamelle(g), "reste-de-la-veille")
      }
    />
  );
}

function Contenu({
  jeu,
  calc,
  agrandir,
  enchainer,
}: {
  jeu: Jeu;
  calc: Calcul;
  agrandir: (o: Offre) => void;
  enchainer: (g: Gamelle) => void;
}) {
  const vue = useMemo(() => vueAPrevoir(jeu, calc), [jeu, calc]);

  return (
    <Corps plat>
      <div className="co-note" style={{ marginBottom: "var(--space-3)" }}>
        Ce qui s’enchaîne tout seul est déjà posé&nbsp;: on ne vous le demande pas. Ne
        restent ici que les manques qu’aucun plat prévu ne couvre — des offres, jamais
        des reproches.
      </div>

      {vue.ouvertes.map((o) => (
        <CarteGamelle key={o.g.i} ouverte={o} enchainer={enchainer} />
      ))}

      {vue.offres.map((o) => (
        <CarteOffre key={`${o.creneau}-${o.type}`} offre={o} agrandir={agrandir} />
      ))}

      {vue.enAttente === 0 ? (
        <div className="co-vide">Rien en attente. La semaine se tient.</div>
      ) : null}

      {/* LE CONSTAT EN DERNIER, et son titre dit une fois ce que le proto
          répétait sur chaque carte. */}
      {vue.faites.length ? (
        <>
          <div
            className="co-kicker"
            style={{ color: "var(--color-accent-2-800)", margin: "var(--space-4) 0 var(--space-2)" }}
          >
            Déjà enchaîné · rien à faire
          </div>
          {vue.faites.map((g) => {
            const c = constatDeLaGamelle(g);
            return (
              <div key={g.i} className="co-offre faite">
                <div className="p">
                  La gamelle de {g.jour} midi se prélève sur le plat de <b>{g.plat?.titre}</b> du{" "}
                  {g.jourVeille} soir : <b>{fmt(c.cuisinees)} parts</b> cuisinées, dont{" "}
                  {fmt(c.pourLeMidi)} pour le midi.
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </Corps>
  );
}

function CarteGamelle({
  ouverte: { g, freins },
  enchainer,
}: {
  ouverte: GamelleOuverte;
  enchainer: (g: Gamelle) => void;
}) {
  return (
    <div className="co-offre">
      <div className="p">
        <Icone nom="gamelle" t={15} /> {g.jour} midi part en gamelle. Cuisiner le <b>{g.plat?.titre}</b> de {g.jourVeille}{" "}
        soir pour <b>{fmt(g.total)} parts</b> — {fmt(g.partsVeille)} + {fmt(g.partsGamelle)} — et{" "}
        {g.jour} midi est prêt.
      </div>
      {freins.map((f) => (
        <div key={f} className="r">
          {f}
        </div>
      ))}
      {/* Pas de bouton quand le plat ne peut pas voyager : proposer un geste
          qu'on sait mauvais est pire que ne rien proposer. La phrase reste,
          parce qu'elle explique pourquoi ce midi n'est pas réglé tout seul. */}
      {g.actionnable ? (
        <div className="btns">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => enchainer(g)}>
            Prévoir la gamelle
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CarteOffre({ offre: o, agrandir }: { offre: Offre; agrandir: (o: Offre) => void }) {
  return (
    <div className="co-offre">
      <div className="p">
        <b>{o.titre}</b> — {virgules(o.combien)}.
      </div>
      <div className="p">
        {virgules(o.deQuoi)} · {o.pour.map(([j]) => j).join(" et ")} ne coûte plus rien
        {o.gainMin ? ` · ${o.gainMin} min gagnées` : ""}.
      </div>
      {o.reserves().map((r) => (
        <div key={r} className="r">
          {virgules(r)}
        </div>
      ))}
      <div className="btns">
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => agrandir(o)}>
          Agrandir le lot
        </button>
      </div>
    </div>
  );
}
