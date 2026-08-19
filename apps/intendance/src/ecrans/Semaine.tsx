// Écran « La semaine » — T9 du backlog.
//
// LA THÈSE DE L'ÉCRAN : quatorze cases, et la plomberie cachée dessous. Une
// semaine se lit d'un coup d'œil — qui est posé, quelle journée est lourde, où
// il manque quelque chose — et le détail (ce qu'un créneau reçoit, ce qu'il
// laisse) ne s'ouvre qu'au doigt. Tout afficher ferait une page de tuyauterie
// que personne ne lit ; ne rien afficher ferait une grille muette.
//
// Le point sauge est la seule chose qu'on montre TOUJOURS du chaînage : il ne
// dit pas quoi, il dit qu'il y a quelque chose. C'est ce qui donne envie de
// toucher, et c'est tout ce qu'on lui demande.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranSemaine`, `slotCarte`).

import { useMemo, useState } from "react";
import { useCatalogue, useSemaine } from "../db/hooks";
import type { Calcul } from "../model/calcul";
import { SAUTE, type Choix, type Jeu } from "../model/jeu";
import { chemin } from "../nav/routes";
import { Corps } from "../ui/Coquille";
import { duree, fmt } from "../ui/format";
import { Icone } from "../ui/icones";
import {
  chiffresDeLaSemaine,
  prochainVide,
  routinesDeFond,
  vueDeLaSemaine,
  type VueJour,
  type VueSlot,
} from "./semaine.vue";

type Poser = (i: number, plat: Choix) => Promise<void>;

export function Semaine() {
  const { catalogue } = useCatalogue();
  const { jeu, calc, poserPlat } = useSemaine(catalogue);
  if (!jeu || !calc) return null;
  return <Contenu jeu={jeu} calc={calc} poserPlat={poserPlat} />;
}

