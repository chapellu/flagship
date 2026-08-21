// Écran « En cuisine » — T12 du backlog.
//
// LE SEUL ÉCRAN QUI SORT DE LA COQUILLE. Pas de barre du bas, pas de
// sous-navigation : on le lit à bout de bras, avec les mains sales, et tout ce
// qui n'est pas l'étape en cours est du bruit. Une étape par écran, en gros.
//
// CE QUI SE PERSISTE ICI EST DIFFÉRENT DU RESTE DE L'APP. Ailleurs on range des
// décisions ; ici on range un AVANCEMENT — où l'on en est dans la recette, et
// jusqu'à quand le minuteur court. C'est le seul état dont la perte fasse
// vraiment mal : un téléphone qui se verrouille à l'étape 5 sur 9 avec une
// casserole sur le feu. Le reste (la liste d'ingrédients dépliée) est un regard,
// et reste en mémoire.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranCuisine`).

import { useEffect, useState } from "react";
import { indexDuCreneau } from "../db";
import { useCatalogue, useSemaine } from "../db/hooks";
import { cleEtape, cleMinuteur, poserReglage, useNombre, useObjet } from "../db/reglages";
import { echelleTexte, facteurAffiche, type Calcul } from "../model/calcul";
import { joue, type Jeu } from "../model/jeu";
import { heureDe } from "../model/heures";
import type { Etape, Plat } from "../model/types";
import type { CleCreneau } from "../nav/routes";
import { aller } from "../nav/useRoute";
import { duree, fmt, hhmm, mmss } from "../ui/format";
import { Icone } from "../ui/icones";
import {
  avancement,
  basculerMinuteur,
  chauffeDe,
  minuteur,
  provenanceIngredient,
  type EtatMinuteur,
} from "./cuisiner.vue";

export function Cuisiner({ creneau, plat }: { creneau: CleCreneau; plat?: string }) {
  const { catalogue } = useCatalogue();
  const { jeu, calc } = useSemaine(catalogue);
  if (!jeu || !calc) return null;

  const i = indexDuCreneau(jeu, creneau.jour, creneau.repas);
  // Sans plat dans l'URL, c'est celui du créneau ; avec, c'est le candidat
  // qu'on est venu lire depuis « Poser ».
  const rid = plat ?? (i >= 0 ? jeu.choix[i] : null);
  const p = joue(rid ?? null) ? jeu.plats[rid as string] : undefined;
  if (!p) return <Introuvable />;

  return <Fiche jeu={jeu} calc={calc} i={i} creneau={creneau} p={p} />;
}

const Introuvable = () => (
  <div className="co-corps plat">
    <div className="co-vide">Ce plat n’existe pas — ou plus.</div>
  </div>
);

/** « Sortir » rend la main à ce qu'on faisait avant, quel que soit l'écran qui
 *  a ouvert la fiche : depuis « Poser » on revient choisir, depuis
 *  « Aujourd'hui » on revient à la journée. Sans histoire — la fiche ouverte
 *  directement par son URL — on retombe sur la journée. */
function sortir() {
  if (window.history.length > 1) window.history.back();
  else aller({ ecran: "aujourdhui" });
}

