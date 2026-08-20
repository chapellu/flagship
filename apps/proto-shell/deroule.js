// PROTOTYPE — LE DÉROULÉ GUIDÉ. Un écran, un geste.
//
// CE QUE LA FICHE NE POUVAIT PAS FAIRE
// La fiche recette montre tout d'un coup : les quantités en haut, la marche à
// suivre en bas. C'est une PAGE DE LIVRE, et un livre se lit avant de cuisiner.
// Les mains dans la farine, à 40 cm de l'écran, il faut l'inverse : le geste
// courant en gros, ce qu'il réclame et rien d'autre, et le minuteur déjà armé.
// C'est ce que fait un appareil de cuisson guidée, et c'est tout ce qu'il fait.
//
// TROIS CHOSES QUE CE FOYER A ET QU'UN THERMOMIX N'A PAS
//   · DES GESTES EN PARALLÈLE. Un robot fait une chose à la fois, donc son
//     déroulé est une file. Ici la pâte se pétrit PENDANT que la poêlée
//     refroidit — le modèle le sait (`enParallele`), et l'écran doit le montrer
//     comme une seule tranche de temps, pas comme deux étapes à la suite.
//   · PLUSIEURS MINUTEURS À LA FOIS. Corollaire du point précédent : le four
//     tourne pendant qu'on fouette. Les minuteurs vivent donc dans une barre
//     qui SURVIT à la navigation — quitter l'étape n'arrête pas sa cuisson.
//   · UN BÉBÉ. Le prélèvement non salé est une étape à part entière, injectée
//     là où la recette dit qu'il y a encore du nature à prendre (`bebeApres`),
//     et pas à la porte de sel — voir le commentaire de `compile.py`.
//
// PAS D'HEURE AU MUR, ET C'EST DÉLIBÉRÉ. Chaque étape pourrait afficher « 18h42 ».
// Ce serait une fausse précision : la durée d'un geste est une estimation, et
// une horloge qui dérive de dix minutes au troisième écran ne se rattrape
// jamais. Un compte à rebours, lui, est juste par construction. Les seules
// heures affichées sont celles des BORNES — quand commencer, quand on sert.

import { echelleTexte } from "./semaine.js";

const FOUR = new Set(["bake", "gratin", "roast", "grill"]);

let etat = null;          // { plats: [...], iPlat, iEtape, vue }
let hote = null;
let horloge = null;
// Les minuteurs SURVIVENT à la navigation et au changement de plat : c'est le
// four qui tourne pendant qu'on fouette autre chose. Clé = `platId:etapeId`.
const minuteurs = new Map();
let veille = null;        // wakeLock — un écran qui s'éteint en cuisine est inutile

/* ------------------------------------------------------------------ modèle */

// LE COÛT EN TEMPS RÉEL D'UNE ÉTAPE, capacité comprise. `needs:` est en
// capacités ; la table `outils` dit sur quel objet du foyer chacune retombe et
// ce que le repli coûte en minutes (hacher au couteau plutôt qu'au robot, +5).
function outil(data, e) {
  for (const cap of e.needs || []) {
    const o = data.foyer.outils?.[cap];
    if (o) return o;
  }
  return null;
}
const minutesDe = (data, e) => (e.minutes || 0) + (outil(data, e)?.deltaMin || 0);

// LES CARTES DU DÉROULÉ — les étapes de la recette, plus le prélèvement bébé
// glissé à sa place. C'est la seule transformation : on n'invente pas d'étape,
// on n'en fusionne pas.
export function cartes(data, plat) {
  const out = [];
  const porte = plat.steps.find(s => s.porteAssaisonnement);
  // Où prélever : ce que la recette DIT (`bebeApres`, dernière étape d'où sort
  // la portion), et à défaut seulement, la porte d'assaisonnement — la
  // devinette que `compile.py` faisait pour tout le monde.
  const ancre = plat.bebe ? (plat.bebeApres || null) : null;
  const avant = plat.bebe && !ancre ? porte?.id : null;
  const bebe = {
    id: "__bebe", bebe: true,
    action: `Prélever ${plat.bebe}${plat.bebePrep ? ` ; ${plat.bebePrep}` : ""}`,
    minutes: 3, needs: [], uses: [],
    // Le prélèvement se fait pendant que la poêlée refroidit : il ne coûte pas
    // trois minutes de plus au dîner, il les prend dans une attente déjà là.
    enParallele: ancre,
  };
  for (const s of plat.steps) {
    if (s.id === avant) out.push(bebe);
    out.push(s);
    if (s.id === ancre) out.push(bebe);
  }
  return out;
}

