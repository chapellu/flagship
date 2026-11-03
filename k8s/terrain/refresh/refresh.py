#!/usr/bin/env python3
"""Relevé quotidien des annonces de terrain → data/market.json.

Tourne dans le CronJob terrain-refresh (k8s/terrain/cronjob.yaml), sur le
volume terrain-data. Ce fichier est public : il ne contient aucun lieu. La zone
de recherche vient de data/config.json (bloc "search"), de communes.json et de
grid.json : on garde les annonces des communes de communes.json et de toutes
les communes des mêmes départements dont le centre tombe dans l'emprise de la
grille de trajets (voir zone_communes). Le prix n'est pas filtré ici : le
budget se règle dans l'app.

Chaque source est un module src_<nom>.py qui expose :

    NAME = "bienici"
    def fetch(search: dict, communes: dict[str, dict]) -> tuple[list[dict], bool]

`communes` est indexé par code INSEE : communes.json et les communes voisines
de la zone (voir zone_communes). `fetch` renvoie les annonces normalisées
(voir AD_FIELDS) et un booléen « relevé complet ». Si le relevé n'est pas
complet (erreur réseau, pagination interrompue…), les annonces absentes ne sont
PAS marquées comme parties : on ne veut pas inventer des ventes.

Bibliothèque standard seulement : l'image est un python:alpine nu.
"""
import datetime as dt
import importlib
import json
import math
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
# préfixé par la source ("bienici:agence-123456").
AD_FIELDS = (
    "id", "src", "url", "insee", "commune", "lat", "lon", "pos",  # pos : exact | approx | commune
    "prix", "m2", "titre", "vendeur",  # vendeur : "particulier" | "mandataire" | "agence" | "constructeur" | nom
    "constructeur", "photo", "published",  # published : date ISO de mise en ligne selon la source
    "constr_txt",  # calculé ici depuis titre + desc + url : True (constructible) | False (non) | None
)
# Les sources peuvent aussi fournir "desc" (texte de l'annonce) : lu pour constr_txt, jamais stocké.


class SkipSource(Exception):
    """Source non configurée (ex. pas de boîte d'alertes) : ignorée, pas en panne."""


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


# ---------------------------------------------------------------- zone de recherche
GEO = "https://geo.api.gouv.fr"


def in_grid(grid, lat, lon):
    """Le point est-il dans l'emprise de grid.json (là où l'app calcule les trajets) ?"""
    if not grid or lat is None or lon is None:
        return False
    return (grid["lon0"] <= lon <= grid["lon0"] + grid["dlon"] * (grid["nx"] - 1)
            and grid["lat0"] <= lat <= grid["lat0"] + grid["dlat"] * (grid["ny"] - 1))


def zone_communes(communes, grid):
    """Zone de recherche : communes.json, plus les autres communes des mêmes
    départements dont le centre est dans l'emprise de la grille (communes
    limitrophes laissées hors de l'étude, communes trop chères pour le
    classement…). Une annonce n'y est jamais perdue faute d'être dans
    communes.json ; l'app la montre avec la zone verte calculée sur la grille.

    Renvoie (communes, alias, ok) : alias associe le code INSEE d'une commune
    déléguée (ancienne commune fusionnée, que certains sites donnent encore) à
    celui de la commune actuelle. Si geo.api.gouv.fr ne répond pas, on se
    contente de communes.json et ok est faux : le relevé du jour ne doit alors
    marquer aucune annonce partie (celles des communes voisines manqueraient)."""
    zone, alias, ok = dict(communes), {}, True
    for dep in sorted({c[:2] for c in communes}):
        try:
            geo = http_json(f"{GEO}/communes?" + urllib.parse.urlencode(
                {"codeDepartement": dep, "fields": "code,nom,centre", "format": "json"}))
            dele = http_json(f"{GEO}/communes_associees_deleguees?" + urllib.parse.urlencode(
                {"codeDepartement": dep, "fields": "code,chefLieu", "format": "json"}))
        except Exception as e:
            print(f"zone {dep}: geo.api.gouv.fr indisponible ({type(e).__name__}: {e}), communes.json seul")
            ok = False
            continue
        for g in geo:
            lon, lat = ((g.get("centre") or {}).get("coordinates") or (None, None))
            if g["code"] not in zone and in_grid(grid, lat, lon):
                zone[g["code"]] = {"nom": g["nom"], "lat": round(lat, 4), "lon": round(lon, 4)}
        alias.update({d["code"]: d["chefLieu"] for d in dele if d.get("chefLieu")})
    alias = {k: v for k, v in alias.items() if v in zone and k not in zone}
    print(f"zone : {len(communes)} communes étudiées + {len(zone) - len(communes)} voisines dans l'emprise de la grille")
    return zone, alias, ok


