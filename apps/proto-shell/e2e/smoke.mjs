import { chromium } from "playwright";
const BASE = process.argv[2] || "http://localhost:8099";
const b = await chromium.launch();
let ko = 0;
for (const v of ["A","B","C"]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(`${BASE}/?variant=${v}`, { waitUntil: "networkidle" });
  if (v === "A") {
    for (const t of ["jardin","cuisine","foyer"]) {
      const bb = await p.locator(`[data-onglet="${t}"]`).boundingBox();
      const hit = await p.evaluate(([x,y]) => document.elementFromPoint(x,y)?.closest("[data-onglet]")?.dataset.onglet ?? "BLOQUÉ",
        [bb.x+bb.width/2, bb.y+bb.height/2]);
      const ok = hit === t;
      if (!ok) ko++;
      console.log(`  tap centre onglet ${t.padEnd(8)} → ${String(hit).padEnd(8)} ${ok?"✓":"✗"}`);
    }
    await p.click('[data-onglet="cuisine"]');           // vrai clic, plus de dispatchEvent
    await p.waitForSelector(".sem-main .carte", { timeout: 8000 });
    const nCartes = await p.locator(".sem-main .carte").count();
    await p.locator(".sem-main .carte").first().click(); // jouer une carte
    await p.waitForTimeout(300);
    const remplis = await p.locator(".sem-jour.rempli").count();
    await p.click("#bascule-courses");                   // voir les courses
    await p.waitForTimeout(300);
    const nArts = await p.locator(".sem-courses .art-l").count();
    console.log(`  cartes=${nCartes} · après clic jours remplis=${remplis} · articles=${nArts}`);
    if (!nCartes || remplis !== 1 || !nArts) ko++;
    await p.screenshot({ path: "/tmp/fix-A.png", fullPage: true });
  }
  console.log(`variante ${v}: erreurs JS = ${errs.length ? errs : "aucune"}`);
  if (errs.length) ko++;
  await p.close();
}
await b.close();
console.log(ko ? `ÉCHEC (${ko})` : "TOUT PASSE");
process.exit(ko ? 1 : 0);