// LE FIL DU TEMPS. Un seul cuisinier : le fil principal avance étape par étape,
// une attente le bloque, et les étapes déclarées en parallèle se glissent dans
// cette attente au lieu de s'ajouter derrière. C'est la transcription de ce que
// `anticipation.py` calcule côté Python — approchée, et elle n'est utilisée que
// pour placer les BLOCS DE FOUR les uns par rapport aux autres, jamais pour
// afficher une heure de geste.
export function fil(data, plat) {
  const cs = cartes(data, plat);
  let t = 0, libre = 0, curseurPar = null;
  const fin = {};
  const pose = cs.map(e => {
    const m = minutesDe(data, e);
    if (e.enParallele && fin[e.enParallele] != null) {
      if (curseurPar == null) curseurPar = fin[e.enParallele];
      const debut = curseurPar;
      curseurPar += m;
      libre = Math.max(libre, curseurPar);
      return { e, debut, min: m, parallele: true };
    }
    t = Math.max(t, libre);
    const debut = t;
    t += m;
    fin[e.id] = t;
    libre = t + (e.attente || 0);
    curseurPar = null;
    return { e, debut, min: m, parallele: false };
  });
  return { pose, duree: Math.max(t, libre) };
}

// RÉGLER LE FOUR N'EST PAS L'OCCUPER. « Préchauffer à 180 °C » réclame la
// capacité `bake` comme « enfourner 45 min », et dure une minute : c'est un
// tour de bouton, pas une cuisson. Sans distinction, le préchauffage de la
// tourte — première étape de la recette, donc 50 min avant sa vraie cuisson —
// se lisait comme une occupation du four à 17h50 et faisait déclarer un conflit
// à la mauvaise heure.
//
// La règle est un SEUIL, faute de champ : aucune étape ne peut dire « je règle
// l'appareil » plutôt que « je m'en sers ». C'est le manque à combler côté
// modèle — et c'est le même manque qui fait qu'aucune température n'est
// lisible ailleurs que dans la phrase.
const REGLAGE_MAX_MIN = 2;

// CE QUI OCCUPE LE FOUR, en minutes depuis minuit. Le four est une ressource
// EXCLUSIVE et le modèle ne le sait nulle part : chaque plat calcule son heure
// de départ tout seul, comme s'il était seul en cuisine.
export function blocsFour(data, plat, heureRepas) {
  const { pose, duree } = fil(data, plat);
  const depart = heureRepas - duree;
  return pose
    .filter(p => (p.e.needs || []).some(c => FOUR.has(c)) && p.min > REGLAGE_MAX_MIN)
    .map(p => ({ plat, etape: p.e, debut: depart + p.debut, fin: depart + p.debut + p.min }));
}

// LA COLLISION, et c'est la trouvaille de ce déroulé. Deux plats du même soir
// réclament le même four à des températures différentes, et rien dans le modèle
// ne pouvait le dire — `minutesSurPlace` et `avanceMin` sont calculés PLAT PAR
// PLAT. On rend le décalage à appliquer, pas seulement l'alerte : « ça se
// chevauche » sans « de combien » n'aide personne devant un four.
export function conflitFour(blocs) {
  const par = [...blocs].sort((a, b) => a.debut - b.debut);
  for (let i = 1; i < par.length; i++) {
    const a = par[i - 1], b = par[i];
    if (b.plat.id !== a.plat.id && b.debut < a.fin) {
      return { avant: a, apres: b, chevauche: Math.round(a.fin - b.debut) };
    }
  }
  return null;
}

