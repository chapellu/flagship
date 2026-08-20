// Écran « Poser un plat » — T11 du backlog.
//
// L'ÉCRAN CENTRAL DE LA DIRECTION. Tout le reste de l'app existe pour que ce
// choix-là soit informé : le cadran dit ce que la semaine coûte à cet instant,
// chaque carte dit ce qu'elle y ajoute, et les deux se lisent sans quitter
// l'écran. C'est la promesse « Le comptoir » — décider avec le prix sous les
// yeux, plutôt que de le découvrir aux courses.
//
// LA MAIN EST UNE MAIN, pas une liste. Quatre cartes tirées avec une garantie
// de variété — une express, une souche, une dérivée — parce qu'un classement
// par score servirait cinq fois la même famille de plats. Elle est déterministe
// en (créneau, repioches) : elle ne bouge pas sous le doigt, et le bouton
// « Repiocher » est la seule chose qui la change.
//
// Port de `apps/proto-shell/comptoir.js` (`ecranPoser`, `carteJouable`).

import { useMemo } from "react";
import { indexDuCreneau } from "../db";
import { useCatalogue, useSemaine } from "../db/hooks";
import { cleRepioche, poserReglage, useNombre } from "../db/reglages";
import type { Calcul } from "../model/calcul";
import { SAUTE, type Jeu } from "../model/jeu";
import { main, type Carte } from "../model/scoring";
import { chemin, type CleCreneau } from "../nav/routes";
import { aller } from "../nav/useRoute";
import { Corps } from "../ui/Coquille";
import { duree, fmt } from "../ui/format";
import { Icone } from "../ui/icones";
import { classeEtat, entreesDeLaCarte, sortiesDeLaCarte } from "./poser.vue";
import { chiffresDeLaSemaine } from "./semaine.vue";

export function Poser({ creneau }: { creneau: CleCreneau }) {
  const { catalogue } = useCatalogue();
  const { jeu, calc, poserPlat } = useSemaine(catalogue);
  const repioches = useNombre(cleRepioche(creneau.jour, creneau.repas));

  if (!jeu || !calc || repioches === undefined) return null;
  const i = indexDuCreneau(jeu, creneau.jour, creneau.repas);
  if (i < 0) return null;

  return (
    <Contenu
      jeu={jeu}
      calc={calc}
      i={i}
      creneau={creneau}
      repioches={repioches}
      poserPlat={poserPlat}
    />
  );
}

