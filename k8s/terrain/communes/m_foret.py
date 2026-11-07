"""Forêts et sentiers (IGN) → foret, fpub, sent, rando, rnoms ; et la même mesure
autour de chaque parcelle de parcels.json.

  foret  part de forêt (%) à moins de 2 km du centre de la commune : Masque Forêt
         IGN 2021-2023 (WMS), en pixels de 50 m, bois d'au moins MIN_HA ha seulement
         (haies, bosquets et alignements d'arbres ne comptent pas) ;
  fpub   part de cette forêt qui est publique (%), forêts gérées par l'ONF (WMS
         FORETS.PUBLIQUES) : ouvertes au public, donc sûres pour se promener ;
  sent   km de sentiers, chemins et routes empierrées de la BD TOPO, non privés,
         qui passent dans ces bois (ou en lisière, à 50 m près), à moins de 3 km du
         centre : de la forêt où l'on peut vraiment marcher ;
  rando  dont km d'itinéraires de randonnée pédestre balisés (BD TOPO) ;
  rnoms  noms des trois itinéraires balisés les plus longs dans ce rayon.

Parcelles (parcels.json) : p["foret"] = mêmes mesures à 1,5 km (à pied depuis la
maison), plus m = distance au plus proche chemin en forêt (≈ 250 m près).

Les dalles BD TOPO (0,1°) et les images WMS sont gardées 90 jours dans le cache.
"""
import math
from array import array
import re
from collections import deque
import os
import time
import urllib.parse
import zlib
import struct
from concurrent.futures import ThreadPoolExecutor

from lib import TODAY, _open, cache_path, http_json, load_json, log, save_json

WMS = "https://data.geopf.fr/wms-r/wms?"
WFS = "https://data.geopf.fr/wfs/ows?"
MASK, PUB = "IGNF_MASQUE-FORET.2021-2023", "FORETS.PUBLIQUES"
PX = 50.0        # m par pixel du masque
CELL = 5         # pixels par case de sentiers (250 m)
TILE = 0.1       # degrés par dalle BD TOPO
TTL = 90         # jours de cache
CHUNK = 2048     # pixels par image WMS
R_FORET, R_SENT, R_PARC = 2000, 3000, 1500
MIN_HA = 10      # un bois plus petit n'est pas une promenade
NOT_WALK = re.compile(r"^(pdipr|voie lyonnaise|viarh|via rhôna|eurovelo|v\d)", re.I)  # codes, voies cyclables
NATURES = ("Sentier", "Chemin", "Route empierrée")


