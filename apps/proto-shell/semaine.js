// PROTOTYPE — constructeur de semaine, version visuelle.
//
// Port compact du modèle Python (chapellu/Workspace, prototypes/recipe-compiler,
// semaine_model.py). Les plats viennent de `cuisine-data.json`, exporté du vrai
// catalogue par export_json.py : aucune donnée n'est inventée ici.
//
// Le modèle de référence reste le Python. Ceci en est une transcription jetable,
// faite pour être vue sur un téléphone.
//
// LA SEMAINE EST FAITE DE CRÉNEAUX, PAS DE JOURS.
// Un créneau = (jour, repas). #29 : les trois repas sont planifiés, ~21 par
// semaine, les deux adultes déjeunent à la maison. L'ordre chronologique porte
// la sémantique : le midi du jour 3 est calculé AVANT le soir du jour 3, donc il
// ne peut voir que ce que le jour 2 a laissé derrière lui.

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

// TROISIÈME NATURE DE CRÉNEAU (creneaux.yaml). `choisi` fait d'un créneau vide
// un TROU ; `routine` veut dire « compté mais jamais distribué » ; `optionnel`
// est la case que ces deux-là laissaient vide — un créneau qui EXISTE sans
// être un manque quand il est vide, mais qui se sélectionne et distribue des
// cartes. C'est ce qu'est un dessert : on n'en mange pas tous les soirs, et une
// semaine sans dessert n'est pas une semaine incomplète.
export const remplissable = c => c.nature === "choisi" || c.nature === "optionnel";

// AMORCE DU TEST GRANDEUR NATURE DU 21/08/2026 — À RETIRER APRÈS.
// Le dîner d'invité et son dessert, posés en dur pour ce soir-là. Ancré sur la
// DATE et non sur un indice de créneau : la fenêtre de 7 jours glisse, donc
// l'amorce cesse d'elle-même de s'appliquer dès que la date sort de la semaine
// affichée. Pas de code mort à nettoyer, pas de piège la semaine suivante.
const AMORCE = {
  "2026-08-21": {
    diner: { plat: "tourte-nicoise-courgettes", parts: 3.5 },
    dessert: { plat: "clafoutis-miel-abricot", parts: 3.5 },
  },
};
const cleJour = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  + `-${String(d.getDate()).padStart(2, "0")}`;

export function creerJeu(data, nJours = 7) {
  const cfg = data.creneaux;
  const emporte = cfg.emporte || {};
  const jours = Array.from({ length: nJours }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return { nom: JOURS[(d.getDay() + 6) % 7], date: d };
  });

  const creneaux = [];
  jours.forEach((j, i) => {
    const duJour = (cfg.jours.exceptions || {})[j.nom] || cfg.jours.defaut;
    // TRIÉ SUR L'HEURE, comme `construire_creneaux()` côté Python — et pas sur
    // l'ordre de déclaration, ce que ce fichier faisait jusqu'ici. Les deux
    // divergeaient depuis que le goûter (16 h) est déclaré après le dîner :
    // le mercredi sortait petit-déj, déjeuner, dîner, goûter. L'ordre porte la
    // sémantique — le chaînage marche les créneaux vers l'avant — donc c'était
    // « hier soir nourrit ce midi » qui était faux, pas seulement l'affichage.
    [...duJour].sort((a, b) => cfg.repas[a].heure - cfg.repas[b].heure).forEach(repas => {
      creneaux.push({
        jour: i, repas,
        label: cfg.repas[repas].label,
        nature: cfg.repas[repas].nature,
        emporte: (emporte[repas] || []).includes(j.nom),
      });
    });
  });

  const choix = Array(creneaux.length).fill(null);
  const parts = Array(creneaux.length).fill(data.foyer.parts);
  creneaux.forEach((c, i) => {
    const a = AMORCE[cleJour(jours[c.jour].date)]?.[c.repas];
    if (a && data.plats.some(p => p.id === a.plat)) {
      choix[i] = a.plat;
      parts[i] = a.parts;
    }
  });

  return {
    data,
    plats: Object.fromEntries(data.plats.map(p => [p.id, p])),
    jours, creneaux,
    equilibreSur: cfg.equilibre_sur || ["dejeuner", "diner"],
    choix,
    // Les parts se règlent PAR REPAS, pas une fois pour la semaine. Un dîner
    // avec des amis, un midi tout seul et une gamelle à prévoir n'ont pas la
    // même taille, et c'est la taille qui commande le panier et les restes.
    parts,
    // On démarre sur le premier créneau réellement choisi : personne ne pioche
    // une carte pour son petit-déjeuner, ni pour un dessert qu'on ne veut
    // peut-être pas — un créneau optionnel se demande, il ne se propose pas.
    slot: creneaux.findIndex(c => c.nature === "choisi"),
    repioches: Array(creneaux.length).fill(0),
  };
}