function Contenu({
  jeu,
  calc,
  i,
  creneau,
  repioches,
  poserPlat,
}: {
  jeu: Jeu;
  calc: Calcul;
  i: number;
  creneau: CleCreneau;
  repioches: number;
  poserPlat: (i: number, plat: string | null) => Promise<void>;
}) {
  const c = jeu.creneaux[i]!;
  const jour = jeu.jours[c.jour]!;
  const saute = jeu.choix[i] === SAUTE;

  const chiffres = useMemo(() => chiffresDeLaSemaine(jeu, calc), [jeu, calc]);

  // LE CALCUL LE PLUS CHER DE L'APP : `main` rejoue `calculer` pour chacun des
  // 51 plats candidats, parce que le coût marginal d'une carte ne se lit nulle
  // part ailleurs. D'où la mémoïsation stricte, et d'où T17. `jeu.slot` est
  // muté ici parce que c'est là que le modèle le lit ; le `jeu` appartient à ce
  // hook et à personne d'autre.
  const cartes = useMemo(() => {
    if (saute) return [];
    jeu.slot = i;
    jeu.repioches[i] = repioches;
    return main(jeu);
  }, [jeu, i, repioches, saute]);

  const jouer = (id: string) => {
    void poserPlat(i, id).then(() => aller({ ecran: "semaine" }));
  };

  return (
    <>
      <div className="co-cadran">
        {chiffres.map((x) =>
          x.vers ? (
            <a key={x.cle} href={chemin(x.vers)}>
              <span className="k">
                <span className="co-kicker">{x.cle}</span>
                <span style={{ color: "var(--color-accent-700)", fontWeight: 700 }}>›</span>
              </span>
              <span className="v">{x.valeur}</span>
            </a>
          ) : (
            <div key={x.cle}>
              <span className="co-kicker">{x.cle}</span>
              <div className="v">{x.valeur}</div>
            </div>
          ),
        )}
      </div>

      <Corps>
        <div className="co-note" style={{ marginBottom: "var(--space-2)" }}>
          {jour.nom} {c.label}
          {c.emporte ? " · doit voyager" : ""} — les trois chiffres du haut bougent à mesure que
          vous posez.
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          <a className="btn btn-secondary" href={chemin({ ecran: "parts", creneau })}>
            {fmt(jeu.parts[i] ?? jeu.catalogue.foyer.parts)} parts
          </a>
          <button
            className="btn btn-secondary"
            onClick={() => void poserPlat(i, saute ? null : SAUTE)}
          >
            {saute ? "On remange ici" : "Sauter ce repas"}
          </button>
          {/* Repiocher sur un repas sauté ne tirerait rien : le bouton
              disparaît plutôt que de ne rien faire. */}
          {saute ? null : (
            <button
              className="btn btn-ghost"
              onClick={() =>
                void poserReglage(cleRepioche(creneau.jour, creneau.repas), repioches + 1)
              }
            >
              Repiocher ⟳
            </button>
          )}
        </div>

        {saute ? (
          <div className="co-vide">Repas sauté — rien à cuisiner, rien à acheter.</div>
        ) : cartes.length ? (
          cartes.map((carte) => (
            <Jouable key={carte.plat.id} carte={carte} creneau={creneau} jouer={jouer} />
          ))
        ) : (
          <div className="co-vide">Plus de cartes pour ce créneau.</div>
        )}
      </Corps>
    </>
  );
}

function Jouable({
  carte,
  creneau,
  jouer,
}: {
  carte: Carte;
  creneau: CleCreneau;
  jouer: (id: string) => void;
}) {
  const p = carte.plat;
  const entrees = entreesDeLaCarte(carte);
  const sorties = sortiesDeLaCarte(p);

  return (
    <div className="co-jouable">
      <div className="tete">
        <span className="nom">{p.titre}</span>
        <span className="meta">
          <span>{duree(carte.minutes)}</span>
          <span>+{carte.marginal} art.</span>
        </span>
      </div>

      <div className="co-flux">
        <div className="co-kicker">Consomme</div>
        {entrees.map((e) => (
          <div key={e.texte} className="l">
            <span className={`co-etat ${classeEtat(e.etat)}`}>{e.etat}</span>
            <span style={{ flex: 1 }}>{e.texte}</span>
          </div>
        ))}
      </div>

      {/* UNE SEULE RAISON, la première. Le scoring en produit plusieurs ; les
          empiler transformerait un argument en plaidoirie, et on cesse de
          croire un plat qui se défend trop. */}
      {carte.pourquoi[0] ? <div className="co-action">{carte.pourquoi[0]}</div> : null}

      <div className="co-flux">
        <div className="co-kicker">Produit</div>
        {sorties.length ? (
          sorties.map((s) => (
            <div key={s.texte} className="l">
              <Icone nom={s.icone} />
              <span style={{ flex: 1 }}>{s.texte}</span>
            </div>
          ))
        ) : (
          <div className="l" style={{ color: "var(--color-neutral-700)" }}>
            Rien — tout est mangé le soir même.
          </div>
        )}
      </div>

      <div className="pied">
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => jouer(p.id)}>
          Poser sur ce créneau
        </button>
        {/* LA FICHE DU CANDIDAT, pas celle du créneau : on lit la recette
            avant de choisir, et le créneau porte peut-être encore autre chose. */}
        <a className="btn btn-ghost" href={chemin({ ecran: "cuisiner", creneau, plat: p.id })}>
          Fiche
        </a>
      </div>
    </div>
  );
}