# ---------------------------------------------------------------- PNG (bibliothèque standard seule)
def png_alpha(b):
    """Canal alpha d'un PNG 8 bits RGBA non entrelacé : liste de lignes (bytes)."""
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("pas une image PNG : " + b[:200].decode("latin-1"))
    i, idat = 8, []
    while i < len(b):
        n, t = struct.unpack(">I4s", b[i:i + 8])
        d = b[i + 8:i + 8 + n]
        i += 12 + n
        if t == b"IHDR":
            w, h, bd, ct, _, _, il = struct.unpack(">IIBBBBB", d)
        elif t == b"IDAT":
            idat.append(d)
        elif t == b"IEND":
            break
    if (bd, ct, il) != (8, 6, 0):
        raise ValueError(f"PNG non pris en charge : {bd} bits, type {ct}, entrelacé {il}")
    raw, bpp, stride = zlib.decompress(b"".join(idat)), 4, w * 4
    prev, out, p = bytearray(stride), [], 0
    for _ in range(h):
        f, line = raw[p], bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            line = bytearray((a + c) & 255 for a, c in zip(line, prev))
        elif f == 3:
            for x in range(stride):
                line[x] = (line[x] + ((line[x - bpp] if x >= bpp else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                c = prev[x - bpp] if x >= bpp else 0
                up = prev[x]
                pa, pb, pc = abs(up - c), abs(a - c), abs(a + up - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else up if pb <= pc else c)) & 255
        out.append(bytes(line[3::4]))
        prev = line
    return w, h, out


OPAQUE = bytes(1 if v > 100 else 0 for v in range(256))


def cached(name, fetch):
    p = cache_path("foret", name)
    if os.path.exists(p) and TODAY - int(os.path.getmtime(p) // 86400) < TTL:
        with open(p, "rb") as f:
            return f.read()
    b = fetch()
    with open(p + ".part", "wb") as f:
        f.write(b)
    os.replace(p + ".part", p)
    return b


def get_bytes(url, tries=4):
    for i in range(tries):
        try:
            with _open(url, timeout=180) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                raise
            log(f"foret : {type(e).__name__} {url[:90]}… nouvel essai")
            time.sleep(5 * (i + 1))


class Raster:
    """Masque 0/1 en pixels de PX m, ligne 0 au nord."""

    def __init__(self, s, w, n, e):
        self.s, self.w, self.n, self.e = s, w, n, e
        self.dlat = PX / 110574
        self.dlon = PX / (111320 * math.cos(math.radians((s + n) / 2)))
        self.W = math.ceil((e - w) / self.dlon)
        self.H = math.ceil((n - s) / self.dlat)

    def load(self, layer):
        m = bytearray(self.W * self.H)
        for y0 in range(0, self.H, CHUNK):
            for x0 in range(0, self.W, CHUNK):
                cw, ch = min(CHUNK, self.W - x0), min(CHUNK, self.H - y0)
                la1 = self.n - y0 * self.dlat
                la0, lo0 = la1 - ch * self.dlat, self.w + x0 * self.dlon
                lo1 = lo0 + cw * self.dlon
                q = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "",
                     "CRS": "EPSG:4326", "BBOX": f"{la0:.6f},{lo0:.6f},{la1:.6f},{lo1:.6f}",
                     "WIDTH": cw, "HEIGHT": ch, "FORMAT": "image/png", "TRANSPARENT": "true"}
                url = WMS + urllib.parse.urlencode(q)
                key = f"{layer}_{la0:.4f}_{lo0:.4f}_{cw}x{ch}.png"
                w, h, rows = png_alpha(cached(key, lambda: get_bytes(url)))
                if (w, h) != (cw, ch):
                    raise ValueError(f"{layer} : image {w}x{h} au lieu de {cw}x{ch}")
                for y, r in enumerate(rows):
                    o = (y0 + y) * self.W + x0
                    m[o:o + cw] = r.translate(OPAQUE)
        return m

    def dilate(self, m):
        """Un pixel de marge (lisière) : OU des 8 voisins, ligne par ligne en entiers."""
        W, out = self.W, bytearray(len(m))
        rows = [int.from_bytes(m[y * W:(y + 1) * W], "big") for y in range(self.H)]
        mask = int.from_bytes(b"\x01" * W, "big")
        hz = [(r | (r << 8) | (r >> 8)) & mask for r in rows]
        for y in range(self.H):
            v = hz[y] | (hz[y - 1] if y else 0) | (hz[y + 1] if y + 1 < self.H else 0)
            out[y * W:(y + 1) * W] = v.to_bytes(W, "big")
        return out

    def woods(self, m, min_px):
        """Pixels des bois d'au moins min_px pixels (8-connexité)."""
        W, H, out = self.W, self.H, bytearray(len(m))
        todo, i = bytearray(m), 0
        while True:
            i = todo.find(1, i)
            if i < 0:
                return out
            todo[i] = 0
            comp, q = array("i", [i]), deque([i])
            while q:
                p = q.popleft()
                x = p % W
                for d in ((-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1) if 0 < x < W - 1 else
                          (-W, -W + 1, 1, W, W + 1) if x == 0 else (-W - 1, -W, -1, W - 1, W)):
                    n = p + d
                    if 0 <= n < W * H and todo[n]:
                        todo[n] = 0
                        comp.append(n)
                        q.append(n)
            if len(comp) >= min_px:
                for p in comp:
                    out[p] = 1

    def xy(self, lat, lon):
        return int((lon - self.w) / self.dlon), int((self.n - lat) / self.dlat)

    def disk(self, m, lat, lon, r):
        """(pixels à 1, pixels) dans le disque de rayon r mètres."""
        cx, cy = self.xy(lat, lon)
        rp = r / PX
        on = tot = 0
        for dy in range(-int(rp), int(rp) + 1):
            y = cy + dy
            if not 0 <= y < self.H:
                continue
            hw = int(math.sqrt(max(0.0, rp * rp - dy * dy)))
            a, b = max(0, cx - hw), min(self.W, cx + hw + 1)
            if a < b:
                on += m.count(1, y * self.W + a, y * self.W + b)
                tot += b - a
        return on, tot


# ---------------------------------------------------------------- sentiers BD TOPO
def tile(ij):
    i, j = ij
    s, w = i * TILE, j * TILE
    name = f"sent_{i}_{j}.json"
    p = cache_path("foret", name)
    old = load_json(p)
    if old and TODAY - old.get("day", 0) < TTL:
        return old["l"]
    nat = ",".join("'" + n + "'" for n in NATURES)
    lines, start = [], 0
    while True:
        q = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "BDTOPO_V3:troncon_de_route",
             "OUTPUTFORMAT": "application/json", "COUNT": "5000", "STARTINDEX": str(start), "SORTBY": "cleabs",
             "CQL_FILTER": f"nature IN ({nat}) AND BBOX(geometrie,{s:.4f},{w:.4f},{s + TILE:.4f},{w + TILE:.4f})",
             "PROPERTYNAME": "cleabs,prive,cpx_nature_itineraire_autre,cpx_toponyme_itineraire_autre,geometrie"}
        d = http_json(WFS + urllib.parse.urlencode(q), timeout=180)
        fs = d.get("features") or []
        for f in fs:
            pr, g = f.get("properties") or {}, f.get("geometry") or {}
            if pr.get("prive") is True or not g:
                continue
            rando = "randonnée pédestre" in (pr.get("cpx_nature_itineraire_autre") or "")
            parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
            for c in parts:
                lines.append([pr.get("cleabs"), 1 if rando else 0,
                              (pr.get("cpx_toponyme_itineraire_autre") or "") if rando else "",
                              [[round(x[0], 5), round(x[1], 5)] for x in c]])
        if len(fs) < 5000:
            break
        start += 5000
    save_json(p, {"day": TODAY, "l": lines})
    return lines


def tiles_around(points, r):
    out = set()
    for la, lo in points:
        dla, dlo = r / 110574, r / (111320 * math.cos(math.radians(la)))
        for i in range(math.floor((la - dla) / TILE), math.floor((la + dla) / TILE) + 1):
            for j in range(math.floor((lo - dlo) / TILE), math.floor((lo + dlo) / TILE) + 1):
                out.add((i, j))
    return out


class Trails:
    """Longueur de chemins en forêt par case de CELL pixels, et par itinéraire balisé."""

    def __init__(self, R, dil):
        self.R = R
        self.CW, self.CH = math.ceil(R.W / CELL), math.ceil(R.H / CELL)
        self.all = [0.0] * (self.CW * self.CH)
        self.rando = [0.0] * (self.CW * self.CH)
        self.names = {}   # case -> {nom: m}
        self.dil = dil
        self.seen = set()

    def add(self, lines):
        R, dil = self.R, self.dil
        kx = 111320 * math.cos(math.radians((R.s + R.n) / 2))
        for cle, rando, name, pts in lines:
            if cle in self.seen:   # tronçon à cheval sur deux dalles
                continue
            self.seen.add(cle)
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                L = math.hypot((x1 - x0) * kx, (y1 - y0) * 110574)
                n = max(1, int(L / 25))
                for k in range(n):
                    t = (k + 0.5) / n
                    px, py = R.xy(y0 + (y1 - y0) * t, x0 + (x1 - x0) * t)
                    if not (0 <= px < R.W and 0 <= py < R.H) or not dil[py * R.W + px]:
                        continue
                    c = (py // CELL) * self.CW + px // CELL
                    self.all[c] += L / n
                    if rando:
                        self.rando[c] += L / n
                        for nm in name.split("/"):
                            nm = nm.strip()
                            if nm and not NOT_WALK.match(nm):
                                d = self.names.setdefault(c, {})
                                d[nm] = d.get(nm, 0) + L / n

    def around(self, lat, lon, r):
        """(km de chemins, km balisés, noms, distance en m à la case de chemins la plus proche)."""
        R = self.R
        px, py = R.xy(lat, lon)
        cx, cy = px // CELL, py // CELL
        cr = int(r / (PX * CELL)) + 1
        a = b = 0.0
        names, near = {}, None
        for dy in range(-cr, cr + 1):
            y = cy + dy
            if not 0 <= y < self.CH:
                continue
            for dx in range(-cr, cr + 1):
                x = cx + dx
                if not 0 <= x < self.CW:
                    continue
                d = math.hypot((x + 0.5) * CELL - px, (y + 0.5) * CELL - py) * PX
                if d > r:
                    continue
                c = y * self.CW + x
                if self.all[c] >= 50:
                    near = d if near is None else min(near, d)
                a += self.all[c]
                b += self.rando[c]
                for k, v in self.names.get(c, {}).items():
                    names[k] = names.get(k, 0) + v
        top = [k for k, v in sorted(names.items(), key=lambda kv: -kv[1]) if v >= 500][:3]
        return round(a / 1000, 1), round(b / 1000, 1), top, near


# ---------------------------------------------------------------- calcul
def measure(R, forest, pub, T, lat, lon, r_foret, r_sent):
    f, tot = R.disk(forest, lat, lon, r_foret)
    p, _ = R.disk(pub, lat, lon, r_foret)
    sent, rando, noms, near = T.around(lat, lon, r_sent)
    return {"foret": round(100 * f / tot) if tot else None,
            "fpub": round(100 * min(1, p / f)) if f else 0,
            "sent": sent, "rando": rando, "rnoms": " · ".join(noms) or None,
            "m": None if near is None else int(round(near / 50) * 50)}


def run(com, parcels):
    pts = [(c["lat"], c["lon"]) for c in com.values()] + [(p["lat"], p["lon"]) for p in parcels]
    tl = tiles_around(pts, R_SENT + PX * CELL)
    s, w = min(i for i, _ in tl) * TILE, min(j for _, j in tl) * TILE
    n, e = (max(i for i, _ in tl) + 1) * TILE, (max(j for _, j in tl) + 1) * TILE
    R = Raster(s, w, n, e)
    log(f"foret : masque {R.W}x{R.H} pixels de {PX:g} m, {len(tl)} dalles de sentiers")
    t0 = time.time()
    forest = R.woods(R.load(MASK), MIN_HA * 10000 / PX ** 2)
    pub = R.load(PUB)
    log(f"foret : masque et bois ≥ {MIN_HA} ha en {time.time() - t0:.0f} s")
    T = Trails(R, R.dilate(forest))
    tl = sorted(tl)
    with ThreadPoolExecutor(3) as ex:   # par lots : une dalle lue est ajoutée puis oubliée
        for k in range(0, len(tl), 6):
            for lines in ex.map(tile, tl[k:k + 6]):
                T.add(lines)
            if k // 6 % 15 == 14:
                log(f"foret : {k + 6}/{len(tl)} dalles")
    out = {}
    for code, c in com.items():
        m = measure(R, forest, pub, T, c["lat"], c["lon"], R_FORET, R_SENT)
        m.pop("m")
        out[code] = m
    par = {}
    for p in parcels:
        m = measure(R, forest, pub, T, p["lat"], p["lon"], R_PARC, R_PARC)
        par[p["id"]] = {"pc": m["foret"], "pub": m["fpub"], "sent": m["sent"], "rando": m["rando"],
                        "noms": m["rnoms"], "m": m["m"]}
    vals = sorted(v["sent"] for v in out.values())
    log(f"foret : {len(out)} communes, km de chemins en forêt à 3 km : médiane {vals[len(vals) // 2]}, "
        f"max {vals[-1]} ; {len(par)} parcelles")
    return out, par
