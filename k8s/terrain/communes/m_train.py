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

train.json « commute » : trajets domicile-travail détaillés, que l'app combine
selon les limites de chacun (voiture / train) :
  pour chaque destination (lieux « work » et « city ») : les gares de départ
  utiles [nom, lat, lon, minutes de train + fin de trajet, arrivées utiles le
  matin] ; pour chaque point de la grille et chaque bourg, ses COMMUTE_K gares
  candidates avec les minutes de voiture pour s'y rendre ; et le trajet tout en
  voiture (sans trafic). Marche, vélo, stationnement et attente du train (selon la
  fréquence) sont calculés dans l'app, réglages dans « rules ».

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


COMMUTE_K = 5                 # gares candidates par point
COMMUTE_RULES = {             # lus par l'app (modifiables sans recalcul)
    "walk_km": 2, "bike_km": 6,           # gare à pied / à vélo jusqu'à cette distance (à vol d'oiseau)
    "walk_kmh": 5, "bike_kmh": 15, "detour": 1.3,
    "park_car": 5, "park_bike": 3,        # se garer, rejoindre le quai
    "wait_cap": 15, "window": 120,        # attente = moitié de l'intervalle entre trains (fenêtre 7 h–9 h), plafonnée
}
EGRESS_FIX, EGRESS_KM = 3, 4  # fin de trajet de la gare d'arrivée au lieu : fixe + par km (marche / TCL)


def itineraries(trips, x, origins, stops):
    """Trains du matin de chaque gare d'origine vers la gare x (direct ou une
    correspondance d'au moins CORRESP min), arrivée entre 7 h et 9 h. Pour chaque
    origine : (options [[départ, arrivée, gare de correspondance ou None], …] les
    plus tardives pour chaque arrivée, sans option dominée ; tracé [[lat, lon], …]
    de l'option la plus rapide)."""
    legs = {}  # gare s → [(départ de s, arrivée à x, voyage, position de s, position de x)]
    for ti, t in enumerate(trips):
        ix = next((n for n, r in enumerate(t) if r[1] == x and r[5]), None)
        if ix is None:
            continue
        for n in range(ix):
            if t[n][4]:
                legs.setdefault(t[n][1], []).append((t[n][3], t[ix][2], ti, n, ix))
    for L in legs.values():
        L.sort()
    deps = {s: [l[0] for l in L] for s, L in legs.items()}
    out = {}
    for o in origins:
        opts = [(l[0], l[1], None, (l[2], l[3], l[4]), None) for l in legs.get(o, [])]
        for ti, t in enumerate(trips):
            io = next((n for n, r in enumerate(t) if r[1] == o and r[4]), None)
            if io is None or t[io][3] < DEP_MIN:
                continue
            for n in range(io + 1, len(t)):
                s, a, down = t[n][1], t[n][2], t[n][5]
                if not down or s == x or s not in legs:
                    continue
                k = bisect.bisect_left(deps[s], a + CORRESP)
                if k < len(legs[s]) and legs[s][k][2] != ti:
                    l = legs[s][k]
                    opts.append((t[io][3], l[1], s, (ti, io, n), (l[2], l[3], l[4])))
        opts = [q for q in opts if ARR[0] <= q[1] <= ARR[1]]
        if not opts:
            continue
        by_arr = {}
        for q in opts:  # pour une arrivée, le départ le plus tardif
            if q[1] not in by_arr or q[0] > by_arr[q[1]][0]:
                by_arr[q[1]] = q
        keep, last_dep = [], -1
        for q in sorted(by_arr.values(), key=lambda q: (q[1], -q[0])):
            if q[0] > last_dep:  # sinon un train plus tôt arrive au plus tard pareil
                keep.append(q)
                last_dep = q[0]
        fast = min(keep, key=lambda q: q[1] - q[0])
        path = []
        for seg in (fast[3], fast[4]):
            if seg:
                ti, a, b = seg
                path += [[round(stops[r[1]][1], 4), round(stops[r[1]][2], 4)] for r in trips[ti][a:b + 1]]
        out[o] = ([[q[0], q[1], stops[q[2]][0] if q[2] else None] for q in keep], path)
    return out


def commute(stops, trips, places, grid, com, osrm):
    """Bloc « commute » de train.json (voir l'en-tête)."""
    codes = sorted(com)
    cpts = [(com[c]["lat"], com[c]["lon"]) for c in codes]
    gpts = grid_points(grid)
    out = {"rules": COMMUTE_RULES}
    for key in ("work", "city"):
        place = places.get(key)
        if not place:
            continue
        P = (place["lat"], place["lon"])
        near = {sid: km(P, (la, lo)) for sid, (n, la, lo) in stops.items() if km(P, (la, lo)) <= NEAR_KM}
        best = {}  # gare de départ → (train + fin de trajet, arrivées utiles, gare d'arrivée, fin de trajet)
        for x, dx in near.items():
            eg = EGRESS_FIX + EGRESS_KM * dx
            for o, (t, n) in rail_times(trips, {x: 0}, {x}).items():
                if o in near and t == 0:
                    continue  # déjà à destination : la voiture ou la marche suffit
                v = round(t + eg)
                if o not in best or v < best[o][0] or (v == best[o][0] and n > best[o][1]):
                    best[o] = (v, n, x, round(eg))
        orig = sorted(best, key=lambda o: stops[o][0])
        it = {}
        for x in {best[o][2] for o in orig}:  # horaires et tracés, par gare d'arrivée
            it.update(itineraries(trips, x, [o for o in orig if best[o][2] == x], stops))
        # [nom, lat, lon, minutes, arrivées utiles, gare d'arrivée, fin de trajet, options, tracé]
        st = [[stops[o][0], round(stops[o][1], 5), round(stops[o][2], 5), best[o][0], best[o][1],
               stops[best[o][2]][0], best[o][3], *(it.get(o) or ([], []))] for o in orig]
        sites = [s[1:3] for s in st]

        def cands(points):
            cand = [sorted(range(len(sites)), key=lambda j: km(p, sites[j]))[:COMMUTE_K] for p in points]
            dur = osrm.minutes(points, [[sites[j] for j in c] for c in cand])
            return [[v for j, car in zip(c, row) for v in (j, car)] for c, row in zip(cand, dur)]
        log(f"commute {key} : {len(st)} gares de départ")
        gc, cc = cands(gpts), cands(cpts)
        gcar = [r[0] for r in osrm.minutes(gpts, [[P]] * len(gpts))]
        ccar = [r[0] for r in osrm.minutes(cpts, [[P]] * len(cpts))]
        out[key] = {"st": st, "grid": gc, "com": dict(zip(codes, cc)),
                    "car": {"grid": gcar, "com": dict(zip(codes, ccar))}}
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
    tj["commute"] = commute(stops, trips, places, grid, com, osrm)
    return fields, gares, tj