// UN REPAS SAUTÉ N'EST PAS UN REPAS VIDE. « On ne mange pas là » (restaurant,
// chez des amis, week-end nomade — #29 dit les week-ends nomades) est une
// DÉCISION, et un créneau vide est une décision qui n'a pas encore été prise.
// Les confondre laissait la semaine se plaindre de trous qu'on avait choisis.
export const SAUTE = "__saute";
export const joue = rid => !!rid && rid !== SAUTE;

const alias = (data, id) => data.rayons.aliases?.[id] ?? id;
const placard = (data, id) => (data.rayons.placard || []).includes(id);
const dateDe = (jeu, i) => jeu.jours[jeu.creneaux[i].jour].date;

// Un `accepts` vise soit une sortie précise (`type`), soit toute une CLASSE de
// sorties (`kind`). C'est ce qui permet à une seule carte « reste réchauffé » de
// manger le gratin d'hier comme la quiche d'avant-hier.
function accepte(out, acc) {
  if (acc.type) return out.type === acc.type;
  if (acc.kind) return out.kind === acc.kind;
  return false;
}
const libelle = acc => acc.type || `un ${acc.kind}`;

// ─────────────────────────────────────────────────── quantités et prélèvement
//
// LE CHAÎNAGE ÉTAIT UN JEU DE JETONS. Une sortie entrait en stock, on la
// TROUVAIT, et personne ne la retirait jamais : le même bocal de bolognaise
// couvrait les pâtes du mardi (500 g) ET les lasagnes du mercredi (700 g), soit
// 1200 g réclamés sur un bocal — pendant que la sauce du lundi n'était mangée
// par personne. Ce qui manquait n'était pas un contrôle mais une GRANDEUR.
//
// Deux mesures coexistent, parce qu'elles mesurent des choses différentes.
// `qty` chiffre une BASE (700 g de sauce, 1 carcasse) : c'est en grammes que
// « y en a-t-il assez » a un sens. `band` compte des REPAS (« 2-repas ») : on
// ne mange pas 340 g de gratin, on mange une part, et c'est l'unité du budget
// de rangement. Une arête chiffrée des deux côtés se règle en grandeur ; sinon
// on retombe sur le jeton, et le prélèvement se dit `approximatif` au lieu de
// faire semblant.

const qteDe = b => (b?.qty?.amount != null ? [b.qty.amount, b.qty.unit] : [null, null]);
const bandRepas = b => { const n = parseInt(String(b ?? ""), 10); return n > 0 ? n : 1; };
const fmtQte = (v, u) => `${Math.round(v * 10) / 10} ${u ?? ""}`.trim();

class Prise {
  constructor(o = {}) { Object.assign(this, { manque: 0, sources: [] }, o); }
  get trouve() { return this.out != null; }
  get couvert() { return this.out != null && this.manque <= 1e-9; }
  // D'où sort ce que le plat a pris, MORCEAU PAR MORCEAU. Annoncer le total sur
  // le premier bocal quand la prise a traversé deux lots est un mensonge, et
  // c'est exactement ce que disait le message d'avant.
  raconte() {
    return this.sources.map(s => {
      const ou = s.ligne._from ? `du lot « ${s.ligne._from} »`
        : s.ligne.location === "congelo" ? "du congélo"
        : `du frigo (J-${s.age})`;
      return `${s.pris == null ? s.ligne.type : fmtQte(s.pris, this.unite)} ${ou}`;
    }).join(" + ");
  }
}

class Stock {
  constructor(outputs, fenetre) {
    this.fenetre = fenetre;
    this.lignes = [];
    (outputs || []).forEach(o => this.ajouter(o));
  }

  ajouter(sortie, { born, source, location } = {}) {
    const l = { ...sortie };
    if (born !== undefined) l.born = born;
    if (source !== undefined) l._from = source;
    if (location !== undefined) l.location = location;
    const [amount, unit] = qteDe(l);
    l._reste = amount;            // null = jeton non chiffré
    l._unite = unit;
    l._epuise = false;
    this.lignes.push(l);
    return l;
  }

