// Terrain — outil de recherche de terrain à deux.
//
// Ce fichier est public et générique : il ne connaît ni les lieux ni les
// personnes. Tout vient de /data/ (servi depuis le serveur, derrière la
// connexion Google) :
//   config.json   lieux (work, famA, famB, home, city), libellés, prénoms
//   communes.json { c: [[…champs de config.fields…]], g: gares }
//   grid.json     grille régulière : minutes de voiture sans trafic vers
//                 work/famA/famB, et altitude (m)
//   parcels.json  parcelles repérées et terrains mixtes
//   ads.json      annonces relevées
//   notes.json    textes d'analyse (HTML)
"use strict";
const $ = (id) => document.getElementById(id);
const DATA = "data/";
const clip = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
const fmtk = (v) => (v == null ? "–" : Math.round(v / 1000) + " k€");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- état
const WKEYS = ["climat", "work", "famille", "train", "ecole", "eau", "prix", "risques", "offre"];
const DEF_W = { climat: 10, work: 20, famille: 15, train: 5, ecole: 15, eau: 5, prix: 15, risques: 15, offre: 0 };
const DEF = {
  profile: "A",
  profiles: { A: { w: { ...DEF_W }, famshare: 80 }, B: { w: { ...DEF_W }, famshare: 80 } },
  days: 4,
  iso: { work: 55, famA: 40, famB: 75, alt: 350, rush: 1.4 },
  f: { fibre: true, ecole: true, zone: false, prix: 200 },
  show: { parcels: true, topads: true, ads: false, creches: false, cadastre: false, outside: false },
  workAt: "qg", // "qg" : le lieu de travail de config.json ; "creche" : la crèche la plus proche de chez soi
};
const STORE = "terrain.state.v1";
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.profiles) return deepMerge(structuredClone(DEF), s);
  } catch (e) { /* stockage indisponible : on part des défauts */ }
  return structuredClone(DEF);
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* idem */ } }
function deepMerge(a, b) {
  for (const k in b) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}

let CFG, C, GARES, GRID, PARCELS, ADS, NOTES;
let CRECHE = null, SCHOOLS = null, MARKET = null; // facultatifs : l'app marche sans
let LBL;

// ---------------------------------------------------------------- chargement
// no-cache : le navigateur revalide (304 si inchangé), donc le relevé du matin apparaît tout de suite
const need = (n) => fetch(DATA + n + ".json", { cache: "no-cache" }).then((r) => {
  if (!r.ok) throw new Error(n + " : " + r.status);
  return r.json();
});
const maybe = (n) => fetch(DATA + n + ".json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
Promise.all([...["config", "communes", "grid", "parcels", "ads", "notes"].map(need), maybe("creches"), maybe("schools"), maybe("market")])
.then(([cfg, com, grid, parcels, ads, notes, creches, schools, market]) => {
  CFG = cfg; GRID = grid; PARCELS = parcels; ADS = ads; NOTES = notes; GARES = com.g;
  CRECHE = creches; SCHOOLS = schools; MARKET = market;
  C = com.c.map((r) => Object.fromEntries(cfg.fields.map((f, i) => [f, r[i]])));
  init();
}).catch((e) => {
  document.querySelector("main").innerHTML = `<p class="prose">Les données n'ont pas pu être chargées (${esc(e.message)}). Elles sont servies depuis le serveur, pas depuis le dépôt.</p>`;
});

function place(k) { return CFG.places[k] || { name: k, short: k }; }
// Option « travail en crèche » : le trajet devient celui vers la crèche la plus proche (creches.json).
const crecheMode = () => S.workAt === "creche" && !!CRECHE;
function workShort() { return crecheMode() ? "Crèche proche" : place("work").short; }
function person(p) { return p === "A" ? CFG.people[0] : p === "B" ? CFG.people[1] : "Compromis"; }

function init() {
  document.title = CFG.title || "Terrain";
  $("title").textContent = CFG.title || "Terrain";
  $("eyebrow").textContent = CFG.budget || "Recherche de terrain";
  document.querySelectorAll("[data-place]").forEach((el) => (el.textContent = place(el.dataset.place).short || place(el.dataset.place).name));
  LBL = {
    climat: "Fraîcheur (altitude)", work: "Trajet → travail", famille: "Près de la famille",
    train: `Train → ${place("city").name}`, ecole: "Écoles", eau: "Eau, sources", prix: "Prix du terrain",
    risques: "Peu de risques", offre: "Grands terrains vendus",
  };
  buildAdList();
  buildControls();
  buildMap();
  buildTabs();
  buildParcels();
  buildAds();
  buildNotes();
  readShared();
  render();
}

// ---------------------------------------------------------------- réglages
function seg(el, items, get, set) {
  el.innerHTML = items.map(([v, l]) => `<button type="button" role="radio" data-v="${v}">${esc(l)}</button>`).join("");
  const sync = () => el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === String(get()))));
  el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; set(b.dataset.v); sync(); });
  sync();
  return sync;
}
let syncProfile, syncWork = () => {};
function buildControls() {
  syncProfile = seg($("profiles"), [["A", CFG.people[0]], ["B", CFG.people[1]], ["mix", "Compromis"]], () => S.profile, (v) => { S.profile = v; syncWeights(); render(); });
  seg($("days"), [["2", "2 j"], ["3", "3 j"], ["4", "4 j"]], () => S.days, (v) => { S.days = +v; render(); });
  if (CRECHE) {
    syncWork = seg($("workat"), [["qg", place("work").short], ["creche", "Crèche près de chez nous"]], () => S.workAt, (v) => {
      S.workAt = v;
      if (v === "creche") { map.addLayer(layers.creches); S.show.creches = true; syncToggles(); }
      render();
    });
  } else $("workat-box").hidden = true;

  $("weights").innerHTML = WKEYS.map((k) => `<div class="w"><label for="w-${k}">${esc(LBL[k])}</label><input type="range" id="w-${k}" min="0" max="40" step="5"><output for="w-${k}"></output></div>`).join("");
  WKEYS.forEach((k) => $("w-" + k).addEventListener("input", (e) => { prof().w[k] = +e.target.value; render(); }));
  $("famshare").addEventListener("input", (e) => { prof().famshare = +e.target.value; render(); });

  for (const k of ["work", "famA", "famB", "alt", "rush"]) {
    $("i-" + k).value = S.iso[k];
    $("i-" + k).addEventListener("input", (e) => { S.iso[k] = +e.target.value; render(); });
  }
  for (const k of ["fibre", "ecole", "zone"]) {
    $("f-" + k).checked = S.f[k];
    $("f-" + k).addEventListener("change", (e) => { S.f[k] = e.target.checked; render(); });
  }
  $("f-prix").value = S.f.prix;
  $("f-prix").addEventListener("input", (e) => { S.f.prix = +e.target.value; render(); });

  $("reset").addEventListener("click", () => {
    const keep = S.profile;
    S = structuredClone(DEF); S.profile = keep === "mix" ? "A" : keep;
    for (const k of ["work", "famA", "famB", "alt", "rush"]) $("i-" + k).value = S.iso[k];
    for (const k of ["fibre", "ecole", "zone"]) $("f-" + k).checked = S.f[k];
    $("f-prix").value = S.f.prix;
    syncProfile(); syncWeights(); render();
  });
  $("share").addEventListener("click", share);
  syncWeights();
}
// En mode compromis, les poids affichés sont la moyenne des deux et ne se règlent pas.
function prof() { return S.profile === "mix" ? null : S.profiles[S.profile]; }
function effW(p) {
  if (p !== "mix") return S.profiles[p];
  const a = S.profiles.A, b = S.profiles.B, w = {};
  WKEYS.forEach((k) => (w[k] = (a.w[k] + b.w[k]) / 2));
  return { w, famshare: (a.famshare + b.famshare) / 2 };
}
function syncWeights() {
  const mix = S.profile === "mix", p = effW(S.profile);
  WKEYS.forEach((k) => { const el = $("w-" + k); el.value = p.w[k]; el.disabled = mix; });
  $("famshare").value = p.famshare; $("famshare").disabled = mix;
  $("who").textContent = mix ? "moyenne des deux" : "pour " + person(S.profile);
  $("profile-hint").textContent = mix
    ? `Le classement fait la moyenne des réglages de ${CFG.people[0]} et ${CFG.people[1]}, et montre l'écart entre vos deux scores.`
    : `Chacun règle ses poids de son côté. « Compromis » met les deux réglages en commun.`;
}