function Fiche({
  jeu,
  calc,
  i,
  creneau,
  p,
}: {
  jeu: Jeu;
  calc: Calcul;
  i: number;
  creneau: CleCreneau;
  p: Plat;
}) {
  const [ingr, setIngr] = useState(false);
  const cle = cleEtape(creneau.jour, creneau.repas, p.id);
  const range = useNombre(cle);

  if (range === undefined) return null;
  const steps = p.steps;
  const etape = Math.min(range, Math.max(0, steps.length - 1));

  const parts = (i >= 0 ? jeu.parts[i] : undefined) ?? jeu.catalogue.foyer.parts;
  const f = (i >= 0 ? calc.facteurs[i] : undefined) || facteurAffiche(p, parts);

  const tete = (
    <>
      <div className="co-fiche-tete">
        <button className="co-retour" onClick={sortir}>
          ‹ Sortir
        </button>
        <span className="t">{p.titre}</span>
        <button
          className={`btn ${ingr ? "btn-primary" : "btn-secondary"}`}
          style={{ fontSize: 12.5, padding: "7px 13px" }}
          onClick={() => setIngr(!ingr)}
        >
          Ingrédients
        </button>
      </div>
      <div className="co-segments">
        {steps.map((s, n) => (
          <i key={s.id} className={n < etape ? "faite" : n === etape ? "ici" : ""} />
        ))}
      </div>
    </>
  );

  // Un plat sans étapes n'a pas de mode guidé — il n'a qu'une liste. La fiche
  // s'ouvre alors dessus, plutôt que sur un écran vide.
  if (ingr || !steps.length)
    return (
      <>
        {tete}
        <Ingredients p={p} parts={parts} f={f} catalogue={jeu.catalogue} />
        {steps.length ? (
          <div style={{ padding: "0 var(--space-4) var(--space-4)" }}>
            <button className="btn btn-secondary btn-block" onClick={() => setIngr(false)}>
              Revenir à l’étape {etape + 1}
            </button>
          </div>
        ) : null}
      </>
    );

  return (
    <>
      {tete}
      <Guide
        p={p}
        steps={steps}
        etape={etape}
        repas={creneau.repas}
        cle={cle}
        cleM={cleMinuteur(creneau.jour, creneau.repas, p.id, steps[etape]!.id)}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────── les ingrédients */

function Ingredients({
  p,
  parts,
  f,
  catalogue,
}: {
  p: Plat;
  parts: number;
  f: number;
  catalogue: Jeu["catalogue"];
}) {
  const produit = +(p.portions * f).toFixed(1);
  return (
    <div className="co-corps">
      <div className="co-encart">
        <Icone nom="info" />
        <span>
          <b>
            Pour {fmt(parts)} parts · on en cuisine {fmt(produit)}.
          </b>{" "}
          {produit > parts + 0.05
            ? p.lotEntier
              ? "Le lot ne se coupe pas."
              : "Ça se garde, autant faire le lot."
            : ""}
        </span>
      </div>
      <div className="co-ing">
        {p.ingredients.map((x) => {
          const prov = provenanceIngredient(catalogue, x);
          return (
            <div key={x.id} className="l">
              <span className="nom">{x.nom}</span>
              <span className="q">{echelleTexte(x, f)}</span>
              <span className={`p ${prov.acheter ? "acheter" : ""}`}>{prov.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── le guide */

function Guide({
  p,
  steps,
  etape,
  repas,
  cle,
  cleM,
}: {
  p: Plat;
  steps: Etape[];
  etape: number;
  repas: string;
  cle: string;
  cleM: string;
}) {
  const e = steps[etape]!;
  const etat = useObjet<EtatMinuteur>(cleM);
  const maintenant = useHorloge(!!etat && etat !== null && "fin" in etat);

  const { reste, total } = avancement(steps, etape);
  const chauffe = chauffeDe(e);
  const m = minuteur(etat ?? null, e.minutes, maintenant);
  const dernier = etape === steps.length - 1;

  const bouger = (d: number) => {
    if (d > 0 && dernier) {
      // Terminer efface l'avancement : la prochaine fois qu'on ouvrira cette
      // fiche, ce sera pour la refaire depuis le début.
      void poserReglage(cle, null);
      sortir();
      return;
    }
    void poserReglage(cle, Math.max(0, Math.min(steps.length - 1, etape + d)));
  };

  return (
    <div className="co-etape">
      <div className="bandeau">
        <span>À table {hhmm(heureDe(repas))}</span>
        <em>
          reste {duree(reste)} sur {duree(total)}
        </em>
      </div>
      <div className="co-kicker accent">
        Étape {etape + 1} sur {steps.length}
      </div>
      <div className="geste">{e.action}</div>
      <div className="texte">
        {/* « Sans surveiller » est la seule chose qui sépare une journée de
            90 minutes tenable d'une autre qui ne l'est pas. */}
        {e.surveille ? "" : "Sans surveiller. "}
        {e.minutes ? `${e.minutes} min.` : ""}
      </div>

      {e.enfant ? (
        <div className="co-encart enfant">
          <Icone nom="enfant" />
          <span>
            <span className="co-kicker" style={{ color: "inherit" }}>
              Avec l’enfant{e.enfantDes ? ` · dès ${e.enfantDes} mois` : ""}
            </span>
            <br />
            {e.enfant}
          </span>
        </div>
      ) : null}

      {e.porteAssaisonnement && p.bebe ? (
        <div className="co-encart">
          <Icone nom="info" />
          <span>
            Prélever la portion bébé <b>avant</b> d’assaisonner — {p.bebe}
          </span>
        </div>
      ) : null}

      <div style={{ flex: 1 }} />

      {chauffe.niveau > 0 || e.minutes > 0 ? (
        <div className="co-reglages">
          {chauffe.niveau > 0 ? (
            <div>
              <span className="co-kicker">Chauffe</span>
              <div className="chauffe-nom">{chauffe.nom}</div>
              <div className="barres">
                {[1, 2, 3, 4].map((n) => (
                  <i key={n} className={n <= chauffe.niveau ? "on" : ""} />
                ))}
              </div>
            </div>
          ) : null}
          {e.minutes > 0 ? (
            <button
              className={`co-minuteur${m.actif ? " actif" : ""}`}
              onClick={() =>
                void poserReglage(cleM, basculerMinuteur(etat ?? null, e.minutes, Date.now()))
              }
            >
              <span
                className="k"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span className="co-kicker">Minuteur</span>
                <span
                  style={{
                    color: m.actif ? "var(--color-accent-800)" : "var(--color-neutral-600)",
                    display: "flex",
                  }}
                >
                  <Icone nom="minuteur" />
                </span>
              </span>
              <div className="n">{mmss(m.reste)}</div>
              <div className="aide">
                {m.actif
                  ? "en cours"
                  : m.sonne
                    ? "terminé · toucher pour relancer"
                    : m.reste < e.minutes * 60
                      ? "en pause · toucher pour reprendre"
                      : "toucher pour lancer"}
              </div>
            </button>
          ) : null}
        </div>
      ) : null}

      {m.sonne ? (
        <div className="co-encart enfant" style={{ marginTop: "var(--space-2)" }}>
          <Icone nom="cloche" />
          <span>
            <b>Minuteur terminé.</b>
          </span>
        </div>
      ) : null}

      <div className="co-pas">
        <button className="prec" onClick={() => bouger(-1)} disabled={etape === 0}>
          ‹
        </button>
        <button className="suiv" onClick={() => bouger(1)}>
          {dernier ? "Terminer" : "C’est fait"}
        </button>
      </div>
    </div>
  );
}

/** Une horloge qui ne bat QUE pendant qu'un minuteur court. Un `setInterval`
 *  permanent ferait redessiner l'écran toute la nuit pour rien. */
function useHorloge(actif: boolean): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return;
    const h = setInterval(() => setT(Date.now()), 250);
    return () => clearInterval(h);
  }, [actif]);
  return actif ? t : Date.now();
}
