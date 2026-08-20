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
let vue = "main";          // main | courses | stock
let detail = null;         // la recette ouverte en fiche, s'il y en a une
// Les courses cochées, et celles qui sont RENTRÉES. La distinction compte :
// cocher, c'est dans le magasin ; rentrer, c'est à la maison — et seul le
// second change ce qu'on a. En mémoire seulement : le proto n'a pas de
// persistance, et il ne doit pas en gagner une par la bande.
const coches = new Set();
const rentres = new Map();

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

  const gam = S.gamelles(jeu, jeu.choix);

  hote.innerHTML = `
    ${bandeauSemaine(calc)}
    ${bandeauApports(cov, arts, calc)}
    ${bandeauRangement(calc)}
    ${bandeauAPrevoir(calc, gam)}
    ${vue === "courses" ? listeCourses(calc, arts)
      : vue === "stock" ? vueStock(calc)
      : mainDeCartes()}
    ${detail ? ficheRecette(calc) : ""}
  `;

  const rafraichir = () => rendre(hote, rendreParent);
  const sur = (sel, ev, fn) => hote.querySelectorAll(sel).forEach(
    b => b.addEventListener(ev, e => { fn(b, e); }));

  sur("[data-slot]", "click", b => {
    jeu.slot = +b.dataset.slot; vue = "main"; rafraichir();
  });
  sur("[data-jouer]", "click", b => {
    jeu.choix[jeu.slot] = b.dataset.jouer;
    avancer();
    rafraichir();
  });
  sur("[data-vider]", "click", (b, e) => {
    e.stopPropagation();
    jeu.choix[+b.dataset.vider] = null; rafraichir();
  });
  // Sauter, c'est DÉCIDER de ne pas manger là — pas laisser le créneau vide.
  sur("[data-sauter]", "click", b => {
    const i = +b.dataset.sauter;
    jeu.choix[i] = jeu.choix[i] === S.SAUTE ? null : S.SAUTE;
    if (jeu.choix[i] === S.SAUTE) avancer();
    rafraichir();
  });
  // Les parts, par repas. Le pas est 0,5 : c'est la part d'un petit.
  sur("[data-parts]", "click", b => {
    const [i, d] = b.dataset.parts.split(":").map(Number);
    jeu.parts[i] = Math.max(0.5, Math.round((jeu.parts[i] + d) * 2) / 2);
    rafraichir();
  });
  sur("[data-detail]", "click", (b, e) => {
    e.stopPropagation();
    detail = { plat: b.dataset.detail, creneau: b.dataset.creneau ? +b.dataset.creneau : null };
    rafraichir();
  });
  sur("[data-fermer]", "click", () => { detail = null; rafraichir(); });
  // La gamelle : le dîner de la veille grossit d'autant, et le midi part sur le
  // reste. Une action, parce que c'est un choix — le proto ne le fait pas seul.
  sur("[data-gamelle]", "click", b => {
    const g = gam.find(x => x.i === +b.dataset.gamelle);
    jeu.parts[g.veille] = Math.round((g.partsVeille + g.partsGamelle) * 2) / 2;
    jeu.choix[g.i] = "reste-de-la-veille";
    rafraichir();
  });
  sur("[data-cocher]", "change", b => {
    if (b.checked) coches.add(b.dataset.cocher); else coches.delete(b.dataset.cocher);
    // Pas de re-rendu : cocher dans un magasin ne doit rien faire bouger sous
    // le doigt. C'est « rentrer » qui change l'état.
    hote.querySelector("#rentrer")?.toggleAttribute("disabled", coches.size === 0);
  });
  sur("#rentrer", "click", () => {
    for (const a of arts) if (coches.has(cleArticle(a))) rentres.set(cleArticle(a), a);
    coches.clear();
    vue = "stock";
    rafraichir();
  });
  sur("#repiocher", "click", () => { jeu.repioches[jeu.slot]++; rafraichir(); });
  sur("[data-vue]", "click", b => {
    vue = vue === b.dataset.vue ? "main" : b.dataset.vue;
    rafraichir();
  });
}

