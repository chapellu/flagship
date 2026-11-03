"""Fibre (ARCEP, « Le marché du haut et très haut débit fixe (déploiements) ») → fibre.

Dernier trimestre publié, fichier par commune (shapefile zippé, ~30 Mo) :
fibre = 100 × locaux raccordables FTTH / locaux, arrondi. On ne lit que la
table attributaire (.dbf) ; le zip n'est retéléchargé qu'au trimestre suivant.
"""
import io
import re
import struct
import zipfile

from lib import cache_path, datagouv_resources, fetch_file, load_json, log, save_json

SLUG = "le-marche-du-haut-et-tres-haut-debit-fixe-deploiements"


def read_dbf(f):
    """Lecteur dBase minimal : en-tête, descripteurs de champs, enregistrements."""
    hdr = f.read(32)
    n, hl, rl = struct.unpack("<IHH", hdr[4:12])
    raw = f.read(hl - 32)
    fields = []
    for i in range((hl - 33) // 32):
        d = raw[32 * i:32 * i + 32]
        fields.append((d[:11].split(b"\0")[0].decode("latin-1"), d[16]))
    for _ in range(n):
        rec = f.read(rl)
        if not rec or rec[:1] == b"\x1a":
            break
        if rec[:1] == b"*":
            continue
        p, out = 1, {}
        for name, ln in fields:
            out[name] = rec[p:p + ln].decode("utf-8", "replace").strip()
            p += ln
        yield out


def latest():
    best = None
    for r in datagouv_resources(SLUG):
        m = re.fullmatch(r"(\d{4})T([1-4])-Communes?", r["title"].strip(), re.I)
        if m and r["url"].endswith(".zip"):
            k = (int(m.group(1)), int(m.group(2)))
            if best is None or k > best[0]:
                best = (k, r["url"])
    if not best:
        raise RuntimeError("ARCEP : pas de fichier par commune")
    return f"{best[0][0]}T{best[0][1]}", best[1]


def run(com, arr):
    q, url = latest()
    p = cache_path("fibre.json")
    data = load_json(p, {})
    if data.get("url") != url:
        zpath, _ = fetch_file(url, "arcep-communes.zip")
        z = zipfile.ZipFile(zpath)
        name = next(n for n in z.namelist() if n.lower().endswith(".dbf"))
        rows = {}
        for r in read_dbf(io.BytesIO(z.read(name))):
            try:
                rows[r["INSEE_COM"]] = [float(r["ftth"] or 0), float(r["Locaux"] or 0)]
            except (KeyError, ValueError):
                continue
        data = {"url": url, "q": q, "rows": rows}
        save_json(p, data)
        log(f"fibre : ARCEP {q}, {len(rows)} communes")
    rows = data["rows"]
    agg = {}
    for code, (f, n) in rows.items():  # arrondissements → commune, si la commune manque
        parent = arr.get(code)
        if parent and parent not in rows:
            a = agg.setdefault(parent, [0, 0])
            a[0] += f
            a[1] += n
    out = {}
    for code in com:
        f, n = rows.get(code) or agg.get(code) or (None, 0)
        out[code] = {"fibre": round(100 * f / n) if n else None}
    return out, data["q"]