  _age(ligne, date) {
    const born = ligne.born instanceof Date ? ligne.born : new Date(ligne.born);
    if (!ligne.born) return null;
    const age = Math.round((date - born) / 86400000);
    return (ligne.location === "congelo" || age <= this.fenetre) ? age : null;
  }

  *_candidates(acc, date) {
    for (const l of this.lignes) {
      if (l._epuise || !accepte(l, acc)) continue;
      const age = this._age(l, date);
      if (age !== null) yield [l, age];
    }
  }

  // Sonde NON destructive : proposer une carte n'est pas la jouer, donc rien ne
  // se consomme ici. C'est `calculer` qui prélève pour de bon.
  disponible(acc, date) {
    for (const [l, age] of this._candidates(acc, date)) return [l, age];
    return [null, null];
  }

  prelever(acc, date) {
    const [besoin, unite] = qteDe(acc);
    let premier = null, premierAge = null, total = 0;
    const sources = [];

    for (const [l, age] of this._candidates(acc, date)) {
      if (besoin == null || l._reste == null || l._unite !== unite) {
        // Une des deux faces ne chiffre rien : la ligne entière part, comme
        // avant. C'est le cas des restes de plat, comptés en repas.
        l._epuise = true;
        return new Prise({ out: l, age, approximatif: true, unite,
                           sources: [{ ligne: l, pris: null, age }] });
      }
      const pris = Math.min(besoin - total, l._reste);
      if (pris <= 0) continue;
      l._reste -= pris;
      if (l._reste <= 1e-9) l._epuise = true;
      total += pris;
      sources.push({ ligne: l, pris, age });
      if (premier === null) { premier = l; premierAge = age; }
      if (total >= besoin - 1e-9) break;
    }

    if (premier === null) return new Prise({ manque: besoin ?? 0, unite });
    return new Prise({ out: premier, age: premierAge, pris: total, unite, sources,
                       manque: Math.max(0, (besoin ?? 0) - total) });
  }
}

// ───────────────────────────────────────────────────────────────── provenance
//
// D'où sort une ligne d'ingrédient. Ces cas existaient déjà, mais éclatés en
// trois encodages sans rapport (une liste placard globale, un booléen par
// ligne, un état du stock) : chaque lecteur redécidait dans son coin.
const PLACARD = "placard", CHAINE = "chaine", FRIGO = "frigo",
      COURSES = "courses", ABSENT = "absent";

// `ABSENT` ne produit PAS de ligne de courses, et c'est contre-intuitif : une
// base manquante se rattrape en cuisinant, jamais en achetant la base. On
// n'achète nulle part 250 g de lentilles *cuites*.
function provenance(data, ing, cid, prises) {
  if (ing.base) {
    const pr = prises.find(p => p.trouve);
    if (!pr) return ABSENT;
    return pr.out._from ? CHAINE : FRIGO;
  }
  return placard(data, cid) ? PLACARD : COURSES;
}

// Un plat déclare les créneaux qui lui vont ; le silence vaut « repas principal ».
export function convient(jeu, plat, i) {
  const ok = plat.creneaux?.length ? plat.creneaux : ["dejeuner", "diner"];
  return ok.includes(jeu.creneaux[i].repas);
}

// Ramène un facteur d'échelle à ce que la recette sait réellement produire.
// `besoin / rendement` donne 0,42 pour un foyer de 2,5 devant une recette pour
// 6. Pour une sauce, cuisiner 42 % du lot a un sens. Pour un plat bâti sur un
// objet entier, non : « faire 0,42 poulet rôti » n'est pas une quantité.
const facteurLot = (plat, f) =>
  plat.lotEntier ? Math.max(1, Math.ceil(f - 1e-9)) : f;

function facteur(plat, besoin) {
  const garde = plat.emits.some(e => e.congelo || e.kind === "reste-plat");
  return facteurLot(plat, garde && besoin < plat.portions ? 1 : besoin / plat.portions);
}

// Le facteur d'un plat pour un nombre de parts donné, et une ligne
// d'ingrédient mise à l'échelle. Exposés pour la fiche recette : elle doit
// pouvoir montrer les vraies quantités d'un plat qui n'est pas encore joué.
export const facteurAffiche = (plat, parts) => facteur(plat, parts);
export const echelleTexte = (ing, f) =>
  `${String(echelle(ing.qty, ing.unit, f)).replace(".", ",")} ${ing.unit}`;