// Le créneau suivant qui attend encore une décision — ni joué, ni sauté.
function avancer() {
  const suivant = jeu.choix.findIndex(
    (c, i) => !c && jeu.creneaux[i].nature === "choisi");
  if (suivant >= 0) jeu.slot = suivant;
}

const cleArticle = a => `${a.id}|${a.unit}`;

function bandeauSemaine(calc) {
  const minutes = S.minutesParJour(jeu, jeu.choix);
  return `<section class="sem-semaine">
    ${jeu.jours.map((j, ij) => {
      const slots = jeu.creneaux
        .map((c, i) => ({ ...c, i }))
        .filter(c => c.jour === ij);
      const choisis = slots.filter(c => c.nature === "choisi");
      const routines = slots.filter(c => c.nature === "routine");
      // Les créneaux optionnels vivent sur leur propre ligne, sous les repas.
      // Les mêler aux dîners en ferait des trous à l'œil — trois cases vides
      // côte à côte se lisent comme trois décisions en retard, or celle-ci
      // n'en est pas une. Un dessert vide n'est pas un dessert oublié.
      const optionnels = slots.filter(c => c.nature === "optionnel");
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
        ${optionnels.length ? `<div class="jour-option">${
          optionnels.map(c => creneau(c, calc)).join("")}</div>` : ""}
        ${routines.length ? `<div class="jour-routine">${
          routines.map(c => c.label).join(" · ")} <em>— routine</em></div>` : ""}
      </div>`;
    }).join("")}
  </section>`;
}

function creneau(c, calc) {
  const rid = jeu.choix[c.i];
  const saute = rid === S.SAUTE;
  const p = S.joue(rid) ? jeu.plats[rid] : null;
  const chaine = calc.chaine.some(x => x.creneau === c.i);
  // Les parts ne s'affichent que quand elles s'écartent du foyer : un chiffre
  // qui ne change jamais est un chiffre qu'on cesse de lire.
  const parts = jeu.parts[c.i] !== jeu.data.foyer.parts
    ? `<b class="parts">${fmtParts(jeu.parts[c.i])} p.</b>` : "";
  return `<button class="sem-slot ${c.i === jeu.slot ? "actif" : ""}
            ${p ? "rempli" : ""} ${saute ? "saute" : ""}
            ${c.nature === "optionnel" ? "optionnel" : ""}" data-slot="${c.i}">
    <span class="lab">${c.label}${c.emporte ? " 🥡" : ""}</span>
    ${saute ? `<span class="t muet">on ne mange pas là</span>
               <span class="vider" data-sauter="${c.i}">×</span>`
      : p ? `<span class="t">${p.titre}</span>
           <span class="pied">${p.minutes} min${parts}${chaine ? ' <b class="lien">↪</b>' : ""}</span>
           <span class="vider" data-vider="${c.i}">×</span>`
        : '<span class="vide">+</span>'}
  </button>`;
}

// 2,5 et non 2.5 : c'est un nombre de parts, pas une mesure d'ingénieur.
const fmtParts = n => String(+n.toFixed(1)).replace(".", ",");

function bandeauApports(cov, arts, calc) {
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
        <button data-vue="courses" class="compte">
          <b>${arts.length}</b><span>articles</span>
        </button>
        <button data-vue="stock" class="compte creux">
          <b>${calc.depot.lignes.filter(l => !l._epuise).length}</b><span>en stock</span>
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

// UN SEUL BANDEAU POUR DEUX MÉCANIQUES, parce que c'en est une seule.
//
// « Tu n'as plus de bolognaise : en faire plus lundi » et « jeudi part en
// gamelle : cuisiner plus mercredi soir » disent exactement la même chose —
// agrandir un lot en amont pour qu'un repas en aval soit déjà payé. L'un est
// commandé par un manque constaté, l'autre par le calendrier. Les afficher
// séparément demandait deux en-têtes pour une seule idée, et poussait les
// cartes sous le pli.
//
// Une OFFRE, jamais une correction : le proto ne redimensionne rien tout seul.
const A_PREVOIR_MAX = 3;

function bandeauAPrevoir(calc, gam) {
  // Seulement des ACTIONS. Une gamelle dont le dîner de la veille n'est pas
  // encore choisi n'a rien à proposer — c'est le paquet de cartes qui pousse
  // alors les plats qui voyagent, au moment où on choisit ce dîner-là. Un
  // bandeau qui réclame sans rien offrir se lit une fois puis s'ignore.
  const lignes = [
    ...gam.filter(g => !g.fait && g.plat).map(ligneGamelle),
    ...calc.offres.map(ligneOffre),
  ];
  if (!lignes.length) return "";
  const montres = lignes.slice(0, A_PREVOIR_MAX);
  const reste = lignes.length - montres.length;
  return `<section class="sem-offres">
    <div class="lab">À prévoir <em>— faire plus, plus tôt</em></div>
    ${montres.join("")}
    ${reste > 0 ? `<div class="of-plus">+ ${reste} autre${reste > 1 ? "s" : ""}</div>` : ""}
  </section>`;
}

function ligneOffre(o) {
  return `<div class="of-l">
    <div class="of-p"><b>${o.titre}</b> — ${o.combien}</div>
    <div class="of-d">${o.deQuoi} · ${
      o.pour.map(([j]) => j).join(" et ")} ne coûte plus rien${
      o.gainMin ? ` · ${o.gainMin} min gagnées` : ""}</div>
    ${o.reserves().map(r => `<div class="of-r">${r}</div>`).join("")}
  </div>`;
}

// La gamelle : on ne prépare pas une lunchbox le matin même, on la prélève sur
// le dîner de la veille — donc ce dîner doit être cuisiné plus grand.
function ligneGamelle(g) {
  if (!g.plat) return `<div class="of-l gamelle vide">
    <div class="of-p">🥡 <b>${g.jour} midi</b> part en gamelle</div>
    <div class="of-d">rien de prévu ${g.jourVeille} soir — c'est là qu'elle se cuisine</div>
  </div>`;
  const freins = [];
  if (!g.transportable) freins.push("⚠ ce plat voyage mal");
  if (!g.laisseReste) freins.push("⚠ il ne laisse pas de reste réutilisable");
  if (!g.tientVaisselle)
    freins.push(`⚠ ${fmtParts(g.total)} parts ne tiennent pas dans ${g.plat.vaisselle.label}`);
  return `<div class="of-l gamelle ${g.actionnable ? "" : "bloque"}">
    <div class="of-p">🥡 <b>${g.jourVeille} soir</b> — cuisiner pour ${fmtParts(g.total)} parts</div>
    <div class="of-d">${g.plat.titre} · ${fmtParts(g.partsVeille)} + ${
      fmtParts(g.partsGamelle)} et ${g.jour} midi est prêt</div>
    ${freins.map(f => `<div class="of-r">${f}</div>`).join("")}
    ${g.actionnable ? `<button class="ga-b" data-gamelle="${g.i}">prévoir la gamelle</button>` : ""}
  </div>`;
}

// LA FICHE. Une carte dit ce qu'un plat COÛTE ; elle ne dit pas comment on le
// fait. Les quantités sont mises à l'échelle des parts du créneau — c'est là que
// « jouer avec les parts » devient concret : on lit 525 g de pâtes, pas 350.
function ficheRecette(calc) {
  const p = jeu.plats[detail.plat];
  const i = detail.creneau;
  const parts = i != null ? jeu.parts[i] : jeu.data.foyer.parts;
  const f = i != null && calc.facteurs[i] ? calc.facteurs[i] : S.facteurAffiche(p, parts);
  const ing = p.ingredients.filter(x => !x.base);
  const bases = p.ingredients.filter(x => x.base);
  // Ce que la casserole rend RÉELLEMENT. Un plat qui se garde se cuisine en lot
  // entier même pour 2,5 parts : afficher « pour 2,5 parts » au-dessus des
  // quantités d'un lot de 4 serait un mensonge, et c'est ce que faisait la
  // première version de cette fiche.
  const produit = +(p.portions * f).toFixed(1);
  return `<div class="fiche-fond" data-fermer="1"></div>
  <section class="fiche">
    <div class="fiche-tete">
      <h2>${p.titre}</h2>
      <button data-fermer="1" class="fermer">×</button>
    </div>
    <div class="fiche-meta">
      <span>${p.minutes} min${p.actifMin ? ` · ${p.actifMin} actives` : ""}</span>
      <span>pour ${fmtParts(parts)} parts</span>
      ${produit > parts + 0.05 ? `<span class="ecart">on en cuisine ${fmtParts(produit)}
        <em>— ${p.lotEntier ? "le lot ne se coupe pas"
          : "ça se garde, autant faire le lot"}</em></span>` : ""}
      ${p.vaisselle ? `<span>tient dans ${p.vaisselle.label}</span>` : ""}
    </div>
    ${bases.length ? `<div class="fiche-bloc"><h3>part d'une base</h3>
      ${bases.map(x => `<div class="fi-l">${S.echelleTexte(x, f)} — ${x.nom}</div>`).join("")}
      ${p.sansReste ? `<div class="fi-note">sans elle : +${p.sansReste.minutes} min et
        ${p.sansReste.ingredients.map(x => x.nom).join(", ")}</div>` : ""}
    </div>` : ""}
    <div class="fiche-bloc"><h3>ingrédients</h3>
      ${ing.map(x => `<div class="fi-l ${x.assaisonnement ? "assai" : ""}">
        ${S.echelleTexte(x, f)} — ${x.nom}</div>`).join("")}
    </div>
    ${p.steps?.length ? `<div class="fiche-bloc"><h3>marche à suivre</h3>
      ${p.steps.map((s, n) => `<div class="fi-s">
        <b>${n + 1}.</b> ${s.action}
        ${s.minutes ? `<span class="fi-min">${s.minutes} min${s.surveille ? "" : " · sans surveiller"}</span>` : ""}
        ${s.enfant ? `<div class="fi-kid">👶 ${s.enfant}${s.enfantDes ? ` (dès ${s.enfantDes} mois)` : ""}</div>` : ""}
      </div>`).join("")}
    </div>` : ""}
    ${p.bebe ? `<div class="fiche-bloc"><h3>portion bébé</h3>
      <div class="fi-l">${p.bebe}</div></div>` : ""}
    ${p.emits.length ? `<div class="fiche-bloc"><h3>ce que ça laisse</h3>
      ${p.emits.map(e => `<div class="fi-l">${e.type}${
        e.qty ? ` — ${fmtParts(e.qty.amount * f)} ${e.qty.unit}` : ""}
        <em>${e.congelo ? "se congèle" : e.gardeFrigo ? `${e.gardeFrigo} j au frigo` : ""}</em></div>`).join("")}
    </div>` : ""}
  </section>`;
}

// CE QU'ON A. Le stock n'était qu'un chiffre dans un coin ; ici il se détaille,
// avec ce que la semaine y prend et ce qu'il en reste après.
function vueStock(calc) {
  const groupes = { frigo: [], congelo: [], placard: [] };
  for (const l of calc.depot.lignes) {
    const esp = l.espace || (l.location === "congelo" ? "congelo" : "frigo");
    (groupes[esp] ||= []).push(l);
  }
  const ligne = l => {
    const q = l.qty?.amount;
    const reste = l._reste != null && q != null && l._reste < q
      ? ` <em>reste ${fmtParts(l._reste)} ${l._unite}</em>` : "";
    return `<div class="st-l ${l._epuise ? "mange" : ""}">
      <span class="st-t">${l.type}</span>
      <span class="st-q">${q != null ? `${fmtParts(q)} ${l._unite}` : (l.band ?? l.qty_band ?? "")}</span>
      <div class="st-d">${l._from ? `cuisiné cette semaine — ${jeu.plats[l._from]?.titre ?? l._from}`
        : "déjà là avant la semaine"}${reste}${l._epuise ? " · mangé par la semaine" : ""}</div>
    </div>`;
  };
  return `<section class="sem-courses sem-stock">
    <div class="entete"><h2>En stock</h2>
      <button data-vue="stock">retour aux cartes</button></div>
    ${Object.entries(groupes).filter(([, v]) => v.length).map(([esp, v]) =>
      `<div class="rayon"><h3>${ESPACES[esp]}</h3>${v.map(ligne).join("")}</div>`).join("")}
    ${rentres.size ? `<div class="rayon"><h3>rentré des courses</h3>
      ${[...rentres.values()].map(a =>
        `<div class="st-l"><span class="st-t">${a.nom}</span>
         <span class="st-q">${a.qty} ${a.unit}</span></div>`).join("")}
      <div class="fi-note">Le modèle ne compte encore que les BASES cuisinées ;
        ces ingrédients bruts sont notés, pas encore soustraits des courses de la
        semaine suivante.</div>
    </div>` : ""}
  </section>`;
}

function mainDeCartes() {
  const i = jeu.slot;
  const c = jeu.creneaux[i];
  const j = jeu.jours[c.jour];
  const saute = jeu.choix[i] === S.SAUTE;
  const main = saute ? [] : S.main(jeu);
  return `<section class="sem-main">
    <div class="entete">
      <h2>${j.nom} ${c.label}${c.emporte ? " 🥡" : ""}</h2>
      <button id="repiocher">repiocher ⟳</button>
    </div>
    <div class="reglages">
      <div class="parts-ctl">
        <button data-parts="${i}:-0.5" aria-label="moins de parts">−</button>
        <span><b>${fmtParts(jeu.parts[i])}</b> parts</span>
        <button data-parts="${i}:0.5" aria-label="plus de parts">+</button>
      </div>
      <button class="sauter ${saute ? "on" : ""}" data-sauter="${i}">${
        saute ? "on remange ici" : "sauter ce repas"}</button>
    </div>
    ${c.emporte ? '<div class="sem-note">déjeuner de coworking — il doit voyager</div>' : ""}
    ${saute ? '<div class="carte-vide">repas sauté — rien à cuisiner, rien à acheter</div>'
      : main.length ? main.map(carte).join("")
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
    <div class="carte-haut"><span class="pic">${s.pic}</span>${s.nom}
      <span class="loupe" data-detail="${l.plat.id}" data-creneau="${jeu.slot}">détail ›</span>
    </div>
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
      <button data-vue="courses">retour aux cartes</button></div>
    ${groupes.map(([rayon, items]) => `
      <div class="rayon"><h3>${rayon}</h3>
        ${items.map(a => {
          const cle = cleArticle(a);
          // La case cochée survit au re-rendu. Elle ne le faisait pas : chaque
          // changement de la semaine reconstruit le DOM et effaçait la liste
          // sous le doigt, au milieu d'un magasin.
          return `<label class="art-l ${rentres.has(cle) ? "rentre" : ""}">
            <input type="checkbox" data-cocher="${cle}"
              ${coches.has(cle) ? "checked" : ""} ${rentres.has(cle) ? "disabled" : ""}>
            <span>${a.qty} ${a.unit} — ${a.nom}${a.n > 1 ? ` <em>(${a.n} plats)</em>` : ""}</span>
          </label>`;
        }).join("")}
      </div>`).join("")}
    <button id="rentrer" ${coches.size ? "" : "disabled"}>rentrer les courses cochées</button>
    ${calc.aVerifier.size ? `<div class="rayon placard"><h3>à vérifier au placard</h3>
      <p>${[...calc.aVerifier.values()].join(" · ")}</p></div>` : ""}
    ${provenanceEnPied(calc)}
  </section>`;
}
