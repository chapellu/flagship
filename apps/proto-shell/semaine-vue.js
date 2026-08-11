// PROTOTYPE — rendu du constructeur de semaine. Jetable.
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
    const data = await fetch("cuisine-data.json").then((r) => r.json());
    jeu = S.creerJeu(data);
  }
  rendre(hote, rendreParent);
}

function rendre(hote, rendreParent) {
  const calc = S.calculer(jeu, jeu.choix);
  const cov = S.couverture(jeu, jeu.choix);
  const arts = S.articles(calc.panier);

  hote.innerHTML = `
    ${bandeauSemaine(calc)}
    ${bandeauApports(cov, arts, calc)}
    ${vue === "courses" ? listeCourses(calc, arts) : mainDeCartes()}
  `;

  hote.querySelectorAll("[data-jour]").forEach((b) =>
    b.addEventListener("click", () => {
      jeu.jour = +b.dataset.jour;
      vue = "main";
      rendre(hote, rendreParent);
    }));
  hote.querySelectorAll("[data-jouer]").forEach((b) =>
    b.addEventListener("click", () => {
      jeu.choix[jeu.jour] = b.dataset.jouer;
      const suivant = jeu.choix.findIndex((c) => !c);
      if (suivant >= 0) jeu.jour = suivant;
      rendre(hote, rendreParent);
    }));
  hote.querySelectorAll("[data-vider]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      jeu.choix[+b.dataset.vider] = null;
      rendre(hote, rendreParent);
    }));
  const rp = hote.querySelector("#repiocher");
  if (rp) rp.addEventListener("click", () => {
    jeu.repioches[jeu.jour]++;
    rendre(hote, rendreParent);
  });
  const bc = hote.querySelector("#bascule-courses");
  if (bc) bc.addEventListener("click", () => {
    vue = vue === "courses" ? "main" : "courses";
    rendre(hote, rendreParent);
  });
}

function bandeauSemaine(calc) {
  return `<section class="sem-jours">
    ${jeu.jours.map((j, i) => {
      const rid = jeu.choix[i];
      const p = rid ? jeu.plats[rid] : null;
      const chaine = calc.chaine.some((c) => c.jour === i);
      return `<button class="sem-jour ${i === jeu.jour ? "actif" : ""} ${p ? "rempli" : ""}"
                data-jour="${i}">
        <span class="j">${j.nom.slice(0, 3)}</span>
        <span class="d">${j.date.getDate()}/${j.date.getMonth() + 1}</span>
        ${p ? `<span class="t">${p.titre}</span>
               ${chaine ? '<span class="lien">↪</span>' : ""}
               <span class="vider" data-vider="${i}">×</span>`
            : '<span class="vide">+</span>'}
      </button>`;
    }).join("")}
  </section>`;
}

function bandeauApports(cov, arts, calc) {
  const prot = Object.entries(cov.servi);
  const manque = [
    ...Object.entries(cov.manques).map(([p, n]) => `${p} ×${n}`),
    ...(cov.famillesManquantes ? [`${cov.famillesManquantes} famille(s) de légumes`] : []),
  ];
  return `<section class="sem-apports">
    <div class="ligne">
      <div>
        <div class="lab">Protéines</div>
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
    <div class="chips">${[...cov.familles].map((f) => `<span class="chip veg">${f}</span>`).join("")
      || '<span class="chip vide">—</span>'}</div>
    ${manque.length ? `<div class="manque">manque : ${manque.join(" · ")}</div>`
      : (jeu.choix.some(Boolean) ? '<div class="atteint">cibles de la semaine atteintes</div>' : "")}
  </section>`;
}

function mainDeCartes() {
  const main = S.main(jeu);
  const jour = jeu.jours[jeu.jour];
  return `<section class="sem-main">
    <div class="entete">
      <h2>${jour.nom} ${jour.date.getDate()}/${jour.date.getMonth() + 1}</h2>
      <button id="repiocher">repiocher ⟳</button>
    </div>
    ${main.length ? main.map(carte).join("")
      : '<div class="carte-vide">plus de cartes — la semaine est pleine</div>'}
  </section>`;
}

function carte(l) {
  const s = SUITS[l.categorie];
  const a = l.plat.apports || {};
  const cout = l.marginal === 0
    ? '<span class="gratuit">+0 article</span>'
    : `+${l.marginal} article${l.marginal > 1 ? "s" : ""}`;
  const marques = [];
  if (l.chaine) marques.push(`<span class="m lien">↪ base déjà cuite</span>`);
  if (l.plein) marques.push(`<span class="m plein">plein tarif</span>`);
  if (l.plat.emits.length)
    marques.push(`<span class="m sortie">→ ${l.plat.emits.map((e) => e.type).join(", ")}</span>`);
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

function listeCourses(calc, arts) {
  const groupes = S.parRayon(jeu.data, calc.panier);
  return `<section class="sem-courses">
    <div class="entete"><h2>Courses — ${arts.length} articles</h2>
      <button id="bascule-courses">retour aux cartes</button></div>
    ${groupes.map(([rayon, items]) => `
      <div class="rayon"><h3>${rayon}</h3>
        ${items.map((a) => `<label class="art-l"><input type="checkbox">
          <span>${a.qty} ${a.unit} — ${a.nom}${a.n > 1 ? ` <em>(${a.n} plats)</em>` : ""}</span>
        </label>`).join("")}
      </div>`).join("")}
    ${calc.aVerifier.size ? `<div class="rayon placard"><h3>à vérifier au placard</h3>
      <p>${[...calc.aVerifier.values()].join(" · ")}</p></div>` : ""}
  </section>`;
}
