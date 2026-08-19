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

const empreinte = (calc, jeu, parJour) => JSON.stringify({
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
}, null, 1);

let ko = 0;
SCENARIOS.forEach((sc, n) => {
  jeuP.choix = Array(jeuP.creneaux.length).fill(null);
  jeuT.choix = Array(jeuT.creneaux.length).fill(null);
  for (const [j, r, id] of sc) { jeuP.choix[idx(jeuP, j, r)] = id; jeuT.choix[idx(jeuT, j, r)] = id; }

  const a = empreinte(P.calculer(jeuP, jeuP.choix), jeuP, P.minutesParJour(jeuP, jeuP.choix));
  const b = empreinte(calculer(jeuT, jeuT.choix), jeuT, minutesParJour(jeuT, jeuT.choix));
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
  const a = empreinte(P.calculer(jeuP, jeuP.choix), jeuP, P.minutesParJour(jeuP, jeuP.choix));
  const b = empreinte(calculer(jeuT, jeuT.choix), jeuT, minutesParJour(jeuT, jeuT.choix));
  if (a !== b) ko++;
  console.log(`${a === b ? "✓" : "✗"} ${parts} parts`);
}
console.log(ko ? `\nDIVERGENCE — ${ko}` : "\nLES DEUX MODÈLES DISENT LA MÊME CHOSE");
process.exit(ko ? 1 : 0);
