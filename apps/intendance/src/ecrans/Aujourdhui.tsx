// Écran « Aujourd'hui » — T8 du backlog.
//
// LA THÈSE DE L'ÉCRAN : le jour ordinaire tient en un écran, sans défilement.
// Ce soir, le geste du jour, l'offre en attente, demain. Rien d'autre. Tout le
// reste — la semaine, les offres, la main de cartes, le stock — est à un onglet
// de distance, et c'est le prix assumé de cette direction.
//
// Aucune phrase n'explique ce que les pastilles disent déjà. Si un texte
// paraphrase une étiquette, c'est l'étiquette qui est mauvaise.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranAujourdhui`, `gesteDuJour`).

import { useMemo } from "react";
import { cleDuCreneau, jourISO } from "../db";
import { useCatalogue, useSemaine } from "../db/hooks";
import { cleGeste, cleRappel, poserReglage, useDrapeau } from "../db/reglages";
import { facteurAffiche, type Calcul } from "../model/calcul";
import { heureDe } from "../model/heures";
import { joue, SAUTE, type Jeu } from "../model/jeu";
import { gamelles, offresSurproduction } from "../model/offres";
import { chemin } from "../nav/routes";
import { Corps } from "../ui/Coquille";
import { duree, fmt, hhmm } from "../ui/format";
import { Icone } from "../ui/icones";

export function Aujourdhui() {
  const { catalogue } = useCatalogue();
  const { jeu, calc } = useSemaine(catalogue);
  if (!jeu || !calc) return null;
  return <Contenu jeu={jeu} calc={calc} />;
}

function Contenu({ jeu, calc }: { jeu: Jeu; calc: Calcul }) {
  const jour0 = jeu.jours[0]!;
  const soir = jeu.creneaux.findIndex((c) => c.jour === 0 && c.repas === "diner");
  const geste = useMemo(() => gesteDuJour(jeu, calc), [jeu, calc]);

  const enAttente =
    offresSurproduction(jeu, jeu.choix, calc).length +
    gamelles(jeu, jeu.choix).filter((g) => !g.fait && g.plat).length;

  return (
    <Corps plat>
      {soir >= 0 ? <CeSoir jeu={jeu} calc={calc} i={soir} /> : null}
      {geste ? <Geste jour={jourISO(jour0.date)} geste={geste} /> : null}
      {enAttente > 0 ? (
        <a className="co-appel" href={chemin({ ecran: "prevoir" })}>
          <span style={{ flex: 1 }}>
            {enAttente > 1 ? `${enAttente} offres à répondre` : "1 offre à répondre"}
          </span>
          <span style={{ fontSize: 15 }}>›</span>
        </a>
      ) : null}
      <Demain jeu={jeu} />
    </Corps>
  );
}

/* ───────────────────────────────────────────────────────────────── ce soir */