// ---------------------------------------------------------------- partage
// Le réglage voyage dans l'URL (#r=…) : pas de serveur à écrire, et ça marche
// d'un téléphone à l'autre par message.
function share() {
  const p = S.profile === "mix" ? "A" : S.profile;
  const payload = { from: p, w: S.profiles[p].w, famshare: S.profiles[p].famshare, iso: S.iso, days: S.days, workAt: S.workAt };
  const url = location.origin + location.pathname + "#r=" + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const out = $("share-out");
  out.hidden = false;
  out.innerHTML = `Lien du réglage de ${esc(person(p))} : <input type="text" readonly value="${esc(url)}" style="width:100%;font:12px var(--f-data)">`;
  const inp = out.querySelector("input");
  inp.select();
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => out.insertAdjacentHTML("beforeend", "<br>Copié. Envoyez-le par message."), () => {});
}
function readShared() {
  const m = location.hash.match(/^#r=(.+)$/);
  if (!m) return;
  let r;
  try { r = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { return; }
  const into = r.from === "A" ? "A" : "B";
  const b = $("received");
  b.hidden = false;
  b.innerHTML = `<span>Réglage reçu de <b>${esc(person(r.from))}</b>.</span><button class="ghost" type="button" id="rcv-ok">L'enregistrer comme profil ${esc(person(into))}</button><button class="ghost" type="button" id="rcv-no">Ignorer</button>`;
  $("rcv-ok").onclick = () => {
    S.profiles[into] = { w: { ...DEF_W, ...r.w }, famshare: r.famshare ?? 80 };
    if (r.workAt) { S.workAt = r.workAt; syncWork(); }
    if (r.iso) { S.iso = { ...S.iso, ...r.iso }; for (const k of ["work", "famA", "famB", "alt", "rush"]) $("i-" + k).value = S.iso[k]; }
    S.profile = "mix"; syncProfile(); syncWeights(); render();
    b.hidden = true; history.replaceState(null, "", location.pathname);
  };
  $("rcv-no").onclick = () => { b.hidden = true; history.replaceState(null, "", location.pathname); };
}

// ---------------------------------------------------------------- score
function workTime(c) {
  if (crecheMode()) {
    const t = CRECHE.com[c.code];
    return { t: t ?? 999, mode: "voiture, crèche la plus proche" }; // trajet local : pas de facteur heure de pointe
  }
  const car = c.workcar != null ? c.workcar * S.iso.rush : 999;
  const tr = c.worktrain ?? 999;
  return tr < car ? { t: Math.round(tr), mode: "train via " + c.workgare, alt: Math.round(car) } : { t: Math.round(car), mode: "voiture" };
}
function parts(c, wt) {
  const s = {};
  s.climat = clip(c.alt, 300, 750);
  s.train = 1 - clip(c.train ?? 99, 35, 65);
  s.ecole = 0.35 * clip(c.cl25, 3, 10) + 0.15 * (c.cl25 >= c.cl19 ? 1 : 0) + 0.2 * (c.priv ? 1 : 0) + 0.3 * (c.colkm != null ? 1 - clip(c.colkm, 5, 18) : 0);
  s.eau = clip(c.srckm, 0, 1.2);
  s.prix = 1 - clip(c.prix ?? 999999, 70000, 180000);
  const p = 0.3 * clip(c.inond, 2, 10) + 0.2 * (c.sech ? 1 : 0) + 0.15 * clip(c.mvt, 0, 4) + 0.15 * c.feu + 0.2 * c.indus;
  s.risques = 1 - Math.min(1, p);
  s.offre = clip(c.big, 0, 6);
  s.work = 1 - clip(wt, 30, 75);
  return s;
}
function scoreWith(s, c, prof) {
  const w = { ...prof.w };
  w.work = w.work * S.days / 4; // le poids du trajet suit le nombre de jours
  const sh = prof.famshare / 100;
  const fam = sh * (1 - clip(c.famA, 20, 55)) + (1 - sh) * (1 - clip(c.famB, 15, 60));
  const tot = WKEYS.reduce((a, k) => a + w[k], 0) || 1;
  return Math.round(100 * WKEYS.reduce((a, k) => a + w[k] * (k === "famille" ? fam : s[k]), 0) / tot);
}
function inZone(c, wt) {
  return wt <= S.iso.work && c.famA <= S.iso.famA && c.famB <= S.iso.famB && c.alt >= S.iso.alt;
}
function compute() {
  for (const c of C) {
    const w = workTime(c);
    c.wt = w.t; c.wmode = w.mode; c.walt = w.alt;
    const s = parts(c, c.wt);
    c.sA = scoreWith(s, c, S.profiles.A);
    c.sB = scoreWith(s, c, S.profiles.B);
    c.score = S.profile === "A" ? c.sA : S.profile === "B" ? c.sB : Math.round((c.sA + c.sB) / 2);
    c.zone = inZone(c, c.wt);
    const why = [];
    if (S.f.fibre && (c.fibre ?? 0) < 80) why.push("fibre < 80 %");
    if (S.f.ecole && c.cl25 < 2) why.push("pas d'école");
    if (c.nv < 2) why.push("trop peu de ventes");
    else if (c.prix > S.f.prix * 1000) why.push("terrain trop cher");
    if (S.f.zone && !c.zone) why.push("hors zone verte");
    c.why = why;
  }
}

// ---------------------------------------------------------------- carte
let map, layers = {}, cuts = [];
const RAMP = ["--s1", "--s2", "--s3", "--s4", "--s5"];
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function colFor(score) { let i = 0; while (i < cuts.length && score > cuts[i]) i++; return css(RAMP[i]); }

function buildMap() {
  map = L.map("map", { zoomSnap: 0.5, scrollWheelZoom: true }).setView([45.86, 4.6], 10);
  const ign = (layer, fmt) => L.tileLayer(`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`, { maxZoom: 19, attribution: "© IGN" });
  const plan = ign("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png").addTo(map);
  const ortho = ign("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg");
  const relief = L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MULTIDIRECTIONAL&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png", { maxZoom: 18, opacity: 0.35, attribution: "© IGN" });
  // Cadastre IGN en surcouche : les parcelles et leurs numéros, sans quitter la carte
  const cadastre = L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=PCI%20vecteur&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png", { maxZoom: 20, minZoom: 13, attribution: "© IGN cadastre" });
  layers.zone = L.layerGroup().addTo(map);
  layers.iso = L.layerGroup().addTo(map);
  layers.communes = L.layerGroup().addTo(map);
  layers.creches = L.layerGroup();
  layers.parcels = L.layerGroup().addTo(map);
  layers.topads = L.layerGroup().addTo(map);
  layers.ads = L.layerGroup();
  layers.places = L.layerGroup().addTo(map);
  const over = {
    "Relief (ombrage)": relief, "Cadastre (zoomer)": cadastre, "Zone verte": layers.zone, "Lignes de trajet": layers.iso, "Communes": layers.communes,
    "Parcelles repérées et mixtes": layers.parcels, "Annonces mises en avant": layers.topads, "Toutes les annonces en ligne": layers.ads,
  };
  if (CRECHE) over["Crèches"] = layers.creches;
  L.control.layers({ "Plan IGN": plan, "Photo aérienne": ortho }, over, { collapsed: true }).addTo(map);
  buildToggles({ cadastre });
  map.on("moveend", renderMapList); // la liste sous la carte suit ce qu'on voit
  for (const k of ["work", "famA", "famB", "home"]) {
    const p = CFG.places[k];
    if (!p) continue;
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<span class="place">${esc(p.short || p.name)}</span>`, iconSize: null }), keyboard: false, interactive: false }).addTo(layers.places);
  }
  if (CRECHE) {
    for (const [lat, lon, nom, commune, cap, type] of CRECHE.sites) {
      L.circleMarker([lat, lon], { radius: 4, color: "#fff", weight: 1, fillColor: css("--work"), fillOpacity: 0.9 })
        .bindTooltip(`${esc(nom)} · ${esc(commune)}${cap ? ` · ${cap} places` : ""}${type ? `<br>${esc(type)}` : ""}`, { direction: "top" })
        .addTo(layers.creches);
    }
  }
  for (const p of PARCELS) {
    if (p.lat == null) continue;
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<div class="pmark ${p.kind}"></div>`, iconSize: [14, 14] }), title: `Parcelle repérée · ${p.commune}` });
    m.bindPopup(() => parcelPopup(p), { maxWidth: 300 });
    m.on("popupopen", () => { if (p.ring && !p._poly) p._poly = L.polygon(p.ring.map(([x, y]) => [y, x]), { color: "#ffcf33", weight: 2, fill: false }).addTo(layers.parcels); });
    p._m = m;
  }
  for (const a of ALLADS) {
    if (a.lat == null || a.gone) continue;
    const cls = ["amark", a.top && "top", isNew(a) && "new", a.drop && "drop"].filter(Boolean).join(" ");
    const m = L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "", html: `<div class="${cls}">${a.top ? "★" : "€"}</div>`, iconSize: a.top ? [22, 22] : [18, 18] }), title: `Annonce · ${a.commune} · ${fmtk(a.prix)}` });
    m.bindPopup(() => adPopup(a), { maxWidth: 300 });
    a._m = m;
  }
}
// Barre « afficher » au-dessus de la carte : plus direct que le menu des calques,
// et retenu sur l'appareil. Le menu des calques reste synchronisé.
let syncToggles = () => {};
function buildToggles(extra) {
  const items = [
    ["parcels", "Parcelles repérées", layers.parcels, `<span class="pmark repere sm"></span>`],
    ["topads", "Annonces mises en avant", layers.topads, `<span class="amark top sm">★</span>`],
    ["ads", "Toutes les annonces", layers.ads, `<span class="amark sm">€</span>`],
    ...(CRECHE ? [["creches", "Crèches", layers.creches, `<span class="cmark"></span>`]] : []),
    ["cadastre", "Cadastre", extra.cadastre, ""],
    ["outside", "Hors zone verte aussi", null, ""],
  ];
  const lay = Object.fromEntries(items.map(([k, , l]) => [k, l]));
  for (const [k, , l] of items) if (l) { if (S.show[k]) map.addLayer(l); else map.removeLayer(l); }
  $("maptoggles").innerHTML = items.map(([k, label, , ic]) => `<label class="chk"><input type="checkbox" data-k="${k}">${ic}${esc(label)}</label>`).join("");
  syncToggles = () => $("maptoggles").querySelectorAll("input").forEach((i) => (i.checked = lay[i.dataset.k] ? map.hasLayer(lay[i.dataset.k]) : !!S.show[i.dataset.k]));
  $("maptoggles").addEventListener("change", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    S.show[k] = e.target.checked;
    if (!lay[k]) { render(); return; } // « hors zone verte » : filtre, pas calque
    if (S.show[k]) map.addLayer(lay[k]); else map.removeLayer(lay[k]);
    renderMapList();
    if (k === "cadastre" && S.show[k] && map.getZoom() < 14) map.setZoom(15); // le cadastre ne s'affiche qu'en zoomant
    save();
  });
  map.on("overlayadd overlayremove", () => { for (const k in lay) if (lay[k]) S.show[k] = map.hasLayer(lay[k]); syncToggles(); renderMapList(); save(); });
  syncToggles();
}
function drawLegend() {
  $("maplegend").innerHTML = `<span><span class="sq" style="background:var(--zone);opacity:.5"></span>Zone verte : tous les seuils respectés</span>
    <span><span class="ln" style="background:var(--work)"></span>${esc(workShort())}</span>
    <span><span class="ln" style="background:var(--famA)"></span>${esc(place("famA").short)}</span>
    <span><span class="ln" style="background:var(--famB)"></span>${esc(place("famB").short)}</span>
    <span><span class="sw" style="background:var(--s5)"></span>Commune, couleur = score</span>
    <span><span class="sq" style="background:#ffcf33"></span>Parcelle repérée</span><span><span class="sq" style="background:#ff7ad1;transform:rotate(45deg)"></span>Terrain mixte</span>
    <span><span class="amark lg top">★</span>Annonce mise en avant</span><span><span class="amark lg">€</span>Annonce en ligne (calque à cocher)</span>
    ${crecheMode() ? `<span><span class="sw" style="background:var(--work)"></span>Crèche</span>` : ""}`;
}

