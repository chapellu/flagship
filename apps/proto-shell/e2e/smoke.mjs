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

    // Trois repas par jour : 7 journées, 14 créneaux choisis, 7 lignes routine.
    check("7 journées", await p.locator(".sem-journee").count() === 7);
    check("14 créneaux choisis", await p.locator(".sem-slot").count() === 14);
    check("les routines sont annoncées", await p.locator(".jour-routine").count() === 7);

    // La thèse du proto : voir le coût PENDANT qu'on choisit. Les apports et la
    // première carte doivent rester au-dessus du pli.
    const ap = await p.locator(".sem-apports").boundingBox();
    const c1 = await p.locator(".sem-main .carte").first().boundingBox();
    check("apports au-dessus du pli", ap.y < 844, `y=${ap.y.toFixed(0)}`);
    check("1re carte au-dessus du pli", c1.y < 844, `y=${c1.y.toFixed(0)}`);

    // Jouer une carte remplit le créneau sélectionné, et rien d'autre.
    await p.locator(".sem-main .carte").first().click();
    await p.waitForTimeout(300);
    check("un seul créneau rempli", await p.locator(".sem-slot.rempli").count() === 1);

    await p.click("#bascule-courses");
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
    check("22 créneaux (21 + goûter)", m.creneaux === 22, `${m.creneaux}`);
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
  }

  check("aucune erreur JS", errs.length === 0, errs.join(" | "));
  await p.close();
}

await b.close();
console.log(ko ? `\nÉCHEC — ${ko} contrôle(s)` : "\nTOUT PASSE");
process.exit(ko ? 1 : 0);