function CeSoir({ jeu, calc, i }: { jeu: Jeu; calc: Calcul; i: number }) {
  const c = jeu.creneaux[i]!;
  const jour = jeu.jours[c.jour]!;
  const rid = jeu.choix[i];
  const p = joue(rid ?? null) ? jeu.plats[rid as string] : undefined;

  const cle = cleDuCreneau(jeu, i);
  const jourIso = jourISO(jour.date);
  const rappel = useDrapeau(cle ? cleRappel(jourIso, c.repas) : null);

  if (rid === SAUTE)
    return (
      <div className="co-cesoir">
        <div className="co-kicker" style={{ color: "var(--color-accent-800)" }}>
          Ce soir · {jour.nom}
        </div>
        <div className="plat">On ne mange pas là</div>
        <p className="co-note" style={{ color: "var(--color-accent-900)", margin: 0 }}>
          Ni courses, ni minutes, ni apports. Le créneau garde sa place et sa raison.
        </p>
      </div>
    );

  if (!p)
    return (
      <>
        <div className="co-vide">Rien de posé ce soir. « Poser un plat » vous en propose quatre.</div>
        <a
          className="btn btn-primary btn-block"
          href={chemin({ ecran: "poser", creneau: { jour: jourIso, repas: c.repas } })}
          style={{ marginTop: "var(--space-3)" }}
        >
          Poser un plat
        </a>
      </>
    );

  const parts = jeu.parts[i] ?? jeu.catalogue.foyer.parts;
  const f = calc.facteurs[i] ?? facteurAffiche(p, parts);
  const produit = +(p.portions * f).toFixed(1);
  const table = heureDe(c.repas);
  const depart = table - p.minutes;

  // CE QUE LE PLAT LAISSE, mis à l'échelle du créneau — c'est ce qui rend la
  // suite de la semaine lisible depuis ce soir. Les manques s'écrivent au même
  // endroit : une sortie qui n'aura pas lieu appartient à la même liste.
  const sorties = p.emits.map((e) => {
    const q = e.qty?.amount != null ? ` · ${fmt(e.qty.amount * f)} ${e.qty.unit}` : "";
    const ou = e.congelo ? "se congèle" : e.gardeFrigo ? `${e.gardeFrigo} j au frigo` : "";
    return { cle: e.type + q, texte: `${e.type}${q}${ou ? ` — ${ou}` : ""}`, manque: false };
  });
  for (const m of calc.manques.filter((x) => x.i === i))
    sorties.push({
      cle: `manque-${m.acc.type ?? m.acc.kind}`,
      texte: `il manque ${fmt(m.manque)} ${m.unite ?? ""} de ${m.acc.type ?? m.acc.kind}`,
      manque: true,
    });

  return (
    <div className="co-cesoir">
      <div className="co-kicker" style={{ color: "var(--color-accent-800)" }}>
        Ce soir · {jour.nom} · à table {hhmm(table)}
      </div>
      <div className="plat">{p.titre}</div>

      <div className="co-pilules" style={{ flexDirection: "column", alignItems: "flex-start" }}>
        <span className="co-pilule">
          <Icone nom="parts" />
          {fmt(parts)} parts
          {/* On ne dit « 6 cuisinées » que quand ça DIFFÈRE des parts demandées.
              Répéter le même chiffre deux fois apprend à ne plus le lire. */}
          {produit > parts + 0.05 ? ` · ${fmt(produit)} cuisinées` : ""}
        </span>
        <span className="co-pilule">
          <Icone nom="horloge" />
          {duree(p.minutes)} · commencer à {hhmm(depart)}
        </span>
        {p.vaisselle ? (
          <span className="co-pilule">
            <Icone nom="placard" />
            {p.vaisselle.label}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: "var(--space-2)" }}>
        {sorties.map((s) => (
          <div key={s.cle} className={`co-sortie${s.manque ? " manque" : ""}`}>
            {s.texte}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <a
          className="btn btn-primary"
          style={{ flex: 1 }}
          href={chemin({ ecran: "cuisiner", creneau: { jour: jourIso, repas: c.repas } })}
        >
          En cuisine
        </a>
        <button
          className="btn btn-secondary"
          style={{
            borderColor: "var(--color-accent)",
            ...(rappel ? { background: "var(--color-accent-2-200)" } : {}),
          }}
          onClick={() => void poserReglage(cleRappel(jourIso, c.repas), !rappel)}
        >
          {rappel ? `Rappel ${hhmm(depart - 10)} ✓` : "Rappel"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── le geste du jour */

interface GesteDuJour {
  type: string;
  quand: string;
  titre: string;
}

/**
 * LE GESTE DU SOIR, dérivé du chaînage. Un plat de demain qui prend dans le
 * congélo demande une décision ce soir : sortir le lot, sinon il sera pris en
 * bloc à 19 h. Le canevas de design l'écrivait en dur ; c'est en réalité une
 * lecture du dépôt, et c'est ce qui la rend juste tous les jours.
 */
function gesteDuJour(jeu: Jeu, calc: Calcul): GesteDuJour | null {
  for (const [i, c] of jeu.creneaux.entries()) {
    if (c.jour !== 1) continue;
    const rid = jeu.choix[i];
    if (!joue(rid ?? null)) continue;
    const ch = calc.chaine.find((x) => x.creneau === i);
    if (!ch) continue;
    const lot = calc.depot.lignes.find((l) => l.type === ch.type && l.espace === "congelo");
    if (!lot) continue;
    return { type: ch.type, quand: `${c.label} de demain`, titre: jeu.plats[rid as string]?.titre ?? "" };
  }
  return null;
}

function Geste({ jour, geste }: { jour: string; geste: GesteDuJour }) {
  const cle = cleGeste(jour, geste.type);
  const fait = useDrapeau(cle);
  return (
    <div className="co-geste">
      <span className="rond" />
      <div style={{ flex: 1 }}>
        <div className="t">Sortir {geste.type} du congélo</div>
        <div className="d">
          Pour {geste.titre} — {geste.quand}
        </div>
      </div>
      <button className={fait ? "fait" : ""} onClick={() => void poserReglage(cle, !fait)}>
        {fait ? "Fait ✓" : "Fait"}
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── demain */

function Demain({ jeu }: { jeu: Jeu }) {
  const demain = jeu.creneaux
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.jour === 1 && c.nature === "choisi");

  return (
    <>
      <div className="co-kicker" style={{ margin: "var(--space-3) 0 var(--space-1)" }}>
        Demain
      </div>
      <div className="co-vide" style={{ color: "var(--color-text)" }}>
        {demain.map((c) => {
          const rid = jeu.choix[c.i];
          const texte =
            rid === SAUTE ? "on ne mange pas là" : joue(rid ?? null) ? jeu.plats[rid as string]?.titre : "à poser";
          const pose = joue(rid ?? null);
          return (
            <div key={c.i}>
              {c.label} : {pose ? texte : <em>{texte}</em>}
            </div>
          );
        })}
      </div>
    </>
  );
}
