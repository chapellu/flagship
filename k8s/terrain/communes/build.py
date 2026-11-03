#!/usr/bin/env python3
"""Fiches communes → data/communes.json, et pour les mêmes communes
data/schools.json, data/creches.json, data/train.json.

Tourne chaque semaine dans le CronJob terrain-communes (k8s/terrain/communes.yaml),
sur le volume terrain-data. Ce fichier est public : il ne contient aucun lieu.
Tout vient de data/config.json (lieux, liste des champs), data/communes.json
(communes déjà étudiées, secteurs choisis à la main) et data/grid.json
(emprise de la carte), et de sources publiques (voir chaque m_*.py).

Zone : les communes de communes.json et toutes celles des mêmes départements
dont le centre est dans l'emprise de grid.json (même règle que le relevé des
annonces). Chaque commune a une fiche complète.

Incrémental : les sources brutes sont gardées dans TERRAIN_CACHE (volume
terrain-cache) et ne sont relues que si elles ont changé ; les temps OSRM sont
mis en cache par couple de points. Une source en panne ne vide rien : ses champs
gardent la valeur de la fiche précédente, le fichier n'est écrit qu'une fois
tout assemblé (écriture atomique), et le job finit en erreur pour qu'on le voie.

Champs repris des fiches d'origine (LEGACY) : les fiches importées à la main
venaient d'une autre méthode pour le train, le trajet en train vers le travail
et les sources ; à la première exécution, leurs valeurs sont gelées dans
data/communes-legacy.json et réappliquées à ces communes (README). Supprimer ce
fichier, ou TERRAIN_COMMUNES_LEGACY=0, fait tout recalculer.

    TERRAIN_DATA=./data TERRAIN_CACHE=./cache python3 build.py
    TERRAIN_COMMUNES_SKIP=train,creches …   (modules sautés : valeurs précédentes gardées)
"""
import datetime as dt
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import m_bpe  # noqa: E402
import m_creches  # noqa: E402
import m_dvf  # noqa: E402
import m_eau  # noqa: E402
import m_ecoles  # noqa: E402
import m_fibre  # noqa: E402
import m_geo  # noqa: E402
import m_risques  # noqa: E402
import m_train  # noqa: E402
import m_voiture  # noqa: E402
from lib import DATA, log  # noqa: E402

LEGACY = ("train", "gare", "tmin", "arr", "ntr", "worktrain", "workgare", "workpr", "src", "srckm")
RUSH = 1.4   # heure de pointe appliquée à workcar pour le champ work (comme les fiches d'origine)
MODULE_FIELDS = {
    "voiture": ("workcar", "famA", "famB", "car", "workpr"),
    "train": ("train", "gare", "tmin", "arr", "ntr", "worktrain", "workgare"),
    "dvf": ("prix", "m2", "eurm2", "nv", "big"),
    "fibre": ("fibre",),
    "ecoles": ("cl19", "cl25", "priv", "col", "colc", "colkm", "va"),
    "risques": ("inond", "sech", "mvt", "feu", "indus"),
    "eau": ("src", "srckm"),
}
ESSENTIAL = ("alt", "workcar", "famA", "famB")  # sans eux, une nouvelle commune attend la semaine suivante
SKIP = {s for s in os.environ.get("TERRAIN_COMMUNES_SKIP", "").split(",") if s}


def path(name):
    return os.path.join(DATA, name)


def report(existing, computed, fields):
    """Écart entre les valeurs recalculées et la fiche précédente, champ par champ."""
    lines = []
    for f in fields:
        same = close = n = 0
        deltas = []
        for code, old in existing.items():
            if code not in computed or f not in computed[code]:
                continue
            a, b = computed[code][f], old.get(f)
            n += 1
            if a == b:
                same += 1
                close += 1
            elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= max(1, 0.05 * abs(b)):
                close += 1
            if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
                deltas.append(a - b)
        if n:
            md = f", écart médian {sorted(deltas)[len(deltas) // 2]:+g}, |écart| médian {sorted(map(abs, deltas))[len(deltas) // 2]:g}" if deltas else ""
            lines.append(f"  {f:10s} {same:4d}/{n} identiques, {close:4d} à ±1 ou ±5 %{md}")
    log("écarts avec la fiche précédente :\n" + "\n".join(lines))


