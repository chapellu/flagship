// PROTOTYPE — rendu du constructeur de semaine. Jetable.
//
// LE CHOIX D'UX, PUISQU'IL A CHANGÉ
// Avec un plat par jour, un ruban horizontal de 6 cartes suffisait. Avec trois
// repas, la semaine fait 22 créneaux : le ruban devient une frise illisible où
// l'on perd la notion de journée. On passe donc à une **liste verticale de
// journées**, chacune portant ses créneaux choisis côte à côte (midi | soir).
// Toute la semaine tient sans défilement horizontal, et la journée redevient
// l'unité qu'elle est dans la vraie vie.
//
// Chaque journée affiche aussi son **total de minutes** : c'est la découverte du
// modèle Python — chaque repas tient dans son budget, la journée non.

import * as S from "./semaine.js";

const SUITS = {
  souche: { pic: "♠", nom: "souche" },
  derive: { pic: "♥", nom: "sur un reste" },
  express: { pic: "♦", nom: "express" },
  congelable: { pic: "♣", nom: "se congèle" },
  complet: { pic: "●", nom: "plat" },
};

let jeu = null;
let vue = "main";

export async function monter(hote, rendreParent) {
  if (!jeu) {
    const data = await fetch("cuisine-data.json").then(r => r.json());
    jeu = S.creerJeu(data);
  }
  rendre(hote, rendreParent);
}

// L'onglet Foyer, côté cuisine : les deux plafonds physiques, ceux qui décident
// si une proposition d'agrandir un lot est réalisable. La contenance des
// récipients est l'analogue exact de la RAM d'un CPU de craft — un lot qui n'y
// entre pas ne part pas, quels que soient les ingrédients disponibles.
export async function encartCuisine(hote) {
  const data = await fetch("cuisine-data.json").then(r => r.json());
  const f = data.foyer;
  const esp = Object.entries(f.espaces)
    .map(([id, s]) => `${ESPACES[id].toLowerCase()} ${s.limite}${
      s.cause === "contenant" ? " (contenants)" : ""}`).join(" · ");
  hote.innerHTML = `
    <div class="carte"><span class="titre">Ce qui tient dans une casserole</span>
      <div class="muted">${f.vaisselle.map(v =>
        `${v.label} — ${v.contenance} portions${v.exemplaires > 1 ? ` ×${v.exemplaires}` : ""}`)
        .join("<br>")}</div>
      <div class="muted"><em>Un lot qui n'entre pas dans le récipient ne se cuisine pas,
        quels que soient les ingrédients.</em></div>
    </div>
    <div class="carte"><span class="titre">Contenants — un pool qui tourne</span>
      <div class="muted">${f.contenants.map(c =>
        `${c.nombre} × ${c.label} (${c.portions} portion${c.portions > 1 ? "s" : ""})
         → ${c.espaces.join(", ") || "aucun espace ouvert"}${c.consommable ? " · consommable" : ""}`)
        .join("<br>")}</div>
      <div class="muted"><em>Un contenant plein est indisponible jusqu'à ce qu'on
        en mange le contenu.</em></div>
    </div>
    <div class="carte"><span class="titre">Places de rangement</span>
      <div class="muted">${esp}</div>
    </div>`;
}

