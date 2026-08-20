// Smoke du prototype. Jetable comme le reste, mais il a déjà trouvé deux vrais
// bugs (l'onglet Cuisine injoignable, puis la semaine qui passait sous le pli).
//
//   cd apps/proto-shell && python3 -m http.server 8099 &
//   node e2e/smoke.mjs http://localhost:8099
//
// Sans argument, il vise la prod : node e2e/smoke.mjs https://proto.chapellu.fr
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8099";
const b = await chromium.launch();
let ko = 0;
const check = (nom, ok, detail = "") => {
  if (!ok) ko++;
  console.log(`  ${ok ? "✓" : "✗"} ${nom}${detail ? " — " + detail : ""}`);
};

for (const v of ["A", "B", "C"]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => m.type() === "error" && errs.push("console: " + m.text()));
  await p.goto(`${BASE}/?variant=${v}`, { waitUntil: "networkidle" });
  console.log(`\nvariante ${v}`);

  if (v === "A") {
    // Le commutateur du prototype ne doit plus recouvrir la barre d'onglets.
    for (const t of ["jardin", "cuisine", "foyer"]) {
      const bb = await p.locator(`[data-onglet="${t}"]`).boundingBox();
      const hit = await p.evaluate(([x, y]) =>
        document.elementFromPoint(x, y)?.closest("[data-onglet]")?.dataset.onglet ?? "BLOQUÉ",
        [bb.x + bb.width / 2, bb.y + bb.height / 2]);
      check(`tap au centre de l'onglet ${t}`, hit === t, `reçu par ${hit}`);
    }

    await p.click('[data-onglet="cuisine"]');
    await p.waitForSelector(".sem-main .carte", { timeout: 8000 });

    // Trois repas par jour : 7 journées, 14 créneaux choisis, 7 lignes routine,
    // et 7 desserts optionnels — remplissables, mais jamais des trous.
    check("7 journées", await p.locator(".sem-journee").count() === 7);
    check("14 créneaux choisis",
      await p.locator(".sem-slot:not(.optionnel)").count() === 14);
    check("7 desserts optionnels", await p.locator(".sem-slot.optionnel").count() === 7);
    check("les routines sont annoncées", await p.locator(".jour-routine").count() === 7);

    // L'ordre porte la sémantique (le chaînage marche les créneaux vers
    // l'avant), et il se trie sur l'HEURE. Le mercredi est le seul jour à cinq
    // repas : c'est là que l'ordre de déclaration mentait, en rangeant le
    // goûter de 16 h après le dîner de 19 h 30.
    const ordreMercredi = await p.evaluate(async () => {
      const S = await import("./semaine.js");
      const data = await fetch("cuisine-data.json").then(r => r.json());
      const jeu = S.creerJeu(data);
      const j = jeu.jours.findIndex(x => x.nom === "mercredi");
      return jeu.creneaux.filter(c => c.jour === j).map(c => c.repas);
    });
    check("les créneaux sont triés sur l'heure",
      ordreMercredi.join(">") === "petit-dejeuner>dejeuner>gouter>diner>dessert",
      ordreMercredi.join(" > "));

    // La thèse du proto : voir le coût PENDANT qu'on choisit. Les apports et la
    // première carte doivent rester au-dessus du pli.
    const ap = await p.locator(".sem-apports").boundingBox();
    const c1 = await p.locator(".sem-main .carte").first().boundingBox();
    check("apports au-dessus du pli", ap.y < 844, `y=${ap.y.toFixed(0)}`);
    check("1re carte au-dessus du pli", c1.y < 844, `y=${c1.y.toFixed(0)}`);

    // Jouer une carte remplit le créneau sélectionné, et rien d'autre.
    // Mesuré en DELTA, pas en absolu : la semaine ne démarre pas forcément
    // vide (cf. `AMORCE` dans semaine.js, le dîner du test grandeur nature).
    const avant = await p.locator(".sem-slot.rempli").count();
    await p.locator(".sem-main .carte").first().click();
    await p.waitForTimeout(300);
    check("un seul créneau rempli de plus",
      await p.locator(".sem-slot.rempli").count() === avant + 1);

    await p.click('[data-vue="courses"]');
    await p.waitForTimeout(300);
    check("la liste de courses sort", await p.locator(".sem-courses .art-l").count() > 0);

    // Le modèle : un reste de plat ne se mange qu'au déjeuner, et gratuitement.
    const m = await p.evaluate(async () => {
      const S = await import("./semaine.js");
      const data = await fetch("cuisine-data.json").then(r => r.json());
      const jeu = S.creerJeu(data);
      const slot = (j, r) => jeu.creneaux.findIndex(c => c.jour === j && c.repas === r);
      const vide = Array(jeu.creneaux.length).fill(null);
      const avec = [...vide]; avec[slot(0, "diner")] = "gratin-de-pates-tomates";
      const cherche = (ch, s) => S.offre(jeu, ch, s).find(l => l.plat.id === "reste-de-la-veille");
      return {
        creneaux: jeu.creneaux.length,
        avant: cherche(vide, slot(1, "dejeuner"))?.score,
        apres: cherche(avec, slot(1, "dejeuner")),
        auDiner: !!cherche(avec, slot(2, "diner")),
      };
    });
    check("29 créneaux (21 + goûter + 7 desserts)", m.creneaux === 29, `${m.creneaux}`);
    check("sans reste, la carte est pénalisée", m.avant < 0, `score ${m.avant}`);
    check("après un dîner, elle est chaînée et gratuite",
      m.apres?.chaine === true && m.apres?.marginal === 0,
      `score ${m.apres?.score}, +${m.apres?.marginal} art.`);
    check("jamais proposée au dîner", m.auDiner === false);

    // Le cadran du rangement : la cuisine est finie, et ça se voit à l'écran.
    check("les trois espaces sont affichés",
      await p.locator(".sem-rangement .rg-c").count() === 3);

    // LA QUANTITÉ, qui n'était lue par personne. Un bocal qui couvre deux plats
    // sans jamais baisser était le bug de fond : on le vérifie de face.
    const q = await p.evaluate(async () => {
      const S = await import("./semaine.js");
      const data = await fetch("cuisine-data.json").then(r => r.json());
      const jeu = S.creerJeu(data);
      const slot = (j, r) => jeu.creneaux.findIndex(c => c.jour === j && c.repas === r);
      const vide = Array(jeu.creneaux.length).fill(null);

      // 700 g au congélo, 500 g réclamés lundi puis 700 g mardi : le second
      // plat ne peut pas retrouver le bocal plein.
      const deux = [...vide];
      deux[slot(0, "diner")] = "pates-bolognaise";
      deux[slot(1, "diner")] = "lasagnes";
      const cd = S.calculer(jeu, deux);

      // Une base attendue mais absente ne s'ACHÈTE pas : elle se cuisine.
      const seule = [...vide];
      seule[slot(0, "dejeuner")] = "salade-lentilles-feta";
      const cs = S.calculer(jeu, seule);

      // Un manque en aval devient une offre d'agrandir le lot en amont.
      const off = [...vide];
      off[slot(0, "diner")] = "lentilles-mijotees";
      off[slot(1, "dejeuner")] = "salade-lentilles-feta";
      off[slot(2, "dejeuner")] = "burgers-de-lentilles";
      const co = S.calculer(jeu, off);

      return {
        pris: cd.chaine.map(c => c.pris),
        manque: cd.manques.reduce((a, m) => a + m.manque, 0),
        recit: cd.chaine.at(-1)?.recit,
        absent: cs.provenances.absent || 0,
        achete: [...cs.panier.keys()].some(k => k.startsWith("lentilles-vertes-cuites")),
        offres: co.offres.map(o => [o.rid, o.facteurPropose, o.manque]),
        congelo: co.stockage.congelo,
      };
    });
    check("le bocal se vide au lieu de se dupliquer",
      q.pris[0] === 500 && q.pris[1] === 200 && q.manque === 500,
      `pris ${q.pris.join("+")}, manque ${q.manque}`);
    check("la prise se raconte morceau par morceau",
      /^200 g du congélo$/.test(q.recit || ""), q.recit);
    check("une base absente ne part pas aux courses",
      q.absent > 0 && q.achete === false, `absent ${q.absent}`);
    check("le manque devient une offre d'agrandir le lot amont",
      q.offres.length === 1 && q.offres[0][0] === "lentilles-mijotees" &&
      q.offres[0][1] === 2, JSON.stringify(q.offres));
    check("le congélo a un plafond et la semaine y range",
      q.congelo.limite === 18 && q.congelo.entre > 0 && q.congelo.sort > 0,
      `${q.congelo.debut} +${q.congelo.entre} −${q.congelo.sort} / ${q.congelo.limite}`);

    // Sauter un repas, régler les parts, prévoir la gamelle de la veille.
    const w = await p.evaluate(async () => {
      const S = await import("./semaine.js");
      const data = await fetch("cuisine-data.json").then(r => r.json());
      const jeu = S.creerJeu(data);
      const slot = (j, r) => jeu.creneaux.findIndex(c => c.jour === j && c.repas === r);
      const vide = Array(jeu.creneaux.length).fill(null);

      // Un repas sauté ne coûte rien : ni courses, ni minutes.
      const plein = [...vide]; plein[slot(0, "diner")] = "gratin-de-pates-tomates";
      const saute = [...vide]; saute[slot(0, "diner")] = S.SAUTE;
      const cp = S.calculer(jeu, plein), cs = S.calculer(jeu, saute);

      // Les parts commandent le panier : plus de monde, plus de courses.
      const p2 = [...jeu.parts]; p2[slot(0, "diner")] = jeu.parts[slot(0, "diner")] * 3;
      const cg = S.calculer(jeu, plein, [], p2);
      const qte = c => [...c.panier.values()].reduce((a, s) => a + s.qty, 0);

      // La gamelle du jour de coworking se cuisine la veille au soir.
      const iEmporte = jeu.creneaux.findIndex(c => c.emporte && c.nature === "choisi");
      const veille = jeu.creneaux.reduce(
        (acc, c, i) => (i < iEmporte && c.repas === "diner" ? i : acc), -1);
      const avecVeille = [...vide]; avecVeille[veille] = "gratin-de-pates-tomates";
      const g = S.gamelles(jeu, avecVeille).find(x => x.i === iEmporte);

      return {
        panierSaute: cs.panier.size, minutesSaute: S.minutesParJour(jeu, saute)[0],
        panierPlein: cp.panier.size, minutesPlein: S.minutesParJour(jeu, plein)[0],
        qteSimple: qte(cp), qteTriple: qte(cg),
        gamelle: g && { veille: g.veille === veille, total: g.total, ok: g.actionnable },
      };
    });
    check("un repas sauté ne coûte ni courses ni minutes",
      w.panierSaute === 0 && w.minutesSaute === 0 && w.panierPlein > 0 && w.minutesPlein > 0,
      `sauté ${w.panierSaute} art. / ${w.minutesSaute} min`);
    check("les parts commandent le panier",
      w.qteTriple > w.qteSimple, `${w.qteSimple} → ${w.qteTriple}`);
    check("la gamelle se cuisine au dîner de la veille",
      w.gamelle?.veille === true && w.gamelle.ok === true && w.gamelle.total === 5,
      JSON.stringify(w.gamelle));

    // La fiche recette : ce que la carte ne dit pas.
    await p.click('[data-vue="courses"]');       // referme la liste de courses
    await p.waitForTimeout(200);
    await p.locator("[data-detail]").first().click();
    await p.waitForTimeout(200);
    check("la fiche donne la marche à suivre",
      await p.locator(".fiche .fi-s").count() > 0);
    await p.click(".fiche .fermer");
    await p.waitForTimeout(150);
    check("la fiche se referme", await p.locator(".fiche").count() === 0);

    // Le stock, et les courses qu'on rentre.
    await p.click('[data-vue="stock"]');
    await p.waitForTimeout(200);
    check("le stock se détaille", await p.locator(".sem-stock .st-l").count() > 0);
    await p.click('[data-vue="courses"]');
    await p.waitForTimeout(250);
    await p.locator("[data-cocher]").first().check();
    await p.waitForTimeout(150);
    await p.click("#rentrer");
    await p.waitForTimeout(250);
    // `innerText` rend le texte VU : le titre passe en capitales par la CSS.
    check("une course rentrée se retrouve en stock",
      (await p.locator(".sem-stock").innerText()).toLowerCase().includes("rentré des courses"));
  }

  check("aucune erreur JS", errs.length === 0, errs.join(" | "));
  await p.close();
}

await b.close();
console.log(ko ? `\nÉCHEC — ${ko} contrôle(s)` : "\nTOUT PASSE");
process.exit(ko ? 1 : 0);