// Isochrones : contours d3 sur la grille, convertis en lon/lat.
// d3.contours place la valeur (i, j) au centre de la cellule [i, i+1] × [j, j+1].
function toGeo(mp) {
  const { lon0, lat0, dlon, dlat } = GRID;
  return { type: "MultiPolygon", coordinates: mp.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [lon0 + (x - 0.5) * dlon, lat0 + (y - 0.5) * dlat]))) };
}
// Les bords de la grille sont forcés « hors d'atteinte » : sans ça, un seuil
// qui dépasse l'emprise de la grille dessine son contour le long du cadre.
function contour(values, thr) {
  const { nx, ny } = GRID;
  for (let i = 0; i < nx; i++) { values[i] = -9999; values[(ny - 1) * nx + i] = -9999; }
  for (let j = 0; j < ny; j++) { values[j * nx] = -9999; values[j * nx + nx - 1] = -9999; }
  return toGeo(d3.contours().size([nx, ny]).smooth(true).thresholds([thr])(values)[0]);
}
let gridCache = null;
function drawIso() {
  const n = GRID.nx * GRID.ny, I = S.iso;
  const big = 999;
  const get = (k, i) => (GRID[k][i] == null ? big : GRID[k][i]);
  // valeur combinée : le pire des quatre rapports « valeur / seuil » ; la zone est là où il vaut ≤ 1
  const comb = new Float64Array(n), w = new Float64Array(n), a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = crecheMode() ? -(CRECHE.grid[i] ?? big) : -get("work", i) * I.rush; a[i] = -get("famA", i); b[i] = -get("famB", i);
    let m = Math.max(-w[i] / I.work, -a[i] / I.famA, -b[i] / I.famB);
    if (I.alt > 0) m = Math.max(m, I.alt / Math.max(1, GRID.alt[i]));
    comb[i] = -m;
  }
  layers.zone.clearLayers(); layers.iso.clearLayers();
  L.geoJSON(contour(comb, -1), { style: { color: css("--zone"), weight: 1.5, fillColor: css("--zone"), fillOpacity: 0.22 }, interactive: false }).addTo(layers.zone);
  const lines = [["work", w, I.work], ["famA", a, I.famA], ["famB", b, I.famB]];
  for (const [k, vals, t] of lines) {
    L.geoJSON(contour(vals, -t), { style: { color: css("--" + k), weight: 2.2, dashArray: k === "work" ? null : "6 5", fill: false }, interactive: false }).addTo(layers.iso);
  }
}
function drawCommunes(rows) {
  layers.communes.clearLayers();
  const ok = rows.filter((c) => !c.why.length).map((c) => c.score).sort((x, y) => x - y);
  cuts = [0.2, 0.4, 0.6, 0.8].map((q) => ok[Math.floor(q * (ok.length - 1))] ?? 0);
  for (const c of rows) {
    c._m = null;
    if (!c.zone && !S.show.outside) continue; // la carte ne montre que la zone verte, sauf demande
    const out = c.why.length > 0;
    const m = L.circleMarker([c.lat, c.lon], {
      radius: out ? 3.5 : 5 + (c.score - (cuts[0] || 0)) / 8, color: out ? css("--grey") : css("--ink"), weight: out ? 0.5 : 1,
      fillColor: out ? css("--grey") : colFor(c.score), fillOpacity: out ? 0.45 : 0.92,
    });
    m.bindTooltip(`${esc(c.nom)} · ${c.score}${out ? " (exclue)" : ""}`, { direction: "top" });
    m.bindPopup(() => communePopup(c), { maxWidth: 300 });
    m.addTo(layers.communes);
    c._m = m;
  }
}
function communePopup(c) {
  const hw = Math.round(c.wt * 2 * S.days / 6) / 10;
  const live = ALLADS.filter((a) => a.insee === c.code && !a.gone).length;
  return `<div class="pop"><h3>${esc(c.nom)}</h3><div class="sub">${esc(c.sect)} · ${c.alt} m</div>
  <dl><dt>Score</dt><dd>${c.score}${S.profile === "mix" ? ` (${esc(CFG.people[0])} ${c.sA} · ${esc(CFG.people[1])} ${c.sB})` : ""}</dd>
  <dt>${esc(workShort())}</dt><dd>${c.wt} min · ${esc(c.wmode)} · ${hw} h/sem.</dd>
  <dt>${esc(place("famA").short)}</dt><dd>${c.famA} min</dd><dt>${esc(place("famB").short)}</dt><dd>${c.famB} min</dd>
  <dt>Terrain médian</dt><dd>${fmtk(c.prix)}${c.eurm2 ? ` · ${c.eurm2} €/m²` : ""}</dd>
  ${live ? `<dt>Annonces</dt><dd>${live} en ligne</dd>` : ""}
  <dt>Fibre</dt><dd>${c.fibre ?? "–"} %</dd></dl>
  ${schoolHTML(c)}
  ${c.why.length ? `<div class="sub">Exclue : ${esc(c.why.join(", "))}</div>` : ""}
  <div class="act"><button type="button" onclick="window.__goRow('${c.code}')">Voir dans le classement</button></div></div>`;
}