// LE PLAN DE LA SOIRÉE — et il montre le plan CORRIGÉ, pas le plan cassé.
// Afficher deux heures de départ qui ne peuvent pas coexister, puis expliquer
// en dessous pourquoi, oblige le lecteur à faire la soustraction lui-même
// devant son four. On applique donc le décalage aux heures affichées, et
// l'encadré ne sert plus qu'à dire ce qui a bougé et pourquoi.
export function plan(plats) {
  const brut = new Map(plats.map(
    p => [p.plat.id, p.heureRepas - fil(p.data, p.plat).duree]));
  const conflit = conflitFour(plats.flatMap(p => blocsFour(p.data, p.plat, p.heureRepas)));
  const depart = new Map(brut);
  if (conflit) {
    depart.set(conflit.avant.plat.id, brut.get(conflit.avant.plat.id) - conflit.chevauche);
  }
  const decale = p => {
    const d = depart.get(p.plat.id) - brut.get(p.plat.id);
    return blocsFour(p.data, p.plat, p.heureRepas)
      .map(b => ({ ...b, debut: b.debut + d, fin: b.fin + d }));
  };
  return {
    brut, depart, conflit,
    blocs: plats.flatMap(decale),
    ordre: [...plats].sort((a, b) => depart.get(a.plat.id) - depart.get(b.plat.id)),
  };
}

/* ----------------------------------------------------------------- rendu */

