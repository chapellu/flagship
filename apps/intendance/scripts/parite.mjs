// PARITÉ AVEC LE PROTO — `npm run parite`
//
// Un port se prouve par l'ÉGALITÉ, pas par ses propres tests. Des tests écrits
// en même temps que le code testent surtout ce que le code fait ; ils ne disent
// pas s'il fait la même chose qu'avant. Ce script joue les mêmes semaines dans
// les deux modèles — le JS de `apps/proto-shell/semaine.js`, qui tourne en
// production sur proto.chapellu.fr, et le port TypeScript — puis compare une
// empreinte de TOUT ce que `calculer` produit : panier, chaînage, manques,
// plein tarif, provenances, facteurs, bilan de rangement, état du dépôt.
//
// CE SCRIPT EST TEMPORAIRE PAR CONSTRUCTION. Il lit le proto, et le proto sera
// supprimé quand le squelette portera les mêmes verdicts (voir la section
// « Sortie » du backlog). Il disparaîtra avec lui — c'est le but.
import { readFileSync } from "node:fs";
import * as P from "../../proto-shell/semaine.js";

const brut = JSON.parse(readFileSync(new URL("../public/cuisine-data.json", import.meta.url), "utf8"));
const LUNDI = new Date("2026-08-17T12:00:00Z");

const { lireCatalogue } = await import("../src/model/catalogue.ts");
const { creerJeu } = await import("../src/model/jeu.ts");
const { calculer, minutesParJour, articles } = await import("../src/model/calcul.ts");
const { offresSurproduction, gamelles } = await import("../src/model/offres.ts");
const { couverture, categorie, offre, main, parRayon } = await import("../src/model/scoring.ts");

// Le proto lit `new Date()` : on le fige le temps du test.
const VraiDate = Date;
globalThis.Date = class extends VraiDate {
  constructor(...a) { return a.length ? new VraiDate(...a) : new VraiDate(LUNDI); }
  static now() { return LUNDI.getTime(); }
};

const jeuP = P.creerJeu(brut);
globalThis.Date = VraiDate;
const jeuT = creerJeu(lireCatalogue(brut), 7, LUNDI);

const idx = (jeu, jour, repas) => jeu.creneaux.findIndex(c => c.jour === jour && c.repas === repas);

const SCENARIOS = [
  [[0, "diner", "pates-bolognaise"], [1, "diner", "lasagnes"]],
  [[0, "diner", "sauce-bolognaise"], [1, "diner", "lasagnes"], [2, "dejeuner", "pates-bolognaise"]],
  [[0, "diner", "fajitas-poulet"], [1, "diner", "poulet-roti"], [2, "diner", "falafels-aux-herbes"]],
  [[0, "diner", "pates-bolognaise"], [1, "diner", "sauce-bolognaise"], [2, "diner", "lasagnes"],
   [3, "diner", "burgers-de-lentilles"], [4, "diner", "poulet-roti"]],
];

// Les offres et les gamelles, dans la forme que l'écran lit vraiment : leurs
// getters calculés, pas leurs champs bruts. Un getter qui diverge se voit à
// l'écran ; un champ privé qui diverge, non.
const empreinteOffres = (offres, gam) => ({
  offres: offres.map(o => [o.creneau, o.type, Math.round(o.manque * 1e6) / 1e6, o.unite,
    o.pour, o.gainMin, o.combien, o.deQuoi, o.phrase(), o.reserves(),
    Math.round(o.facteurPropose * 1e6) / 1e6, Math.round(o.multiple * 1e6) / 1e6,
    Math.round(o.portionsAStocker * 1e6) / 1e6, o.calibre, o.indivisible,
    o.tientVaisselle, o.tientStockage]).sort(),
  gamelles: gam.map(g => [g.i, g.veille, g.jour, g.jourVeille, g.plat?.id ?? null,
    g.partsVeille, g.partsGamelle, g.total, g.transportable, g.laisseReste,
    g.tientVaisselle, g.fait, g.actionnable]).sort(),
});

