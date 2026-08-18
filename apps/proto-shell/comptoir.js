// PROTOTYPE — variante D, « Le comptoir ». Jetable comme le reste.
//
// Transcription de la direction 1 du canevas Claude Design (projet
// « Application mobile », `Direction 1 - Le comptoir.dc.html`) en HTML/CSS/JS
// vanilla, posée sur le VRAI modèle (`semaine.js`, lui-même transcrit du
// recipe-compiler Python). Le canevas se jugeait sur un bureau, à côté de ses
// annotations ; ceci se juge sur un iPhone, le pouce dessus.
//
// CE QUE LA DIRECTION PARIE
// Le coût ne se consulte pas, il s'affiche là où il se décide. La facette se
// lit en quatre vues courtes — aujourd'hui, la semaine, à prévoir, poser un
// plat — et les trois chiffres restent épinglés dans celle où l'on choisit.
// Ce qu'elle sacrifie : l'ubiquité. Les plafonds d'espace vivent maintenant
// dans le stock, à deux gestes.
//
// CE QUI A CHANGÉ EN PASSANT DU CANEVAS AU MODÈLE
// Le canevas portait une semaine écrite à la main (gratin de mardi, 63 €,
// « à table 18h15 »). Ici tout ce qui peut venir du modèle en vient, et ce qui
// ne le peut pas est dit à voix haute plutôt que recopié :
//
//   • Les euros n'existent nulle part dans `cuisine-data.json` — pas un prix
//     dans le catalogue. Le cadran des trois chiffres garde sa forme et son
//     rôle, mais compte ce que le modèle sait : articles, heures, lots.
//   • Les quantités par étape de recette n'existent pas non plus : le modèle
//     tient les ingrédients d'un plat, pas leur répartition dans les gestes.
//     Le mode guidé montre donc l'étape seule, et la liste complète reste au
//     bouton « Ingrédients ». C'est le manque le plus visible de la fiche.
//   • L'heure du repas est posée en dur ici (voir HEURE) : la direction s'y
//     appuie beaucoup — le compte à rebours, le rappel — et le foyer ne la
//     porte pas encore.
//
// La semaine s'auto-remplit au montage, en jouant la meilleure carte de chaque
// créneau. Le canevas montrait une semaine déjà posée, et c'est ce qu'il faut
// juger : « aujourd'hui » et « la semaine » n'ont aucun sens devant 14 trous.

import * as S from "./semaine.js";
import { quetes } from "./data.js";

// L'HEURE DU REPAS N'EST PAS UNE DONNÉE DU MODÈLE. La direction en dépend
// (« à table 19h00 », « commencer à 17h25 », le rappel dix minutes avant), et
// le foyer ne la porte pas. On la pose ici, en hypothèse assumée : si l'écran
// gagne, c'est au foyer de gagner des heures de repas, pas à ce fichier.
const HEURE = { dejeuner: 12 * 60 + 30, diner: 19 * 60 };

// La chauffe des quatre barres, dérivée des `needs` que le modèle porte déjà
// sur chaque étape. Le canevas l'écrivait à la main ; c'est un affichage du
// matériel, et le matériel est dans les données.
const CHAUFFE = [
  { n: ["bake", "gratin"], nom: "Four", niveau: 3 },
  { n: ["boil", "simmer-large"], nom: "Feu vif", niveau: 4 },
  { n: ["pan-fry"], nom: "Feu moyen", niveau: 3 },
  { n: ["simmer"], nom: "Feu doux", niveau: 2 },
  { n: ["steam"], nom: "Vapeur", niveau: 2 },
  { n: ["reheat"], nom: "Réchauffe", niveau: 1 },
];

const ESPACES = { frigo: "Frigo", congelo: "Congélo", placard: "Placard" };

const ico = (d, t = 16) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"
  style="flex:none">${d}</svg>`;
const ICO = {
  parts: ico('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'),
  horloge: ico('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>'),
  gamelle: ico('<rect x="2" y="7" width="20" height="14" rx="3"></rect><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path><path d="M2 13h20"></path>', 14),
  frigo: ico('<rect x="5" y="2" width="14" height="20" rx="3"></rect><path d="M5 10h14"></path><path d="M9 6v1"></path><path d="M9 14v2"></path>', 14),
  congelo: ico('<path d="M12 3v18"></path><path d="M4.5 7.5 19.5 16.5"></path><path d="M19.5 7.5 4.5 16.5"></path>', 14),
  placard: ico('<rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M12 3v18"></path><path d="M9 9h.01"></path><path d="M15 9h.01"></path>', 14),
  alerte: ico('<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path>', 14),
  bebe: ico('<path d="M8 3h8l-1 4H9Z"></path><path d="M7 7h10l-1 13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1Z"></path>', 14),
  minuteur: ico('<path d="M6 4h12"></path><path d="M9 4v3a3 3 0 0 0 6 0V4"></path><circle cx="12" cy="14" r="7"></circle><path d="M12 11v3l2 1"></path>', 15),
  cloche: ico('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"></path><path d="M10 21h4"></path>', 18),
  info: ico('<circle cx="12" cy="12" r="9"></circle><path d="M12 8h.01"></path><path d="M11 12h1v4h1"></path>', 17),
  enfant: ico('<circle cx="12" cy="7" r="4"></circle><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"></path>', 17),
};

let jeu = null;
let hote = null;

// État en mémoire uniquement — règle du prototype. `ecran` porte les neuf vues
// de la direction ; le reste est ce qu'un doigt a touché depuis le montage.
const etat = {
  ecran: "A",        // K cockpit · A aujourd'hui · W semaine · P à prévoir · H poser
                     // B en cuisine · C courses · D parts · S stock · J jardin
  slot: 0,           // le créneau qu'on travaille (poser, parts)
  ouvert: null,      // le créneau déplié dans la semaine
  fiche: null,       // le plat ouvert en mode guidé
  etape: 0, ingr: false,
  tRestant: 0, tActif: false, tSonne: false,
  mode: "magasin",
  coches: new Set(), rentres: new Set(),
  cat: null,
  geste: false, rappel: false,
};
let tick = null;

export async function monter(h) {
  hote = h;
  if (!jeu) {
    const data = await fetch("cuisine-data.json").then(r => r.json());
    jeu = S.creerJeu(data);
    preRemplir();     // rend la main tout de suite, remplit en tâche de fond
  }
  if (!tick) tick = setInterval(() => {
    if (!etat.tActif) return;
    etat.tRestant -= 1;
    if (etat.tRestant <= 0) { etat.tRestant = 0; etat.tActif = false; etat.tSonne = true; }
    rendre();
  }, 1000);
  rendre();
}

// LA SEMAINE ARRIVE POSÉE. La direction se juge sur une semaine pleine — c'est
// tout son propos : voir ce qui s'enchaîne. On joue donc la meilleure carte de
// chaque créneau, dans l'ordre chronologique, exactement comme un doigt le
// ferait. Rien n'est écrit à la main : c'est le modèle qui choisit.
//
// UN CRÉNEAU PAR TOUR DE BOUCLE, et c'est la mesure qui l'a imposé. Poser les
// quatorze d'un coup prenait 13,7 s sur une machine de bureau : `offre()`
// rejoue `calculer()` pour chacun des 51 plats candidats, quatorze fois de
// suite. Bloquer là-dessus, c'est un écran blanc de treize secondes sur un
// téléphone — et le premier verdict aurait porté là-dessus, pas sur le design.
// L'écran se rend donc vide, puis se remplit sous les yeux. Que ce coût soit
// visible est un résultat du proto, pas un détail d'implémentation : le vrai
// squelette devra mémoïser ce calcul, ou le sortir du fil principal.
let posePrete = false;
function preRemplir() {
  jeu.slot = jeu.creneaux.findIndex(c => c.nature === "choisi");
  etat.slot = jeu.slot;
  const aPoser = jeu.creneaux.map((c, i) => i).filter(i => jeu.creneaux[i].nature === "choisi");
  const suite = () => {
    const i = aPoser.shift();
    if (i == null) { posePrete = true; rendre(); return; }
    jeu.slot = i;
    const m = S.main(jeu, 3);
    if (m.length) jeu.choix[i] = m[0].plat.id;
    jeu.slot = etat.slot;
    rendre();
    setTimeout(suite, 0);
  };
  setTimeout(suite, 0);
}

/* ─────────────────────────────────────────────────────────── petites mesures */

const fmt = n => String(+(+n).toFixed(1)).replace(".", ",");
const duree = m => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? String(m % 60).padStart(2, "0") : ""}`.trim()
  : `${m} min`;
