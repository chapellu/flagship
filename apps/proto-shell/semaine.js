// PROTOTYPE — constructeur de semaine, version visuelle.
//
// Port compact du modèle Python (chapellu/Workspace, prototypes/recipe-compiler,
// semaine_model.py). Les plats viennent de `cuisine-data.json`, exporté du vrai
// catalogue par export_json.py : aucune donnée n'est inventée ici.
//
// Le modèle de référence reste le Python. Ceci en est une transcription jetable,
// faite pour être vue sur un téléphone.

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export function creerJeu(data, nJours = 6) {
  const jours = Array.from({ length: nJours }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return { nom: JOURS[(d.getDay() + 6) % 7], date: d };
  });
  return {
    data,
    plats: Object.fromEntries(data.plats.map((p) => [p.id, p])),
    jours,
    choix: Array(nJours).fill(null),
    jour: 0,
    repioches: Array(nJours).fill(0),
  };
}

const alias = (data, id) => data.rayons.aliases?.[id] ?? id;
const placard = (data, id) => (data.rayons.placard || []).includes(id);

function facteur(plat, besoin) {
  const garde = plat.emits.some((e) => e.congelo || e.kind === "reste-plat");
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
export function calculer(jeu, choix) {
  const { data } = jeu;
  const besoin = data.foyer.parts;
  const fenetre = data.foyer.fenetreFrigo;
  const stock = data.stock.map((o) => ({ ...o, born: new Date(o.born) }));
  const panier = new Map();
  const aVerifier = new Map();
  const chaine = [], pleinTarif = [];

  choix.forEach((rid, i) => {
    if (!rid) return;
    const p = jeu.plats[rid];
    const date = jeu.jours[i].date;
    let plein = false;

    for (const acc of p.accepts) {
      const dispo = stock.find(
        (o) => o.type === acc.type &&
          (o.location === "congelo" ||
            (date - o.born) / 86400000 <= fenetre)
      );
      if (dispo) chaine.push({ jour: i, type: acc.type, depuis: dispo._from ?? null });
      else if (p.sansReste) { plein = true; pleinTarif.push({ jour: i, minutes: p.sansReste.minutes }); }
    }

    const f = facteur(p, besoin);
    const lignes = [...p.ingredients.filter((x) => !x.base)];
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
      stock.push({ type: e.type, born: date, location: "frigo", _from: rid });
  });

  return { panier, aVerifier, chaine, pleinTarif };
}

export function couverture(jeu, choix) {
  const { data } = jeu;
  const servi = {}, achete = {}, feculent = {}, profil = {};
  const familles = new Set();
  choix.forEach((rid) => {
    if (!rid) return;
    const p = jeu.plats[rid];
    const a = p.apports || {};
    const surReste = p.ingredients.some((i) => i.base);
    if (a.proteine && a.proteine !== "aucune") {
      servi[a.proteine] = (servi[a.proteine] || 0) + 1;
      if (!surReste) achete[a.proteine] = (achete[a.proteine] || 0) + 1;
    }
    if (a.feculent && a.feculent !== "aucun")
      feculent[a.feculent] = (feculent[a.feculent] || 0) + 1;
    (a.legumes || []).forEach((x) => familles.add(x));
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
  if (p.emits.some((e) => e.kind === "base")) return "souche";
  if (p.minutes <= 25) return "express";
  if (p.emits.some((e) => e.congelo)) return "congelable";
  return "complet";
}

export function offre(jeu, choix, jour) {
  const base = calculer(jeu, choix);
  const nBase = base.panier.size;
  const deja = new Set(choix.filter(Boolean));
  const cov = couverture(jeu, choix);
  const poids = jeu.data.equilibre.poids;
  const rep = jeu.data.equilibre.cibles.repetition_max;

  return jeu.data.plats
    .filter((p) => !deja.has(p.id))
    .map((p) => {
      const essai = [...choix]; essai[jour] = p.id;
      const apres = calculer(jeu, essai);
      const chaineIci = apres.chaine.filter((c) => c.jour === jour);
      const pleinIci = apres.pleinTarif.filter((c) => c.jour === jour);
      const a = p.apports || {};
      const surReste = p.ingredients.some((i) => i.base);

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
      const neuves = (a.legumes || []).filter((f) => !cov.familles.has(f));
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
      const marginal = apres.panier.size - nBase;
      score += poids.article_marginal * marginal;

      return {
        plat: p, categorie: categorie(p), score: Math.round(score * 10) / 10,
        marginal, pourquoi,
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
  const lignes = offre(jeu, jeu.choix, jeu.jour);
  if (!lignes.length) return [];
  const rnd = alea(`${jeu.jour}:${jeu.repioches[jeu.jour]}`);
  const pris = new Set(), main = [];

  const tirer = (pool) => {
    const libres = pool.filter((l) => !pris.has(l.plat.id));
    if (!libres.length) return null;
    const poids = libres.map((l) => Math.max(0.4, l.score + 12));
    let r = rnd() * poids.reduce((a, b) => a + b, 0);
    for (let i = 0; i < libres.length; i++) { r -= poids[i]; if (r <= 0) return libres[i]; }
    return libres[libres.length - 1];
  };

  for (const cat of ["express", "souche", "derive"]) {
    const c = tirer(lignes.filter((l) => l.categorie === cat));
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
  return [...panier.values()].map((s) => ({
    ...s,
    qty: ["pièce", "gousse"].includes(s.unit) ? Math.ceil(s.qty - 1e-9) : s.qty,
  }));
}

export function parRayon(data, panier) {
  const arts = articles(panier);
  const groupes = [], vus = new Set();
  for (const rayon of data.rayons.ordre) {
    const dedans = arts.filter((a) => (data.rayons.rayons[rayon] || []).includes(a.id));
    if (dedans.length) {
      dedans.forEach((a) => vus.add(a.id));
      groupes.push([rayon, dedans.sort((x, y) => x.nom.localeCompare(y.nom))]);
    }
  }
  const reste = arts.filter((a) => !vus.has(a.id));
  if (reste.length) groupes.push(["autre", reste]);
  return groupes;
}