function rendre(hote, rendreParent) {
  const calc = S.calculer(jeu, jeu.choix);
  const cov = S.couverture(jeu, jeu.choix);
  const arts = S.articles(calc.panier);

  hote.innerHTML = `
    ${bandeauSemaine(calc)}
    ${bandeauApports(cov, arts)}
    ${bandeauRangement(calc)}
    ${bandeauOffres(calc)}
    ${vue === "courses" ? listeCourses(calc, arts) : mainDeCartes()}
  `;

  hote.querySelectorAll("[data-slot]").forEach(b =>
    b.addEventListener("click", () => {
      jeu.slot = +b.dataset.slot;
      vue = "main";
      rendre(hote, rendreParent);
    }));
  hote.querySelectorAll("[data-jouer]").forEach(b =>
    b.addEventListener("click", () => {
      jeu.choix[jeu.slot] = b.dataset.jouer;
      const suivant = jeu.choix.findIndex(
        (c, i) => !c && jeu.creneaux[i].nature === "choisi");
      if (suivant >= 0) jeu.slot = suivant;
      rendre(hote, rendreParent);
    }));
  hote.querySelectorAll("[data-vider]").forEach(b =>
    b.addEventListener("click", e => {
      e.stopPropagation();
      jeu.choix[+b.dataset.vider] = null;
      rendre(hote, rendreParent);
    }));
  const rp = hote.querySelector("#repiocher");
  if (rp) rp.addEventListener("click", () => {
    jeu.repioches[jeu.slot]++;
    rendre(hote, rendreParent);
  });
  const bc = hote.querySelector("#bascule-courses");
  if (bc) bc.addEventListener("click", () => {
    vue = vue === "courses" ? "main" : "courses";
    rendre(hote, rendreParent);
  });
}

function bandeauSemaine(calc) {
  const minutes = S.minutesParJour(jeu, jeu.choix);
  return `<section class="sem-semaine">
    ${jeu.jours.map((j, ij) => {
      const slots = jeu.creneaux
        .map((c, i) => ({ ...c, i }))
        .filter(c => c.jour === ij);
      const choisis = slots.filter(c => c.nature === "choisi");
      const routines = slots.filter(c => c.nature === "routine");
      const m = minutes[ij];
      return `<div class="sem-journee">
        <div class="jour-tete">
          <span class="nom">${j.nom}</span>
          <span class="date">${j.date.getDate()}/${j.date.getMonth() + 1}</span>
          ${m ? `<span class="min ${m > 90 ? "lourd" : ""}">${m} min</span>` : ""}
        </div>
        <div class="jour-slots">
          ${choisis.map(c => creneau(c, calc)).join("")}
        </div>
        ${routines.length ? `<div class="jour-routine">${
          routines.map(c => c.label).join(" · ")} <em>— routine</em></div>` : ""}
      </div>`;
    }).join("")}
  </section>`;
}

function creneau(c, calc) {
  const rid = jeu.choix[c.i];
  const p = rid ? jeu.plats[rid] : null;
  const chaine = calc.chaine.some(x => x.creneau === c.i);
  return `<button class="sem-slot ${c.i === jeu.slot ? "actif" : ""} ${p ? "rempli" : ""}"
            data-slot="${c.i}">
    <span class="lab">${c.label}${c.emporte ? " 🥡" : ""}</span>
    ${p ? `<span class="t">${p.titre}</span>
           <span class="pied">${p.minutes} min${chaine ? ' <b class="lien">↪</b>' : ""}</span>
           <span class="vider" data-vider="${c.i}">×</span>`
        : '<span class="vide">+</span>'}
  </button>`;
}

function bandeauApports(cov, arts) {
  const prot = Object.entries(cov.servi);
  const manque = [
    ...Object.entries(cov.manques).map(([p, n]) => `${p} ×${n}`),
    ...(cov.famillesManquantes ? [`${cov.famillesManquantes} famille(s) de légumes`] : []),
  ];
  return `<section class="sem-apports">
    <div class="ligne">
      <div>
        <div class="lab">Protéines <em>— repas principaux</em></div>
        <div class="chips">${prot.length
          ? prot.map(([p, n]) => `<span class="chip ok">${p}${n > 1 ? " ×" + n : ""}</span>`).join("")
          : '<span class="chip vide">rien encore</span>'}</div>
      </div>
      <div class="compteur">
        <button id="bascule-courses" class="compte">
          <b>${arts.length}</b><span>articles</span>
        </button>
      </div>
    </div>
    <div class="lab">Légumes — ${cov.familles.size} famille(s)</div>
    <div class="chips">${[...cov.familles].map(f => `<span class="chip veg">${f}</span>`).join("")
      || '<span class="chip vide">—</span>'}</div>
    ${manque.length ? `<div class="manque">manque : ${manque.join(" · ")}</div>`
      : (jeu.choix.some(Boolean) ? '<div class="atteint">cibles de la semaine atteintes</div>' : "")}
  </section>`;
}