function echelle(qty, unit, f) {
  const v = qty * f;
  if (unit === "g") return Math.round(v / 10) * 10;
  if (["pièce", "gousse", "c. à s.", "c. à c.", "pincée"].includes(unit))
    return Math.round(v * 2) / 2;
  return Math.round(v * 10) / 10;
}

// Le cœur : panier, chaînage, plein tarif, provenance et rangement — pour une
// semaine partielle.
export function calculer(jeu, choix, jetes = [], parts = jeu.parts) {
  const { data } = jeu;
  const depot = new Stock(
    data.stock.filter(o => !jetes.includes(o.type)).map(o => ({ ...o, born: new Date(o.born) })),
    data.foyer.fenetreFrigo);
  const panier = new Map();
  const aVerifier = new Map();
  const chaine = [], pleinTarif = [], manques = [], provenances = {};
  const facteurs = choix.map(() => 1);

  choix.forEach((rid, i) => {
    if (!joue(rid)) return;
    const p = jeu.plats[rid];
    const date = dateDe(jeu, i);
    let plein = false;
    const prises = [];

    // 7 Wonders : un `accepts` non couvert est un PRIX, pas une barrière.
    for (const acc of p.accepts) {
      const pr = depot.prelever(acc, date);
      prises.push(pr);
      if (pr.trouve)
        chaine.push({ creneau: i, type: pr.out.type, depuis: pr.out._from ?? null,
                      age: pr.age, pris: pr.pris, unite: pr.unite,
                      manque: pr.manque, recit: pr.raconte() });
      // Ce qui manque EN GRANDEUR remonte : c'est ce qui rend la semaine
      // dimensionnable, un plat amont pouvant être cuisiné plus grand exprès.
      if (pr.manque > 1e-9)
        manques.push({ i, acc, manque: pr.manque, unite: pr.unite, titre: p.titre,
                       gainMin: p.gainChainage || 0 });
      if (pr.couvert || (pr.trouve && pr.approximatif)) continue;
      if (p.sansReste) { plein = true; pleinTarif.push({ creneau: i, minutes: p.sansReste.minutes }); }
    }

    const f = facteur(p, parts[i] ?? data.foyer.parts);
    facteurs[i] = f;
    const lignes = [...p.ingredients];
    if (plein) lignes.push(...p.sansReste.ingredients);
    for (const ing of lignes) {
      const cid = alias(data, ing.id);
      const prov = provenance(data, ing, cid, prises);
      provenances[prov] = (provenances[prov] || 0) + 1;
      if (data.horsCourses.includes(prov)) continue;
      if (prov === PLACARD) { aVerifier.set(cid, ing.nom); continue; }
      const cle = cid + "|" + ing.unit;
      const slot = panier.get(cle) || { nom: ing.nom, qty: 0, n: 0, id: cid, unit: ing.unit };
      slot.qty += echelle(ing.qty, ing.unit, f);
      slot.n += 1;
      panier.set(cle, slot);
    }

    for (const e of p.emits) {
      const [amount, unit] = qteDe(e);
      depot.ajouter({ ...e, qty: amount == null ? null : { amount: amount * f, unit } },
                    { born: date, source: rid, location: "frigo" });
    }
  });

  const stockage = bilanStockage(jeu, choix, jetes, facteurs, depot);
  return { panier, aVerifier, chaine, pleinTarif, manques, provenances,
           facteurs, depot, stockage,
           offres: offresSurproduction(jeu, choix, manques, facteurs, stockage) };
}

// ──────────────────────────────────────────────── la cuisine n'est pas infinie
//
// Deux plafonds par espace, tous deux réels : les ÉTAGÈRES et les CONTENANTS.
// Le plus bas commande, et savoir lequel mord change le geste — dégager une
// étagère, ou laver des boîtes. Dans une vraie cuisine, la contrainte n'est
// presque jamais « le congélateur est plein » : c'est « les six boîtes sont au
// frigo avec la ratatouille de mardi dedans ».
export function bilanStockage(jeu, choix, jetes, facteurs, depot) {
  const { data } = jeu;
  const debut = {}, entre = {}, sort = {};
  const add = (acc, e, n) => { acc[e] = (acc[e] || 0) + n; };

  for (const o of data.stock) {
    if (jetes.includes(o.type)) continue;
    add(debut, o.location === "congelo" ? "congelo" : "frigo", bandRepas(o.qty_band));
  }
  choix.forEach((rid, i) => {
    if (!joue(rid)) return;
    for (const e of jeu.plats[rid].emits) add(entre, e.espace, bandRepas(e.band) * facteurs[i]);
  });
  // Ce que la semaine MANGE rend sa place ET son contenant. Sans ce terme, le
  // rangement ne serait qu'un compteur qui monte — et un niveau qu'on ne mesure
  // qu'à la hausse n'est pas un niveau.
  for (const l of depot.lignes) {
    if (!l._epuise) continue;
    add(sort, l.espace || (l.location === "congelo" ? "congelo" : "frigo"),
        bandRepas(l.band ?? l.qty_band));
  }

  const bilan = {};
  for (const [espace, cfg] of Object.entries(data.foyer.espaces)) {
    const fin = (debut[espace] || 0) + (entre[espace] || 0) - (sort[espace] || 0);
    bilan[espace] = { ...cfg, debut: debut[espace] || 0, entre: entre[espace] || 0,
                      sort: sort[espace] || 0, fin,
                      libre: Math.max(0, cfg.limite - fin), deborde: fin > cfg.limite };
  }
  return bilan;
}