// ---- écoles (schools.json). Pas de classement officiel des écoles primaires :
// on montre l'IPS (milieu social des élèves) face à la moyenne du département,
// et pour les collèges la valeur ajoutée du brevet (fait mieux ou moins bien qu'attendu).
function ipsWord(ips, ref) {
  if (ips == null || ref == null) return "";
  const d = ips - ref;
  return d >= 10 ? "très favorisé" : d >= 3 ? "favorisé" : d > -3 ? "dans la moyenne" : d > -10 ? "plutôt modeste" : "modeste";
}
function vaWord(dnb) {
  if (!dnb || dnb.va_note == null) return "";
  const v = dnb.va_note + (dnb.va_reussite ?? 0) / 6;
  return v >= 0.5 ? `<span class="chip g">fait mieux qu'attendu</span>` : v <= -0.5 ? `<span class="chip wa">moins bien qu'attendu</span>` : `<span class="chip">conforme à l'attendu</span>`;
}
const statut = (e) => (e.statut === "Public" ? "public" : "privé" + (e.contrat ? " " + e.contrat : ""));
function schoolHTML(c, open = false) {
  const s = SCHOOLS?.com?.[c.code];
  if (!s) return `<dl><dt>École</dt><dd>${c.cl25} classes${c.priv ? " · privée" : ""}</dd></dl>`;
  const ref = SCHOOLS.ref?.[c.code.slice(0, 2)] || {};
  const ec = s.ecoles.map((e) => {
    const r = e.statut === "Public" ? ref.ips_public : ref.ips_prive;
    return `<li><b>${esc(e.nom)}</b> · ${esc(statut(e))}<br><span class="sub">${[e.mat && e.elem ? "maternelle + élémentaire" : e.mat ? "maternelle" : "élémentaire",
      e.eleves ? `${e.eleves} élèves${e.classes ? `, ${e.classes} classes` : ""}` : "",
      e.ips ? `IPS ${e.ips} (${ipsWord(e.ips, r)} ; dép. ${r ?? "–"})` : "",
      e.cantine ? "cantine" : "pas de cantine", e.jours ? `semaine de ${String(e.jours).replace(".", ",")} j` : "", e.ulis ? "ULIS" : ""].filter(Boolean).join(" · ")}</span></li>`;
  }).join("");
  const col = (s.colleges || []).map((k) => `<li><b>${esc(k.nom)}</b> · ${esc(statut(k))} · ${k.km} km (${esc(k.commune)})<br><span class="sub">${[
    k.dnb ? `brevet ${k.dnb.session} : ${k.dnb.reussite} % de réussite, ${k.dnb.note}/20 à l'écrit, ${(k.dnb.mentions_tb ?? 0)} mentions TB sur ${k.dnb.candidats}` : "pas de résultats publiés",
    k.ips ? `IPS ${k.ips}` : "", k.ulis ? "ULIS" : ""].filter(Boolean).join(" · ")}</span> ${vaWord(k.dnb)}</li>`).join("");
  const resume = s.ecoles.length
    ? s.ecoles.map((e) => statut(e)).join(", ") + (s.rpi ? " · RPI" : "")
    : "pas d'école dans la commune";
  return `<details class="school"${open ? " open" : ""}><summary>École : ${esc(resume)}</summary>
    ${ec ? `<ul>${ec}</ul>` : `<p class="sub">Pas d'école : les enfants vont dans une commune voisine, en général en car scolaire.</p>`}
    ${s.rpi ? `<p class="sub">Regroupement pédagogique dispersé (RPI) : les classes sont réparties entre villages, un car scolaire fait la navette.</p>` : ""}
    <p class="sub"><b>Collèges les plus proches</b> (le collège public de secteur est en général l'un des deux premiers publics)</p><ul>${col}</ul>
    <p class="sub">IPS : milieu social des familles (moyenne nationale ${ref.ips_national ?? "≈ 106"}), pas une note de l'école. « Mieux qu'attendu » : valeur ajoutée officielle du brevet. Car scolaire : ${c.code.startsWith("42") ? "réseau Cars Région Loire" : "lignes scolaires Cars du Rhône (SYTRAL), arrêts sur sytral.fr"}.</p>
  </details>`;
}

// ---- parcelles et annonces : liens rapides
const cadastreUrl = (lat, lon) => `https://cartes.gouv.fr/explorer-les-cartes/?c=${lon},${lat}&z=18&l=CADASTRALPARCELS.PARCELLAIRE_EXPRESS$GEOPORTAIL:OGC:WMTS(1;1;1;0)&permalink=yes`;
const plu = (lat, lon) => `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${lon}&lat=${lat}&zoom=17`;
// identifiant cadastral 14 caractères : INSEE (5) + préfixe (3) + section (2) + numéro (4)
const parcelRef = (id) => (id && id.length === 14 ? `section ${id.slice(8, 10).replace(/^0/, "")} n° ${+id.slice(10)}` : id || "");
function parcelPopup(p) {
  const c = C.find((x) => x.nom === p.commune);
  return `<div class="pop"><span class="tag">Parcelle repérée</span><img src="${DATA + esc(p.img)}" alt=""><h3>${esc(p.commune)}</h3>
  <div class="sub">${p.kind === "mixte" ? `${p.constr} m² constructibles + ${p.agri} m² en zone A/N` : esc(p.surface) + " · " + esc(p.zone)} · ${esc(parcelRef(p.id))}</div>
  <p>${esc(p.note)}</p><dl><dt>Altitude</dt><dd>${esc(p.alt)}</dd><dt>Pente</dt><dd>${esc(p.pente)}</dd><dt>Exposition</dt><dd>${esc(p.expo)}</dd>
  ${c ? `<dt>${esc(workShort())}</dt><dd>${c.wt} min</dd>` : ""}</dl>
  <div class="act"><button type="button" onclick="window.__goParcel('${esc(p.id)}')">Fiche de la parcelle</button>
  <a href="${cadastreUrl(p.lat, p.lon)}" target="_blank" rel="noopener">Cadastre ↗</a><a href="${plu(p.lat, p.lon)}" target="_blank" rel="noopener">Zonage ↗</a></div></div>`;
}
function adPopup(a) {
  return `<div class="pop"><span class="tag ad">Annonce${a.top ? " mise en avant" : ""}</span>${a.photo ? `<img src="${esc(a.photo)}" alt="">` : ""}<h3>${esc(a.commune)} · ${fmtk(a.prix)}</h3>
  <div class="sub">${a.m2} m² · ${a.eurm2} €/m²${a.vendeur ? " · " + esc(a.vendeur) : ""}${a.top ? " · " + esc(a.top) : ""}</div>
  ${marketLine(a)}${a.analyse ? `<p>${esc(a.analyse)}</p>` : ""}
  <div class="act"><a class="go" href="${esc(a.url)}" target="_blank" rel="noopener">Voir l'annonce ↗</a><button type="button" onclick="window.__goAd('${esc(a.id)}')">Dans la liste</button>
  ${a.lat ? `<a href="${cadastreUrl(a.lat, a.lon)}" target="_blank" rel="noopener">Cadastre ↗</a>` : ""}</div></div>`;
}

// ---------------------------------------------------------------- rendu
let raf = 0;
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(doRender); }
function doRender() {
  save();
  for (const k of ["work", "famA", "famB"]) document.querySelector(`output[for=i-${k}]`).textContent = S.iso[k] + " min";
  document.querySelector("output[for=i-alt]").textContent = S.iso.alt + " m";
  document.querySelector("output[for=i-rush]").textContent = "×" + S.iso.rush.toFixed(2).replace(/0$/, "");
  document.querySelector("output[for=f-prix]").textContent = S.f.prix + " k";
  const p = effW(S.profile);
  WKEYS.forEach((k) => { if (S.profile === "mix") $("w-" + k).value = p.w[k]; document.querySelector(`output[for=w-${k}]`).textContent = Math.round(p.w[k]); });
  document.querySelector("output[for=famshare]").textContent = `${Math.round(p.famshare)}/${100 - Math.round(p.famshare)}`;
  $("weekly").textContent = `Le poids du trajet suit les jours. À ${S.days} jours, 45 min de trajet font ${Math.round(S.days * 2 * 45 / 6) / 10} h par semaine, 60 min en font ${S.days * 2} h.`;

  compute();
  const rows = [...C].sort((a, b) => b.score - a.score);
  drawIso();
  drawCommunes(rows);
  drawLegend();
  const inz = C.filter((c) => c.zone).length;
  $("zone-count").textContent = crecheMode()
    ? `${inz} communes dans la zone verte (bourg). Travail : crèche la plus proche, en voiture sans trafic.`
    : `${inz} communes dans la zone verte (bourg). Voiture ${place("work").short} : temps sans trafic × ${S.iso.rush.toFixed(2)}.`;
  document.querySelectorAll("[data-place=work]").forEach((el) => (el.textContent = workShort()));
  syncMarkers();
  renderMapList();
  renderTable(rows);
  renderParcels();
  renderAds();
}
// Annonces et parcelles : sur la carte seulement si leur commune est dans la zone verte
// (ou si « hors zone verte aussi » est coché).
const byCodeC = () => Object.fromEntries(C.map((c) => [c.code, c]));
const parcelCommune = (p) => C.find((x) => x.nom === p.commune);
function syncMarkers() {
  const bc = byCodeC();
  for (const a of ALLADS) {
    if (!a._m) continue;
    const lay = a.top ? layers.topads : layers.ads, ok = S.show.outside || !!bc[a.insee]?.zone;
    if (ok) lay.addLayer(a._m); else lay.removeLayer(a._m);
  }
  for (const p of PARCELS) {
    if (!p._m) continue;
    const ok = S.show.outside || !!parcelCommune(p)?.zone;
    if (ok) layers.parcels.addLayer(p._m); else { layers.parcels.removeLayer(p._m); if (p._poly) { layers.parcels.removeLayer(p._poly); p._poly = null; } }
  }
}
// Liste sous la carte = exactement ce que montre la carte : communes visibles dans
// le cadre, et sous chacune ses annonces et parcelles affichées.
function renderMapList() {
  if (!map || !C[0] || C[0].score == null) return;
  const B = map.getBounds(), vis = (m) => m && map.hasLayer(m) && B.contains(m.getLatLng());
  const groups = new Map();
  const g = (code) => { if (!groups.has(code)) groups.set(code, { c: C.find((x) => x.code === code), ads: [], parcels: [] }); return groups.get(code); };
  for (const c of C) if (vis(c._m)) g(c.code);
  for (const a of ALLADS) if (vis(a._m) && a.insee) g(a.insee).ads.push(a);
  for (const p of PARCELS) { const c = parcelCommune(p); if (vis(p._m) && c) g(c.code).parcels.push(p); }
  const list = [...groups.values()].filter((x) => x.c).sort((x, y) => (y.c.zone - x.c.zone) || (!x.c.why.length - !y.c.why.length) * -1 || y.c.score - x.c.score);
  const nAds = list.reduce((n, x) => n + x.ads.length, 0), nP = list.reduce((n, x) => n + x.parcels.length, 0);
  $("maplist-head").textContent = list.length
    ? `${list.length} commune${list.length > 1 ? "s" : ""}${S.show.outside ? "" : " de la zone verte"} dans le cadre · ${nAds} annonce${nAds > 1 ? "s" : ""} · ${nP} parcelle${nP > 1 ? "s" : ""} repérée${nP > 1 ? "s" : ""}. La liste suit la carte : déplacez ou zoomez.`
    : S.show.outside ? "Rien dans le cadre." : "Aucune commune de la zone verte dans le cadre : élargissez les seuils ou dézoomez.";
  const sc = (c) => `<span class="score" style="background:${colFor(c.score)};color:${c.score > (cuts[2] || 0) ? "var(--bg)" : "var(--ink)"}">${c.score}</span>`;
  $("top5").innerHTML = list.map(({ c, ads, parcels }) => `<article class="mcard${c.why.length ? " out" : ""}">
    <button type="button" class="mhead" data-code="${c.code}">${sc(c)}<b>${esc(c.nom)}</b><span>${c.alt} m · ${esc(workShort())} ${c.wt} min · ${esc(place("famA").short)} ${c.famA} · ${esc(place("famB").short)} ${c.famB} min${c.zone ? "" : " · hors zone"}${c.why.length ? " · exclue : " + esc(c.why.join(", ")) : ""}</span></button>
    ${ads.length || parcels.length ? `<ul>${parcels.map((p) => `<li><button type="button" data-pid="${esc(p.id)}"><span class="pmark ${p.kind} sm"></span>${esc(p.kind === "mixte" ? `${p.constr} m² + ${p.agri} m² A/N` : p.surface)} · ${esc(p.zone)}</button></li>`).join("")}
      ${ads.sort((x, y) => (!!y.top - !!x.top) || x.prix - y.prix).map((a) => `<li><button type="button" data-aid="${esc(a.id)}"><span class="amark sm${a.top ? " top" : ""}">${a.top ? "★" : "€"}</span>${a.m2} m² · ${fmtk(a.prix)}${a.drop ? ` <span class="chip wa">−${fmtk(a.drop)}</span>` : ""}${isNew(a) ? ' <span class="chip g">nouvelle</span>' : ""}</button>
        <a href="${esc(a.url)}" target="_blank" rel="noopener" aria-label="Ouvrir l'annonce">↗</a></li>`).join("")}</ul>` : ""}
  </article>`).join("");
  $("top5").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const it = b.dataset.code ? C.find((x) => x.code === b.dataset.code) : b.dataset.pid ? PARCELS.find((x) => x.id === b.dataset.pid) : ALLADS.find((x) => x.id === b.dataset.aid);
    if (it?._m) { map.panTo(it._m.getLatLng()); it._m.openPopup(); } // pan sans zoom : la liste ne se vide pas sous les doigts
  };
}