def locate(ads, zone, alias, grid):
    """Rattache chaque annonce à une commune de la zone, ou la laisse hors zone
    (insee None) : code de commune déléguée → commune actuelle ; code inconnu →
    nom de la commune dans le même département ; pas de code du tout (certaines
    annonces ne donnent qu'un code postal) → commune la plus proche du point,
    s'il est dans la grille. Sans coordonnées, l'annonce prend le centre de sa commune."""
    by_name = {}
    for code, c in zone.items():
        by_name.setdefault((norm(c["nom"]), code[:2]), code)
    for a in ads:
        insee = alias.get(a.get("insee"), a.get("insee"))
        if insee not in zone and a.get("commune"):
            deps = [insee[:2]] if insee else sorted({c[:2] for c in zone})
            insee = next((by_name[k] for k in ((norm(a["commune"]), d) for d in deps) if k in by_name), insee)
        if insee not in zone and not insee and in_grid(grid, a.get("lat"), a.get("lon")):
            k = math.cos(math.radians(a["lat"]))
            insee = min(zone, key=lambda c: (zone[c]["lat"] - a["lat"]) ** 2 + ((zone[c]["lon"] - a["lon"]) * k) ** 2)
        a["insee"] = insee if insee in zone else None
        if a["insee"] and a.get("lat") is None:
            c = zone[a["insee"]]
            a.update(lat=c["lat"], lon=c["lon"], pos="commune")
        if a["insee"] and not a.get("commune"):
            a["commune"] = zone[a["insee"]]["nom"]
    return ads


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
    sys.modules.setdefault("refresh", sys.modules[__name__])  # un seul module : SkipSource est la même classe
    cfg = load("config.json", {})
    search = cfg.get("search") or {}
    com = load("communes.json", None)
    if not com:
        sys.exit("communes.json absent : rien à relever")
    i_code, i_nom, i_lat, i_lon = (cfg["fields"].index(f) for f in ("code", "nom", "lat", "lon"))
    communes = {r[i_code]: {"nom": r[i_nom], "lat": r[i_lat], "lon": r[i_lon]} for r in com["c"]}
    grid = load("grid.json", None)
    zone, alias, zone_ok = zone_communes(communes, grid)

    day = today()
    market = load("market.json", {"ads": {}, "runs": []})
    run = {"date": day, "sources": {}}
    for name in SOURCES:
        try:
            mod = importlib.import_module("src_" + name)
            ads, complete = mod.fetch(search, zone)
            complete = complete and zone_ok
            ads = locate(ads, zone, alias, grid)
            hors = sum(1 for a in ads if not a["insee"])
            # surface inconnue (certaines alertes e-mail) : gardée, l'app l'affiche « – »
            ads = [a for a in ads if a["insee"] and (a.get("m2") is None or a["m2"] >= search.get("minM2", 0))]
            if hors:
                print(f"{name}: {hors} annonces hors zone ignorées")
            gone = merge(market, name, ads, complete, day)
            run["sources"][name] = {"ok": True, "complete": complete, "n": len(ads), "gone": gone}
            print(f"{name}: {len(ads)} annonces dans la zone, complet={complete}, parties={gone}")
        except SkipSource as e:
            print(f"{name}: ignorée ({e})")
            run["sources"][name] = {"ok": True, "skipped": str(e)}
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