const hhmm = min => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}h${String(m % 60).padStart(2, "0")}`;
};
// Une heure qu'on annonce à 4 minutes près ment sur sa propre précision.
const vers = min => hhmm(Math.round(min / 5) * 5);

// `plats` : un par créneau rempli de la MÊME JOURNÉE, du plus tôt au plus tard.
// Le déroulé s'ouvre sur la soirée dès qu'il y en a plus d'un — parce que c'est
// là, et seulement là, que le four se dispute.
export async function ouvrir(hoteEl, plats, iPlat = 0) {
  hote = hoteEl;
  etat = { plats, iPlat: Math.max(0, iPlat), iEtape: -1,
           vue: plats.length > 1 ? "soiree" : "etapes" };
  document.body.dataset.deroule = "1";
  // Un écran qui s'éteint au bout de 30 s pendant qu'on pétrit est inutilisable.
  try { veille = await navigator.wakeLock?.request("screen"); } catch { /* refusé : tant pis */ }
  rendre();
}

function fermer() {
  document.body.removeAttribute("data-deroule");
  veille?.release?.().catch(() => {});
  veille = null;
  etat = null;
  // Les minuteurs, eux, ne meurent pas avec l'écran : on peut fermer le déroulé
  // pendant que la tourte cuit. Ils repartiront visibles à la réouverture.
  hote?.remove();
  hote = null;
  if (!minuteurs.size) arreterHorloge();
}

const courant = () => etat.plats[etat.iPlat];

function rendre() {
  if (!etat) return;
  const p = courant();
  hote.innerHTML = `
    <div class="dr-fond"></div>
    <section class="dr" data-plat="${p.plat.id}">
      ${barreMinuteurs()}
      ${etat.vue === "soiree" ? vueSoiree()
        : etat.iEtape < 0 ? vueMiseEnPlace(p)
        : etat.iEtape >= cartes(p.data, p.plat).length ? vueFin(p)
        : vueEtape(p)}
    </section>`;
  brancher();
}

const sur = (sel, fn) => hote.querySelectorAll(sel).forEach(
  b => b.addEventListener("click", e => { e.stopPropagation(); fn(b, e); }));

function brancher() {
  sur("[data-fermer]", fermer);
  sur("[data-aller]", b => { etat.iEtape = +b.dataset.aller; etat.vue = "etapes"; rendre(); });
  sur("[data-plat-i]", b => {
    etat.iPlat = +b.dataset.platI; etat.iEtape = -1; etat.vue = "etapes"; rendre();
  });
  sur("[data-soiree]", () => { etat.vue = "soiree"; rendre(); });
  sur("[data-minuteur]", b => basculerMinuteur(b.dataset.minuteur, +b.dataset.min, b.dataset.quoi));
}

/* --- la barre de minuteurs, qui survit à tout ------------------------------ */

function barreMinuteurs() {
  if (!minuteurs.size) return "";
  const now = Date.now();
  return `<div class="dr-minuteurs">${[...minuteurs.entries()].map(([cle, m]) => {
    const reste = Math.round((m.fin - now) / 1000);
    return `<div class="dr-mn ${reste <= 0 ? "sonne" : ""}">
      <b>${mmss(Math.max(0, reste))}</b>
      <span>${m.quoi}</span>
      <button data-minuteur="${cle}" data-min="0" data-quoi="" aria-label="arrêter">×</button>
    </div>`;
  }).join("")}</div>`;
}

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function basculerMinuteur(cle, min, quoi) {
  if (minuteurs.has(cle)) minuteurs.delete(cle);
  else minuteurs.set(cle, { fin: Date.now() + min * 60000, quoi, sonne: false });
  if (minuteurs.size) demarrerHorloge(); else arreterHorloge();
  rendre();
}

function demarrerHorloge() {
  if (horloge) return;
  horloge = setInterval(() => {
    const now = Date.now();
    for (const m of minuteurs.values()) {
      if (!m.sonne && m.fin <= now) { m.sonne = true; sonner(); }
    }
    // On ne re-rend que la barre : re-rendre l'écran chaque seconde perdrait le
    // défilement et ferait clignoter le bouton sous le doigt.
    const barre = hote?.querySelector(".dr-minuteurs");
    if (barre) barre.outerHTML = barreMinuteurs();
    else if (etat) rendre();
    if (barre) brancher();
  }, 1000);
}

function arreterHorloge() { clearInterval(horloge); horloge = null; }

// Un bip synthétisé plutôt qu'un fichier : le proto n'embarque aucun binaire.
function sonner() {
  navigator.vibrate?.([200, 100, 200, 100, 400]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.001, t0);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
      o.start(t0); o.stop(t0 + 0.3);
    }
  } catch { /* audio refusé : la vibration et le rouge suffisent */ }
}

/* --- la soirée : plusieurs plats, un seul four ---------------------------- */

function vueSoiree() {
  const { brut, depart, conflit, blocs, ordre } = plan(etat.plats);
  const bouge = conflit && conflit.avant.plat;
  return `
    <header class="dr-tete">
      <button data-fermer="1" class="dr-x" aria-label="fermer">×</button>
      <div class="dr-fil">la soirée — ${etat.plats.length} plats</div>
    </header>
    <div class="dr-corps">
      <h2 class="dr-action">${etat.plats.length} plats, un seul four</h2>
      ${ordre.map((p, i) => {
        const mien = blocs.filter(b => b.plat.id === p.plat.id);
        return `<button class="dr-plat" data-plat-i="${etat.plats.indexOf(p)}">
          <div class="dr-plat-t"><b>${i + 1}.</b> ${p.plat.titre}</div>
          <div class="dr-plat-m">commencer vers ${vers(depart.get(p.plat.id))}
            · servi ${hhmm(p.heureRepas)}${
            p.plat.id === bouge?.id ? " · <b>décalé</b>" : ""}</div>
          ${mien.map(b => `<div class="dr-plat-f">🔥 four ${vers(b.debut)} → ${vers(b.fin)}
            <em>${court(b.etape.action, 46)}</em></div>`).join("")}
        </button>`;
      }).join("")}
      ${conflit ? `<div class="dr-conflit">
        <b>⚠ le four était pris deux fois — les heures ci-dessus sont déjà corrigées</b>
        <p>Tel que la semaine le prévoyait, « ${conflit.avant.plat.titre} » occupait le
           four jusqu'à ${vers(conflit.avant.fin)} pendant que
           « ${conflit.apres.plat.titre} » le réclamait dès ${vers(conflit.apres.debut)} :
           <b>${conflit.chevauche} min de chevauchement</b>, et pas à la même température.</p>
        <p>« ${conflit.avant.plat.titre} » est donc avancé de ${conflit.chevauche} min —
           départ vers <b>${vers(depart.get(bouge.id))}</b> au lieu de
           ${vers(brut.get(bouge.id))}. Son four se libère à
           ${vers(conflit.avant.fin - conflit.chevauche)},
           juste avant que l'autre le réclame, et ce qui refroidit après absorbe
           le décalage.</p>
        <p>Le préchauffage suit : celui de « ${conflit.apres.plat.titre} » ne peut pas
           se faire tant que l'autre plat cuit — le four n'a qu'une température à la fois.</p>
        <p class="dr-note">Le modèle calcule l'heure de départ PLAT PAR PLAT : il ne
           sait pas encore que le four est une ressource unique, et le décalage
           ci-dessus est celui de cet écran, pas du plan. C'est ce déroulé qui l'a
           fait apparaître.</p>
      </div>` : `<div class="dr-ok">Le four n'est jamais réclamé deux fois à la fois.</div>`}
      <button class="dr-suite" data-plat-i="${etat.plats.indexOf(ordre[0])}">
        commencer par « ${ordre[0].plat.titre} » ›</button>
    </div>`;
}

/* --- la mise en place ----------------------------------------------------- */

function vueMiseEnPlace(p) {
  const { plat, facteur, parts, data } = p;
  // L'heure de départ vient du plan de la SOIRÉE, décalage du four compris :
  // sinon cet écran-ci contredirait le précédent, et c'est celui-ci qu'on lit
  // en s'y mettant.
  const depart = plan(etat.plats).depart.get(plat.id);
  const outils = [...new Set(plat.steps.flatMap(s => s.needs || [])
    .map(c => data.foyer.outils?.[c]?.label).filter(Boolean))];
  const cs = cartes(data, plat);
  return `
    <header class="dr-tete">
      <button data-fermer="1" class="dr-x" aria-label="fermer">×</button>
      <div class="dr-fil">${plat.titre}</div>
      ${etat.plats.length > 1 ? '<button class="dr-lien" data-soiree="1">la soirée</button>' : ""}
    </header>
    <div class="dr-corps">
      <h2 class="dr-action">Mise en place</h2>
      <div class="dr-bornes">
        <span>commencer vers <b>${vers(depart)}</b></span>
        <span>servi à <b>${hhmm(p.heureRepas)}</b></span>
        <span>${cs.length} étapes · ${fmt(parts)} parts</span>
      </div>
      <div class="dr-ing">
        ${plat.ingredients.map(x => `<div class="dr-i ${x.assaisonnement ? "assai" : ""}">
          <b>${echelleTexte(x, facteur)}</b><span>${x.nom}</span></div>`).join("")}
      </div>
      ${outils.length ? `<div class="dr-outils">${outils.map(o => `<span>${o}</span>`).join("")}</div>` : ""}
      ${plat.bebe ? "" : `<div class="dr-sansbebe">Pas de portion bébé sur ce plat.
        <em>Le modèle ne sait le dire que par absence — il n'a pas de champ pour
        porter un interdit d'âge et sa raison.</em></div>`}
      <button class="dr-suite" data-aller="0">commencer ›</button>
    </div>`;
}

const fmt = n => String(+n.toFixed(1)).replace(".", ",");

/* --- une étape ------------------------------------------------------------ */

function vueEtape(p) {
  const { plat, facteur, data } = p;
  const cs = cartes(data, plat);
  const i = etat.iEtape;
  const e = cs[i];
  const m = minutesDe(data, e);
  const o = outil(data, e);
  const parRef = Object.fromEntries(plat.ingredients.map(x => [x.ref || x.id, x]));
  // `uses: null` = la recette n'a pas encore le lien ; `[]` = elle l'a et cette
  // étape ne verse rien. Les deux ne s'affichent pas pareil : le premier doit
  // renvoyer à la mise en place, le second ne doit rien dire du tout.
  const ing = (e.uses || []).map(u => parRef[u]).filter(Boolean);
  const cible = e.enParallele ? cs.find(x => x.id === e.enParallele) : null;
  const cle = `${plat.id}:${e.id}`;
  return `
    <header class="dr-tete">
      <button data-fermer="1" class="dr-x" aria-label="fermer">×</button>
      <div class="dr-fil">${plat.titre} — ${i + 1}/${cs.length}</div>
      ${etat.plats.length > 1 ? '<button class="dr-lien" data-soiree="1">la soirée</button>' : ""}
    </header>
    <div class="dr-jauge"><i style="width:${((i + 1) / cs.length) * 100}%"></i></div>
    <div class="dr-corps ${e.bebe ? "bebe" : ""}">
      ${cible ? `<div class="dr-par">⇄ en même temps que : <b>${court(cible.action)}</b></div>` : ""}
      ${ing.length ? `<div class="dr-ing serre">
        ${ing.map(x => `<div class="dr-i ${x.assaisonnement ? "assai" : ""}">
          <b>${echelleTexte(x, facteur)}</b><span>${x.nom}</span></div>`).join("")}
      </div>` : e.uses == null ? `<div class="dr-note">Cette recette ne dit pas encore
        quels ingrédients chaque étape réclame — voir la mise en place.</div>` : ""}
      <h2 class="dr-action ${e.bebe ? "bebe" : ""}">${e.bebe ? "👶 " : ""}${e.action}</h2>
      ${o?.reecrit ? `<div class="dr-outil">→ ${o.reecrit}</div>`
        : o?.label ? `<div class="dr-outil">→ ${o.label}</div>` : ""}
      ${e.enfant ? `<div class="dr-kid">👧 avec le grand${
        e.enfantDes ? ` (dès ${e.enfantDes} mois)` : ""} : ${e.enfant}</div>` : ""}
      ${e.surveille === false ? '<div class="dr-libre">sans surveiller — les mains sont libres</div>' : ""}
      ${m ? `<button class="dr-timer ${minuteurs.has(cle) ? "on" : ""}"
        data-minuteur="${cle}" data-min="${m}" data-quoi="${court(e.action, 24)}">
        ⏱ ${m} min ${minuteurs.has(cle) ? "— arrêter" : "— démarrer"}</button>` : ""}
      ${e.attente ? `<div class="dr-attente">⏳ puis ${e.attente} min de ${e.attenteRaison || "repos"}
        ${suiteParallele(cs, i)}
        <button class="dr-timer creux" data-minuteur="${cle}:attente"
          data-min="${e.attente}" data-quoi="${e.attenteRaison || "attente"}">
          ⏱ armer les ${e.attente} min</button>
      </div>` : ""}
    </div>
    <nav class="dr-nav">
      <button data-aller="${i - 1}" ${i === 0 ? "" : ""}>‹ retour</button>
      <button class="pri" data-aller="${i + 1}">${
        i === cs.length - 1 ? "terminé ›" : "suivant ›"}</button>
    </nav>`;
}

// Ce qu'on fait PENDANT l'attente, nommé sur l'écran de l'attente elle-même :
// c'est la seule place où l'information sert. La recette l'a écrit — les étapes
// qui déclarent `enParallele` sur celle-ci.
function suiteParallele(cs, i) {
  const suite = cs.filter(x => x.enParallele === cs[i].id);
  if (!suite.length) return "";
  return `<div class="dr-pendant">pendant ce temps : ${
    suite.map(x => court(x.action, 40)).join(" · ")}</div>`;
}

const court = (txt, n = 34) => {
  const t = txt.replace(/^Pendant la [^:]+ : /, "");
  return t.length > n ? t.slice(0, n).trimEnd() + "…" : t;
};

/* --- la fin --------------------------------------------------------------- */

function vueFin(p) {
  const { plat, facteur } = p;
  const autre = etat.plats.find(x => x.plat.id !== plat.id);
  return `
    <header class="dr-tete">
      <button data-fermer="1" class="dr-x" aria-label="fermer">×</button>
      <div class="dr-fil">${plat.titre}</div>
    </header>
    <div class="dr-corps">
      <h2 class="dr-action">C'est prêt.</h2>
      ${plat.emits?.length ? `<div class="dr-emits"><h3>à consigner au stock</h3>
        ${plat.emits.map(e => `<div class="dr-i"><b>${e.type}</b><span>${
          e.congelo ? "se congèle" : e.gardeFrigo ? `${e.gardeFrigo} j au frigo` : ""}${
          e.note ? ` — ${e.note}` : ""}</span></div>`).join("")}
        <p class="dr-note">Le proto n'a pas de persistance : rien n'est réellement
          consigné. C'est #41.</p>
      </div>` : ""}
      ${autre ? `<button class="dr-suite" data-plat-i="${etat.plats.indexOf(autre)}">
        passer à « ${autre.plat.titre} » ›</button>`
        : '<button class="dr-suite" data-fermer="1">fermer</button>'}
    </div>`;
}

// Les flèches du clavier appartiennent au déroulé tant qu'il est ouvert : sans
// ça elles changent la VARIANTE du shell sous les doigts du cuisinier.
document.addEventListener("keydown", ev => {
  if (!etat || etat.vue === "soiree") return;
  const cs = cartes(courant().data, courant().plat);
  if (ev.key === "ArrowRight" && etat.iEtape < cs.length) { ev.stopPropagation(); etat.iEtape++; rendre(); }
  if (ev.key === "ArrowLeft" && etat.iEtape > -1) { ev.stopPropagation(); etat.iEtape--; rendre(); }
  if (ev.key === "Escape") fermer();
}, true);
