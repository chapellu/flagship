#!/usr/bin/env python3
"""Crèches → data/creches.json (option « travail en crèche près de chez nous »).

    python3 tools/creches.py BPE25.zip ./data

BPE25.zip : base permanente des équipements de l'INSEE
(https://www.insee.fr/fr/statistiques/8217525), équipement D502 « établissement
d'accueil du jeune enfant » (crèches collectives, parentales, micro-crèches,
haltes-garderies financées par la CAF), géolocalisé.

Sortie :
  sites  [[lat, lon, nom, commune, places, type], …] dans l'emprise de grid.json
  grid   minutes de voiture sans trafic vers la crèche la plus proche, même
         grille que grid.json (null si injoignable)
  com    { insee: minutes } depuis le bourg de chaque commune de communes.json

Temps : OSRM (router.project-osrm.org), comme grid.json. Pour chaque point on
interroge les K crèches les plus proches à vol d'oiseau, par paquets.
Ne garde rien de personnel : tout vient de data/ et de sources publiques.
"""
import csv
import io
import json
import math
import os
import sys
import time
import urllib.request
import zipfile

K = 5          # crèches candidates par point
BATCH = 36     # points d'origine par requête (≤ 100 coordonnées au total sur le serveur de démo)
OSRM = "https://router.project-osrm.org/table/v1/driving/"


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def osrm(src, dst):
    coords = ";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in src + dst)
    q = f"?sources={';'.join(map(str, range(len(src))))}&destinations={';'.join(map(str, range(len(src), len(src) + len(dst))))}&annotations=duration"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(OSRM + coords + q, headers={"User-Agent": "terrain-creches/1.0"}), timeout=60) as r:
                d = json.load(r)
            if d.get("code") == "Ok":
                return d["durations"]
        except Exception as e:  # le serveur de démo limite le débit : on attend et on recommence
            print("osrm:", e, file=sys.stderr)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("OSRM ne répond pas")


def nearest_minutes(points, sites):
    """Pour chaque point (lat, lon), minutes vers la crèche la plus proche par la route."""
    out = [None] * len(points)
    order = sorted(range(len(points)), key=lambda i: (round(points[i][0] / 0.08), points[i][1]))  # paquets voisins
    for b in range(0, len(order), BATCH):
        idx = order[b:b + BATCH]
        cand = sorted({j for i in idx for j in sorted(range(len(sites)), key=lambda j: km(points[i], sites[j]))[:K]})
        dur = osrm([points[i] for i in idx], [sites[j][:2] for j in cand])
        for row, i in zip(dur, idx):
            v = [x for x in row if x is not None]
            out[i] = round(min(v) / 60) if v else None
        print(f"  {min(b + BATCH, len(order))}/{len(order)}", file=sys.stderr)
        time.sleep(1.1)
    return out


def main(bpe_zip, data):
    grid = json.load(open(os.path.join(data, "grid.json")))
    cfg = json.load(open(os.path.join(data, "config.json")))
    com = json.load(open(os.path.join(data, "communes.json")))
    F = cfg["fields"]
    nx, ny, lon0, lat0, dlon, dlat = (grid[k] for k in ("nx", "ny", "lon0", "lat0", "dlon", "dlat"))
    box = (lat0 - 0.1, lat0 + ny * dlat + 0.1, lon0 - 0.1, lon0 + nx * dlon + 0.1)  # marge : une crèche juste hors cadre compte

    z = zipfile.ZipFile(bpe_zip)
    f = io.TextIOWrapper(z.open([n for n in z.namelist() if n.lower().endswith(".csv")][0]), encoding="utf-8", errors="replace")
    r = csv.reader(f, delimiter=";")
    h = {k: i for i, k in enumerate(next(r))}
    sites = []
    for row in r:
        if row[h["TYPEQU"]] != "D502" or not row[h["LATITUDE"]]:
            continue
        lat, lon = float(row[h["LATITUDE"]]), float(row[h["LONGITUDE"]])
        if box[0] <= lat <= box[1] and box[2] <= lon <= box[3]:
            cap = row[h["CAPACITE"]]
            sites.append([round(lat, 5), round(lon, 5), row[h["NOMRS"]].title(), row[h["LIBCOM"]].title(),
                          int(cap) if cap.isdigit() else None, (row[h["ACCUEIL"]] or "").capitalize()])
    print(f"{len(sites)} crèches dans l'emprise", file=sys.stderr)

    print("communes…", file=sys.stderr)
    rows = [dict(zip(F, c)) for c in com["c"]]
    cm = nearest_minutes([(c["lat"], c["lon"]) for c in rows], sites)
    print("grille…", file=sys.stderr)
    pts = [(lat0 + j * dlat, lon0 + i * dlon) for j in range(ny) for i in range(nx)]
    gm = nearest_minutes(pts, sites)

    out = {"source": "INSEE BPE 2025 (D502, CNAF) ; temps OSRM sans trafic vers la crèche la plus proche",
           "sites": sites, "grid": gm, "com": {c["code"]: m for c, m in zip(rows, cm)}}
    with open(os.path.join(data, "creches.json"), "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("écrit creches.json", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
