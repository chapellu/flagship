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

export function creerJeu(data, nJours = 7) {
  const cfg = data.creneaux;
  const ordre = Object.keys(cfg.repas);
  const emporte = cfg.emporte || {};
  const jours = Array.from({ length: nJours }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return { nom: JOURS[(d.getDay() + 6) % 7], date: d };
  });

  const creneaux = [];
  jours.forEach((j, i) => {
    const duJour = (cfg.jours.exceptions || {})[j.nom] || cfg.jours.defaut;
    [...duJour].sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b)).forEach(repas => {
      creneaux.push({
        jour: i, repas,
        label: cfg.repas[repas].label,
        nature: cfg.repas[repas].nature,
        emporte: (emporte[repas] || []).includes(j.nom),
      });
    });
  });

  return {
    data,
    plats: Object.fromEntries(data.plats.map(p => [p.id, p])),
    jours, creneaux,
    equilibreSur: cfg.equilibre_sur || ["dejeuner", "diner"],
    choix: Array(creneaux.length).fill(null),
    // On démarre sur le premier créneau réellement choisi : personne ne pioche
    // une carte pour son petit-déjeuner.
    slot: creneaux.findIndex(c => c.nature === "choisi"),
    repioches: Array(creneaux.length).fill(0),
  };
}

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

// Un plat déclare les créneaux qui lui vont ; le silence vaut « repas principal ».
export function convient(jeu, plat, i) {
  const ok = plat.creneaux?.length ? plat.creneaux : ["dejeuner", "diner"];
  return ok.includes(jeu.creneaux[i].repas);
}

function facteur(plat, besoin) {
  const garde = plat.emits.some(e => e.congelo || e.kind === "reste-plat");
  return garde && besoin < plat.portions ? 1 : besoin / plat.portions;
}

function echelle(qty, unit, f) {
  const v = qty * f;
  if (unit === "g") return Math.round(v / 10) * 10;
  if (["pièce", "gousse", "c. à s.", "c. à c.", "pincée"].includes(unit))
    return Math.round(v * 2) / 2;
  return Math.round(v * 10) / 10;
}

// Le cœur : panier, chaînage, plein tarif — pour une semaine partielle.
export function calculer(jeu, choix, jetes = []) {
  const { data } = jeu;
  const besoin = data.foyer.parts;
  const fenetre = data.foyer.fenetreFrigo;
  const stock = data.stock
    .filter(o => !jetes.includes(o.type))
    .map(o => ({ ...o, born: new Date(o.born) }));
  const panier = new Map();
  const aVerifier = new Map();
  const chaine = [], pleinTarif = [];

  choix.forEach((rid, i) => {
    if (!rid) return;
    const p = jeu.plats[rid];
    const date = dateDe(jeu, i);
    let plein = false;

    for (const acc of p.accepts) {
      const dispo = stock.find(
        o => accepte(o, acc) &&
          (o.location === "congelo" || (date - o.born) / 86400000 <= fenetre)
      );
      if (dispo) chaine.push({ creneau: i, type: dispo.type, depuis: dispo._from ?? null });
      else if (p.sansReste) { plein = true; pleinTarif.push({ creneau: i, minutes: p.sansReste.minutes }); }
    }

    const f = facteur(p, besoin);
    const lignes = [...p.ingredients.filter(x => !x.base)];
    if (plein) lignes.push(...p.sansReste.ingredients);
    for (const ing of lignes) {
      const cid = alias(data, ing.id);
      if (placard(data, cid)) { aVerifier.set(cid, ing.nom); continue; }
      const cle = cid + "|" + ing.unit;
      const slot = panier.get(cle) || { nom: ing.nom, qty: 0, n: 0, id: cid, unit: ing.unit };
      slot.qty += echelle(ing.qty, ing.unit, f);
      slot.n += 1;
      panier.set(cle, slot);
    }

    for (const e of p.emits)
      stock.push({ type: e.type, kind: e.kind, born: date, location: "frigo", _from: rid });
  });

  return { panier, aVerifier, chaine, pleinTarif };
}

export function couverture(jeu, choix) {
  const { data } = jeu;
  const servi = {}, achete = {}, feculent = {}, profil = {};
  const familles = new Set();
  choix.forEach((rid, i) => {
    if (!rid) return;
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
    if (rid) parJour[jeu.creneaux[i].jour] += jeu.plats[rid].minutes;
  });
  return parJour;
}