// ──────────────────────────────────────────────────────── faire plus, plus tôt
//
// « Tu n'as plus de bolognaise d'avance : en faire plus jeudi, et le gratin de
// samedi est déjà payé. » Une OFFRE, pas une correction : cuisiner plus grand
// engage un saladier, un tiroir de congélo et de l'argent — trois choses que le
// modèle ne sait pas arbitrer à la place de l'usager.

// Unités qui comptent des OBJETS : on ne récupère pas 1,4 carcasse.
const LOTS_COMPTABLES = ["pièce", "recette", "lot"];

class Offre {
  constructor(o) { Object.assign(this, o); }

  get facteurBrut() { return this.facteurActuel + this.manque / this.parLot; }

  // Un seul lot, pris plus gros — un poulet se choisit entre 1,2 et 2 kg. Sans
  // ça, « lot entier » envoie rôtir DEUX poulets pour 300 g manquants, alors
  // que le geste réel est d'en prendre un plus grand.
  get calibre() { return !!this.calibreMax && this.facteurBrut <= this.calibreMax + 1e-9; }

  get facteurPropose() {
    const brut = this.facteurBrut;
    return (this.indivisible && !this.calibre) ? Math.ceil(brut - 1e-9) : brut;
  }

  get multiple() { return this.facteurActuel ? this.facteurPropose / this.facteurActuel : 1; }

  // Le surplus au-delà du manque : c'est l'arrondi du lot entier qui crée du
  // stock, et le stock n'est pas infini.
  get portionsAStocker() {
    return Math.max(0, this.facteurPropose - this.facteurBrut) * this.repasParLot;
  }

  get tientVaisselle() {
    return this.vaisselle == null || this.facteurPropose <= this.vaisselle.facteurMax + 1e-9;
  }
  get tientStockage() {
    return this.placesLibres == null || this.portionsAStocker <= this.placesLibres + 1e-9;
  }

  // Un lot indivisible se dit en LOTS, pas en multiplicateur : « ×4,8 » d'un
  // lot déjà fractionnaire ne veut rien dire devant une casserole.
  get combien() {
    const g = n => +n.toFixed(2);
    const n = this.facteurPropose;
    return this.calibre ? "en prendre un plus gros"
      : this.indivisible ? `en faire ${g(n)} lot${n > 1 ? "s" : ""} entier${n > 1 ? "s" : ""}`
      : `en faire ${g(this.multiple)}×`;
  }

  get deQuoi() { return `+${fmtQte(this.manque, this.unite)} de ${this.type}`; }

  phrase() {
    const pour = this.pour.map(([j, t]) => `${j} (${t})`).join(" et ");
    const gain = this.gainMin ? `, ${this.gainMin} min gagnées` : "";
    return `${this.titre} : ${this.combien} (${this.deQuoi}) `
      + `et ${pour} ne coûte plus rien${gain}.`;
  }

  // Les deux murs de la cuisine, dits séparément : ils ne se réparent pas de la
  // même façon.
  reserves() {
    const r = [];
    if (this.portionsAStocker > 1e-9)
      r.push(`un lot ne se coupe pas : ${+this.portionsAStocker.toFixed(2)} portion(s) de plus à ranger`);
    if (!this.tientVaisselle)
      r.push(`⚠ ça ne tient pas dans ${this.vaisselle.label} (×${+this.vaisselle.facteurMax.toFixed(2)} maximum) — il faut deux tournées`);
    if (!this.tientStockage)
      r.push(`⚠ plus ${this.cause === "place" ? "de place au" : "de contenant pour le"} ${this.espace} (${+this.placesLibres.toFixed(1)} place(s) libre(s))`);
    return r;
  }
}

