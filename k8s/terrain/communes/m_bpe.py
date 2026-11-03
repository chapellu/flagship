"""Base permanente des équipements (INSEE BPE) : crèches et écoles en RPI dispersé.

Le zip (~140 Mo) n'est retéléchargé que si l'INSEE en publie une nouvelle
version (ETag / Last-Modified) ; on n'en garde que l'extrait utile
(CACHE/bpe.json), puis le zip est effacé.
"""
import csv
import io
import os
import zipfile

from lib import cache_path, fetch_file, load_json, log, save_json

BPE_URL = os.environ.get("TERRAIN_BPE_URL", "https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.zip")
LABEL = os.environ.get("TERRAIN_BPE_LABEL", "INSEE BPE 2025")


def load():
    """{"creches": [[lat, lon, nom, commune, places, type], …], "rpi": [codes commune], "label": …}"""
    p = cache_path("bpe.json")
    out = load_json(p)
    if not out or out.get("url") != BPE_URL:  # pas d'extrait : forcer le téléchargement
        for x in ("bpe.zip", "bpe.zip.meta.json"):
            if os.path.exists(cache_path("raw", x)):
                os.unlink(cache_path("raw", x))
        out = None
    zpath, changed = fetch_file(BPE_URL, "bpe.zip", max_age_days=27)
    if out and not changed:
        return out
    z = zipfile.ZipFile(zpath)
    f = io.TextIOWrapper(z.open([n for n in z.namelist() if n.lower().endswith(".csv")][0]), encoding="utf-8", errors="replace")
    r = csv.reader(f, delimiter=";")
    h = {k: i for i, k in enumerate(next(r))}
    creches, rpi = [], set()
    for row in r:
        t = row[h["TYPEQU"]]
        if t == "D502" and row[h["LATITUDE"]]:
            cap = row[h["CAPACITE"]]
            creches.append([round(float(row[h["LATITUDE"]]), 5), round(float(row[h["LONGITUDE"]]), 5), row[h["NOMRS"]].title(),
                            row[h["LIBCOM"]].title(), int(cap) if cap.isdigit() else None, (row[h["ACCUEIL"]] or "").capitalize()])
        elif t in ("C107", "C108", "C109") and row[h["RPI"]] == "D":
            rpi.add(row[h["DEPCOM"]])
    out = {"url": BPE_URL, "label": LABEL, "creches": creches, "rpi": sorted(rpi)}
    save_json(p, out)
    log(f"bpe : {len(creches)} crèches, {len(rpi)} communes en RPI dispersé")
    _drop(zpath)
    return out


def _drop(zpath):
    """Le zip ne sert plus : on garde l'en-tête (meta) pour les requêtes conditionnelles."""
    try:
        os.truncate(zpath, 0)
    except OSError:
        pass