// ---- tableau
let sortK = "score", sortDir = -1, showAll = false;
function renderTable(rows) {
  const mix = S.profile === "mix";
  const cols = [
    ["score", "Score"], ["nom", "Commune"], ["alt", "Alt."], ["wt", workShort()], ["famA", place("famA").short], ["famB", place("famB").short],
    ["train", "Train"], ["prix", "Terrain médian"], ["cl25", "École"], ["colkm", "Collège catho."], ["srckm", "Eau"], ["risk", "Risques"],
  ];
  if (mix) cols.splice(1, 0, ["gap", "Écart"]);
  const thead = $("tbl").tHead;
  thead.innerHTML = "<tr>" + cols.map(([k, l]) => `<th data-k="${k}"${k === sortK ? ` aria-sort="${sortDir < 0 ? "descending" : "ascending"}"` : ""}>${esc(l)}</th>`).join("") + "</tr>";
  thead.onclick = (e) => { const th = e.target.closest("th"); if (!th) return; const k = th.dataset.k; if (k === sortK) sortDir = -sortDir; else { sortK = k; sortDir = ["nom", "wt", "famA", "famB", "train", "prix", "colkm"].includes(k) ? 1 : -1; } render(); };
  const val = { gap: (c) => Math.abs(c.sA - c.sB), risk: (c) => c.inond + 3 * c.sech, train: (c) => c.train ?? 999, prix: (c) => c.prix ?? 9e9, colkm: (c) => c.colkm ?? 99 };
  const v = val[sortK] || ((c) => c[sortK]);
  let r = rows.filter((c) => !c.why.length).sort((a, b) => (typeof v(a) === "string" ? v(a).localeCompare(v(b)) : v(a) - v(b)) * sortDir);
  const total = r.length;
  $("count").textContent = `${total} communes retenues sur ${C.length}. Cliquez un en-tête pour trier, une ligne pour la voir sur la carte.`;
  if (!showAll) r = r.slice(0, 30);
  $("more").hidden = total <= 30;
  $("more").textContent = showAll ? "Ne montrer que les 30 premières" : `Afficher les ${total} communes`;
  $("more").onclick = () => { showAll = !showAll; render(); };
  const hw = (t) => Math.round(t * 2 * S.days / 6) / 10;
  $("tbl").tBodies[0].innerHTML = r.map((c) => {
    const ch = [];
    if (c.inond >= 8) ch.push(`<span class="chip wa">inond. ${c.inond}</span>`);
    if (c.sech) ch.push(`<span class="chip wa">argile ${c.sech}</span>`);
    if (c.feu) ch.push(`<span class="chip b">feux</span>`);
    if (c.indus) ch.push(`<span class="chip b">site indus.</span>`);
    if (!ch.length) ch.push(`<span class="chip g">peu</span>`);
    return `<tr data-code="${c.code}">
      <td><span class="score" style="background:${colFor(c.score)};color:${c.score > (cuts[2] || 0) ? "var(--bg)" : "var(--ink)"}">${c.score}</span>${c.zone ? '<span class="sub">zone verte</span>' : ""}</td>
      ${mix ? `<td class="num">${Math.abs(c.sA - c.sB)}<span class="sub">${esc(CFG.people[0])} ${c.sA} · ${esc(CFG.people[1])} ${c.sB}</span></td>` : ""}
      <td><strong>${esc(c.nom)}</strong><span class="sub">${esc(c.sect)}</span></td>
      <td class="num">${c.alt} m</td>
      <td class="num">${c.wt} min<span class="sub">${esc(c.wmode)}${c.walt ? " · voiture " + c.walt : ""} · ${hw(c.wt)} h/sem.</span></td>
      <td class="num">${c.famA} min</td><td class="num">${c.famB} min</td>
      <td class="num">${c.train ?? "–"} min<span class="sub">${c.gare ? esc(c.gare) : "pas de gare"}</span></td>
      <td class="num">${fmtk(c.prix)}<span class="sub">${c.m2 ? c.m2 + " m² · " + c.eurm2 + " €/m²" : ""} · ${c.nv} ventes</span></td>
      <td class="num">${c.cl25} cl.<span class="sub">${schoolBrief(c) || `${c.cl19}→${c.cl25} depuis 2019${c.priv ? " · privée" : ""}`}</span></td>
      <td>${c.col ? `${esc(c.colc)} · ${c.colkm} km<span class="sub">${esc(c.col)}${c.va != null ? " · VA " + (c.va > 0 ? "+" : "") + c.va : ""}</span>` : "–"}</td>
      <td class="num">${c.src}<span class="sub">${c.srckm}/km²</span></td><td>${ch.join("")}</td></tr>`;
  }).join("");
  $("tbl").tBodies[0].onclick = (e) => { const tr = e.target.closest("tr"); if (tr) window.__goMap(tr.dataset.code); };
}
function schoolBrief(c) {
  const s = SCHOOLS?.com?.[c.code];
  if (!s) return "";
  const ref = SCHOOLS.ref?.[c.code.slice(0, 2)] || {};
  const e = s.ecoles.map((x) => statut(x) + (x.ips ? `, ${ipsWord(x.ips, x.statut === "Public" ? ref.ips_public : ref.ips_prive)}` : "")).join(" / ");
  return (e || "pas d'école") + (s.rpi ? " · RPI" : "");
}
// sauts vers une fiche : on surligne l'élément quelques secondes
function flash(sel) { requestAnimationFrame(() => { const el = document.querySelector(sel); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("sel"); setTimeout(() => el.classList.remove("sel"), 2000); } }); }
window.__goParcel = (id) => { pkind = "tout"; renderParcels(); showTab("parcelles"); flash(`#plist [data-pid="${CSS.escape(id)}"]`); };
window.__goAd = (id) => { showTab("annonces"); const a = ALLADS.find((x) => x.id === id); if (a && (a.gone || a.stale)) $("a-gone").checked = true; renderAds(); flash(`#atop [data-aid="${CSS.escape(id)}"], #atbl tr[data-aid="${CSS.escape(id)}"]`); };
window.__goRow = (code) => { showTab("classement"); requestAnimationFrame(() => { const tr = document.querySelector(`#tbl tr[data-code="${code}"]`); if (tr) { tr.scrollIntoView({ block: "center" }); tr.classList.add("sel"); setTimeout(() => tr.classList.remove("sel"), 2000); } }); };
window.__goMap = (code) => {
  const c = C.find((x) => x.code === code);
  if (!c.zone && !S.show.outside) { S.show.outside = true; syncToggles(); doRender(); } // commune hors zone : on l'affiche
  showTab("carte");
  setTimeout(() => { map.invalidateSize(); map.setView([c.lat, c.lon], 12); c._m?.openPopup(); }, 50);
};

