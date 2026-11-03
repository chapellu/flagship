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
import time
import traceback
import unicodedata
import urllib.parse
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
    "constr_txt",  # calculé ici depuis titre + desc + url : True (constructible) | False (non) | None
)
# Les sources peuvent aussi fournir "desc" (texte de l'annonce) : lu pour constr_txt, jamais stocké.


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


# Constructibilité d'après le texte. Les terrains très bon marché sont souvent
# agricoles, naturels ou de loisir : on cherche d'abord les mentions négatives.
NON_CONSTR = re.compile(r"non[\s-]*constructible|inconstructible|terrains?[\s-]+de[\s-]+loisirs?|terrains?[\s-]+agricoles?|zone[\s-]+(?:agricole|naturelle)|\bzone[\s-]+[AN]\b|pas constructible", re.I)
CONSTR = re.compile(r"constructible|[àa][\s-]+b[âa]tir|viabilis|permis de construire|lotissement|libre de constructeur", re.I)
# vignes, terres agricoles : les « terrains » les moins chers du relevé. Ne comptent
# que si le texte ne dit pas aussi constructible (« terrain à bâtir face aux vignes »).
AGRI = re.compile(r"\bvignes?\b|\bAO[PC]\b|viticoles?|cuvage|terres? agricoles?|exploitation agricole|\bpâtures?\b", re.I)


def text_constructible(*texts):
    t = " ".join(x or "" for x in texts)
    if NON_CONSTR.search(t):
        return False
    if CONSTR.search(t):
        return True
    return False if AGRI.search(t) else None


# Zone du PLU au point (Géoportail de l'Urbanisme, via API Carto IGN).
# Renvoie {"ztype": "U"|"AUc"|"AUs"|"A"|"N"|…, "zone": libellé} ; ztype "" si la
# commune n'a pas de PLU numérisé (carte communale ou RNU) ; None si l'API échoue.
def plu_zone(lat, lon):
    geom = json.dumps({"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]})
    try:
        d = http_json("https://apicarto.ign.fr/api/gpu/zone-urba?" + urllib.parse.urlencode({"geom": geom}), timeout=30)
    except Exception as e:
        print("plu:", type(e).__name__, e)
        return None
    f = (d.get("features") or [{}])[0].get("properties") or {}
    return {"ztype": f.get("typezone") or "", "zone": f.get("libelle") or ""}


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
        a["constr_txt"] = text_constructible(a.get("titre"), a.get("desc"), a.get("url"))
        a = {k: a.get(k) for k in AD_FIELDS}
        seen.add(a["id"])
        h = hist.get(a["id"])
        if h is None:
            h = hist[a["id"]] = {"first": day, "prices": []}
        elif h.get("gone"):
            h["relist"] = h.get("relist", 0) + 1  # revenue après disparition
            h["gone"] = None
        h.update({k: v for k, v in a.items() if v is not None})
        # date de mise en ligne bidon (Bien'ici : 1970-01-01) : on l'oublie, l'âge partira de "first"
        if (h.get("published") or "9") < "2000":
            h.pop("published", None)
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


def zones(market, budget=400):
    """Zone du PLU au point de l'annonce, une fois par annonce (et à nouveau si sa
    position change). Seulement si la position est exacte ou floutée (~250 m) :
    au centre du village, la zone ne dirait rien de la parcelle."""
    n = 0
    for h in market["ads"].values():
        if h.get("gone") or h.get("pos") not in ("exact", "approx") or h.get("lat") is None:
            continue
        key = f"{h['lat']:.5f},{h['lon']:.5f}"
        if h.get("zkey") == key:
            continue
        if n >= budget:  # le reste attendra demain
            break
        z = plu_zone(h["lat"], h["lon"])
        n += 1
        time.sleep(0.3)
        if z is not None:
            h.update(z, zkey=key)
    if n:
        print(f"plu : {n} zones interrogées")


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
    zones(market)
    market["runs"] = [r for r in market["runs"] if r["date"] != day][-89:] + [run]
    market["updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    save("market.json", market)
    if not any(s.get("ok") for s in run["sources"].values()):
        sys.exit("aucune source n'a répondu")


if __name__ == "__main__":
    main()