const empreinte = (calc, jeu, parJour, extra = {}) => JSON.stringify({
  panier: [...calc.panier.values()].map(a => [a.id, a.unit, Math.round(a.qty * 100) / 100, a.n]).sort(),
  articles: articles(calc.panier).map(a => [a.id, a.qty]).sort(),
  aVerifier: [...calc.aVerifier.keys()].sort(),
  chaine: calc.chaine.map(c => [c.creneau, c.type, c.pris, c.manque, c.recit, c.depuis]),
  manques: calc.manques.map(m => [m.i, m.manque, m.unite, m.titre]),
  pleinTarif: calc.pleinTarif,
  provenances: Object.entries(calc.provenances).sort(),
  facteurs: calc.facteurs.map(f => Math.round(f * 1e6) / 1e6),
  stockage: Object.entries(calc.stockage).map(([e, s]) =>
    [e, Math.round(s.debut * 1e6) / 1e6, Math.round(s.entre * 1e6) / 1e6,
     Math.round(s.sort * 1e6) / 1e6, Math.round(s.fin * 1e6) / 1e6, s.deborde, s.cause]).sort(),
  minutes: parJour,
  depot: calc.depot.lignes.map(l => [l.type, l._from ?? l.from ?? null,
    Math.round(((l._reste ?? l.reste) ?? -1) * 100) / 100, (l._epuise ?? l.epuise)]),
  ...extra,
}, null, 1);

// La couverture et le scoring — ce qui décide de ce que l'écran PROPOSE.
const empreinteChoix = (cov, cartes, rayons) => ({
  couverture: [Object.entries(cov.servi).sort(), Object.entries(cov.feculent).sort(),
    Object.entries(cov.profil).sort(), [...cov.familles].sort(),
    Object.entries(cov.manques).sort(), Object.entries(cov.satures).sort(),
    cov.famillesManquantes],
  cartes: cartes.map(c => [c.plat.id, c.categorie, c.score, c.marginal, c.pourquoi,
    c.malTransporte, c.manque, c.minutes, c.chaine, c.depuis, c.recit, c.partiel, c.plein]),
  rayons: rayons.map(([r, items]) => [r, items.map(a => [a.id, a.qty, a.unit, a.n])]),
});

let ko = 0;
SCENARIOS.forEach((sc, n) => {
  jeuP.choix = Array(jeuP.creneaux.length).fill(null);
  jeuT.choix = Array(jeuT.creneaux.length).fill(null);
  for (const [j, r, id] of sc) { jeuP.choix[idx(jeuP, j, r)] = id; jeuT.choix[idx(jeuT, j, r)] = id; }

  const cp = P.calculer(jeuP, jeuP.choix), ct = calculer(jeuT, jeuT.choix);
  const a = empreinte(cp, jeuP, P.minutesParJour(jeuP, jeuP.choix),
    empreinteOffres(cp.offres, P.gamelles(jeuP, jeuP.choix)));
  const b = empreinte(ct, jeuT, minutesParJour(jeuT, jeuT.choix),
    empreinteOffres(offresSurproduction(jeuT, jeuT.choix, ct), gamelles(jeuT, jeuT.choix)));
  const ok = a === b;
  if (!ok) {
    ko++;
    const la = a.split("\n"), lb = b.split("\n");
    for (let i = 0; i < Math.max(la.length, lb.length); i++)
      if (la[i] !== lb[i]) { console.log(`  proto: ${la[i]}\n  port : ${lb[i]}`); break; }
  }
  console.log(`${ok ? "✓" : "✗"} scénario ${n + 1} (${sc.length} plats)`);
});

