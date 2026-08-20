// PROTOTYPE — trois variantes structurellement différentes du shell,
// commutables par ?variant= (barre flottante, flèches clavier).
import { foyer, cellules, quetes, stock, dinerCeSoir, journal, enTete } from "./data.js";

const app = document.getElementById("app");
const VARIANTES = [
  { cle: "A", nom: "Facettes", rendre: rendreA },
  { cle: "B", nom: "Terrasse", rendre: rendreB },
  { cle: "C", nom: "Journal", rendre: rendreC },
];

// État en mémoire uniquement (règle du prototype : pas de persistance).
const etat = { ongletA: "jardin", celluleB: null, filtreC: "tout" };

/* ---------------- variante A — shell à onglets ---------------- */
function rendreA() {
  const { date, saison } = enTete();
  const t = etat.ongletA;
  let corps = "";
  if (t === "jardin") {
    corps = `
      <section>
        <h2>Cette semaine</h2><br>
        ${quetes.map(q => `
          <div class="carte">
            <span class="titre">${q.titre}</span>
            <span class="chip ${q.fenetre}">${q.fenetre === "nudge" ? "nudge" : q.fenetre === "bientot" ? "bientôt" : "fenêtre ouverte"}</span>
            <div class="muted">${q.detail}</div>
          </div>`).join("")}
      </section>
      <section>
        <h2>La terrasse</h2><br>
        ${cellules.map(c => `
          <div class="carte">
            <span class="titre">${c.nom}</span> <span class="chip ${c.statut}">${c.statut}</span>
            <div>${c.contenu}</div>
            <div class="muted">${c.note}</div>
          </div>`).join("")}
      </section>`;
  } else if (t === "cuisine") {
    // Le constructeur de semaine est monté ici, dans l'onglet gagnant (variante
    // A). Il tire ses plats de cuisine-data.json, exporté du vrai catalogue
    // Python — rien n'est inventé côté écran.
    corps = `<div id="sem-hote"><div class="muted" style="padding:16px">chargement…</div></div>`;
  } else {
    corps = `
      <section>
        <h2>Le foyer</h2><br>
        <div class="carte"><span class="titre">${foyer.lieu}</span><div class="muted">${foyer.mangeurs}</div></div>
        <div class="carte"><span class="titre">Équipement cuisine</span><div class="muted">${foyer.equipement.join(" · ")}</div></div>
        <div id="foyer-cuisine"></div>
        <div class="carte"><span class="titre">Facettes installées</span>
          ${foyer.facettes.map(f => `<div>${f.emoji} ${f.nom} <span class="muted">(${f.version})</span></div>`).join("")}
          <div class="muted">Sorties découplées — le shell ne connaît que la navigation.</div>
        </div>
      </section>`;
  }
  app.innerHTML = `
    <div class="va">
      <header class="va-header">
        <h1>${t === "jardin" ? "🌱 Jardin" : t === "cuisine" ? "🍲 Cuisine" : "⚙️ Foyer"}</h1>
        <div class="saison">${date} — ${saison}</div>
      </header>
      ${corps}
      <div class="va-tabs">
        ${["jardin", "cuisine", "foyer"].map(x => `
          <button data-onglet="${x}" class="${t === x ? "actif" : ""}">
            <span class="ico">${x === "jardin" ? "🌱" : x === "cuisine" ? "🍲" : "⚙️"}</span>${x}
          </button>`).join("")}
      </div>
    </div>`;
  app.querySelectorAll("[data-onglet]").forEach(b =>
    b.addEventListener("click", () => { etat.ongletA = b.dataset.onglet; rendreA(); }));
  // Ce que la cuisine peut TENIR — récipients et contenants — vient du même
  // export que les plats, jamais d'une liste écrite à la main ici.
  const fc = app.querySelector("#foyer-cuisine");
  if (fc) import("./semaine-vue.js").then(m => m.encartCuisine(fc)).catch(() => {});

  const hote = app.querySelector("#sem-hote");
  if (hote) {
    // Le message d'erreur est affiché : sans navigateur sur la VM, c'est la
    // seule façon de diagnostiquer depuis un téléphone.
    import("./semaine-vue.js")
      .then(m => m.monter(hote, rendreA))
      .catch(e => { hote.innerHTML =
        `<div class="carte" style="margin:14px"><span class="titre">Erreur de chargement</span>
         <div class="muted">${e}</div></div>`; });
  }
}

