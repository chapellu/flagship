"""Train : champs train/gare/tmin/arr/ntr et worktrain/workgare de communes.json,
et data/train.json (lignes « Train → Part-Dieu / Perrache » de l'app).

Horaires théoriques SNCF (TER, tram-train, Intercités), GTFS publié sur
transport.data.gouv.fr (jeu « horaires-sncf »), un jour de semaine type :
le premier mardi au moins une semaine après aujourd'hui (ou après le début de
validité du fichier). Arrivée entre 7 h et 9 h, au plus une correspondance
(CORRESP minutes au moins), pas d'attente comptée au départ. TGV et cars exclus.

train.json (méthode inchangée depuis tools/train.py) :
  voiture jusqu'à l'une des K gares les plus proches (OSRM sans trafic, comme
  grid.json) + MARGE + train le plus court vers Lyon Part-Dieu / Perrache ; les
  gares de Lyon intra-muros sont prolongées par un trajet TCL forfaitaire (URBAIN).
  Plus le trajet tout en voiture jusqu'à ces deux gares (l'app y applique
  l'heure de pointe et PARK_LYON, et garde le plus rapide des deux).

communes.json, calé sur les fiches d'origine (voir README) :
  train     = voiture jusqu'à la gare + CITY_C + train jusqu'à une gare X à moins de
              NEAR_KM du lieu « city » + CITY_B min/km de X au lieu ; gare, tmin
              (minutes de train), arr (gare X) et ntr (arrivées utiles le matin) en découlent ;
  worktrain = idem vers le lieu « work » (WORK_C, WORK_B), workgare la gare de départ.
"""
import bisect
import csv
import datetime
import io
import os
import zipfile

from lib import fetch_file, grid_box, grid_points, km, log, nearest

GTFS_URL = os.environ.get("TERRAIN_GTFS_URL", "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip")
MARGE = 8                 # min : se garer, rejoindre le quai (train.json)
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
PARK_LYON = 10            # min : se garer près de la gare en ville et finir à pied
K = 6                     # gares candidates par point (les plus proches à vol d'oiseau)
# communes.json : constantes calées sur les 229 fiches d'origine (écart médian ~2 min)
K_COM = 8
NEAR_KM = 6
CITY_C, CITY_B = 4, 3
WORK_C, WORK_B = 14, 4


def hm(s):
    h, m, _ = s.split(":")
    return int(h) * 60 + int(m)


def pick_day(start, end, today=None):
    """Mardi type : le premier mardi au moins 7 jours après aujourd'hui et après le
    début de validité, sans dépasser la fin de validité."""
    p = lambda s: datetime.date(int(s[:4]), int(s[4:6]), int(s[6:]))
    d = max(p(start), today or datetime.date.today()) + datetime.timedelta(days=7)
    d += datetime.timedelta(days=(1 - d.weekday()) % 7)
    if end and d > p(end):
        d = p(start) + datetime.timedelta(days=7)
        d += datetime.timedelta(days=(1 - d.weekday()) % 7)
    return d.strftime("%Y%m%d")


def load_gtfs(path, day=None):
    z = zipfile.ZipFile(path)
    rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))
    names = z.namelist()
    if day is None:
        fi = next(rd("feed_info.txt"))
        day = pick_day(fi["feed_start_date"], fi.get("feed_end_date"))
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


def rail_times(trips, urb, tgt):
    """Minutes de train les plus courtes de chaque gare vers les gares tgt, et
    nombre d'heures d'arrivée utiles. urb : {gare: minutes ajoutées à l'arrivée}
    (tgt y figurent à 0). Arrivée effective (arrivée + urb) entre 7 h et 9 h."""
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
            m = min(m, L[i][1])
            mins[i] = m
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


def station_times(stops, trips, tk):
    """Vers Part-Dieu (pd) ou Perrache (pe), avec les fins de trajet TCL d'URBAIN."""
    urb = {sid: URBAIN[n][tk] for sid, (n, _, _) in stops.items() if n in URBAIN and tk in URBAIN[n]}
    tgt = {sid for sid, (n, _, _) in stops.items() if n == TARGETS[tk]}
    for s in tgt:
        urb[s] = 0
    return rail_times(trips, urb, tgt)


def best_via(points, st, times, osrm, k, extra):
    """Pour chaque point : (minutes, indice de gare, minutes de voiture) le plus court
    sur ses k gares les plus proches ; times[j] = minutes de train de la gare j (ou None)."""
    cand = nearest(points, [s[1:3] for s in st], k)
    dur = osrm.minutes(points, [[st[j][1:3] for j in c] for c in cand])
    out = []
    for c, row in zip(cand, dur):
        b = None
        for j, car in zip(c, row):
            if car is None or times[j] is None:
                continue
            v = car + extra + times[j]
            if b is None or v < b[0]:
                b = (v, j, car)
        out.append(b)
    return out