def main():
    cfg = lib.load_json(path("config.json"))
    old = lib.load_json(path("communes.json"))
    grid = lib.load_json(path("grid.json"))
    if not cfg or not old or not grid:
        sys.exit("config.json, communes.json et grid.json sont nécessaires")
    F = cfg["fields"]
    existing = {r[F.index("code")]: dict(zip(F, r)) for r in old["c"]}

    com, arr = m_geo.area(existing, grid)
    m_geo.sectors(com, existing, cfg.get("sectors") or {})
    m_geo.add_altitude(com)
    log(f"zone : {len(com)} communes ({len(set(com) - set(existing))} nouvelles)")

    osrm = lib.Osrm()
    res, status, extra = {}, {}, {}

    def step(name, fn):
        if name in SKIP:
            status[name] = "sauté"
            return None
        t0 = dt.datetime.now()
        try:
            out = fn()
            status[name] = f"ok ({(dt.datetime.now() - t0).seconds} s)"
            return out
        except Exception as e:  # une source en panne ne bloque pas les autres
            traceback.print_exc()
            status[name] = f"erreur : {type(e).__name__}: {e}"[:300]
            return None
        finally:
            osrm.save()

    res["voiture"] = step("voiture", lambda: m_voiture.run(com, cfg, osrm))
    res["risques"] = step("risques", lambda: m_risques.run(com))
    if m_risques.partial:
        status["risques"] = "erreur : " + m_risques.partial
    res["eau"] = step("eau", lambda: m_eau.run(com, arr))
    r = step("fibre", lambda: m_fibre.run(com, arr))
    if r:
        res["fibre"], extra["fibre"] = r
    r = step("dvf", lambda: m_dvf.run(com, arr))
    if r:
        res["dvf"], extra["dvf"] = r
    bpe = step("bpe", m_bpe.load) if not ({"ecoles", "creches"} <= SKIP) else None
    if bpe:
        r = step("ecoles", lambda: m_ecoles.run(com, arr, bpe))
        if r:
            res["ecoles"], schools = r
            lib.save_json(path("schools.json"), schools)
        cr = step("creches", lambda: m_creches.run(com, grid, bpe, osrm))
        if cr:
            lib.save_json(path("creches.json"), cr)
    r = step("train", lambda: m_train.run(com, cfg, grid, osrm))
    gares = {}
    if r:
        res["train"], gares, tj = r
        lib.save_json(path("train.json"), tj)

    computed = {code: {k: c.get(k) for k in ("sect", "alt", "pop")} for code, c in com.items()}
    for name, out in res.items():
        for code, v in (out or {}).items():
            computed.setdefault(code, {}).update(v)
    report(existing, computed, [f for f in F if f not in ("code", "nom", "lat", "lon")])

    # valeurs gelées des fiches d'origine
    leg_p = path("communes-legacy.json")
    legacy = lib.load_json(leg_p)
    if legacy is None and "meta" not in old and os.environ.get("TERRAIN_COMMUNES_LEGACY", "1") != "0":
        legacy = {"fields": list(LEGACY), "note": "valeurs des fiches importées à la main, réappliquées par build.py",
                  "rows": {code: {f: r.get(f) for f in LEGACY if f in r} for code, r in existing.items()}}
        lib.save_json(leg_p, legacy)
        log(f"legacy : {len(legacy['rows'])} fiches d'origine gelées dans communes-legacy.json")
    if os.environ.get("TERRAIN_COMMUNES_LEGACY", "1") == "0":
        legacy = None

    rows, skipped = [], []
    for code in sorted(set(com) | set(existing)):
        prev = existing.get(code, {})
        if code not in com:  # inconnue de geo.api (commune fusionnée…) : ligne inchangée
            rows.append(prev)
            continue
        c = com[code]
        r = {f: prev.get(f) for f in F}
        r.update({k: c.get(k) for k in ("code", "nom", "sect", "lat", "lon", "alt", "pop")})
        if r["alt"] is None:
            r["alt"] = prev.get("alt")
        for name, fields in MODULE_FIELDS.items():
            got = (res.get(name) or {}).get(code)
            if got is not None:
                r.update({f: got.get(f) for f in fields if f in got})
        for f, v in ((legacy or {}).get("rows", {}).get(code) or {}).items():
            r[f] = v
        if r.get("workcar") is not None:
            car = round(r["workcar"] * RUSH)
            tr = r.get("worktrain")
            r["work"], r["workmode"] = (tr, "train") if tr is not None and tr <= car else (car, "voiture")
        if code not in existing and any(r.get(f) is None for f in ESSENTIAL):
            skipped.append(code)
            continue
        rows.append(r)
    if skipped:
        log(f"{len(skipped)} nouvelles communes sans altitude ou temps de voiture : reportées à la semaine prochaine")
    if len(rows) < len(existing):
        sys.exit(f"{len(rows)} fiches contre {len(existing)} avant : rien n'est écrit")

    g = {s[0]: s for s in old.get("g") or []}
    for r in rows:
        if r.get("gare") and r["gare"] not in g and r["gare"] in gares:
            g[r["gare"]] = gares[r["gare"]]
    out = {
        "c": [[r.get(f) for f in F] for r in rows],
        "g": list(g.values()),
        "meta": {"built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                 "dvf": extra.get("dvf"), "fibre": extra.get("fibre"),
                 "legacy": list(LEGACY) if legacy else [], "status": status},
    }
    lib.save_json(os.path.join(lib.CACHE, "communes.prev.json"), old)  # filet : la version précédente
    lib.save_json(path("communes.json"), out)
    log(f"écrit communes.json : {len(rows)} communes ; " + ", ".join(f"{k} {v}" for k, v in status.items()))
    if any(v.startswith("erreur") for v in status.values()):
        sys.exit("au moins une source a échoué : ses champs gardent les valeurs précédentes")


if __name__ == "__main__":
    main()