export function offresSurproduction(jeu, choix, manques, facteurs, stockage) {
  const offres = new Map();
  for (const m of manques) {
    if (!m.unite || m.manque <= 0) continue;
    // On remonte du manque vers le plat le plus proche EN AMONT qui émet la
    // chose : c'est celui qu'il coûte le moins cher d'agrandir, il est déjà au
    // menu, déjà allumé, déjà payé en temps.
    for (let j = m.i - 1; j >= 0; j--) {
      const p = joue(choix[j]) && jeu.plats[choix[j]];
      if (!p) continue;
      const e = p.emits.find(x => {
        const [amount, unit] = qteDe(x);
        return accepte(x, m.acc) && amount > 0 && unit === m.unite;
      });
      if (!e) continue;
      const cle = `${j}|${e.type}`;
      if (offres.has(cle)) {
        // Deux plats qui réclament la même base au même émetteur = UNE offre.
        // Seul le manque s'additionne ; le facteur se recalcule dessus, sinon
        // on arrondirait deux fois et on proposerait un lot de trop.
        const a = offres.get(cle);
        a.manque += m.manque;
        a.pour.push([jeu.jours[jeu.creneaux[m.i].jour].nom, m.titre]);
        a.gainMin += m.gainMin;
      } else {
        const espace = e.espace;
        offres.set(cle, new Offre({
          creneau: j, rid: choix[j], titre: p.titre, type: e.type,
          facteurActuel: facteurs[j], parLot: qteDe(e)[0], manque: m.manque,
          unite: m.unite, pour: [[jeu.jours[jeu.creneaux[m.i].jour].nom, m.titre]],
          gainMin: m.gainMin,
          indivisible: p.lotEntier || LOTS_COMPTABLES.includes(qteDe(e)[1]),
          calibreMax: p.calibreMax, vaisselle: p.vaisselle,
          repasParLot: bandRepas(e.band), espace,
          placesLibres: stockage[espace]?.libre ?? null,
          cause: stockage[espace]?.cause,
        }));
      }
      break;
    }
  }
  return [...offres.values()];
}

// ──────────────────────────────────── la gamelle se cuisine la veille au soir
//
// #29 : « coworking days need lunchbox outputs ». Le modèle savait déjà qu'un
// déjeuner de coworking doit VOYAGER — un plat qui se transporte mal y était
// mal noté. Il ne savait pas d'où sort la gamelle : on ne cuisine pas une
// lunchbox le matin même, on la prélève sur le dîner de la veille. Ce qui
// manquait n'est donc pas une contrainte de plus, c'est un DIMENSIONNEMENT :
// le dîner de mercredi doit être cuisiné pour le mercredi soir ET le jeudi midi.
//
// C'est le même geste que « faire plus, plus tôt », mais commandé par le
// calendrier au lieu d'un manque constaté.
const dinerDeLaVeille = (jeu, i) => {
  for (let j = i - 1; j >= 0; j--) if (jeu.creneaux[j].repas === "diner") return j;
  return -1;
};

export function gamelles(jeu, choix, parts = jeu.parts) {
  const out = [];
  jeu.creneaux.forEach((c, i) => {
    if (!c.emporte || c.nature !== "choisi") return;
    const veille = dinerDeLaVeille(jeu, i);
    if (veille < 0) return;
    const p = joue(choix[veille]) ? jeu.plats[choix[veille]] : null;
    const dejaPris = joue(choix[i]);
    const total = parts[veille] + parts[i];
    const g = {
      i, veille, jour: jeu.jours[c.jour].nom,
      jourVeille: jeu.jours[jeu.creneaux[veille].jour].nom,
      plat: p, partsVeille: parts[veille], partsGamelle: parts[i], total,
      // Trois choses peuvent clocher, et ce ne sont pas les mêmes gestes :
      // le plat ne voyage pas, il ne laisse rien à emporter, ou le lot ne
      // tient pas dans le récipient une fois agrandi.
      transportable: p ? p.transportable !== false : null,
      laisseReste: p ? p.emits.some(e => e.kind === "reste-plat") : null,
      tientVaisselle: p?.vaisselle ? total / p.portions <= p.vaisselle.facteurMax + 1e-9 : true,
      fait: dejaPris,
    };
    g.actionnable = !!p && !dejaPris && g.transportable && g.laisseReste;
    out.push(g);
  });
  return out;
}