// ---- onglets
function buildTabs() {
  document.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });
  const h = location.hash.replace("#", "");
  if (document.querySelector(`[data-view="${h}"]`)) showTab(h);
}
function showTab(t) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== t));
  $("side").hidden = !["carte", "classement", "parcelles", "annonces"].includes(t);
  document.querySelector(".layout").style.gridTemplateColumns = $("side").hidden ? "1fr" : "";
  if (t === "carte") setTimeout(() => map.invalidateSize(), 30);
  if (!location.hash.startsWith("#r=")) history.replaceState(null, "", "#" + t);
}

// ---- parcelles
let pkind = "tout";
function buildParcels() {
  seg($("pkind"), [["tout", "Toutes"], ["repere", "Repérées (constructibles)"], ["mixte", "Mixtes (constructible + pré)"]], () => pkind, (v) => { pkind = v; renderParcels(); });
}
function renderParcels() {
  $("pintro").innerHTML = pkind === "mixte" ? NOTES.mixtes_intro : pkind === "repere" ? NOTES.reperes_intro : NOTES.mixtes_intro;
  const list = PARCELS.filter((p) => pkind === "tout" || p.kind === pkind)
    .map((p) => ({ p, c: C.find((x) => x.nom === p.commune) }))
    .sort((a, b) => (b.c?.score ?? 0) - (a.c?.score ?? 0));
  $("plist").innerHTML = list.map(({ p, c }) => `<figure class="parcel" data-pid="${esc(p.id)}">
    <div class="ph"><img src="${DATA + esc(p.img)}" alt="Photo aérienne, ${esc(p.commune)}" loading="lazy"><svg viewBox="0 0 360 240" aria-hidden="true"><polygon points="${esc(p.svg)}"/></svg><span class="scale">${esc(p.scale)}</span></div>
    <figcaption><div class="ptop"><b>${esc(p.commune)}</b><span class="z ${p.kind === "mixte" ? "u" : /AU/.test(p.zone) ? "au" : "u"}">${p.kind === "mixte" ? `${p.constr} m² ${esc(p.zone)} + ${p.agri} m² A/N` : esc(p.surface) + " · " + esc(p.zone)}</span></div>
    <p>${esc(p.note)}</p>
    <dl><div><dt>Altitude</dt><dd>${esc(p.alt)}</dd></div><div><dt>Pente</dt><dd>${esc(p.pente)}</dd></div><div><dt>Expo.</dt><dd>${esc(p.expo)}</dd></div>
    ${c ? `<div><dt>${esc(workShort())}</dt><dd>${c.wt} min</dd></div><div><dt>Score</dt><dd>${c.score}${c.zone ? " ✓" : ""}</dd></div>` : ""}</dl>
    <div class="act"><button type="button" data-ll="${p.lat},${p.lon}">Voir sur la carte</button><a href="${cadastreUrl(p.lat, p.lon)}" target="_blank" rel="noopener">Cadastre ↗</a><a href="${plu(p.lat, p.lon)}" target="_blank" rel="noopener">Zonage ↗</a><span class="sub">${esc(parcelRef(p.id))}</span></div>
    </figcaption></figure>`).join("");
  $("plist").onclick = (e) => { const b = e.target.closest("button[data-ll]"); if (!b) return; const [la, lo] = b.dataset.ll.split(",").map(Number); showTab("carte"); setTimeout(() => { map.invalidateSize(); map.setView([la, lo], 16); }, 50); };
}

