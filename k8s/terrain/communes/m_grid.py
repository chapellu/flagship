"""Grille de trajets → data/grid.json, taillée automatiquement.

La grille (cellules de ~1,5 km) porte, pour chaque point, les minutes de voiture
sans trafic (OSRM, serveur de démonstration) vers les lieux work / famA / famB de
config.json et l'altitude (IGN RGE ALTI). L'app y trace la zone verte et les
lignes de trajet ; train.json et creches.json ont leurs tableaux sur la même grille.

Taille : la grille s'agrandit, par cellules entières (les points déjà calculés et
leurs temps en cache restent valables), tant qu'une ligne de trajet tracée aux
curseurs au maximum (LIMITS, ceux de apps/terrain/index.html, heure de pointe au
minimum) toucherait un bord. Règle : sur chaque côté, les MARGIN rangées du bord
doivent être hors d'atteinte pour tous les critères :
  - voiture : work et city (× heure de pointe minimale), famA, famB, et Part-Dieu /
    Perrache tout en voiture (+ stationnement) ;
  - train (si les horaires sont chargés) : trajet mixte voiture / marche / vélo +
    train vers work et city, comme l'app (train.json « commute »), et voiture +
    train vers Part-Dieu / Perrache (train.json « grid »).
Les critères voiture sont testés d'abord (un appel OSRM pour toute une bande) ; le
train ne l'est que sur les rangées de bord déjà hors d'atteinte en voiture.

Garde-fous : chaque côté s'arrête à MAX_KM du centre des lieux de config.json, et
un passage n'ajoute pas plus de MAX_NEW cellules (le serveur OSRM de démonstration
limite le débit) : la croissance reprend au passage suivant, les temps déjà
demandés étant en cache. La grille ne rétrécit jamais.

« reach » : 1 pour les points où les critères toujours imposés à la zone verte
(famA, famB) tiennent aux curseurs au maximum. Les communes et les annonces suivent
cette zone (lib.in_area, refresh.in_area) : hors d'elle, une commune ne peut jamais
être dans la zone verte.

Réglages facultatifs dans config.json : "grid": {"maxKm": 120, "maxNew": 8000,
"limits": {…}} ; TERRAIN_GRID_MAX_NEW pour un passage à la main.
"""
import datetime as dt
import math
import os

import m_train
from lib import altitudes, cache_path, grid_points, km, load_json, log, save_json

# maxima des curseurs de apps/terrain/index.html (minutes)
LIMITS = {"work": 90, "workTr": 120, "city": 120, "cityTr": 120, "famA": 90, "famB": 120, "tpd": 120, "tpe": 120}
RUSH_MIN = 1.0     # curseur « heure de pointe » au minimum : les lignes les plus loin
MARGIN = 2         # rangées de bord hors d'atteinte (l'app force la rangée du bord à « hors d'atteinte »)
STEP = 3           # cellules ajoutées par côté et par tour
MAX_KM = 120
MAX_NEW = 8000
CAR = ("work", "famA", "famB", "city")   # lieux de config.json : minutes de voiture
ZONE = ("famA", "famB")                  # critères toujours dans la zone verte → reach
SIDES = ("W", "E", "S", "N")


