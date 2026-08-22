// Écran « Les parts » — T14 du backlog.
//
// LA THÈSE DE L'ÉCRAN : un seul chiffre, deux cibles énormes, et tout ce que
// ce chiffre déclenche écrit autour. Les parts d'un créneau commandent le
// panier, les restes et le chaînage ; c'est le réglage le plus conséquent de
// l'app, et c'est aussi celui qu'on fait d'une main en tenant un enfant de
// l'autre. D'où les deux ronds de 64 px et le pas de 0,5 — la part d'un petit.
//
// C'EST LE MÊME LEVIER QUE « À PRÉVOIR » ACTIONNE. Agrandir un lot, prévoir
// une gamelle et pousser ce bouton écrivent tous les trois des parts sur un
// créneau. Rien de ce que l'app propose ailleurs ne se fait par un chemin qui
// ne se relise pas ici.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranParts`).

import { useEffect, useMemo, useState } from "react";
import { indexDuCreneau } from "../db";
import { useCatalogue, useSemaine } from "../db/hooks";
import type { Calcul } from "../model/calcul";
import { SAUTE, type Jeu } from "../model/jeu";
import { chemin, type CleCreneau } from "../nav/routes";
import { aller } from "../nav/useRoute";
import { Corps } from "../ui/Coquille";
import { fmt } from "../ui/format";
import { Icone } from "../ui/icones";
import {
  apercuDeLaSemaine,
  bouger,
  crans,
  cuisson,
  noteDesParts,
  partsAEcrire,
  PAS,
  MINIMUM,
  type LigneApercu,
} from "./parts.vue";

export function Parts({ creneau }: { creneau: CleCreneau }) {
  const { catalogue } = useCatalogue();
  const { jeu, calc, reglerLesParts } = useSemaine(catalogue);
  if (!jeu || !calc) return null;

  const i = indexDuCreneau(jeu, creneau.jour, creneau.repas);
  // Le créneau hors semaine est déjà dit par `App` : arriver ici avec `-1`
  // voudrait dire que les deux ne lisent pas la même semaine.
  if (i < 0) return null;

  return (
    <Contenu
      // LE SOUHAIT LOCAL APPARTIENT À UN CRÉNEAU. Sans cette clé, passer d'un
      // créneau à l'autre par l'aperçu garderait le nombre du précédent sous
      // le pouce le temps que la base réponde.
      key={`${creneau.jour}|${creneau.repas}`}
      jeu={jeu}
      calc={calc}
      i={i}
      creneau={creneau}
      ecrire={(v) => void reglerLesParts(i, v)}
    />
  );
}

/** « Retour » rend la main à ce qui a ouvert l'écran : depuis « Poser » on
 *  revient aux cartes, depuis « La semaine » à la grille. Sans histoire —
 *  l'URL ouverte directement — on retombe sur la semaine, qui est l'endroit
 *  d'où l'on règle des parts. */
function retour() {
  if (window.history.length > 1) window.history.back();
  else aller({ ecran: "semaine" });
}