// ---- annonces
// ALLADS réunit le relevé quotidien (market.json, écrit par le CronJob
// terrain-refresh) et les annonces commentées à la main (ads.json : top, analyse).
let ALLADS = [];
const DAY = 864e5;
const todayISO = () => new Date().toISOString().slice(0, 10);
const adKey = (url) => { const m = /bienici\.com\/annonce\/(?:.*\/)?([^/?#]+)/.exec(url || ""); return m ? "bienici:" + m[1] : url; };
const since = (a) => a.published && a.published < (a.first || "9") ? a.published : a.first || a.published;
function daysOn(a) { const s = since(a); return s ? Math.max(0, Math.round((Date.parse(a.gone || todayISO()) - Date.parse(s)) / DAY)) : null; }
const isNew = (a) => !a.gone && daysOn(a) != null && daysOn(a) <= 7 && !!MARKET;
const median = (v) => { v = v.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const fmtd = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");
function buildAdList() {
  const curated = Object.fromEntries(ADS.map((a) => [adKey(a.url), a]));
  if (!MARKET) { ALLADS = ADS.map((a) => ({ ...a, id: adKey(a.url) })); return; }
  ALLADS = Object.entries(MARKET.ads).filter(([, h]) => !h.dup).map(([id, h]) => {
    const cur = curated[id] || {};
    const max = Math.max(...(h.prices || []).map((p) => p[1]), h.prix || 0);
    return { ...h, id, eurm2: h.m2 ? Math.round(h.prix / h.m2) : null, drop: max > h.prix ? max - h.prix : 0,
      top: cur.top, analyse: cur.analyse, photo: cur.photo || h.photo, lat: h.lat ?? cur.lat, lon: h.lon ?? cur.lon };
  });
  const seen = new Set(ALLADS.map((a) => a.id));
  for (const [id, a] of Object.entries(curated)) if (!seen.has(id)) ALLADS.push({ ...a, id, stale: true }); // plus vue au dernier relevé
}
function marketLine(a) {
  if (!MARKET) return "";
  if (a.stale) return `<p class="sub">Plus vue au dernier relevé : sans doute vendue ou retirée.</p>`;
  const d = daysOn(a);
  const bits = [a.gone ? `partie le ${fmtd(a.gone)} après ${d} j en ligne` : `en ligne depuis ${d} j${isNew(a) ? " · nouvelle" : ""}`];
  if (a.drop) bits.push(`prix baissé de ${fmtk(a.drop)}`);
  if (a.relist) bits.push("remise en ligne");
  return `<p class="sub">${bits.join(" · ")}</p>`;
}
function buildAds() {
  $("aintro").innerHTML = NOTES.annonces_intro;
  ["a-m2", "a-prix"].forEach((id) => $(id).addEventListener("input", renderAds));
  $("a-zone").addEventListener("change", renderAds);
  $("a-gone").addEventListener("change", renderAds);
  $("a-gone-wrap").hidden = !MARKET;
  renderMarket();
}
function renderAds() {
  document.querySelector("output[for=a-m2]").textContent = $("a-m2").value + " m²";
  document.querySelector("output[for=a-prix]").textContent = $("a-prix").value + " k";
  const byCode = Object.fromEntries(C.map((c) => [c.code, c]));
  const tops = ALLADS.filter((a) => a.top);
  $("atop").innerHTML = tops.map((a) => {
    const c = byCode[a.insee];
    return `<figure class="parcel ad" data-aid="${esc(a.id)}"><div class="adph">${a.photo ? `<img src="${esc(a.photo)}" alt="" loading="lazy">` : ""}</div>
    <figcaption><span class="tag go">${esc(a.top)}</span><div class="ptop"><b>${esc(a.commune)}</b><span class="price">${fmtk(a.prix)}</span></div>
    <dl><div><dt>Surface</dt><dd>${a.m2} m²</dd></div>${c ? `<div><dt>${esc(workShort())}</dt><dd>${c.wt} min</dd></div><div><dt>${esc(place("famA").short)}</dt><dd>${c.famA} min</dd></div><div><dt>${esc(place("famB").short)}</dt><dd>${c.famB} min</dd></div>` : ""}</dl>
    ${marketLine(a)}<p>${esc(a.analyse)}</p><div class="act"><a class="go" href="${esc(a.url)}" target="_blank" rel="noopener">Voir l'annonce ↗</a>${a.lat ? `<button type="button" data-ll="${a.lat},${a.lon}">Voir sur la carte</button>` : ""}</div></figcaption></figure>`;
  }).join("");
  const m2 = +$("a-m2").value, px = +$("a-prix").value * 1000, z = $("a-zone").checked, g = $("a-gone").checked;
  const rows = ALLADS.filter((a) => a.m2 >= m2 && a.prix <= px && (!z || byCode[a.insee]?.zone) && (g || (!a.gone && !a.stale)))
    .map((a) => ({ a, c: byCode[a.insee] })).sort((x, y) => (!!x.a.gone - !!y.a.gone) || (y.c?.score ?? 0) - (x.c?.score ?? 0));
  $("atbl").tHead.innerHTML = `<tr><th>Score commune</th><th>Commune</th><th>Surface</th><th>Prix</th><th>€/m²</th><th>${esc(workShort())}</th><th>Alt. bourg</th>${MARKET ? "<th>En ligne</th>" : ""}<th>Annonce</th></tr>`;
  $("atbl").tBodies[0].innerHTML = rows.map(({ a, c }) => `<tr data-aid="${esc(a.id)}"${a.gone || a.stale ? ' class="gone"' : ""}><td class="num">${c ? c.score : "–"}${c?.zone ? '<span class="sub">zone verte</span>' : ""}</td>
    <td><strong>${esc(a.commune)}</strong>${a.top ? ' <span class="chip g">★</span>' : ""}<span class="sub">${esc(a.titre || "")}</span></td><td class="num">${a.m2} m²</td>
    <td class="num">${fmtk(a.prix)}${a.drop ? `<span class="sub">−${fmtk(a.drop)}</span>` : ""}</td><td class="num">${a.eurm2 ?? "–"}</td>
    <td class="num">${c ? c.wt + " min" : "–"}</td><td class="num">${c ? c.alt + " m" : "–"}</td>
    ${MARKET ? `<td class="num">${a.stale ? "–" : daysOn(a) + " j"}<span class="sub">${a.stale ? "plus vue" : a.gone ? "partie le " + fmtd(a.gone) : isNew(a) ? "nouvelle" : "depuis le " + fmtd(since(a))}</span></td>` : ""}
    <td><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.agence || a.vendeur || "voir")} ↗</a>${a.src ? `<span class="sub">${esc(a.src)}${a.constructeur ? " · constructeur" : ""}</span>` : a.constructeur ? '<span class="sub">constructeur</span>' : ""}
    ${a.lat && !a.gone ? `<button type="button" class="linkish" data-ll="${a.lat},${a.lon}">carte</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9">Aucune annonce avec ces filtres.</td></tr>`;
  const goLL = (e) => { const b = e.target.closest("button[data-ll]"); if (!b) return; const [la, lo] = b.dataset.ll.split(",").map(Number); showTab("carte"); setTimeout(() => { map.invalidateSize(); map.setView([la, lo], 15); }, 50); };
  $("atbl").tBodies[0].onclick = goLL; $("atop").onclick = goLL;
}

// ---- le marché : ce qui part vite, ce qui traîne
function renderMarket() {
  const el = $("market");
  if (!MARKET) { el.innerHTML = `<p class="hint">Le relevé quotidien n'a pas encore tourné : les annonces ci-dessous sont celles du relevé manuel.</p>`; return; }
  const runs = MARKET.runs || [], last = runs[runs.length - 1] || { sources: {} }, start = runs[0]?.date;
  const live = ALLADS.filter((a) => !a.gone && !a.stale && a.src), gone = ALLADS.filter((a) => a.gone);
  const bySect = {};
  const sectOf = Object.fromEntries(C.map((c) => [c.code, c.sect]));
  for (const a of ALLADS) if (a.src) (bySect[sectOf[a.insee] || "?"] ||= []).push(a);
  const recent = (a) => a.gone && Date.parse(todayISO()) - Date.parse(a.gone) <= 30 * DAY;
  const fast = gone.filter((a) => daysOn(a) <= 45).sort((a, b) => b.gone.localeCompare(a.gone)).slice(0, 8);
  const slow = live.filter((a) => daysOn(a) >= 120).sort((a, b) => daysOn(b) - daysOn(a)).slice(0, 8);
  const li = (a, extra) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.commune)} · ${a.m2} m² · ${fmtk(a.prix)}</a> <span class="sub">${extra}</span></li>`;
  const srcs = Object.entries(last.sources).map(([k, v]) => v.ok ? `${esc(k)} ${v.n}${v.complete ? "" : " (incomplet)"}` : `<b>${esc(k)} en panne</b>`).join(" · ");
  el.innerHTML = `<p class="hint">Relevé chaque matin. Dernier passage le ${fmtd(last.date)} : ${srcs}. Suivi depuis le ${fmtd(start)}${runs.length < 30 ? ` : il faut quelques semaines d'historique pour que les durées de vente veuillent dire quelque chose` : ""}.</p>
  <div class="kpis"><div><b>${live.length}</b><span>en ligne</span></div><div><b>${live.filter(isNew).length}</b><span>nouvelles (7 j)</span></div>
  <div><b>${live.filter((a) => a.drop).length}</b><span>prix baissé</span></div><div><b>${gone.filter(recent).length}</b><span>parties (30 j)</span></div>
  <div><b>${median(live.map(daysOn)) ?? "–"} j</b><span>en ligne, médiane</span></div><div><b>${median(gone.map(daysOn)) ?? "–"} j</b><span>avant de partir, médiane</span></div></div>
  <div class="cols2"><div><h3>Parties vite (≤ 45 j)</h3>${fast.length ? `<ul>${fast.map((a) => li(a, `partie le ${fmtd(a.gone)} après ${daysOn(a)} j`)).join("")}</ul>` : `<p class="hint">Rien encore : il faut que des annonces disparaissent du relevé.</p>`}</div>
  <div><h3>Traînent (≥ 120 j)</h3>${slow.length ? `<ul>${slow.map((a) => li(a, `${daysOn(a)} j${a.drop ? ` · −${fmtk(a.drop)}` : ""} : vendeur peut-être prêt à négocier`)).join("")}</ul>` : `<p class="hint">Aucune.</p>`}</div></div>
  <h3>Par secteur</h3><div class="tablewrap"><table><thead><tr><th>Secteur</th><th>En ligne</th><th>€/m² médian</th><th>Jours en ligne (médiane)</th><th>Parties (30 j)</th><th>Durée avant départ</th></tr></thead><tbody>
  ${Object.entries(bySect).sort((a, b) => b[1].length - a[1].length).map(([s, v]) => { const l = v.filter((a) => !a.gone), g = v.filter((a) => a.gone);
    return `<tr><td>${esc(s)}</td><td class="num">${l.length}</td><td class="num">${median(l.map((a) => a.eurm2)) ?? "–"}</td><td class="num">${median(l.map(daysOn)) ?? "–"}</td><td class="num">${g.filter(recent).length}</td><td class="num">${g.length ? median(g.map(daysOn)) + " j" : "–"}</td></tr>`; }).join("")}
  </tbody></table></div>
  <p class="hint">Une annonce qui disparaît n'est pas forcément vendue : retrait, compromis, ou remise en ligne plus tard (signalée). Les doublons entre sites sont fusionnés.</p>`;
}

// ---- textes
function buildNotes() {
  $("analyse").innerHTML = NOTES.analyse;
  $("visite").innerHTML = NOTES.visite + NOTES.plan + NOTES.methode;
  // la grille de visite se coche ; on garde les cases sur cet appareil
  document.querySelectorAll("#visite input[type=checkbox]").forEach((cb) => {
    try { cb.checked = localStorage.getItem("terrain.g." + cb.id) === "1"; } catch (e) { /* rien */ }
    cb.addEventListener("change", () => { try { localStorage.setItem("terrain.g." + cb.id, cb.checked ? "1" : "0"); } catch (e) { /* rien */ } });
  });
}
