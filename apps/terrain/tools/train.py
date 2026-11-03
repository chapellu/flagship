#!/usr/bin/env python3
"""Train vers Lyon Part-Dieu et Lyon Perrache → data/train.json (lignes « chrono train »).

    python3 tools/train.py SNCF_GTFS.zip ./data [AAAAMMJJ]

SNCF_GTFS.zip : horaires théoriques SNCF (TER, tram-train, Intercités), GTFS publié
sur transport.data.gouv.fr (jeu « horaires-sncf ») :
https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip
AAAAMMJJ : jour de semaine type à étudier (par défaut, le premier mardi une
semaine après le début de validité du fichier).

Temps porte à porte, heure de pointe du matin (arrivée entre 7 h et 9 h) :
  voiture jusqu'à la gare (OSRM sans trafic, comme grid.json)
  + MARGE (se garer, rejoindre le quai)
  + trajet en train le plus court de la gare à Part-Dieu / Perrache, au plus une
    correspondance (CORRESP minutes au moins), sans attente au départ.
Les gares de Lyon intra-muros (Saint-Paul, Gorge de Loup, Vaise, Jean Macé) sont
reliées à Part-Dieu / Perrache par un trajet TCL forfaitaire (URBAIN) quand le
train s'y arrête. TGV, OUIGO et cars exclus : ce n'est pas un trajet quotidien.

Sortie :
  stations [[nom, lat, lon, pd, pe, npd, npe], …] gares utiles : minutes de train
           vers Part-Dieu (pd) et Perrache (pe), nombre de départs le matin
  grid     { pd: […], pe: […] } minutes porte à porte, même grille que grid.json
  com      { insee: [pd, gare_pd, voiture_pd, pe, gare_pe, voiture_pe] } depuis le
           bourg (gare_* : indice dans stations)
Ne garde rien de personnel : tout vient de data/ et de sources publiques.
"""
import bisect
import csv
import datetime
import io
import json
import math
import os
import sys
import time
import urllib.request
import zipfile

MARGE = 8                 # min : se garer, rejoindre le quai
CORRESP = 5               # min : correspondance minimale en gare
ARR = (7 * 60, 9 * 60)    # arrivée à destination entre 7 h et 9 h
DEP_MIN = 5 * 60          # pas de départ avant 5 h
TYPES = ("Train TER", "TramTrain", "Train", "INTERCITES")  # préfixes des StopPoint gardés
TARGETS = {"pd": "Lyon Part Dieu", "pe": "Lyon Perrache"}
# Fin de trajet en TCL (marche + attente + métro/tram/bus), minutes, estimation forfaitaire.
URBAIN = {
    "Lyon Saint-Paul": {"pd": 25, "pe": 18},     # métro D (Vieux Lyon) puis A ou B
    "Lyon Gorge de Loup": {"pd": 22, "pe": 15},  # métro D puis A ou B
    "Lyon Vaise": {"pd": 25, "pe": 17},          # métro D puis A ou B
    "Lyon Jean Macé": {"pd": 12, "pe": 12},      # métro B / tram T2
    "Lyon Part Dieu": {"pe": 20},                # tram T1 / métro B puis A
    "Lyon Perrache": {"pd": 20},
}
K = 6           # gares candidates par point (les plus proches à vol d'oiseau)
BATCH = 36      # points d'origine par requête OSRM
OSRM = "https://router.project-osrm.org/table/v1/driving/"


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def hm(s):
    h, m, _ = s.split(":")
    return int(h) * 60 + int(m)


def osrm(src, dst):
    coords = ";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in src + dst)
    q = f"?sources={';'.join(map(str, range(len(src))))}&destinations={';'.join(map(str, range(len(src), len(src) + len(dst))))}&annotations=duration"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(OSRM + coords + q, headers={"User-Agent": "terrain-train/1.0"}), timeout=60) as r:
                d = json.load(r)
            if d.get("code") == "Ok":
                return d["durations"]
        except Exception as e:  # le serveur de démo limite le débit : on attend et on recommence
            print("osrm:", e, file=sys.stderr)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("OSRM ne répond pas")


