import "./styles/organic.css";

// L'app — le shell multi-facettes (Workspace#36), habillé par la direction
// « Le comptoir » du canevas Claude Design.
//
// À ce stade (T2), l'app rend la planche de référence du système de design :
// les rampes, la type, les primitives. Ce n'est pas un écran de l'app, c'est
// l'écran qui permet de juger le système sur un vrai téléphone avant d'y
// construire quoi que ce soit — les rayons, les contrastes et la lourdeur du
// Caprasimo ne se jugent pas sur une capture.
//
// La coquille (barre du bas, sous-nav, routeur) arrive en T7 ; les écrans, un
// par un, de T8 à T16.

const RAMPES = ["neutral", "accent", "accent-2"] as const;
const PALIERS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export function App() {
  return (
    <div className="coquille">
      <div className="co-tete">
        <div>
          <div className="titre">Organic</div>
          <div className="sous">le système de design, sur l'écran qui le jugera</div>
        </div>
      </div>

      <div className="co-corps">
        <section>
          <div className="co-kicker accent">Type</div>
          <h1 style={{ fontSize: 42 }}>Le comptoir</h1>
          <h3>Gratin de courgettes et riz</h3>
          <p>
            Caprasimo pour les titres, Figtree pour le texte. Les deux sont
            auto-hébergées : une cuisine n'a pas toujours de réseau.
          </p>
          <p className="text-muted">
            Texte secondaire — 55 % d'encre, jamais un gris froid.
          </p>
        </section>

        <section style={{ marginTop: "var(--space-6)" }}>
          <div className="co-kicker accent">Couleur</div>
          {RAMPES.map((r) => (
            <div key={r} style={{ marginTop: "var(--space-2)" }}>
              <div className="co-note">{r}</div>
              <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                {PALIERS.map((p) => (
                  <div
                    key={p}
                    title={`--color-${r}-${p}`}
                    style={{
                      flex: 1,
                      height: 34,
                      borderRadius: 6,
                      background: `var(--color-${r}-${p})`,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section style={{ marginTop: "var(--space-6)" }}>
          <div className="co-kicker accent">Actions</div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-2)",
              marginTop: "var(--space-2)",
            }}
          >
            <button className="btn btn-primary">Poser un plat</button>
            <button className="btn btn-secondary">Plus tard</button>
            <button className="btn btn-ghost">Fiche</button>
            <button className="btn btn-primary" disabled>
              Indisponible
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-1)",
              marginTop: "var(--space-3)",
            }}
          >
            <span className="tag">55 min</span>
            <span className="tag tag-accent">il en manque</span>
            <span className="tag tag-accent-2">déjà cuisiné</span>
          </div>
        </section>

        <section style={{ marginTop: "var(--space-6)" }}>
          <div className="co-kicker accent">Surfaces</div>
          <div className="card elev-sm" style={{ marginTop: "var(--space-2)" }}>
            <div className="co-kicker">Ce soir · mardi</div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 27, lineHeight: 1.1 }}>
              Dahl de lentilles corail
            </div>
            <div className="co-pilules">
              <span className="co-pilule">4,5 parts</span>
              <span className="co-pilule">35 min</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