function Contenu({
  jeu,
  calc,
  i,
  creneau,
  ecrire,
}: {
  jeu: Jeu;
  calc: Calcul;
  i: number;
  creneau: CleCreneau;
  ecrire: (parts: number | null) => void;
}) {
  const c = jeu.creneaux[i]!;
  const jour = jeu.jours[c.jour]!;
  const foyer = jeu.catalogue.foyer.parts;
  const enBase = jeu.parts[i] ?? foyer;
  const saute = jeu.choix[i] === SAUTE;
  const plat = jeu.plats[jeu.choix[i] ?? ""] ?? null;

  // LE NOMBRE BOUGE SOUS LE POUCE, la base suit. C'est le seul écran où ça se
  // justifie : deux cibles de 64 px sont faites pour être tapées vite, et un
  // aller-retour IndexedDB entre chaque tap ferait deux dégâts — le chiffre
  // traîne d'un battement, et deux taps rapprochés partent du même état donc
  // le second se perd. On garde donc le souhait ici, et on l'oublie dès que la
  // base l'a rattrapé : une écriture venue d'ailleurs (un autre onglet, une
  // gamelle prévue) reprend la main aussitôt.
  const [souhait, setSouhait] = useState<number | null>(null);
  const parts = souhait ?? enBase;
  useEffect(() => {
    if (souhait !== null && Math.abs(souhait - enBase) < 0.01) setSouhait(null);
  }, [souhait, enBase]);

  const changer = (pas: number) => {
    const v = bouger(parts, pas);
    if (v === parts) return;
    setSouhait(v);
    ecrire(partsAEcrire(v, foyer));
  };

  const regle = useMemo(() => crans(parts, foyer), [parts, foyer]);
  const cuit = plat ? cuisson(plat, parts) : null;
  const apercu = useMemo(() => apercuDeLaSemaine(jeu, calc, i), [jeu, calc, i]);
  const duSaute = apercu.some((l) => l.saute);

  return (
    <Corps plat>
      <button className="co-retour" onClick={retour}>
        ‹ Retour
      </button>

      <div className="co-tete" style={{ padding: 0, margin: "var(--space-2) 0 var(--space-3)" }}>
        <div>
          <div className="titre" style={{ textTransform: "capitalize" }}>
            {jour.nom} {c.label}
          </div>
          <div className="sous">{plat ? plat.titre : saute ? "repas sauté" : "aucun plat posé"}</div>
        </div>
      </div>

      {/* Régler les parts d'un repas sauté ne veut rien dire : le modèle ne
          compte ni ses courses ni ses minutes. On le dit, plutôt que d'offrir
          deux boutons qui ne changeraient rien au calcul. */}
      {saute ? (
        <>
          <div className="co-vide">
            Ce repas est sauté&nbsp;: il ne coûte rien et ne produit rien, donc il n’a pas de
            parts. C’est en remangeant ici qu’elles reviennent.
          </div>
          {/* Nommer le geste sans l'offrir ferait de cet écran un cul-de-sac :
              « on remange ici » vit sur « Poser », à un tap. */}
          <a
            className="btn btn-secondary btn-block"
            href={chemin({ ecran: "poser", creneau })}
            style={{ marginTop: "var(--space-3)" }}
          >
            Remanger ici
          </a>
        </>
      ) : (
        <>
          <div className="co-parts">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span className="co-kicker">Parts du créneau</span>
              <span style={{ fontSize: "11.5px", color: "var(--color-neutral-700)" }}>
                foyer&nbsp;: {fmt(foyer)}
              </span>
            </div>

            <div className="ligne">
              {/* À 0,5, le « – » se DÉSACTIVE au lieu de ne rien faire. Le proto
                  bornait en silence : on tapait un rond de 64 px et l'écran
                  restait immobile, ce qui se lit comme une panne. */}
              <button
                className="rond"
                aria-label="moins de parts"
                disabled={parts <= MINIMUM}
                onClick={() => changer(-PAS)}
              >
                –
              </button>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div className="n">{fmt(parts)}</div>
                <div className="co-note">{noteDesParts(parts, foyer)}</div>
              </div>
              <button className="rond plus" aria-label="plus de parts" onClick={() => changer(PAS)}>
                +
              </button>
            </div>

            <div className="co-crans" aria-hidden>
              {regle.map((cr) => (
                <i key={cr.v} className={cr.ici ? "ici" : cr.foyer ? "foyer" : ""} />
              ))}
            </div>

            <div className="co-note" style={{ textAlign: "center", marginTop: "var(--space-2)" }}>
              {parts <= MINIMUM
                ? "En dessous, personne ne mange — et ça se dit en sautant le repas."
                : "Pas de 0,5 — la part d’un petit. Pouce sur le bouton, l’autre main tient le petit."}
            </div>
          </div>

          {cuit ? (
            <div className="co-duo">
              <div className="lot">
                <span className="co-kicker" style={{ color: "var(--color-accent-800)" }}>
                  Cuisiné
                </span>
                <div className="v">{fmt(cuit.produit)} parts</div>
                {/* Sans cette phrase, descendre le nombre sans voir « cuisiné »
                    bouger passe pour un écran cassé. */}
                {cuit.pourquoi ? <div className="t">{cuit.pourquoi}</div> : null}
              </div>
              <div>
                <span className="co-kicker">Réserve</span>
                <div className="t">{cuit.reserve}</div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {apercu.length > 1 ? (
        <>
          <div className="co-kicker" style={{ margin: "var(--space-4) 0 var(--space-2)" }}>
            La semaine, ce qui est décidé
          </div>
          {apercu.map((l) => (
            <Ligne key={l.creneau.jour + l.creneau.repas} ligne={l} />
          ))}
        </>
      ) : null}

      {duSaute ? (
        <div className="co-encart">
          <Icone nom="info" t={15} />
          <span>
            Un créneau <b>sauté</b> n’est pas vide&nbsp;: ni courses, ni minutes, ni apports. Il
            garde sa place et sa raison.
          </span>
        </div>
      ) : null}
    </Corps>
  );
}

/** Une ligne de l'aperçu. C'est un LIEN vers les parts de ce créneau — régler
 *  la semaine, c'est régler plusieurs créneaux d'affilée, et repasser par la
 *  grille entre chacun ferait deux taps de trop à chaque fois. La ligne
 *  courante, elle, ne mène nulle part : elle est déjà là. */
function Ligne({ ligne: l }: { ligne: LigneApercu }) {
  const dedans = (
    <>
      <span className="quand">{l.quand}</span>
      <span style={{ flex: 1 }}>
        <div className="plat">{l.quoi}</div>
        {l.souci ? <div className="note souci">{l.souci}</div> : null}
        {l.partsRegle && !l.saute ? <div className="note">{fmt(l.parts)} parts</div> : null}
      </span>
      {l.saute ? <span className="tag">sauté</span> : null}
    </>
  );
  const classe = `co-apercu${l.saute ? " saute" : ""}`;

  if (l.ici)
    return (
      <div className={`${classe} ici`} aria-current="true">
        {dedans}
      </div>
    );
  return (
    <a className={classe} href={chemin({ ecran: "parts", creneau: l.creneau })}>
      {dedans}
    </a>
  );
}