const hhmm = m => `${Math.floor((((m % 1440) + 1440) % 1440) / 60)}h${String(m % 60).padStart(2, "0")}`;
const mmss = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cleArt = a => `${a.id}|${a.unit}`;
const espaceDe = l => l.espace || (l.location === "congelo" ? "congelo" : "frigo");

const creneauxDuJour = ij => jeu.creneaux
  .map((c, i) => ({ ...c, i }))
  .filter(c => c.jour === ij);

// Les trois chiffres. Le canevas en affichait un quatrième — 63 € — qui n'a pas
// de source : pas un prix dans le catalogue. On garde la forme du cadran (trois
// grandeurs, épinglées là où l'on choisit) et on compte ce qui existe.
function chiffres(calc) {
  const arts = S.articles(calc.panier);
  const minutes = S.minutesParJour(jeu, jeu.choix).reduce((a, b) => a + b, 0);
  const lots = calc.depot.lignes.filter(l => !l._epuise).length;
  return [
    { k: "Articles", v: String(arts.length) },
    { k: "Cuisine", v: duree(minutes) },
    { k: "Lots", v: String(lots), vers: "S" },
  ];
}

// Ce qui attend une réponse : les offres de surproduction, plus les gamelles
// qu'aucun dîner de la veille ne couvre encore.
const enAttente = (calc, gam) => calc.offres.length + gam.filter(g => !g.fait && g.plat).length;

