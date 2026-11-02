#!/usr/bin/env python3
"""Relevé quotidien des annonces de terrain → data/market.json.

Tourne dans le CronJob terrain-refresh (k8s/terrain/cronjob.yaml), sur le
volume terrain-data. Ce fichier est public : il ne contient aucun lieu. La zone
de recherche vient de data/config.json (bloc "search") et de communes.json
(seules les annonces situées dans ces communes sont gardées).

Chaque source est un module src_<nom>.py qui expose :

    NAME = "bienici"
    def fetch(search: dict, communes: dict[str, dict]) -> tuple[list[dict], bool]

`communes` est indexé par code INSEE. `fetch` renvoie les annonces normalisées
(voir AD_FIELDS) et un booléen « relevé complet ». Si le relevé n'est pas
complet (erreur réseau, pagination interrompue…), les annonces absentes ne sont
PAS marquées comme parties : on ne veut pas inventer des ventes.

Bibliothèque standard seulement : l'image est un python:alpine nu.
"""
import datetime as dt
import importlib
import json
import os
import re
import sys
import tempfile
import traceback
import unicodedata
import urllib.request

DATA = os.environ.get("TERRAIN_DATA", "/data")
UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SOURCES = [s for s in os.environ.get("TERRAIN_SOURCES", "bienici").split(",") if s]

# Champs d'une annonce normalisée. id doit être stable d'un jour à l'autre et
# préfixé par la source ("bienici:iad-france-966297").
AD_FIELDS = (
    "id", "src", "url", "insee", "commune", "lat", "lon", "pos",  # pos : exact | approx | commune
    "prix", "m2", "titre", "vendeur",  # vendeur : "particulier" | "mandataire" | "agence" | "constructeur" | nom
    "constructeur", "photo", "published",  # published : date ISO de mise en ligne selon la source
)


# ---------------------------------------------------------------- outils partagés par les sources
def http_json(url, data=None, headers=None, timeout=40):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def http_text(url, headers=None, timeout=40):
    h = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read().decode(r.headers.get_content_charset() or "utf-8", "replace")


def norm(s):
    """Nom de commune comparable : « Saint-Martin-en-Haut » == « ST MARTIN EN HAUT »."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\bste?\b", lambda m: "sainte" if m.group() == "ste" else "saint", s)
    return re.sub(r"[^a-z0-9]+", "", s)


CONSTRUCTEUR = re.compile(r"constructeur|terrain\s*\+\s*maison|maison\s*\+\s*terrain|projet de construction|maison individuelle sur", re.I)


def is_constructeur(*texts):
    return bool(CONSTRUCTEUR.search(" ".join(t or "" for t in texts)))


# ---------------------------------------------------------------- fusion avec l'historique
def today():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=1))).date().isoformat()


def load(name, default):
    try:
        with open(os.path.join(DATA, name)) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(name, obj):
    """Écriture atomique : nginx ne sert jamais un fichier à moitié écrit."""
    fd, tmp = tempfile.mkstemp(dir=DATA, prefix="." + name)
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(DATA, name))


def merge(market, src, ads, complete, day):
    hist = market["ads"]
    seen = set()
    for a in ads:
        a = {k: a.get(k) for k in AD_FIELDS}
        seen.add(a["id"])
        h = hist.get(a["id"])
        if h is None:
            h = hist[a["id"]] = {"first": day, "prices": []}
        elif h.get("gone"):
            h["relist"] = h.get("relist", 0) + 1  # revenue après disparition
            h["gone"] = None
        h.update({k: v for k, v in a.items() if v is not None})
        h["last"] = day
        if a["prix"] and (not h["prices"] or h["prices"][-1][1] != a["prix"]):
            h["prices"].append([day, a["prix"]])
    gone = 0
    if complete:
        for k, h in hist.items():
            if h.get("src") == src and k not in seen and not h.get("gone"):
                h["gone"] = day
                gone += 1
    return gone


def dedupe(market):
    """Une même parcelle sur deux sites : même commune, même surface (±2 %),
    prix à ±3 %. On garde la plus ancienne et on note les autres en doublon."""
    live = [(k, h) for k, h in market["ads"].items() if not h.get("gone")]
    live.sort(key=lambda kh: (kh[1].get("published") or kh[1]["first"], kh[0]))
    keep = []
    for k, h in live:
        h.pop("dup", None)
        for k2, h2 in keep:
            if (h2.get("src") != h.get("src") and h2.get("insee") == h.get("insee") and h.get("m2") and h2.get("m2")
                    and abs(h["m2"] - h2["m2"]) <= 0.02 * h2["m2"]
                    and h.get("prix") and h2.get("prix") and abs(h["prix"] - h2["prix"]) <= 0.03 * h2["prix"]):
                h["dup"] = k2
                break
        else:
            keep.append((k, h))


def main():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # les src_*.py sont à côté
    cfg = load("config.json", {})
    search = cfg.get("search") or {}
    com = load("communes.json", None)
    if not com:
        sys.exit("communes.json absent : rien à relever")
    i_code, i_nom, i_lat, i_lon = (cfg["fields"].index(f) for f in ("code", "nom", "lat", "lon"))
    communes = {r[i_code]: {"nom": r[i_nom], "lat": r[i_lat], "lon": r[i_lon]} for r in com["c"]}

    day = today()
    market = load("market.json", {"ads": {}, "runs": []})
    run = {"date": day, "sources": {}}
    for name in SOURCES:
        try:
            mod = importlib.import_module("src_" + name)
            ads, complete = mod.fetch(search, communes)
            ads = [a for a in ads if a.get("insee") in communes and (a.get("m2") or 0) >= search.get("minM2", 0)]
            gone = merge(market, name, ads, complete, day)
            run["sources"][name] = {"ok": True, "complete": complete, "n": len(ads), "gone": gone}
            print(f"{name}: {len(ads)} annonces dans la zone, complet={complete}, parties={gone}")
        except Exception as e:  # une source en panne ne bloque pas les autres
            traceback.print_exc()
            run["sources"][name] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
    dedupe(market)
    market["runs"] = [r for r in market["runs"] if r["date"] != day][-89:] + [run]
    market["updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    save("market.json", market)
    if not any(s.get("ok") for s in run["sources"].values()):
        sys.exit("aucune source n'a répondu")


if __name__ == "__main__":
    main()