export function couverture(jeu, choix) {
  const { data } = jeu;
  const servi = {}, achete = {}, feculent = {}, profil = {};
  const familles = new Set();
  choix.forEach((rid, i) => {
    if (!joue(rid)) return;
    // Les cibles se mesurent sur les repas principaux. Les plafonds ont été
    // posés contre six dîners ; les étaler sur 21 créneaux les diviserait par
    // deux sans que personne l'ait décidé.
    if (!jeu.equilibreSur.includes(jeu.creneaux[i].repas)) return;
    const p = jeu.plats[rid];
    const a = p.apports || {};
    const surReste = p.ingredients.some(x => x.base);
    if (a.proteine && a.proteine !== "aucune") {
      servi[a.proteine] = (servi[a.proteine] || 0) + 1;
      if (!surReste) achete[a.proteine] = (achete[a.proteine] || 0) + 1;
    }
    if (a.feculent && a.feculent !== "aucun")
      feculent[a.feculent] = (feculent[a.feculent] || 0) + 1;
    (a.legumes || []).forEach(x => familles.add(x));
    if (a.profil) profil[a.profil] = (profil[a.profil] || 0) + 1;
  });

  const cibles = data.equilibre.cibles;
  const manques = {}, satures = {};
  for (const [p, c] of Object.entries(cibles.proteine)) {
    if (c.min != null && (servi[p] || 0) < c.min) manques[p] = c.min - (servi[p] || 0);
    if (c.max != null && (achete[p] || 0) >= c.max) satures[p] = true;
  }
  return {
    servi, feculent, profil, familles, manques, satures,
    famillesManquantes: Math.max(0, cibles.familles_legumes_min - familles.size),
  };
}

// Catégorie = couleur de la carte. Dérivée des données, jamais étiquetée.
export function categorie(p) {
  if (p.accepts.length) return "derive";
  if (p.emits.some(e => e.kind === "base")) return "souche";
  if (p.minutes <= 25) return "express";
  if (p.emits.some(e => e.congelo)) return "congelable";
  return "complet";
}

export function offre(jeu, choix, slot) {
  const base = calculer(jeu, choix);
  const nBase = base.panier.size;
  const deja = new Set(choix.filter(Boolean));
  const cov = couverture(jeu, choix);
  const poids = jeu.data.equilibre.poids;
  const rep = jeu.data.equilibre.cibles.repetition_max;
  const cr = jeu.creneaux[slot];
  // Ce créneau est-il le dîner qui précède un déjeuner de coworking encore vide ?
  const gamelleDemain = cr.repas === "diner"
    ? (gamelles(jeu, choix).find(g => g.veille === slot && !g.fait) || {}).jour
    : null;

  return jeu.data.plats
    .filter(p => !deja.has(p.id) && convient(jeu, p, slot))
    .map(p => {
      const essai = [...choix]; essai[slot] = p.id;
      const apres = calculer(jeu, essai);
      const chaineIci = apres.chaine.filter(c => c.creneau === slot);
      const pleinIci = apres.pleinTarif.filter(c => c.creneau === slot);
      const a = p.apports || {};
      const surReste = p.ingredients.some(x => x.base);
      const malTransporte = cr.emporte && p.transportable === false;

      let score = 0; const pourquoi = [];
      if (a.proteine && a.proteine !== "aucune") {
        if (cov.manques[a.proteine]) {
          score += poids.proteine_manquante;
          pourquoi.push(`apporte ${a.proteine}, qui manque`);
        } else if (cov.satures[a.proteine] && !surReste) {
          score += poids.proteine_saturee;
          pourquoi.push(`${a.proteine} déjà servi assez`);
        } else if (cov.satures[a.proteine]) {
          pourquoi.push(`${a.proteine} déjà pris, mais celle-ci est déjà payée`);
        }
      }
      const neuves = (a.legumes || []).filter(f => !cov.familles.has(f));
      if (neuves.length) {
        score += poids.famille_legume_neuve * neuves.length;
        pourquoi.push("légumes nouveaux : " + neuves.join(", "));
      }
      if (a.feculent && (cov.feculent[a.feculent] || 0) >= rep.feculent)
        score += poids.repetition_feculent;
      if (a.profil && (cov.profil[a.profil] || 0) >= rep.profil) {
        score += poids.repetition_profil;
        pourquoi.push(`encore du ${a.profil}`);
      }
      if (chaineIci.length) score += poids.chaine_couverte;
      // Gamelle : un plat qui voyage mal n'est pas interdit, juste moins bon.
      if (malTransporte) {
        score += poids.mal_transporte ?? -6;
        pourquoi.push("voyage mal en gamelle");
      }
      // Le dîner de la veille d'un jour de coworking a un second métier : il
      // fabrique la gamelle. Un plat qui voyage et laisse un reste vaut mieux
      // là qu'ailleurs — même poids que le chaînage, parce que c'en est un.
      if (gamelleDemain && p.transportable !== false &&
          p.emits.some(e => e.kind === "reste-plat")) {
        score += poids.chaine_couverte;
        pourquoi.push(`laisse la gamelle de ${gamelleDemain}`);
      }
      // Un `accepts` requis que rien ne couvre reste une mauvaise idée.
      const requisNonCouvert = p.accepts.some(acc => acc.requis) &&
        !chaineIci.length && !p.sansReste;
      if (requisNonCouvert) {
        score += poids.chaine_manquante;
        pourquoi.push(`demande ${p.accepts.map(libelle).join(", ")}`);
      }
      const marginal = apres.panier.size - nBase;
      score += poids.article_marginal * marginal;

      return {
        plat: p, categorie: categorie(p), score: Math.round(score * 10) / 10,
        marginal, pourquoi, malTransporte, manque: requisNonCouvert,
        minutes: p.minutes + (pleinIci.length ? pleinIci[0].minutes : 0),
        chaine: chaineIci.length > 0,
        depuis: chaineIci.length ? chaineIci[0].depuis : null,
        // « Il y en a, mais pas assez » : le troisième cas que le booléen
        // d'avant confondait avec « il y en a ».
        recit: chaineIci.length ? chaineIci[0].recit : null,
        partiel: chaineIci.some(c => c.manque > 1e-9),
        plein: pleinIci.length > 0,
      };
    })
    .sort((x, y) => y.score - x.score);
}