class Grid:
    def __init__(self, g, cfg, osrm, gt):
        self.lon0, self.lat0, self.dlon, self.dlat = g["lon0"], g["lat0"], g["dlon"], g["dlat"]
        self.osrm, self.gt = osrm, gt
        gc = cfg.get("grid") or {}
        self.L = {**LIMITS, **(gc.get("limits") or {})}
        places = cfg.get("places") or {}
        self.dst = {k: (places[k]["lat"], places[k]["lon"]) for k in CAR if k in places}
        self.car, self.train = {}, {}   # (i, j) → {critère: minutes} ; (i, j) → atteignable en train
        self.box = {"W": 0, "E": g["nx"] - 1, "S": 0, "N": g["ny"] - 1}
        # plafond : MAX_KM autour du centre des lieux, sans jamais couper la grille existante
        pts = [(p["lat"], p["lon"]) for p in places.values() if "lat" in p] or [self.pt(g["nx"] // 2, g["ny"] // 2)]
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        mk = float(gc.get("maxKm", MAX_KM))
        dx = mk / (111.32 * math.cos(math.radians(c[0]))) / self.dlon
        dy = mk / 111.2 / self.dlat
        ci, cj = (c[1] - self.lon0) / self.dlon, (c[0] - self.lat0) / self.dlat
        self.cap = {"W": min(0, math.ceil(ci - dx)), "E": max(g["nx"] - 1, math.floor(ci + dx)),
                    "S": min(0, math.ceil(cj - dy)), "N": max(g["ny"] - 1, math.floor(cj + dy))}
        self.max_new = int(os.environ.get("TERRAIN_GRID_MAX_NEW") or gc.get("maxNew", MAX_NEW))
        self.st = self.com = None
        if gt:
            lat_lo, lon_lo = self.pt(self.cap["W"], self.cap["S"])
            lat_hi, lon_hi = self.pt(self.cap["E"], self.cap["N"])
            self.st = gt.stations((lat_lo - 0.15, lat_hi + 0.15, lon_lo - 0.15, lon_hi + 0.15))
            pos = {s[0]: (s[1], s[2]) for s in self.st}
            for k, n in m_train.TARGETS.items():
                if n in pos:
                    self.dst["t" + k] = pos[n]
            self.com = {}
            for key in ("work", "city"):
                if key in places:
                    b = gt.commute_best(key, places[key])
                    self.com[key] = [(round(gt.stops[o][1], 5), round(gt.stops[o][2], 5), v[0], v[1])
                                     for o, v in sorted(b.items(), key=lambda x: gt.stops[x[0]][0])]

    def pt(self, i, j):
        return (round(self.lat0 + j * self.dlat, 6), round(self.lon0 + i * self.dlon, 6))

    # ------------------------------------------------------------ voiture
    def need_car(self, cells):
        cells = [c for c in cells if c not in self.car]
        if not cells:
            return
        keys = list(self.dst)
        rows = self.osrm.minutes([self.pt(*c) for c in cells], [[self.dst[k] for k in keys]] * len(cells))
        for c, row in zip(cells, rows):
            self.car[c] = dict(zip(keys, row))

    def car_reach(self, c):
        v, L = self.car[c], self.L
        ok = lambda k, lim, f=1.0, add=0: v.get(k) is not None and v[k] * f + add <= lim
        park = m_train.PARK_LYON
        return (ok("work", L["work"], RUSH_MIN) or ok("city", L["city"], RUSH_MIN) or ok("famA", L["famA"])
                or ok("famB", L["famB"]) or ok("tpd", L["tpd"], RUSH_MIN, park) or ok("tpe", L["tpe"], RUSH_MIN, park))

    # ------------------------------------------------------------ train (même calcul que l'app)
    def need_train(self, cells):
        cells = [c for c in cells if c not in self.train]
        if not cells or not self.gt:
            return
        pts = [self.pt(*c) for c in cells]
        ok = [False] * len(cells)
        R = m_train.COMMUTE_RULES
        for key, sites in (self.com or {}).items():
            lc, lt = self.L[key], self.L[key + "Tr"]
            cand = m_train.commute_cands(pts, [s[:2] for s in sites], self.osrm)
            for n, (p, cd) in enumerate(zip(pts, cand)):
                for x in range(0, len(cd), 2):
                    s, car = sites[cd[x]], cd[x + 1]
                    rail = s[2] + min(R["wait_cap"], R["window"] / max(1, s[3]) / 2)
                    d = km(p, s[:2])
                    if d <= R["walk_km"]:
                        f = (d * R["detour"] / R["walk_kmh"] * 60 + rail) / lt
                    elif d <= R["bike_km"]:
                        f = (d * R["detour"] / R["bike_kmh"] * 60 + R["park_bike"] + rail) / lt
                    else:
                        f = 99
                    if car is not None:
                        f = min(f, car / lc + (R["park_car"] + rail) / lt)
                    ok[n] = ok[n] or f <= 1
        for ki, k in enumerate(m_train.TARGETS):
            times = [s[3 + ki] for s in self.st]
            sites = [s[1:3] for s in self.st]
            cand = [sorted((j for j in range(len(sites)) if times[j] is not None), key=lambda j: km(p, sites[j]))[:m_train.K] for p in pts]
            rows = self.osrm.minutes(pts, [[sites[j] for j in cd] for cd in cand])
            for n, (cd, row) in enumerate(zip(cand, rows)):
                ok[n] = ok[n] or any(m is not None and m + m_train.MARGE + times[j] <= self.L["t" + k] for j, m in zip(cd, row))
        self.train.update(zip(cells, ok))

    # ------------------------------------------------------------ croissance
    def edge(self, side, depth=MARGIN):
        b = self.box
        if side in ("W", "E"):
            ii = range(b["W"], b["W"] + depth) if side == "W" else range(b["E"] - depth + 1, b["E"] + 1)
            return [(i, j) for i in ii for j in range(b["S"], b["N"] + 1)]
        jj = range(b["S"], b["S"] + depth) if side == "S" else range(b["N"] - depth + 1, b["N"] + 1)
        return [(i, j) for j in jj for i in range(b["W"], b["E"] + 1)]

    def is_open(self, side):
        cells = self.edge(side)
        self.need_car(cells)
        if any(self.car_reach(c) for c in cells):
            return True
        self.need_train(cells)
        return any(self.train.get(c) for c in cells)

    def grow(self, side):
        b, cap = self.box, self.cap
        n = min(STEP, abs(cap[side] - b[side]))
        b[side] += n if side in ("E", "N") else -n
        cells = self.edge(side, n)
        self.need_car(cells)
        return len(cells)

    def all_cells(self):
        b = self.box
        return [(i, j) for j in range(b["S"], b["N"] + 1) for i in range(b["W"], b["E"] + 1)]


def run(old, cfg, osrm, gt=None):
    """Nouvelle grille (dict grid.json), pas encore écrite : build.py l'écrit en dernier,
    avec train.json et creches.json calculés sur elle."""
    G = Grid(old, cfg, osrm, gt)
    if not gt:
        log("grille : horaires SNCF indisponibles, taille décidée sur les seuls temps de voiture")
    n0, a0 = len(G.car), osrm.asked
    G.need_car(G.all_cells())
    added, rounds, stop = 0, 0, None
    while True:
        opened = [s for s in SIDES if G.box[s] != G.cap[s] and G.is_open(s)]
        if not opened:
            break
        if added >= G.max_new:
            stop = f"plafond de {G.max_new} nouvelles cellules par passage atteint, reprise au prochain passage"
            break
        rounds += 1
        for s in opened:
            added += G.grow(s)
        if rounds % 5 == 0:
            log(f"grille : tour {rounds}, {G.box['E'] - G.box['W'] + 1} × {G.box['N'] - G.box['S'] + 1}, "
                f"+{added} cellules, {osrm.asked - a0} requêtes OSRM")
            osrm.save()
    capped = [s for s in SIDES if G.box[s] == G.cap[s] and G.is_open(s)]
    b = G.box
    nx, ny = b["E"] - b["W"] + 1, b["N"] - b["S"] + 1
    cells = G.all_cells()
    G.need_car(cells)
    # altitude : reprise de l'ancienne grille pour les points communs, IGN pour les autres
    oalt = old.get("alt") or []
    keep = len(oalt) == old["nx"] * old["ny"]
    inside = lambda i, j: keep and 0 <= i < old["nx"] and 0 <= j < old["ny"]
    alt_c = load_json(cache_path("alti.json"), {})
    todo = [c for c in cells if not inside(*c)]
    z = dict(zip(todo, altitudes([G.pt(*c) for c in todo], alt_c)))
    save_json(cache_path("alti.json"), alt_c)
    alt = [oalt[j * old["nx"] + i] if inside(i, j) else z[(i, j)] for i, j in cells]
    g = {
        "lon0": round(G.lon0 + b["W"] * G.dlon, 6), "lat0": round(G.lat0 + b["S"] * G.dlat, 6),
        "dlon": G.dlon, "dlat": G.dlat, "nx": nx, "ny": ny,
        "source": f"OSRM (router.project-osrm.org) sans trafic, altitude IGN RGE ALTI ; recalculé le {dt.date.today().isoformat()}",
    }
    for k in ("work", "famA", "famB"):
        if k in G.dst:
            g[k] = [G.car[c].get(k) for c in cells]
    g["alt"] = alt
    zk = [k for k in ZONE if k in G.dst]
    g["reach"] = [1 if zk and all(G.car[c].get(k) is not None and G.car[c][k] <= G.L[k] for k in zk) else 0 for c in cells]
    g["auto"] = {"limits": G.L, "margin": MARGIN, "capped": capped, "pending": bool(stop),
                 "grown": {"W": -b["W"], "S": -b["S"], "E": b["E"] - old["nx"] + 1, "N": b["N"] - old["ny"] + 1}}
    msg = (f"grille : {old['nx']} × {old['ny']} → {nx} × {ny} ({len(cells)} points, +{len(cells) - old['nx'] * old['ny']}), "
           f"{osrm.asked - a0} requêtes OSRM, {len(G.car) - n0} points calculés, {sum(g['reach'])} atteignables (reach) ; "
           f"côtés au plafond de distance : {', '.join(capped) or 'aucun'}")
    log(msg + (f" ; {stop}" if stop else ""))
    return g