// LA CUISINE EST FINIE, et c'est la moitié du modèle qui manquait à l'écran.
// Chaque espace a DEUX plafonds, les étagères et les boîtes ; le plus bas
// commande. On affiche lequel mord, parce que dégager une étagère et laver des
// boîtes ne sont pas le même geste.
const ESPACES = { frigo: "Frigo", congelo: "Congélo", placard: "Placard" };

function bandeauRangement(calc) {
  const g = n => +n.toFixed(1);
  // Trois colonnes, pas trois lignes : ce bandeau est un CADRAN qu'on lit en
  // choisissant, et la thèse du proto est que le coût reste au-dessus du pli.
  // Le détail ne s'écrit que quand il change quelque chose.
  const cols = Object.entries(calc.stockage).map(([id, s]) => {
    const pct = Math.min(100, (s.fin / s.limite) * 100);
    return `<div class="rg-c ${s.deborde ? "deborde" : ""} ${s.cause === "contenant" ? "boites" : ""}">
      <div class="rg-t">${ESPACES[id]}<b>${g(s.fin)}</b><span>/ ${g(s.limite)}</span></div>
      <div class="rg-jauge"><i style="width:${pct}%"></i></div>
      <div class="rg-p">${s.debut ? `${g(s.debut)} ` : ""}+${g(s.entre)}${
        s.sort ? ` −${g(s.sort)}` : ""}</div>
    </div>`;
  });
  // Ce qui mérite une phrase : un espace qui déborde, ou un espace dont ce sont
  // les BOÎTES qui commandent et pas les étagères — deux gestes différents.
  const notes = Object.entries(calc.stockage)
    .filter(([, s]) => s.deborde || s.cause === "contenant")
    .map(([id, s]) => s.deborde
      ? `⚠ le ${ESPACES[id].toLowerCase()} déborde`
      : `${ESPACES[id].toLowerCase()} : limité par les contenants (${g(s.limite)}), pas par la place (${s.places})`);
  return `<section class="sem-rangement">
    <div class="lab">Où ça se range <em>— la cuisine n'est pas infinie</em></div>
    <div class="rg-cols">${cols.join("")}</div>
    ${notes.map(n => `<div class="rg-note">${n}</div>`).join("")}
  </section>`;
}

// « Tu n'as plus de bolognaise d'avance : en faire plus lundi, et le gratin de
// jeudi est déjà payé. » Une OFFRE, jamais une correction automatique — le
// prototype ne redimensionne rien tout seul.
function bandeauOffres(calc) {
  if (!calc.offres.length) return "";
  return `<section class="sem-offres">
    <div class="lab">Faire plus, plus tôt</div>
    ${calc.offres.map(o => `<div class="of-l">
      <div class="of-p"><b>${o.titre}</b> — ${o.combien}</div>
      <div class="of-d">${o.deQuoi} · ${
        o.pour.map(([j]) => j).join(" et ")} ne coûte plus rien${
        o.gainMin ? ` · ${o.gainMin} min gagnées` : ""}</div>
      ${o.reserves().map(r => `<div class="of-r">${r}</div>`).join("")}
    </div>`).join("")}
  </section>`;
}

function mainDeCartes() {
  const main = S.main(jeu);
  const c = jeu.creneaux[jeu.slot];
  const j = jeu.jours[c.jour];
  return `<section class="sem-main">
    <div class="entete">
      <h2>${j.nom} ${c.label}${c.emporte ? " 🥡" : ""}</h2>
      <button id="repiocher">repiocher ⟳</button>
    </div>
    ${c.emporte ? '<div class="sem-note">déjeuner de coworking — il doit voyager</div>' : ""}
    ${main.length ? main.map(carte).join("")
      : '<div class="carte-vide">plus de cartes pour ce créneau</div>'}
  </section>`;
}

