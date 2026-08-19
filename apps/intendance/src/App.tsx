import { useEffect, useState } from "react";
import { base, jourISO } from "./db";
import { useCatalogue, useSemaine } from "./db/hooks";
import { amorcer } from "./db/stock";
import { articles } from "./model/calcul";
import { main } from "./model/scoring";
import { SAUTE } from "./model/jeu";
import "./styles/organic.css";

// L'app — le shell multi-facettes (Workspace#36), habillé par la direction
// « Le comptoir » du canevas Claude Design.
//
// À ce stade (T6), l'app rend une SONDE : la semaine posée, lue et écrite dans
// Dexie. Ce n'est pas un écran de la direction, c'est la preuve que l'état
// survit — la seule qui vaille étant faite avec le pouce, sur un téléphone,
// en rechargeant la page. La coquille et le routeur arrivent en T7, les
// écrans de T8 à T16, et cette sonde disparaîtra avec T9.

export function App() {
  const { catalogue, erreur } = useCatalogue();
  const { jeu, calc, chargement, poserPlat, oublierCreneau } = useSemaine(catalogue);
  const [occupe, setOccupe] = useState<number | null>(null);

  // Le stock du catalogue n'entre en base qu'une fois : à partir de là c'est le
  // foyer qui fait foi. Voir `amorcer`.
  useEffect(() => {
    if (catalogue) void amorcer(base, catalogue);
  }, [catalogue]);

  if (erreur)
    return (
      <div className="coquille">
        <div className="co-corps plat">
          <div className="co-h">Le catalogue n'est pas lisible</div>
          <p className="co-note">{erreur.message}</p>
        </div>
      </div>
    );

  if (chargement || !jeu || !calc)
    return (
      <div className="coquille">
        <div className="co-corps plat">
          <div className="co-note">chargement…</div>
        </div>
      </div>
    );

  const poserLaMeilleure = async (i: number) => {
    setOccupe(i);
    try {
      jeu.slot = i;
      const cartes = main(jeu, 1);
      await poserPlat(i, cartes[0]?.plat.id ?? SAUTE);
    } finally {
      setOccupe(null);
    }
  };

  const arts = articles(calc.panier);

  return (
    <div className="coquille">
      <div className="co-tete">
        <div>
          <div className="titre">La semaine</div>
          <div className="sous">
            {arts.length} article{arts.length > 1 ? "s" : ""} · sonde de persistance (T6)
          </div>
        </div>
      </div>

      <div className="co-corps plat">
        <div className="co-aide">
          Posez un plat, <b>rechargez la page</b> : il est toujours là. Une décision est
          rangée sous son jour, jamais sous son index — rouvrez l'app demain et elle
          sera toujours sur le bon repas.
        </div>

        {jeu.jours.map((j, ij) => {
          const slots = jeu.creneaux
            .map((c, i) => ({ ...c, i }))
            .filter((c) => c.jour === ij && c.nature === "choisi");
          return (
            <div className="co-jour" key={jourISO(j.date)}>
              <div className="tete">
                <span className="nom">{j.nom}</span>
                <span className="date">{jourISO(j.date)}</span>
              </div>
              <div className="co-slots">
                {slots.map((c) => {
                  const rid = jeu.choix[c.i];
                  const plat = rid && rid !== SAUTE ? jeu.plats[rid] : null;
                  return (
                    <button
                      key={c.i}
                      className="co-slot"
                      disabled={occupe !== null}
                      onClick={() => void (rid ? oublierCreneau(c.i) : poserLaMeilleure(c.i))}
                    >
                      <span className="quand">{c.label}</span>
                      <div className={`nom ${plat || rid ? "" : "attente"}`}>
                        {occupe === c.i
                          ? "on cherche…"
                          : rid === SAUTE
                            ? "on ne mange pas là"
                            : (plat?.titre ?? "toucher pour poser")}
                      </div>
                      {plat ? (
                        <div className="marques">
                          <span className="m">{plat.minutes} min</span>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