/* ---------------- variante B — plan spatial de la terrasse ---------------- */
function rendreB() {
  const flag = stock.find(s => s.flag);
  const c = etat.celluleB;
  app.innerHTML = `
    <div class="vb">
      ${flag ? `<div class="vb-banner">🍲 <b>${flag.nom}</b> récolté — « vu, disponible » côté cuisine</div>` : ""}
      <div class="vb-map">
        <span class="vb-chip">La terrasse — Francheville</span>
        <div class="vb-soleil">☀️ ouest<br>3-4 h vers midi</div>
        ${cellules.map(x => `
          <button class="vb-cell ${x.type} ${x.statut === "alerte" ? "alerte" : ""}"
            style="left:${x.x}%;top:${x.y}%;width:${x.w}%;height:${x.h}%"
            data-cellule="${x.id}">
            <b>${x.nom}</b><span class="muted">${x.contenu}</span>
          </button>`).join("")}
      </div>
      ${c ? `
      <div class="vb-sheet">
        <div class="poignee"></div>
        <h2>${c.nom} — ${c.contenu}</h2>
        <div class="muted">${c.note}</div>
        <div class="muted" style="margin-top:8px">Spectre du substrat — terreau → sol vivant</div>
        <div class="sol-bar"><div style="width:${c.sol * 100}%"></div></div>
        ${c.derniereObs ? `<div class="muted">Dernière observation : ${c.derniereObs}</div>` : ""}
        <div class="vb-actions">
          <button>📓 Observer</button>
          <button>🧺 Récolter</button>
          <button>🌱 Que planter ensuite ?</button>
        </div>
      </div>` : ""}
    </div>`;
  app.querySelectorAll("[data-cellule]").forEach(b =>
    b.addEventListener("click", () => {
      const cell = cellules.find(x => x.id === b.dataset.cellule);
      etat.celluleB = etat.celluleB === cell ? null : cell;
      rendreB();
    }));
  const map = app.querySelector(".vb-map");
  map.addEventListener("click", e => { if (e.target === map) { etat.celluleB = null; rendreB(); } });
}

/* ---------------- variante C — journal unifié ---------------- */
function rendreC() {
  const { date, saison } = enTete();
  const f = etat.filtreC;
  const items = journal.filter(j => f === "tout" || j.facette === f);
  app.innerHTML = `
    <div class="vc">
      <div class="vc-header">
        <h1>${date}</h1>
        <div class="muted">${saison}</div>
        <div class="vc-filtres">
          ${["tout", "jardin", "cuisine"].map(x => `
            <button data-filtre="${x}" class="${f === x ? "actif" : ""}">${x[0].toUpperCase() + x.slice(1)}</button>`).join("")}
        </div>
      </div>
      <div class="vc-flux">
        ${items.map((j, i) => `
          <div class="vc-item" data-facette="${j.facette}">
            <div class="vc-rail"><div class="vc-dot"></div>${i < items.length - 1 ? '<div class="vc-trait"></div>' : ""}</div>
            <div class="vc-corps">
              <div class="quand">${j.quand} · ${j.facette}</div>
              <b>${j.titre}</b>
              <div class="muted">${j.detail}</div>
              ${j.lien ? '<span class="vc-lien">🍲 repris par « ce soir »</span>' : ""}
            </div>
          </div>`).join("")}
      </div>
      <div class="vc-saisie">＋ Consigner une observation, une récolte…</div>
    </div>`;
  app.querySelectorAll("[data-filtre]").forEach(b =>
    b.addEventListener("click", () => { etat.filtreC = b.dataset.filtre; rendreC(); }));
}

/* ---------------- commutateur ---------------- */
function varianteCourante() {
  const cle = new URLSearchParams(location.search).get("variant") || "A";
  return VARIANTES.find(v => v.cle === cle.toUpperCase()) || VARIANTES[0];
}
function aller(delta) {
  const i = VARIANTES.indexOf(varianteCourante());
  const v = VARIANTES[(i + delta + VARIANTES.length) % VARIANTES.length];
  const u = new URL(location);
  u.searchParams.set("variant", v.cle);
  history.replaceState(null, "", u);
  rendre();
}
function rendre() {
  const v = varianteCourante();
  // Le CSS a besoin de connaître la variante : seule A a une barre d'onglets
  // fixe sous laquelle le commutateur ne doit pas se poser.
  document.body.dataset.variant = v.cle;
  document.getElementById("sw-label").textContent = `${v.cle} — ${v.nom}`;
  v.rendre();
}
document.getElementById("sw-prev").addEventListener("click", () => aller(-1));
document.getElementById("sw-next").addEventListener("click", () => aller(1));
document.addEventListener("keydown", e => {
  if (e.target.matches("input, textarea, [contenteditable]")) return;
  // Déroulé ouvert : les flèches lui appartiennent. Changer de variante du shell
  // sous les doigts de quelqu'un qui cuisine serait la pire des surprises.
  if (document.body.dataset.deroule) return;
  if (e.key === "ArrowLeft") aller(-1);
  if (e.key === "ArrowRight") aller(1);
});
rendre();