// Tirage pondéré déterministe : la même main tant qu'on ne repioche pas.
function alea(graine) {
  let h = 2166136261;
  for (const c of graine) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function main(jeu, taille = 4) {
  const lignes = offre(jeu, jeu.choix, jeu.slot);
  if (!lignes.length) return [];
  const rnd = alea(`${jeu.slot}:${jeu.repioches[jeu.slot]}`);
  const pris = new Set(), main = [];

  const tirer = (pool) => {
    const libres = pool.filter(l => !pris.has(l.plat.id));
    if (!libres.length) return null;
    const poids = libres.map(l => Math.max(0.4, l.score + 12));
    let r = rnd() * poids.reduce((a, b) => a + b, 0);
    for (let i = 0; i < libres.length; i++) { r -= poids[i]; if (r <= 0) return libres[i]; }
    return libres[libres.length - 1];
  };

  for (const cat of ["express", "souche", "derive"]) {
    const c = tirer(lignes.filter(l => l.categorie === cat));
    if (c) { pris.add(c.plat.id); main.push(c); }
  }
  while (main.length < taille) {
    const c = tirer(lignes);
    if (!c) break;
    pris.add(c.plat.id); main.push(c);
  }
  return main.sort((a, b) => b.score - a.score);
}

export function articles(panier) {
  return [...panier.values()].map(s => ({
    ...s,
    qty: ["pièce", "gousse"].includes(s.unit) ? Math.ceil(s.qty - 1e-9) : s.qty,
  }));
}

export function parRayon(data, panier) {
  const arts = articles(panier);
  const groupes = [], vus = new Set();
  for (const rayon of data.rayons.ordre) {
    const dedans = arts.filter(a => (data.rayons.rayons[rayon] || []).includes(a.id));
    if (dedans.length) {
      dedans.forEach(a => vus.add(a.id));
      groupes.push([rayon, dedans.sort((x, y) => x.nom.localeCompare(y.nom))]);
    }
  }
  const reste = arts.filter(a => !vus.has(a.id));
  if (reste.length) groupes.push(["autre", reste]);
  return groupes;
}

// Minutes de cuisine par JOUR — pas par créneau. C'est la journée qui fatigue,
// pas le repas : trois plats qui tiennent chacun dans leur budget peuvent faire
// une journée intenable.
export function minutesParJour(jeu, choix) {
  const parJour = jeu.jours.map(() => 0);
  choix.forEach((rid, i) => {
    if (joue(rid)) parJour[jeu.creneaux[i].jour] += jeu.plats[rid].minutes;
  });
  return parJour;
}