def load_gtfs(path, day):
    z = zipfile.ZipFile(path)
    rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))
    names = z.namelist()
    if day is None:
        start = next(rd("feed_info.txt"))["feed_start_date"]
        d = datetime.date(int(start[:4]), int(start[4:6]), int(start[6:])) + datetime.timedelta(days=7)
        day = (d + datetime.timedelta(days=(1 - d.weekday()) % 7)).strftime("%Y%m%d")
    wd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][datetime.datetime.strptime(day, "%Y%m%d").weekday()]
    services = set()
    if "calendar.txt" in names:
        for r in rd("calendar.txt"):
            if r[wd] == "1" and r["start_date"] <= day <= r["end_date"]:
                services.add(r["service_id"])
    for r in rd("calendar_dates.txt"):
        if r["date"] == day:
            (services.add if r["exception_type"] == "1" else services.discard)(r["service_id"])
    trips = {r["trip_id"] for r in rd("trips.txt") if r["service_id"] in services}
    stops, area = {}, {}
    for r in rd("stops.txt"):
        if r["location_type"] == "1":
            stops[r["stop_id"]] = (r["stop_name"], float(r["stop_lat"]), float(r["stop_lon"]))
        elif r["stop_id"].split(":", 1)[1].rsplit("-", 1)[0] in {"OCE" + t for t in TYPES}:
            area[r["stop_id"]] = r["parent_station"] or r["stop_id"]
    seq = {}
    for r in rd("stop_times.txt"):
        if r["trip_id"] in trips and r["stop_id"] in area:
            seq.setdefault(r["trip_id"], []).append((int(r["stop_sequence"]), area[r["stop_id"]], hm(r["arrival_time"]), hm(r["departure_time"]),
                                                    r["pickup_type"] != "1", r["drop_off_type"] != "1"))
    return day, stops, [sorted(v) for v in seq.values() if len(v) > 1]


def station_times(stops, trips, tk):
    """Minutes de train les plus courtes de chaque gare vers la cible tk, et nombre de départs utiles."""
    urb = {sid: URBAIN[n][tk] for sid, (n, _, _) in stops.items() if n in URBAIN and tk in URBAIN[n]}
    tgt = {sid for sid, (n, _, _) in stops.items() if n == TARGETS[tk]}
    for s in tgt:
        urb[s] = 0
    # direct[s] : (départ de s, arrivée effective à la cible) pour chaque train qui y mène sans changer
    direct = {}
    for t in trips:
        best = None
        for _, s, a, d, up, down in reversed(t):
            if down and s in urb:
                e = a + urb[s]
                best = e if best is None else min(best, e)
            if up and best is not None and s not in tgt:
                direct.setdefault(s, []).append((d, best))
    suffix = {}
    for s, L in direct.items():
        L.sort()
        m, mins = 10 ** 9, [0] * len(L)
        for i in range(len(L) - 1, -1, -1):
            m = min(m, L[i][1]); mins[i] = m
        suffix[s] = ([d for d, _ in L], mins)

    def after(s, t):  # arrivée effective la plus tôt en prenant à s un train qui part à t ou après
        if s not in suffix:
            return None
        deps, mins = suffix[s]
        i = bisect.bisect_left(deps, t)
        return mins[i] if i < len(deps) else None

    res = {}  # gare → [durée min, {heures d'arrivée}]
    for t in trips:
        for i, (_, o, _, d, up, _) in enumerate(t):
            if not up or d < DEP_MIN or o in tgt:
                continue
            arr = []
            for _, s, a, _, _, down in t[i + 1:]:
                if not down:
                    continue
                if s in urb:
                    arr.append(a + urb[s])
                x = after(s, a + CORRESP)
                if x is not None:
                    arr.append(x)
            ok = [e for e in arr if ARR[0] <= e <= ARR[1]]
            if not ok:
                continue
            e = min(ok)
            r = res.setdefault(o, [10 ** 9, set()])
            r[0] = min(r[0], e - d)
            r[1].add(e)
    out = {s: (v[0], len(v[1])) for s, v in res.items()}
    out.update({s: (0, 0) for s in tgt})  # déjà sur place
    return out