def train_json(stops, trips, day, grid, com, osrm):
    """data/train.json : même contenu que l'ancien tools/train.py."""
    keys = list(TARGETS)
    tt = {k: station_times(stops, trips, k) for k in keys}
    box = grid_box(grid, 0.15)  # une gare juste hors cadre compte
    st = []
    for sid in sorted(set(tt["pd"]) | set(tt["pe"]), key=lambda s: stops[s][0]):
        n, la, lo = stops[sid]
        if not (box[0] <= la <= box[1] and box[2] <= lo <= box[3]):
            continue
        pd, pe = tt["pd"].get(sid), tt["pe"].get(sid)
        st.append([n, round(la, 5), round(lo, 5), pd and pd[0], pe and pe[0], pd and pd[1], pe and pe[1]])
    log(f"train : {day}, {len(trips)} trains, {len(st)} gares dans l'emprise")
    codes = sorted(com)
    cpts = [(com[c]["lat"], com[c]["lon"]) for c in codes]
    gpts = grid_points(grid)
    res = {}
    for ki, k in enumerate(keys):
        times = [s[3 + ki] for s in st]
        res[k] = (best_via(cpts, st, times, osrm, K, MARGE), best_via(gpts, st, times, osrm, K, MARGE))
    flat = lambda b: [None, None, None] if b is None else list(b)
    pos = {s[0]: (s[1], s[2]) for s in st}
    dst = [pos[TARGETS[k]] for k in keys]
    gcar = osrm.minutes(gpts, [dst] * len(gpts))
    ccar = osrm.minutes(cpts, [dst] * len(cpts))
    return {
        "source": f"Horaires SNCF (GTFS, {day}, arrivée 7 h–9 h, ≤ 1 correspondance) ; voiture OSRM sans trafic jusqu'à la gare + {MARGE} min",
        "day": day, "marge": MARGE, "corresp": CORRESP, "urbain": URBAIN,
        "stations": st,
        "grid": {k: [b[0] if b else None for b in res[k][1]] for k in keys},
        "com": {c: flat(res["pd"][0][i]) + flat(res["pe"][0][i]) for i, c in enumerate(codes)},
        "car": {"grid": {k: [row[n] for row in gcar] for n, k in enumerate(keys)},
                "com": {c: v for c, v in zip(codes, ccar)}},
        "park": PARK_LYON,
    }


def to_place(stops, trips, place, points, osrm, C, B):
    """Meilleur trajet voiture + train vers un lieu : pour chaque point,
    (minutes, gare de départ, minutes de train, gare d'arrivée, arrivées utiles) ou None."""
    P = (place["lat"], place["lon"])
    near = {sid: km(P, (la, lo)) for sid, (n, la, lo) in stops.items() if km(P, (la, lo)) <= NEAR_KM}
    rt = {x: rail_times(trips, {x: 0}, {x}) for x in near}
    # pour chaque gare de départ : meilleure arrivée X (train + fin de trajet)
    best = {}
    for x, tx in rt.items():
        for o, (t, n) in tx.items():
            v = t + B * near[x]
            if o not in best or v < best[o][0]:
                best[o] = (v, t, x, n)
    orig = sorted(best)
    st = [(o, stops[o][1], stops[o][2]) for o in orig]
    times = [best[o][0] for o in orig]
    out = []
    for b in best_via(points, st, times, osrm, K_COM, C):
        if b is None:
            out.append(None)
            continue
        o = orig[b[1]]
        _, t, x, n = best[o]
        out.append((round(b[0]), o, t, x, n))
    return out


def run(com, cfg, grid, osrm):
    path, _ = fetch_file(GTFS_URL, "sncf-gtfs.zip")
    day, stops, trips = load_gtfs(path)
    places = cfg.get("places") or {}
    codes = sorted(com)
    pts = [(com[c]["lat"], com[c]["lon"]) for c in codes]
    fields = {c: {} for c in codes}
    gares = {}
    if "city" in places:
        for c, r in zip(codes, to_place(stops, trips, places["city"], pts, osrm, CITY_C, CITY_B)):
            if r:
                v, o, t, x, n = r
                fields[c].update(train=v, gare=stops[o][0], tmin=t, arr=stops[x][0], ntr=n)
                gares.setdefault(stops[o][0], [stops[o][0], round(stops[o][1], 4), round(stops[o][2], 4), n, t])
            else:
                fields[c].update(train=None, gare=None, tmin=None, arr=None, ntr=None)
    if "work" in places:
        for c, r in zip(codes, to_place(stops, trips, places["work"], pts, osrm, WORK_C, WORK_B)):
            fields[c].update(worktrain=r[0] if r else None, workgare=stops[r[1]][0] if r else None)
    tj = train_json(stops, trips, day, grid, com, osrm)
    return fields, gares, tj