function carte(l) {
  const s = SUITS[l.categorie];
  const a = l.plat.apports || {};
  const cout = l.marginal === 0
    ? '<span class="gratuit">+0 article</span>'
    : `+${l.marginal} article${l.marginal > 1 ? "s" : ""}`;
  const marques = [];
  // On dit COMBIEN et D'OÙ, pas « il y en a » : une prise qui traverse deux
  // bocaux se raconte en deux morceaux, et « pas assez » est un troisième cas.
  if (l.chaine) marques.push(`<span class="m lien">↪ ${l.recit || "base déjà cuite"}</span>`);
  if (l.partiel) marques.push(`<span class="m alerte">il en manque</span>`);
  if (l.plein) marques.push(`<span class="m plein">plein tarif</span>`);
  if (l.malTransporte) marques.push(`<span class="m alerte">voyage mal</span>`);
  if (l.manque) marques.push(`<span class="m alerte">demande un reste</span>`);
  if (l.plat.emits.length)
    marques.push(`<span class="m sortie">→ ${l.plat.emits.map(e => e.type).join(", ")}</span>`);
  return `<button class="carte ${l.categorie}" data-jouer="${l.plat.id}">
    <div class="carte-haut"><span class="pic">${s.pic}</span>${s.nom}</div>
    <div class="carte-titre">${l.plat.titre}</div>
    <div class="carte-meta">
      <span class="min">${l.minutes} min</span>
      <span class="art">${cout}</span>
      ${a.proteine && a.proteine !== "aucune" ? `<span class="tag">${a.proteine}</span>` : ""}
      ${a.profil ? `<span class="tag">${a.profil}</span>` : ""}
    </div>
    ${marques.length ? `<div class="carte-marques">${marques.join("")}</div>` : ""}
    ${l.pourquoi.length ? `<div class="carte-pourquoi">${l.pourquoi.join(" · ")}</div>` : ""}
  </button>`;
}

// Toute ligne d'ingrédient a une PROVENANCE, décidée une fois : c'est ce qui
// fait qu'on n'achète pas ce qu'on a déjà. « À cuisiner d'avance » est le cas
// contre-intuitif : une base manquante ne s'achète nulle part — on n'achète pas
// 250 g de lentilles *cuites*.
function provenanceEnPied(calc) {
  const lab = jeu.data.provenances;
  const lignes = Object.entries(calc.provenances)
    .filter(([p]) => p !== "courses")
    .map(([p, n]) => `<span class="chip prov ${p}">${lab[p]} : ${n}</span>`);
  if (!lignes.length) return "";
  return `<div class="rayon hors-liste"><h3>hors liste</h3>
    <div class="chips">${lignes.join("")}</div></div>`;
}

function listeCourses(calc, arts) {
  const groupes = S.parRayon(jeu.data, calc.panier);
  return `<section class="sem-courses">
    <div class="entete"><h2>Courses — ${arts.length} articles</h2>
      <button id="bascule-courses">retour aux cartes</button></div>
    ${groupes.map(([rayon, items]) => `
      <div class="rayon"><h3>${rayon}</h3>
        ${items.map(a => `<label class="art-l"><input type="checkbox">
          <span>${a.qty} ${a.unit} — ${a.nom}${a.n > 1 ? ` <em>(${a.n} plats)</em>` : ""}</span>
        </label>`).join("")}
      </div>`).join("")}
    ${calc.aVerifier.size ? `<div class="rayon placard"><h3>à vérifier au placard</h3>
      <p>${[...calc.aVerifier.values()].join(" · ")}</p></div>` : ""}
    ${provenanceEnPied(calc)}
  </section>`;
}