def nearest(points, st, keys):
    """Pour chaque point : par cible, (minutes totales, indice de gare, minutes de voiture)."""
    out = [dict() for _ in points]
    order = sorted(range(len(points)), key=lambda i: (round(points[i][0] / 0.08), points[i][1]))
    for b in range(0, len(order), BATCH):
        idx = order[b:b + BATCH]
        cand = sorted({j for i in idx for j in sorted(range(len(st)), key=lambda j: km(points[i], st[j][1:3]))[:K]})
        dur = osrm([points[i] for i in idx], [st[j][1:3] for j in cand])
        for row, i in zip(dur, idx):
            for ki, k in enumerate(keys):
                best = None
                for j, sec in zip(cand, row):
                    tt = st[j][3 + ki]
                    if sec is None or tt is None:
                        continue
                    car = round(sec / 60)
                    v = car + MARGE + tt
                    if best is None or v < best[0]:
                        best = (v, j, car)
                out[i][k] = best
        print(f"  {min(b + BATCH, len(order))}/{len(order)}", file=sys.stderr)
        time.sleep(1.1)
    return out


def main(gtfs, data, day=None):
    grid = json.load(open(os.path.join(data, "grid.json")))
    cfg = json.load(open(os.path.join(data, "config.json")))
    com = json.load(open(os.path.join(data, "communes.json")))
    F = cfg["fields"]
    nx, ny, lon0, lat0, dlon, dlat = (grid[k] for k in ("nx", "ny", "lon0", "lat0", "dlon", "dlat"))
    m = 0.15  # marge : une gare juste hors cadre compte
    box = (lat0 - m, lat0 + ny * dlat + m, lon0 - m, lon0 + nx * dlon + m)

    day, stops, trips = load_gtfs(gtfs, day)
    print(f"{day} : {len(trips)} trains", file=sys.stderr)
    keys = list(TARGETS)
    tt = {k: station_times(stops, trips, k) for k in keys}
    st = []
    for sid in sorted(set(tt["pd"]) | set(tt["pe"]), key=lambda s: stops[s][0]):
        n, la, lo = stops[sid]
        if not (box[0] <= la <= box[1] and box[2] <= lo <= box[3]):
            continue
        pd, pe = tt["pd"].get(sid), tt["pe"].get(sid)
        st.append([n, round(la, 5), round(lo, 5), pd and pd[0], pe and pe[0], pd and pd[1], pe and pe[1]])
    print(f"{len(st)} gares dans l'emprise", file=sys.stderr)

    print("communes…", file=sys.stderr)
    rows = [dict(zip(F, c)) for c in com["c"]]
    cm = nearest([(c["lat"], c["lon"]) for c in rows], st, keys)
    print("grille…", file=sys.stderr)
    pts = [(lat0 + j * dlat, lon0 + i * dlon) for j in range(ny) for i in range(nx)]
    gm = nearest(pts, st, keys)

    flat = lambda b: [None, None, None] if b is None else list(b)
    out = {
        "source": f"Horaires SNCF (GTFS, {day}, arrivée 7 h–9 h, ≤ 1 correspondance) ; voiture OSRM sans trafic jusqu'à la gare + {MARGE} min",
        "day": day, "marge": MARGE, "corresp": CORRESP, "urbain": URBAIN,
        "stations": st,
        "grid": {k: [g[k][0] if g.get(k) else None for g in gm] for k in keys},
        "com": {c["code"]: flat(r.get("pd")) + flat(r.get("pe")) for c, r in zip(rows, cm)},
    }
    with open(os.path.join(data, "train.json"), "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("écrit train.json", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:4])