function Contenu({ jeu, calc, poserPlat }: { jeu: Jeu; calc: Calcul; poserPlat: Poser }) {
  // LE CRÉNEAU OUVERT SE DÉSIGNE PAR (JOUR, REPAS), comme partout ailleurs.
  // C'est de l'état d'affichage — il n'a rien à faire en base, c'est un regard
  // et pas une décision — mais si la fenêtre glisse à minuit pendant que
  // l'écran est ouvert, un index déplierait la carte du voisin.
  const [ouvert, setOuvert] = useState<string | null>(null);

  const jours = useMemo(() => vueDeLaSemaine(jeu, calc), [jeu, calc]);
  const chiffres = useMemo(() => chiffresDeLaSemaine(jeu, calc), [jeu, calc]);
  const vide = prochainVide(jeu);
  const fond = useMemo(() => routinesDeFond(jours), [jours]);
  const duTuyau = jours.some((j) => j.slots.some((s) => s.lie && !s.saute));

  return (
    <Corps plat>
      <a className="co-chiffres" href={chemin({ ecran: "stock" })}>
        <span style={{ flex: 1, display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
          {chiffres.map((c) => (
            <span key={c.cle}>
              <span className="n">{c.valeur}</span> <span className="k">{c.cle}</span>
            </span>
          ))}
        </span>
        <span className="lien">Stock ›</span>
      </a>

      {/* Une légende qui explique un point absent de l'écran est du bruit. */}
      {duTuyau ? (
        <div className="co-legende">
          <span className="pt" />
          <span>plat lié à un autre jour — touchez le créneau pour voir le lien</span>
        </div>
      ) : null}

      {fond.length ? (
        <div className="co-routine" style={{ marginBottom: "var(--space-2)" }}>
          {fond.join(" · ")} tous les jours — routine, non comptée
        </div>
      ) : null}

      {jours.map((j) => (
        <Jour
          key={j.jour}
          jour={j}
          extras={j.routines.filter((r) => !fond.includes(r))}
          ouvert={ouvert}
          ouvrir={setOuvert}
          poserPlat={poserPlat}
        />
      ))}

      {vide ? (
        <a className="btn btn-primary btn-block" href={chemin({ ecran: "poser", creneau: vide })}>
          Poser un plat
        </a>
      ) : null}
    </Corps>
  );
}

function Jour({
  jour,
  extras,
  ouvert,
  ouvrir,
  poserPlat,
}: {
  jour: VueJour;
  /** Ce que CE jour a de plus que les autres — voir `routinesDeFond`. */
  extras: string[];
  ouvert: string | null;
  ouvrir: (id: string | null) => void;
  poserPlat: Poser;
}) {
  return (
    <div className="co-jour">
      <div className="tete">
        <span className="nom">{jour.nom}</span>
        <span className="date">
          {jour.date.getDate()}/{jour.date.getMonth() + 1}
        </span>
        {jour.minutes ? (
          <span className="ctx">
            {duree(jour.minutes)}
            {jour.lourde ? " · journée lourde" : ""}
          </span>
        ) : null}
      </div>
      <div className="co-slots">
        {jour.slots.map((s) => (
          <Slot
            key={s.id}
            slot={s}
            ouvert={ouvert === s.id}
            basculer={() => ouvrir(ouvert === s.id ? null : s.id)}
            poserPlat={poserPlat}
          />
        ))}
      </div>
      {extras.length ? <div className="co-routine">+ {extras.join(" · ")}</div> : null}
    </div>
  );
}

function Slot({
  slot: s,
  ouvert,
  basculer,
  poserPlat,
}: {
  slot: VueSlot;
  ouvert: boolean;
  basculer: () => void;
  poserPlat: Poser;
}) {
  return (
    <div className={`co-slot${s.saute ? " saute" : ""}${ouvert ? " ouvert" : ""}`}>
      <button className="resume" aria-expanded={ouvert} onClick={basculer}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="quand">{s.label}</span>
          {s.emporte ? <Icone nom="gamelle" t={12} /> : null}
          <span style={{ flex: 1 }} />
          {s.lie && !s.saute ? <span className="lien" /> : null}
        </div>
        <div className={`nom${s.plat || s.saute ? "" : " attente"}`}>
          {s.saute ? "on ne mange pas là" : (s.plat?.titre ?? "à poser")}
        </div>
        {s.plat ? (
          <div className="marques">
            {/* Un plat à zéro minute n'est pas gratuit, il est déjà cuisiné :
                c'est une part qu'on réchauffe, et ça se dit. */}
            <span className={`m${s.minutes >= 60 ? " lourd" : ""}`}>
              {s.minutes === 0 ? "à réchauffer" : duree(s.minutes)}
            </span>
            {s.partsRegle ? <span className="m">{fmt(s.parts)} parts</span> : null}
          </div>
        ) : null}
        {s.souci ? <div className="souci">{s.souci}</div> : null}
      </button>

      {ouvert ? (
        <div className="detail">
          {s.recoit.map((x) => (
            <span key={x.type} className="recoit">
              ↩ {x.recit || x.type}
            </span>
          ))}
          {s.donne.map((e, n) => (
            <span key={`${e.type}-${n}`} className="donne">
              ↪ donne {e.type}
              {e.congelo ? " (se congèle)" : e.gardeFrigo ? ` (${e.gardeFrigo} j au frigo)` : ""}
            </span>
          ))}
          <span className="actions">
            {/* Sur un repas sauté, « changer le plat » et « régler les parts »
                n'ont pas de sens : il n'y a rien à régler tant qu'on ne remange
                pas là. Une seule action, et elle rouvre le créneau. */}
            {s.saute ? null : (
              <>
                <a href={chemin({ ecran: "poser", creneau: s.creneau })}>
                  {s.plat ? "changer le plat" : "poser un plat"}
                </a>
                <a href={chemin({ ecran: "parts", creneau: s.creneau })}>régler les parts</a>
              </>
            )}
            {/* « On remange ici » efface le choix sans toucher aux parts : on a
                pu régler « 6 parts » avant de sauter, et retaper le chiffre
                serait une punition. Voir `db/semaine.ts`. */}
            <button onClick={() => void poserPlat(s.i, s.saute ? null : SAUTE)}>
              {s.saute ? "on remange ici" : "sauter"}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