// LE GESTE DU SOIR, dérivé du chaînage. Un plat de demain qui prend dans le
// congélo demande une décision ce soir : sortir le lot. Le canevas l'écrivait
// en dur ; c'est en réalité une lecture du dépôt.
function gesteDuJour(calc) {
  for (const c of creneauxDuJour(1)) {
    if (!S.joue(jeu.choix[c.i])) continue;
    const ch = calc.chaine.find(x => x.creneau === c.i);
    if (!ch) continue;
    const l = calc.depot.lignes.find(x => x.type === ch.type && espaceDe(x) === "congelo");
    if (!l) continue;
    return { type: ch.type, quand: `${c.label} de demain`, plat: jeu.plats[jeu.choix[c.i]] };
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────── le rendu */

function rendre() {
  const calc = S.calculer(jeu, jeu.choix);
  const gam = S.gamelles(jeu, jeu.choix);
  const v = {
    K: () => ecranCockpit(calc, gam),
    A: () => ecranAujourdhui(calc, gam),
    W: () => ecranSemaine(calc),
    P: () => ecranPrevoir(calc, gam),
    H: () => ecranPoser(calc),
    B: () => ecranCuisine(calc),
    C: () => ecranCourses(calc),
    D: () => ecranParts(calc),
    S: () => ecranStock(calc),
    J: () => ecranJardin(),
  }[etat.ecran]();

  const dansCuisine = ["A", "W", "P", "H", "C", "D", "S"].includes(etat.ecran);
  const reste = jeu.creneaux.filter((c, i) => c.nature === "choisi" && !jeu.choix[i]).length;
  hote.innerHTML = `
    ${dansCuisine ? enTeteCuisine(calc, gam) : ""}
    ${posePrete ? "" : `<div class="co-pose">on pose la semaine — ${reste} créneau${
      reste > 1 ? "x" : ""} restant${reste > 1 ? "s" : ""}</div>`}
    ${v}
    ${barre(calc, gam)}`;
  brancher(calc, gam);
}

function enTeteCuisine(calc, gam) {
  const j0 = jeu.jours[0], jN = jeu.jours[jeu.jours.length - 1];
  const mois = d => d.toLocaleDateString("fr-FR", { month: "long" });
  const n = enAttente(calc, gam);
  const onglets = [
    ["A", "Aujourd’hui", ""], ["W", "La semaine", ""],
    ["P", "À prévoir", n ? String(n) : ""], ["C", "Courses", ""],
  ];
  return `
    <div class="co-tete">
      <div>
        <div class="titre">Cuisine</div>
        <div class="sous">semaine du ${j0.getDate ? "" : ""}${j0.date.getDate()} au ${jN.date.getDate()} ${mois(jN.date)}</div>
      </div>
      <button class="btn btn-secondary" data-ecran="K">Cockpit</button>
    </div>
    <div class="co-sousnav">
      ${onglets.map(([k, nom, p]) => `
        <button data-ecran="${k}" class="${etat.ecran === k ? "actif" : ""}">
          <span>${nom}</span>${p ? `<span class="co-pastille">${p}</span>` : ""}
        </button>`).join("")}
    </div>`;
}

// LA BARRE DU BAS APPARTIENT À LA COQUILLE, pas à la facette : c'est la seule
// chose qui ne change jamais d'un écran à l'autre.
function barre(calc, gam) {
  const n = enAttente(calc, gam);
  const taches = nTaches(calc);
  const cuisine = etat.ecran !== "K" && etat.ecran !== "J";
  const b = [
    { k: "K", nom: "Cockpit", actif: etat.ecran === "K", p: taches ? String(taches) : "", c: "var(--color-neutral-500)" },
    { k: "A", nom: "Cuisine", actif: cuisine, p: n ? String(n) : "", c: "var(--color-accent)" },
    { k: "J", nom: "Jardin", actif: etat.ecran === "J", p: "", c: "var(--color-accent-2)" },
  ];
  return `<div class="co-barre">
    ${b.map(x => `<button data-ecran="${x.k}" class="${x.actif ? "actif" : ""}">
      <span class="point" style="background:${x.c}"></span>
      <span>${x.nom}</span>
      ${x.p ? `<span class="co-pastille">${x.p}</span>` : ""}
    </button>`).join("")}
  </div>`;
}

const nTaches = calc => (etat.geste && gesteDuJour(calc) ? 0 : gesteDuJour(calc) ? 1 : 0)
  + (etat.rentres.size >= S.articles(calc.panier).length ? 0 : 1) + 1;

/* ─────────────────────────────────────────────────── A — aujourd'hui */

function ecranAujourdhui(calc, gam) {
  const soir = creneauxDuJour(0).find(c => c.repas === "diner");
  const rid = soir ? jeu.choix[soir.i] : null;
  const p = S.joue(rid) ? jeu.plats[rid] : null;
  const corps = [];

  if (!p) {
    corps.push(`<div class="co-vide">Rien de posé ce soir. « Poser un plat » vous en propose quatre.</div>
      <button class="btn btn-primary btn-block" data-poser="${soir ? soir.i : 0}"
        style="margin-top:var(--space-3)">Poser un plat</button>`);
  } else {
    const parts = jeu.parts[soir.i];
    const f = calc.facteurs[soir.i] ?? S.facteurAffiche(p, parts);
    const produit = +(p.portions * f).toFixed(1);
    const total = p.minutes;
    const depart = HEURE.diner - total;
    const sorties = p.emits.map(e => {
      const q = e.qty?.amount != null ? ` · ${fmt(e.qty.amount * f)} ${e.qty.unit}` : "";
      const ou = e.congelo ? "se congèle" : e.gardeFrigo ? `${e.gardeFrigo} j au frigo` : "";
      return `<div class="co-sortie">${esc(e.type)}${q}${ou ? ` — ${ou}` : ""}</div>`;
    });
    const manqueIci = calc.manques.filter(m => m.i === soir.i);
    manqueIci.forEach(m => sorties.push(
      `<div class="co-sortie manque">il manque ${fmt(m.manque)} ${esc(m.unite ?? "")} de ${esc(m.acc.type ?? m.acc.kind)}</div>`));

    corps.push(`
      <div class="co-cesoir">
        <div class="co-kicker" style="color:var(--color-accent-800)">Ce soir · ${jeu.jours[0].nom} · à table ${hhmm(HEURE.diner)}</div>
        <div class="plat">${esc(p.titre)}</div>
        <div class="co-pilules" style="flex-direction:column;align-items:flex-start">
          <span class="co-pilule">${ICO.parts}${fmt(parts)} parts${produit > parts + 0.05 ? ` · ${fmt(produit)} cuisinées` : ""}</span>
          <span class="co-pilule">${ICO.horloge}${duree(total)} · commencer à ${hhmm(depart)}</span>
          ${p.vaisselle ? `<span class="co-pilule">${ICO.placard}${esc(p.vaisselle.label)}</span>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:var(--space-2)">${sorties.join("")}</div>
        <div style="display:flex;gap:var(--space-2);margin-top:var(--space-3)">
          <button class="btn btn-primary" style="flex:1" data-cuisine="${soir.i}">En cuisine</button>
          <button class="btn btn-secondary ${etat.rappel ? "on" : ""}" data-rappel="1"
            style="border-color:var(--color-accent);${etat.rappel ? "background:var(--color-accent-2-200)" : ""}">
            ${etat.rappel ? `Rappel ${hhmm(depart - 10)} ✓` : "Rappel"}</button>
        </div>
      </div>`);
  }

  const g = gesteDuJour(calc);
  if (g) corps.push(`
    <div class="co-geste">
      <span class="rond"></span>
      <div style="flex:1">
        <div class="t">Sortir ${esc(g.type)} du congélo</div>
        <div class="d">Pour ${esc(g.plat.titre)} — ${esc(g.quand)}</div>
      </div>
      <button data-geste="1" class="${etat.geste ? "fait" : ""}">${etat.geste ? "Fait ✓" : "Fait"}</button>
    </div>`);

  const n = enAttente(calc, gam);
  if (n) corps.push(`
    <button class="co-appel" data-ecran="P">
      <span style="flex:1">${n > 1 ? `${n} offres à répondre` : "1 offre à répondre"}</span>
      <span style="font-size:15px">›</span>
    </button>`);

  const demain = creneauxDuJour(1).filter(c => c.nature === "choisi");
  corps.push(`
    <div class="co-kicker" style="margin:var(--space-3) 0 var(--space-1)">Demain</div>
    <div class="co-vide" style="color:var(--color-text)">
      ${demain.map(c => {
        const r = jeu.choix[c.i];
        const t = r === S.SAUTE ? "<em>on ne mange pas là</em>"
          : S.joue(r) ? esc(jeu.plats[r].titre) : "<em>à poser</em>";
        return `${c.label} : ${t}`;
      }).join("<br>")}
    </div>`);

  return `<div class="co-corps plat">${corps.join("")}</div>`;
}

/* ─────────────────────────────────────────────────── W — la semaine */

function ecranSemaine(calc) {
  const ch = chiffres(calc);
  const minutes = S.minutesParJour(jeu, jeu.choix);
  return `
    <div class="co-corps plat">
      <button class="co-chiffres" data-ecran="S">
        <span style="flex:1;display:flex;gap:var(--space-3);align-items:baseline">
          ${ch.map(x => `<span class="n">${x.v}</span>`).join("")}
        </span>
        <span class="lien">Stock ›</span>
      </button>
      <div class="co-legende">
        <span class="pt"></span>
        <span>plat lié à un autre jour — touchez le créneau pour voir le lien</span>
      </div>
      ${jeu.jours.map((j, ij) => {
        const slots = creneauxDuJour(ij);
        const choisis = slots.filter(c => c.nature === "choisi");
        const routines = slots.filter(c => c.nature === "routine");
        const m = minutes[ij];
        return `<div class="co-jour">
          <div class="tete">
            <span class="nom">${j.nom}</span>
            <span class="date">${j.date.getDate()}/${j.date.getMonth() + 1}</span>
            ${m ? `<span class="ctx">${duree(m)}${m > 90 ? " · journée lourde" : ""}</span>` : ""}
          </div>
          <div class="co-slots">${choisis.map(c => slotCarte(c, calc)).join("")}</div>
          ${routines.length ? `<div class="co-routine">${routines.map(c => c.label).join(" · ")} — routine, non comptée</div>` : ""}
        </div>`;
      }).join("")}
      <button class="btn btn-primary btn-block" data-poser="${etat.slot}">Poser un plat</button>
    </div>`;
}

function slotCarte(c, calc) {
  const rid = jeu.choix[c.i];
  const saute = rid === S.SAUTE;
  const p = S.joue(rid) ? jeu.plats[rid] : null;
  const ouvert = etat.ouvert === c.i;
  const recoit = calc.chaine.filter(x => x.creneau === c.i);
  const donne = p ? p.emits : [];
  const lie = recoit.length > 0 || donne.length > 0;
  const souci = calc.manques.filter(m => m.i === c.i)
    .map(m => `manque ${fmt(m.manque)} ${m.unite ?? ""} de ${m.acc.type ?? m.acc.kind}`).join(" · ");
  const parts = jeu.parts[c.i];
  const min = p ? p.minutes : 0;

  return `<button class="co-slot ${saute ? "saute" : ""} ${ouvert ? "ouvert" : ""}" data-slot="${c.i}">
    <div style="display:flex;align-items:center;gap:6px">
      <span class="quand">${c.label}${c.emporte ? " 🥡" : ""}</span>
      <span style="flex:1"></span>
      ${lie && !saute ? '<span class="lien"></span>' : ""}
    </div>
    <div class="nom ${p || saute ? "" : "attente"}">${
      saute ? "on ne mange pas là" : p ? esc(p.titre) : "à poser"}</div>
    ${p ? `<div class="marques">
      <span class="m ${min >= 60 ? "lourd" : ""}">${min === 0 ? "à réchauffer" : duree(min)}</span>
      ${parts !== jeu.data.foyer.parts ? `<span class="m">${fmt(parts)} parts</span>` : ""}
    </div>` : ""}
    ${souci ? `<div class="souci">${esc(souci)}</div>` : ""}
    ${ouvert ? `<div class="detail">
      ${recoit.map(x => `<span class="recoit">↩ ${esc(x.recit || x.type)}</span>`).join("")}
      ${donne.map(e => `<span class="donne">↪ donne ${esc(e.type)}${
        e.congelo ? " (se congèle)" : e.gardeFrigo ? ` (${e.gardeFrigo} j au frigo)` : ""}</span>`).join("")}
      <span class="actions">
        <span data-poser="${c.i}">changer le plat</span>
        <span data-parts="${c.i}">régler les parts</span>
        <span data-sauter="${c.i}">${saute ? "on remange ici" : "sauter"}</span>
      </span>
    </div>` : ""}
  </button>`;
}

/* ─────────────────────────────────────────────────── P — à prévoir */

function ecranPrevoir(calc, gam) {
  const blocs = [];

  // Ce qui s'enchaîne déjà tout seul ne se demande pas : ça se constate.
  for (const g of gam.filter(x => x.fait && x.plat)) blocs.push(`
    <div class="co-offre faite">
      <div class="co-kicker" style="color:var(--color-accent-2-800)">Déjà enchaîné · rien à faire</div>
      <div class="p">La gamelle de ${g.jour} midi se prélève sur le plat de
        <b>${esc(g.plat.titre)}</b> du ${g.jourVeille} soir : <b>${fmt(g.total)} parts</b>
        au lieu de ${fmt(g.partsVeille)}.</div>
    </div>`);

  for (const g of gam.filter(x => !x.fait && x.plat)) {
    const freins = [];
    if (!g.transportable) freins.push("⚠ ce plat voyage mal");
    if (!g.laisseReste) freins.push("⚠ il ne laisse pas de reste réutilisable");
    if (!g.tientVaisselle) freins.push(`⚠ ${fmt(g.total)} parts ne tiennent pas dans ${g.plat.vaisselle.label}`);
    blocs.push(`
      <div class="co-offre">
        <div class="p">🥡 ${g.jour} midi part en gamelle. Cuisiner le
          <b>${esc(g.plat.titre)}</b> de ${g.jourVeille} soir pour <b>${fmt(g.total)} parts</b>
          — ${fmt(g.partsVeille)} + ${fmt(g.partsGamelle)} — et ${g.jour} midi est prêt.</div>
        ${freins.map(f => `<div class="r">${esc(f)}</div>`).join("")}
        ${g.actionnable ? `<div class="btns">
          <button class="btn btn-primary" style="flex:1" data-gamelle="${g.i}">Prévoir la gamelle</button>
        </div>` : ""}
      </div>`);
  }

  for (const [n, o] of calc.offres.entries()) blocs.push(`
    <div class="co-offre">
      <div class="p"><b>${esc(o.titre)}</b> — ${esc(o.combien)}.</div>
      <div class="p">${esc(o.deQuoi)} · ${o.pour.map(([j]) => esc(j)).join(" et ")}
        ne coûte plus rien${o.gainMin ? ` · ${o.gainMin} min gagnées` : ""}.</div>
      ${o.reserves().map(r => `<div class="r">${esc(r)}</div>`).join("")}
      <div class="btns">
        <button class="btn btn-primary" style="flex:1" data-offre="${n}">Agrandir le lot</button>
      </div>
    </div>`);

  return `<div class="co-corps plat">
    <div class="co-note" style="margin-bottom:var(--space-3)">
      Ce qui s'enchaîne tout seul est déjà posé : on ne vous le demande pas. Ne
      restent ici que les manques qu'aucun plat prévu ne couvre — des offres,
      jamais des reproches.</div>
    ${blocs.length ? blocs.join("") : '<div class="co-vide">Rien en attente. La semaine se tient.</div>'}
  </div>`;
}

/* ─────────────────────────────────────────────────── H — poser un plat */

function ecranPoser(calc) {
  const i = etat.slot;
  const c = jeu.creneaux[i];
  const j = jeu.jours[c.jour];
  const saute = jeu.choix[i] === S.SAUTE;
  jeu.slot = i;
  const main = saute ? [] : S.main(jeu);

  return `
    <div class="co-cadran">
      ${chiffres(calc).map(x => x.vers
        ? `<button data-ecran="${x.vers}">
             <span class="k"><span class="co-kicker">${x.k}</span><span style="color:var(--color-accent-700);font-weight:700">›</span></span>
             <span class="v">${x.v}</span></button>`
        : `<div><span class="co-kicker">${x.k}</span><div class="v">${x.v}</div></div>`).join("")}
    </div>
    <div class="co-corps">
      <div class="co-note" style="margin-bottom:var(--space-2)">
        ${esc(j.nom)} ${esc(c.label)}${c.emporte ? " · doit voyager" : ""} —
        les trois chiffres du haut bougent à mesure que vous posez.</div>
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3)">
        <button class="btn btn-secondary" data-parts="${i}">${fmt(jeu.parts[i])} parts</button>
        <button class="btn btn-secondary" data-sauter="${i}">${saute ? "On remange ici" : "Sauter ce repas"}</button>
        <button class="btn btn-ghost" data-repiocher="1">Repiocher ⟳</button>
      </div>
      ${saute ? '<div class="co-vide">Repas sauté — rien à cuisiner, rien à acheter.</div>'
        : main.length ? main.map(l => carteJouable(l, i)).join("")
        : '<div class="co-vide">Plus de cartes pour ce créneau.</div>'}
    </div>`;
}

// LA CARTE DIT CE QU'ELLE CONSOMME ET CE QU'ELLE PRODUIT. C'est le geste
// central de la direction : le coût pendant qu'on choisit, pas après.
function carteJouable(l, i) {
  const p = l.plat;
  const entrees = [];
  if (l.chaine) entrees.push({ etat: l.partiel ? "pas assez" : "trouvé", texte: l.recit || "base déjà cuite" });
  if (l.manque) entrees.push({ etat: "absent", texte: `demande ${p.accepts.map(a => a.type || `un ${a.kind}`).join(", ")} — ça ne s'achète pas` });
  if (l.plein) entrees.push({ etat: "pas assez", texte: `sans le reste : +${p.sansReste.minutes} min et ${p.sansReste.ingredients.map(x => x.nom).join(", ")}` });
  entrees.push({
    etat: l.marginal === 0 ? "trouvé" : "à acheter",
    texte: l.marginal === 0 ? "rien de plus à acheter" : `${l.marginal} article${l.marginal > 1 ? "s" : ""} de plus au panier`,
  });

  const sorties = p.emits.map(e => {
    const clef = e.kind === "reste-plat" ? "frigo" : e.congelo ? "congelo" : "frigo";
    return `<div class="l">${ICO[clef]}<span style="flex:1">${esc(e.type)}${
      e.qty?.amount != null ? ` · ${fmt(e.qty.amount)} ${e.qty.unit} par lot` : ""}</span></div>`;
  });
  if (p.bebe) sorties.push(`<div class="l">${ICO.bebe}<span style="flex:1">portion bébé — ${esc(p.bebe)}</span></div>`);

  const cls = e => e === "trouvé" ? "trouve" : e === "pas assez" ? "court" : "";
  return `<div class="co-jouable">
    <div class="tete">
      <span class="nom">${esc(p.titre)}</span>
      <span class="meta">
        <span>${duree(l.minutes)}</span>
        <span>${l.marginal === 0 ? "+0" : `+${l.marginal}`} art.</span>
      </span>
    </div>
    <div class="co-flux">
      <div class="co-kicker">Consomme</div>
      ${entrees.map(e => `<div class="l"><span class="co-etat ${cls(e.etat)}">${e.etat}</span>
        <span style="flex:1">${esc(e.texte)}</span></div>`).join("")}
    </div>
    ${l.pourquoi.length ? `<div class="co-action">${esc(l.pourquoi[0])}</div>` : ""}
    <div class="co-flux">
      <div class="co-kicker">Produit</div>
      ${sorties.length ? sorties.join("")
        : '<div class="l" style="color:var(--color-neutral-700)">Rien — tout est mangé le soir même.</div>'}
    </div>
    <div class="pied">
      <button class="btn btn-primary" style="flex:1" data-jouer="${p.id}">Poser sur ce créneau</button>
      <button class="btn btn-ghost" data-cuisine="${i}" data-plat="${p.id}">Fiche</button>
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────────── B — en cuisine */

function ecranCuisine(calc) {
  const { plat: pid, creneau: i } = etat.fiche || {};
  const p = jeu.plats[pid];
  if (!p) return '<div class="co-corps plat"><div class="co-vide">Plat introuvable.</div></div>';
  const parts = i != null ? jeu.parts[i] : jeu.data.foyer.parts;
  const f = (i != null && calc.facteurs[i]) ? calc.facteurs[i] : S.facteurAffiche(p, parts);
  const produit = +(p.portions * f).toFixed(1);
  const steps = p.steps || [];

  const tete = `
    <div class="co-fiche-tete">
      <button class="co-retour" data-ecran="A">‹ Sortir</button>
      <span class="t">${esc(p.titre)}</span>
      <button class="btn ${etat.ingr ? "btn-primary" : "btn-secondary"}" data-ingr="1"
        style="font-size:12.5px;padding:7px 13px">Ingrédients</button>
    </div>
    <div class="co-segments">${steps.map((_, n) =>
      `<i class="${n < etat.etape ? "faite" : n === etat.etape ? "ici" : ""}"></i>`).join("")}</div>`;

  if (etat.ingr || !steps.length) {
    const prov = ing => {
      const cid = jeu.data.rayons.aliases?.[ing.id] ?? ing.id;
      if (ing.base) return ["base", "acheter"];
      if ((jeu.data.rayons.placard || []).includes(cid)) return ["placard", ""];
      return ["à acheter", "acheter"];
    };
    return `${tete}
      <div class="co-corps">
        <div class="co-encart">${ICO.info}
          <span><b>Pour ${fmt(parts)} parts · on en cuisine ${fmt(produit)}.</b>
          ${produit > parts + 0.05 ? (p.lotEntier ? "Le lot ne se coupe pas." : "Ça se garde, autant faire le lot.") : ""}</span></div>
        <div class="co-ing">
          ${p.ingredients.map(x => {
            const [lab, k] = prov(x);
            return `<div class="l">
              <span class="nom">${esc(x.nom)}</span>
              <span class="q">${S.echelleTexte(x, f)}</span>
              <span class="p ${k}">${lab}</span></div>`;
          }).join("")}
        </div>
        ${steps.length ? `<button class="btn btn-secondary btn-block" data-ingr="1"
          style="margin-top:var(--space-3)">Revenir à l'étape ${etat.etape + 1}</button>` : ""}
      </div>`;
  }

  const e = steps[Math.min(etat.etape, steps.length - 1)];
  const total = steps.reduce((a, x) => a + (x.minutes || 0), 0);
  const reste = steps.slice(etat.etape).reduce((a, x) => a + (x.minutes || 0), 0);
  const ch = CHAUFFE.find(c => (e.needs || []).some(n => c.n.includes(n)));
  const chauffe = ch || { nom: "Sans feu", niveau: 0 };
  const aMinuteur = (e.minutes || 0) > 0;
  const dernier = etat.etape === steps.length - 1;

  return `${tete}
    <div class="co-etape">
      <div class="bandeau">
        <span>À table ${hhmm(HEURE[jeu.creneaux[i ?? 0]?.repas] ?? HEURE.diner)}</span>
        <em>reste ${duree(reste)} sur ${duree(total)}</em>
      </div>
      <div class="co-kicker accent">Étape ${etat.etape + 1} sur ${steps.length}</div>
      <div class="geste">${esc(e.action)}</div>
      <div class="texte">${e.surveille === false ? "Sans surveiller." : ""}
        ${e.minutes ? `${e.minutes} min.` : ""}</div>
      ${e.enfant ? `<div class="co-encart enfant">${ICO.enfant}
        <span><span class="co-kicker" style="color:inherit">Avec l'enfant${
          e.enfantDes ? ` · dès ${e.enfantDes} mois` : ""}</span>
        <br>${esc(e.enfant)}</span></div>` : ""}
      ${e.porteAssaisonnement && p.bebe ? `<div class="co-encart">${ICO.info}
        <span>Prélever la portion bébé <b>avant</b> d'assaisonner — ${esc(p.bebe)}</span></div>` : ""}

      <div style="flex:1"></div>

      ${(chauffe.niveau > 0 || aMinuteur) ? `<div class="co-reglages">
        ${chauffe.niveau > 0 ? `<div>
          <span class="co-kicker">Chauffe</span>
          <div class="chauffe-nom">${chauffe.nom}</div>
          <div class="barres">${[1, 2, 3, 4].map(n =>
            `<i class="${n <= chauffe.niveau ? "on" : ""}"></i>`).join("")}</div>
        </div>` : ""}
        ${aMinuteur ? `<button class="co-minuteur ${etat.tActif ? "actif" : ""}" data-minuteur="${e.minutes}">
          <span class="k" style="display:flex;align-items:center;justify-content:space-between">
            <span class="co-kicker">Minuteur</span>
            <span style="color:${etat.tActif ? "var(--color-accent-800)" : "var(--color-neutral-600)"};display:flex">${ICO.minuteur}</span>
          </span>
          <div class="n">${mmss(etat.tRestant > 0 ? etat.tRestant : e.minutes * 60)}</div>
          <div class="aide">${etat.tActif ? "en cours" : etat.tRestant > 0 ? "en pause · toucher pour reprendre" : "toucher pour lancer"}</div>
        </button>` : ""}
      </div>` : ""}
      ${etat.tSonne ? `<div class="co-encart enfant" style="margin-top:var(--space-2)">${ICO.cloche}
        <span><b>Minuteur terminé.</b></span></div>` : ""}

      <div class="co-pas">
        <button class="prec" data-etape="-1" ${etat.etape === 0 ? "disabled" : ""}>‹</button>
        <button class="suiv" data-etape="1">${dernier ? "Terminer" : "C'est fait"}</button>
      </div>
    </div>`;
}

/* ─────────────────────────────────────────────────── C — les courses */

function ecranCourses(calc) {
  const arts = S.articles(calc.panier);
  const groupes = S.parRayon(jeu.data, calc.panier);
  const magasin = etat.mode === "magasin";
  const n = magasin ? etat.coches.size : etat.rentres.size;

  // Ce qui n'est pas sur la liste, et pourquoi. « À cuisiner d'avance » est le
  // cas contre-intuitif : une base manquante ne s'achète nulle part.
  const hors = Object.entries(calc.provenances)
    .filter(([p]) => p !== "courses")
    .map(([p, k]) => [jeu.data.provenances[p], k]);

  return `
    <div class="co-tete" style="padding-top:0">
      <div>
        <div class="co-kicker">${magasin ? `${n} sur ${arts.length} dans le caddie` : `${n} sur ${arts.length} rentrés au stock`}</div>
      </div>
      <div class="co-seg">
        <button data-mode="magasin" class="${magasin ? "on" : ""}">Au magasin</button>
        <button data-mode="maison" class="${!magasin ? "on" : ""}">À la maison</button>
      </div>
    </div>
    <div class="co-corps">
      <div class="co-aide">${magasin
        ? "Au magasin, on coche : l'article est dans le caddie. Rien n'entre au stock tant qu'on n'est pas rentré."
        : "À la maison, on rentre : l'article rejoint le stock, et le plat qui l'attendait passe en « trouvé »."}</div>
      ${groupes.map(([rayon, items]) => `
        <div style="margin-bottom:var(--space-3)">
          <div class="co-kicker" style="margin-bottom:var(--space-1)">${esc(rayon)}</div>
          ${items.map(a => {
            const c = cleArt(a);
            const on = magasin ? etat.coches.has(c) : etat.rentres.has(c);
            return `<button class="co-art ${on ? (magasin ? "coche" : "rentre") : ""}" data-cocher="${esc(c)}">
              <span class="puce">${on ? (magasin ? "✓" : "↓") : ""}</span>
              <span style="flex:1">
                <span class="nom">${esc(a.nom)}</span>
                <div class="pour">${a.n > 1 ? `${a.n} plats` : "1 plat"}</div>
              </span>
              <span class="q">${fmt(a.qty)} ${esc(a.unit)}</span>
            </button>`;
          }).join("")}
        </div>`).join("")}
      ${calc.aVerifier.size ? `<div class="co-vide" style="margin-bottom:var(--space-3)">
        <b>À vérifier au placard</b><br>${[...calc.aVerifier.values()].map(esc).join(" · ")}</div>` : ""}
      ${hors.length ? `<div class="co-offre">
        <div class="co-kicker accent">Hors liste</div>
        <div class="co-note" style="margin-top:2px">Ce que la semaine demande et qu'on n'achète pas.</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-3)">
          ${hors.map(([lab, k]) => `<span class="tag tag-accent">${esc(lab)} : ${k}</span>`).join("")}
        </div>
      </div>` : ""}
    </div>`;
}

/* ─────────────────────────────────────────────────── D — les parts */

function ecranParts(calc) {
  const i = etat.slot;
  const c = jeu.creneaux[i];
  const j = jeu.jours[c.jour];
  const rid = jeu.choix[i];
  const p = S.joue(rid) ? jeu.plats[rid] : null;
  const parts = jeu.parts[i];
  const foyer = jeu.data.foyer.parts;
  const f = p ? S.facteurAffiche(p, parts) : 1;
  const produit = p ? +(p.portions * f).toFixed(1) : 0;
  const tient = !p?.vaisselle || f <= p.vaisselle.facteurMax + 1e-9;

  const autres = jeu.creneaux.map((x, k) => ({ ...x, k }))
    .filter(x => x.nature === "choisi" && x.k !== i && (jeu.choix[x.k] != null))
    .slice(0, 6);

  return `
    <div class="co-corps plat">
      <button class="co-retour" data-ecran="W">‹ La semaine</button>
      <div style="margin:var(--space-2) 0 var(--space-3)">
        <div class="co-tete" style="padding:0">
          <div>
            <div class="titre" style="text-transform:capitalize">${esc(j.nom)} ${esc(c.label)}</div>
            <div class="sous">${p ? esc(p.titre) : "aucun plat posé"}</div>
          </div>
        </div>
      </div>
      <div class="co-parts">
        <div style="display:flex;align-items:baseline;justify-content:space-between">
          <span class="co-kicker">Parts du créneau</span>
          <span style="font-size:11.5px;color:var(--color-neutral-700)">foyer : ${fmt(foyer)}</span>
        </div>
        <div class="ligne">
          <button class="rond" data-pas="-0.5" aria-label="moins de parts">–</button>
          <div style="flex:1;text-align:center">
            <div class="n">${fmt(parts)}</div>
            <div class="co-note">${parts === foyer ? "comme le foyer"
              : parts > foyer ? `+${fmt(parts - foyer)} de plus que le foyer`
              : `${fmt(parts - foyer)} — quelqu'un mange dehors`}</div>
          </div>
          <button class="rond plus" data-pas="0.5" aria-label="plus de parts">+</button>
        </div>
        <div class="co-crans">
          ${Array.from({ length: 9 }, (_, n) => {
            const v = Math.max(0.5, foyer - 2) + n * 0.5;
            return `<i class="${Math.abs(v - parts) < 0.01 ? "ici" : v === foyer ? "foyer" : ""}"></i>`;
          }).join("")}
        </div>
        <div class="co-note" style="text-align:center;margin-top:var(--space-2)">
          Pas de 0,5 — la part d'un petit. Pouce sur le bouton, l'autre main tient le petit.</div>
      </div>
      ${p ? `<div class="co-duo">
        <div class="lot">
          <span class="co-kicker" style="color:var(--color-accent-800)">Cuisiné</span>
          <div class="v">${fmt(produit)} parts</div>
        </div>
        <div>
          <span class="co-kicker">Réserve</span>
          <div class="t">${tient
            ? (p.vaisselle ? `Tient dans ${esc(p.vaisselle.label)}.` : "Rien ne borne ce plat.")
            : `⚠ Au-delà, ça ne tient pas : ${esc(p.vaisselle.label)} (×${fmt(p.vaisselle.facteurMax)} max).`}</div>
        </div>
      </div>` : ""}
      <div class="co-kicker" style="margin:var(--space-4) 0 var(--space-2)">Le reste de la semaine</div>
      ${autres.map(x => {
        const r = jeu.choix[x.k];
        const saute = r === S.SAUTE;
        const q = S.joue(r) ? jeu.plats[r] : null;
        const souci = calc.manques.filter(m => m.i === x.k).length;
        return `<div class="co-apercu ${saute ? "saute" : ""}">
          <span class="quand">${esc(jeu.jours[x.jour].nom.slice(0, 3))} ${esc(x.label)}</span>
          <span style="flex:1">
            <div class="plat">${saute ? "on ne mange pas là" : q ? esc(q.titre) : "à poser"}</div>
            ${souci ? '<div class="note souci">un manque sur ce créneau</div>'
              : jeu.parts[x.k] !== jeu.data.foyer.parts ? `<div class="note">${fmt(jeu.parts[x.k])} parts</div>` : ""}
          </span>
          ${saute ? '<span class="tag">sauté</span>' : ""}
        </div>`;
      }).join("")}
      <div class="co-encart" style="margin-top:var(--space-3)">${ICO.info}
        <span>Un créneau <b>sauté</b> n'est pas vide : ni courses, ni minutes, ni apports.
        Il garde sa place et sa raison.</span></div>
    </div>`;
}

/* ─────────────────────────────────────────────────── S — l'inventaire */

// La FIABILITÉ d'un chiffre, dérivée de ce que le dépôt sait réellement.
// Le canevas la posait à la main en cinq catégories inventées ; le modèle porte
// la même idée sous une autre forme — une ligne chiffrée, une ligne déduite
// d'un plat cuisiné, une ligne qui n'a qu'une bande de repas.
function fiabilite(l) {
  if (l._from) return ["estimé", "estime", "moyenne"];
  if (l.qty?.amount != null) return ["compté", "compte", "haute"];
  return ["en bloc", "", "basse"];
}

function ecranStock(calc) {
  const lignes = calc.depot.lignes;
  const parEspace = { frigo: [], congelo: [], placard: [] };
  for (const l of lignes) (parEspace[espaceDe(l)] ||= []).push(l);

  const cats = Object.entries(parEspace).filter(([, v]) => v.length).map(([id, v]) => {
    const vivants = v.filter(l => !l._epuise);
    const conf = v.some(l => fiabilite(l)[2] === "basse") ? "basse"
      : v.every(l => fiabilite(l)[2] === "haute") ? "haute" : "moyenne";
    const etats = [...new Set(v.map(l => fiabilite(l)[0]))];
    return { id, nom: ESPACES[id], n: Math.min(4, vivants.length), total: vivants.length, conf, etat: etats.join(" · ") };
  });

  const montres = etat.cat ? lignes.filter(l => espaceDe(l) === etat.cat) : lignes;

  return `<div class="co-corps plat">
    <button class="co-retour" data-ecran="W">‹ La semaine</button>
    <div class="co-h" style="margin-top:var(--space-2)">L'inventaire</div>
    <div class="co-note" style="margin-top:var(--space-1)">
      ${etat.cat ? `Ce que le ${ESPACES[etat.cat].toLowerCase()} porte, et d'où vient chaque chiffre.`
        : "Ce qui est chez vous, par où c'est rangé. Chaque rangement porte en mots la fiabilité de son chiffre."}</div>

    <div class="co-cats">
      ${cats.map(c => `<button data-cat="${c.id}" class="${etat.cat === c.id ? "on" : ""}">
        <span style="flex:1">
          <div class="nom">${c.nom}</div>
          <div class="note">${c.total} lot${c.total > 1 ? "s" : ""} · ${esc(c.etat)}</div>
        </span>
        <span class="co-jauge ${c.conf}">${Array.from({ length: 4 }, (_, k) =>
          `<i class="${k < c.n ? "on" : ""}"></i>`).join("")}</span>
      </button>`).join("")}
    </div>

    <div class="co-kicker" style="margin:var(--space-4) var(--space-1) var(--space-2)">La cuisine est un lieu fini</div>
    <div class="co-espaces">
      ${Object.entries(calc.stockage).map(([id, s]) => {
        const boites = s.cause === "contenant";
        const p = (n, max) => `width:${Math.max(0, Math.min(100, Math.round(n / max * 100)))}%`;
        const geste = boites ? "laver des boîtes" : "dégager une étagère";
        return `<div class="co-espace">
          <div class="nom">${ESPACES[id]}</div>
          <div class="plafond ${!boites ? "commande" : ""}">
            <div class="t"><span>étagères</span><span>${Math.max(0, +(s.places - s.fin).toFixed(1))} libres</span></div>
            <div class="rail"><i style="${p(s.fin, s.places)}"></i></div>
          </div>
          <div class="plafond ${boites ? "commande" : ""}">
            <div class="t"><span>contenants</span><span>${Math.max(0, +(s.contenants - s.fin).toFixed(1))} libres</span></div>
            <div class="rail"><i style="${p(s.fin, s.contenants)}"></i></div>
          </div>
          ${s.deborde ? `<div class="geste">⚠ ça déborde — ${geste}</div>`
            : `<div class="geste">${geste}</div>`}
        </div>`;
      }).join("")}
    </div>
    <div class="co-note" style="margin:var(--space-2) var(--space-1) 0">
      Deux plafonds par espace : les étagères et les contenants. Le plus bas
      commande, et c'est lui qui passe en terre cuite — laver deux bocaux n'est
      pas dégager une étagère.</div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin:var(--space-4) var(--space-1) var(--space-2)">
      <span class="co-kicker">${etat.cat ? `Lots · ${ESPACES[etat.cat]}` : "Tous les lots"}</span>
      ${etat.cat ? '<button class="co-retour" data-cat="">Tout voir</button>' : ""}
    </div>
    ${montres.length ? montres.map(l => {
      const [lab, k] = fiabilite(l);
      const q = l.qty?.amount;
      const reste = l._reste != null && q != null && l._reste < q ? ` · reste ${fmt(l._reste)} ${l._unite}` : "";
      return `<div class="co-lot ${l._epuise ? "mange" : ""}">
        <span style="color:var(--color-neutral-700);display:flex">${ICO[espaceDe(l)]}</span>
        <span style="flex:1">
          <div class="nom">${esc(l.type)}</div>
          <div class="ou">${ESPACES[espaceDe(l)]}${
            l._from ? ` · cuisiné cette semaine (${esc(jeu.plats[l._from]?.titre ?? l._from)})` : " · déjà là avant la semaine"
          }${reste}${l._epuise ? " · mangé par la semaine" : ""}</div>
        </span>
        <span>
          <div class="q">${q != null ? `${fmt(q)} ${esc(l._unite ?? "")}` : esc(l.band ?? l.qty_band ?? "—")}</div>
          <div class="src ${k}">${lab}</div>
        </span>
      </div>`;
    }).join("") : '<div class="co-vide">Rien ici.</div>'}
    <div class="co-encart" style="margin-top:var(--space-3)">${ICO.info}
      <span><b>Compté</b> : la quantité vient de l'export, elle est juste.
      <b>Estimé</b> : déduite d'un plat cuisiné cette semaine, à vérifier de l'œil.
      <b>En bloc</b> : pas compté du tout — on sait seulement que ça existe.</span></div>
  </div>`;
}

/* ─────────────────────────────────────────────────── K — le cockpit */

function ecranCockpit(calc, gam) {
  const arts = S.articles(calc.panier);
  const minutes = S.minutesParJour(jeu, jeu.choix).reduce((a, b) => a + b, 0);
  const n = enAttente(calc, gam);
  const g = gesteDuJour(calc);
  const taches = [
    g && !etat.geste ? { f: "Cuisine", t: `Sortir ${g.type} du congélo`, d: `Pour ${g.plat.titre} — ${g.quand}` } : null,
    etat.rentres.size >= arts.length && arts.length ? null
      : { f: "Cuisine", t: "Les courses", d: etat.coches.size ? `${etat.coches.size} sur ${arts.length} cochés · rien de rentré au stock` : `${arts.length} articles à cocher` },
    quetes[0] ? { f: "Jardin", t: quetes[0].titre, d: quetes[0].detail } : null,
  ].filter(Boolean);

  return `<div class="co-corps plat">
    <div class="co-h" style="text-transform:capitalize">${jeu.jours[0].nom} ${jeu.jours[0].date.getDate()} ${
      jeu.jours[0].date.toLocaleDateString("fr-FR", { month: "long" })}</div>
    <div style="font-size:14px;line-height:1.5;color:var(--color-neutral-700);margin-top:var(--space-1)">
      Deux facettes actives. ${taches.length === 0 ? "Rien ne vous attend aujourd'hui."
        : `${taches.length === 1 ? "Une chose vous attend" : `${taches.length} choses vous attendent`} aujourd'hui, toutes facettes confondues.`}</div>

    <div style="margin:var(--space-4) 0 var(--space-6)">
      ${taches.map(t => `<div class="co-tache">
        <span class="p ${t.f === "Jardin" ? "jardin" : ""}">${t.f}</span>
        <span style="flex:1"><div class="t">${esc(t.t)}</div><div class="d">${esc(t.d)}</div></span>
      </div>`).join("")}
    </div>

    <div class="co-kicker" style="margin-bottom:var(--space-2)">Vos facettes</div>
    <button class="co-facette cuisine" data-ecran="A">
      <span class="tete"><span class="nom">Cuisine</span>
        <span class="etat">${jeu.creneaux.filter(c => c.nature === "choisi").length} créneaux</span></span>
      <span class="resume">${n === 0 ? "La semaine est posée jusqu'à dimanche, tout est répondu."
        : `La semaine est posée jusqu'à dimanche. ${n > 1 ? `${n} offres attendent` : "Une offre attend"} votre réponse.`}</span>
      <span class="chiffres">
        <span>${arts.length} articles</span>
        <span>${duree(minutes)} de cuisine</span>
        ${n ? `<span>${n > 1 ? `${n} offres ouvertes` : "1 offre ouverte"}</span>` : ""}
      </span>
    </button>
    <button class="co-facette jardin" data-ecran="J">
      <span class="tete"><span class="nom">Jardin</span><span class="etat">3 bacs</span></span>
      <span class="resume">${esc(quetes[0]?.detail ?? "Rien en cours.")}</span>
      <span class="chiffres">${quetes.slice(0, 2).map(q => `<span>${esc(q.titre)}</span>`).join("")}</span>
    </button>
    <div class="co-facette dort">
      <span class="tete"><span class="nom">Maison</span><span class="etat">en sommeil</span></span>
      <span class="resume">Facette pas encore ouverte. Elle reste ici, sans chiffre, jusqu'au jour où elle servira.</span>
    </div>
    <div class="co-note" style="margin-top:var(--space-4)">
      La barre du bas suit partout : elle appartient à la coquille, pas à la facette.</div>
  </div>`;
}

// Le jardin n'est pas l'objet de cette direction — il est là pour que la barre
// du bas ne soit pas un mensonge : une coquille à trois facettes dont deux
// n'ouvrent rien ne se juge pas.
function ecranJardin() {
  return `<div class="co-corps plat">
    <div class="co-h">Jardin</div>
    <div class="co-note" style="margin:var(--space-1) 0 var(--space-4)">
      Cette facette n'est pas ce que la direction teste : elle est ici pour que
      la coquille en porte réellement deux.</div>
    ${quetes.map(q => `<div class="co-tache">
      <span class="p jardin">${esc(q.fenetre === "nudge" ? "nudge" : q.fenetre === "bientot" ? "bientôt" : "ouverte")}</span>
      <span style="flex:1"><div class="t">${esc(q.titre)}</div><div class="d">${esc(q.detail)}</div></span>
    </div>`).join("")}
  </div>`;
}

/* ────────────────────────────────────────────────────────────── les gestes */

function brancher(calc, gam) {
  const sur = (sel, fn) => hote.querySelectorAll(sel).forEach(
    b => b.addEventListener("click", e => { e.stopPropagation(); fn(b, e); }));

  sur("[data-ecran]", b => { etat.ecran = b.dataset.ecran; etat.cat = null; rendre(); });

  sur("[data-slot]", b => {
    const i = +b.dataset.slot;
    etat.ouvert = etat.ouvert === i ? null : i;
    etat.slot = i;
    rendre();
  });
  sur("[data-poser]", b => { etat.slot = +b.dataset.poser; jeu.slot = etat.slot; etat.ecran = "H"; rendre(); });
  sur("[data-parts]", b => { etat.slot = +b.dataset.parts; etat.ecran = "D"; rendre(); });
  sur("[data-sauter]", b => {
    const i = +b.dataset.sauter;
    jeu.choix[i] = jeu.choix[i] === S.SAUTE ? null : S.SAUTE;
    rendre();
  });
  sur("[data-jouer]", b => { jeu.choix[etat.slot] = b.dataset.jouer; etat.ecran = "W"; etat.ouvert = etat.slot; rendre(); });
  sur("[data-repiocher]", () => { jeu.repioches[etat.slot]++; rendre(); });
  sur("[data-pas]", b => {
    const i = etat.slot;
    jeu.parts[i] = Math.max(0.5, Math.round((jeu.parts[i] + +b.dataset.pas) * 2) / 2);
    rendre();
  });

  sur("[data-cuisine]", b => {
    const i = +b.dataset.cuisine;
    const pid = b.dataset.plat || jeu.choix[i];
    if (!S.joue(pid)) return;
    etat.fiche = { plat: pid, creneau: i };
    etat.ecran = "B"; etat.etape = 0; etat.ingr = false;
    etat.tActif = false; etat.tRestant = 0; etat.tSonne = false;
    rendre();
  });
  sur("[data-ingr]", () => { etat.ingr = !etat.ingr; rendre(); });
  sur("[data-etape]", b => {
    const steps = jeu.plats[etat.fiche.plat].steps || [];
    const d = +b.dataset.etape;
    if (d > 0 && etat.etape === steps.length - 1) { etat.ecran = "A"; etat.etape = 0; }
    else etat.etape = Math.max(0, Math.min(steps.length - 1, etat.etape + d));
    etat.tActif = false; etat.tRestant = 0; etat.tSonne = false;
    rendre();
  });
  sur("[data-minuteur]", b => {
    const m = +b.dataset.minuteur;
    etat.tActif = !etat.tActif;
    etat.tSonne = false;
    if (etat.tRestant <= 0) etat.tRestant = m * 60;
    rendre();
  });

  sur("[data-geste]", () => { etat.geste = !etat.geste; rendre(); });
  sur("[data-rappel]", () => { etat.rappel = !etat.rappel; rendre(); });

  // LA GAMELLE : le dîner de la veille grossit d'autant, et le midi part sur le
  // reste. Une action, parce que c'est un choix — le proto ne le fait pas seul.
  sur("[data-gamelle]", b => {
    const g = gam.find(x => x.i === +b.dataset.gamelle);
    if (!g) return;
    jeu.parts[g.veille] = Math.round((g.partsVeille + g.partsGamelle) * 2) / 2;
    jeu.choix[g.i] = "reste-de-la-veille";
    rendre();
  });
  // AGRANDIR UN LOT, c'est régler les parts du créneau amont : le modèle ne
  // connaît pas d'autre levier, et c'est heureux — un facteur qui ne serait
  // pas un nombre de parts ne se lirait nulle part ailleurs dans l'écran.
  sur("[data-offre]", b => {
    const o = calc.offres[+b.dataset.offre];
    if (!o) return;
    const p = jeu.plats[o.rid];
    jeu.parts[o.creneau] = Math.max(jeu.parts[o.creneau],
      Math.round(o.facteurPropose * p.portions * 2) / 2);
    rendre();
  });

  sur("[data-mode]", b => { etat.mode = b.dataset.mode; rendre(); });
  sur("[data-cocher]", b => {
    const c = b.dataset.cocher;
    const set = etat.mode === "magasin" ? etat.coches : etat.rentres;
    if (set.has(c)) set.delete(c); else set.add(c);
    rendre();
  });
  sur("[data-cat]", b => { etat.cat = b.dataset.cat || null; rendre(); });
}
