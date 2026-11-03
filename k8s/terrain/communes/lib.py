"""Outils partagés du générateur de fiches communes (build.py).

Bibliothèque standard seulement (python:alpine nu). Tout ce qui est téléchargé
est une donnée publique, mise en cache dans CACHE (volume terrain-cache) : un
fichier n'est relu sur le réseau que si sa version a changé (ETag /
Last-Modified, ou URL de ressource data.gouv.fr différente).
"""
import gzip
import json
import math
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

DATA = os.environ.get("TERRAIN_DATA", "/data")
CACHE = os.environ.get("TERRAIN_CACHE", "/cache")
UA = "terrain-communes/1.0 (+https://github.com/chapellu/flagship)"
TODAY = int(time.time() // 86400)  # jours depuis 1970 : âge des entrées de cache


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- fichiers
def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_json(path, obj, compact=True):
    """Écriture atomique (fichier temporaire puis rename) : nginx ne sert jamais un
    fichier à moitié écrit, et une erreur en cours de route laisse l'ancien intact."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix="." + os.path.basename(path) + ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":") if compact else None)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def cache_path(*parts):
    p = os.path.join(CACHE, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# ---------------------------------------------------------------- réseau
def _open(url, data=None, headers=None, timeout=120):
    h = {"User-Agent": UA}
    h.update(headers or {})
    return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=timeout)


def http_json(url, data=None, headers=None, timeout=120, tries=4, pause=0.0):
    """GET (ou POST si data) JSON, avec reprises espacées : les API publiques
    limitent le débit, on attend plutôt que d'insister."""
    for i in range(tries):
        try:
            with _open(url, data, {"Accept": "application/json", **(headers or {})}, timeout) as r:
                out = json.load(r)
            if pause:
                time.sleep(pause)
            return out
        except urllib.error.HTTPError as e:
            if e.code in (400, 404) or i == tries - 1:
                raise
            log(f"http {e.code} {url[:90]}… nouvel essai")
        except Exception as e:  # réseau, délai
            if i == tries - 1:
                raise
            log(f"http {type(e).__name__} {url[:90]}… nouvel essai")
        time.sleep(5 * (i + 1))


def fetch_file(url, name, max_age_days=0):
    """Télécharge url dans CACHE/raw/name si la version distante a changé.
    Renvoie (chemin, changé?). max_age_days : ne pas même vérifier avant ce délai."""
    path = cache_path("raw", name)
    meta_p = path + ".meta.json"
    meta = load_json(meta_p, {})
    if os.path.exists(path) and meta.get("url") == url and TODAY - meta.get("day", 0) < max_age_days:
        return path, False
    h = {}
    if os.path.exists(path) and meta.get("url") == url:
        if meta.get("etag"):
            h["If-None-Match"] = meta["etag"]
        if meta.get("lm"):
            h["If-Modified-Since"] = meta["lm"]
    try:
        r = _open(url, headers=h, timeout=300)
    except urllib.error.HTTPError as e:
        if e.code == 304:
            meta["day"] = TODAY
            save_json(meta_p, meta)
            return path, False
        raise
    tmp = path + ".part"
    with r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
        info = r.headers
    os.replace(tmp, path)
    save_json(meta_p, {"url": url, "etag": info.get("ETag"), "lm": info.get("Last-Modified"), "day": TODAY})
    log(f"téléchargé {name} ({os.path.getsize(path) // 1024} ko)")
    return path, True


def stream_gz_lines(url):
    """Lignes texte d'un .csv.gz distant, décompressé à la volée (rien sur disque)."""
    r = _open(url, timeout=600)
    import io
    return r, io.TextIOWrapper(gzip.GzipFile(fileobj=r), encoding="utf-8", newline="")


def datagouv_resources(slug):
    """Ressources d'un jeu de données data.gouv.fr (titre, url, date)."""
    d = http_json("https://www.data.gouv.fr/api/1/datasets/" + slug + "/")
    return [{"title": r.get("title") or "", "url": r["url"], "modified": r.get("last_modified") or "", "format": r.get("format")} for r in d.get("resources", [])]


# ---------------------------------------------------------------- géométrie
def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def grid_points(grid):
    return [(grid["lat0"] + j * grid["dlat"], grid["lon0"] + i * grid["dlon"]) for j in range(grid["ny"]) for i in range(grid["nx"])]


def grid_box(grid, margin=0.0):
    return (grid["lat0"] - margin, grid["lat0"] + grid["ny"] * grid["dlat"] + margin,
            grid["lon0"] - margin, grid["lon0"] + grid["nx"] * grid["dlon"] + margin)


# ---------------------------------------------------------------- OSRM (temps de voiture sans trafic)
OSRM = os.environ.get("TERRAIN_OSRM", "https://router.project-osrm.org/table/v1/driving/")
OSRM_MAX = 100          # coordonnées par requête sur le serveur de démonstration
OSRM_TTL = 180          # jours : au-delà, un temps est redemandé (le réseau routier change)


def _k(p):
    return f"{p[0]:.5f},{p[1]:.5f}"


class Osrm:
    """Matrice de temps OSRM avec cache disque : chaque couple (origine,
    destination) n'est demandé qu'une fois tous les OSRM_TTL jours. Les manquants
    partent par paquets (≤ 100 coordonnées), une requête par seconde au plus."""

    def __init__(self, path=None):
        self.path = path or cache_path("osrm.json")
        self.c = load_json(self.path, {})
        self.asked = 0

    def save(self):
        save_json(self.path, self.c)

    def _get(self, src, dst):
        coords = ";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in src + dst)
        q = (f"?sources={';'.join(map(str, range(len(src))))}"
             f"&destinations={';'.join(map(str, range(len(src), len(src) + len(dst))))}&annotations=duration")
        for i in range(6):
            try:
                d = http_json(OSRM + coords + q, tries=1, timeout=90)
                if d.get("code") == "Ok":
                    time.sleep(1.1)
                    self.asked += 1
                    return d["durations"]
                log("osrm:", d.get("code"), d.get("message"))
            except Exception as e:  # le serveur de démo limite le débit : on attend
                log("osrm:", type(e).__name__, e)
            time.sleep(4 * (i + 1))
        raise RuntimeError("OSRM ne répond pas")

    def _store(self, src, dst):
        for p, row in zip(src, self._get(src, dst)):
            for q, s in zip(dst, row):
                self.c[_k(p) + ">" + _k(q)] = [None if s is None else round(s, 1), TODAY]
        if self.asked % 25 == 0:
            log(f"  osrm : {self.asked} requêtes")
            self.save()

    def table(self, src, dsts):
        """src : liste de points ; dsts : pour chaque point, sa liste de destinations.
        Renvoie pour chaque point la liste des secondes (None si injoignable)."""
        miss = {}
        for p, ds in zip(src, dsts):
            kp = _k(p)
            for q in ds:
                v = self.c.get(kp + ">" + _k(q))
                if v is None or TODAY - v[1] > OSRM_TTL:
                    miss.setdefault(kp, (p, {}))[1][_k(q)] = q
        if miss:
            # paquets d'origines voisines, destinations mises en commun
            batch, dst = [], {}
            for p, ds in sorted(miss.values(), key=lambda x: (round(x[0][0] / 0.08), x[0][1])):
                if len(ds) + 1 > OSRM_MAX:  # trop de destinations pour une seule origine : en plusieurs fois
                    dl = list(ds.values())
                    for b in range(0, len(dl), OSRM_MAX - 1):
                        self._store([p], dl[b:b + OSRM_MAX - 1])
                    continue
                nd = {**dst, **ds}
                if batch and len(batch) + 1 + len(nd) > OSRM_MAX:
                    self._store(batch, list(dst.values()))
                    batch, nd = [], dict(ds)
                batch.append(p)
                dst = nd
            if batch:
                self._store(batch, list(dst.values()))
            self.save()
        return [[(self.c.get(_k(p) + ">" + _k(q)) or [None])[0] for q in ds] for p, ds in zip(src, dsts)]

    def minutes(self, src, dsts):
        return [[None if s is None else round(s / 60) for s in row] for row in self.table(src, dsts)]


def nearest(points, sites, k, batch=36):
    """Sites candidats de chaque point : les k plus proches à vol d'oiseau de chacun
    des points de son paquet (batch points voisins). Un site un peu plus loin mais
    bien mieux desservi est ainsi essayé aussi ; c'est la règle des anciens scripts
    (tools/train.py, tools/creches.py), qui donne les mêmes temps à la minute."""
    order = sorted(range(len(points)), key=lambda i: (round(points[i][0] / 0.08), points[i][1]))
    out = [None] * len(points)
    for b in range(0, len(order), batch):
        idx = order[b:b + batch]
        u = sorted({j for i in idx for j in sorted(range(len(sites)), key=lambda j: km(points[i], sites[j]))[:k]})
        for i in idx:
            out[i] = u
    return out


# ---------------------------------------------------------------- altitude (IGN RGE ALTI)
ALTI = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"


def altitudes(points, cache):
    """Altitude (m) de chaque point, IGN RGE ALTI ; cache : dict persistant."""
    todo = [p for p in points if _k(p) not in cache]
    for b in range(0, len(todo), 50):
        part = todo[b:b + 50]
        q = urllib.parse.urlencode({"lon": "|".join(f"{p[1]}" for p in part), "lat": "|".join(f"{p[0]}" for p in part),
                                    "resource": "ign_rge_alti_wld", "zonly": "true"})
        z = http_json(ALTI + "?" + q, pause=0.5)["elevations"]
        for p, v in zip(part, z):
            cache[_k(p)] = None if v is None or v < -1000 else round(v)
    return [cache.get(_k(p)) for p in points]