// Et les parts, qui commandent tout le reste.
jeuP.choix = Array(jeuP.creneaux.length).fill(null);
jeuT.choix = Array(jeuT.creneaux.length).fill(null);
const i = idx(jeuP, 0, "diner");
jeuP.choix[i] = "fajitas-poulet"; jeuT.choix[idx(jeuT, 0, "diner")] = "fajitas-poulet";
for (const parts of [0.5, 1, 2.5, 4, 6, 12]) {
  jeuP.parts[i] = parts; jeuT.parts[idx(jeuT, 0, "diner")] = parts;
  const cp = P.calculer(jeuP, jeuP.choix), ct = calculer(jeuT, jeuT.choix);
  const a = empreinte(cp, jeuP, P.minutesParJour(jeuP, jeuP.choix),
    empreinteOffres(cp.offres, P.gamelles(jeuP, jeuP.choix, jeuP.parts)));
  const b = empreinte(ct, jeuT, minutesParJour(jeuT, jeuT.choix),
    empreinteOffres(offresSurproduction(jeuT, jeuT.choix, ct), gamelles(jeuT, jeuT.choix, jeuT.parts)));
  if (a !== b) ko++;
  console.log(`${a === b ? "✓" : "✗"} ${parts} parts`);
}
// LE SCORING, sur chaque créneau d'une semaine à moitié posée. C'est lui qui
// décide ce que l'écran propose : une divergence d'un dixième de point y
// change la carte qu'un doigt va toucher.
jeuP.choix = Array(jeuP.creneaux.length).fill(null);
jeuT.choix = Array(jeuT.creneaux.length).fill(null);
jeuP.parts = Array(jeuP.creneaux.length).fill(brut.foyer.parts);
jeuT.parts = Array(jeuT.creneaux.length).fill(brut.foyer.parts);
for (const [j, r, id] of SCENARIOS[3]) { jeuP.choix[idx(jeuP, j, r)] = id; jeuT.choix[idx(jeuT, j, r)] = id; }

let slotsKo = 0;
for (let s = 0; s < jeuP.creneaux.length; s++) {
  if (jeuP.creneaux[s].nature !== "choisi" || jeuP.choix[s]) continue;
  jeuP.slot = s; jeuT.slot = s;
  const a = JSON.stringify(empreinteChoix(
    P.couverture(jeuP, jeuP.choix), P.offre(jeuP, jeuP.choix, s),
    P.parRayon(brut, P.calculer(jeuP, jeuP.choix).panier)), null, 1);
  const b = JSON.stringify(empreinteChoix(
    couverture(jeuT, jeuT.choix), offre(jeuT, jeuT.choix, s),
    parRayon(jeuT.catalogue, calculer(jeuT, jeuT.choix).panier)), null, 1);
  if (a !== b) {
    slotsKo++; ko++;
    const la = a.split("\n"), lb = b.split("\n");
    for (let i = 0; i < Math.max(la.length, lb.length); i++)
      if (la[i] !== lb[i]) { console.log(`  créneau ${s}\n  proto: ${la[i]}\n  port : ${lb[i]}`); break; }
  }
}
console.log(`${slotsKo ? "✗" : "✓"} scoring sur tous les créneaux libres`);

// La main tirée : même graine, mêmes cartes, y compris après repioche.
let mainKo = 0;
for (let s = 0; s < jeuP.creneaux.length; s++) {
  if (jeuP.creneaux[s].nature !== "choisi" || jeuP.choix[s]) continue;
  for (const rep of [0, 1, 2]) {
    jeuP.slot = s; jeuT.slot = s;
    jeuP.repioches[s] = rep; jeuT.repioches[s] = rep;
    const a = P.main(jeuP).map(c => [c.plat.id, c.score]);
    const b = main(jeuT).map(c => [c.plat.id, c.score]);
    if (JSON.stringify(a) !== JSON.stringify(b)) { mainKo++; ko++; }
  }
}
console.log(`${mainKo ? "✗" : "✓"} main de cartes, trois repioches par créneau`);

// La catégorie de chaque plat du catalogue — l'enseigne de la carte.
const catKo = brut.plats.filter(p => P.categorie(p) !== categorie(jeuT.plats[p.id])).map(p => p.id);
if (catKo.length) { ko++; console.log("  catégories divergentes :", catKo.slice(0, 5)); }
console.log(`${catKo.length ? "✗" : "✓"} enseignes des ${brut.plats.length} plats`);

console.log(ko ? `\nDIVERGENCE — ${ko}` : "\nLES DEUX MODÈLES DISENT LA MÊME CHOSE");
process.exit(ko ? 1 : 0);
