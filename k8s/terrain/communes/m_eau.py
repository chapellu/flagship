"""Sources (IGN BD TOPO, détails hydrographiques) → src, srckm.

  src    points d'eau « Source », « Source captée », « Fontaine » et « Lavoir »
         de la BD TOPO rattachés à la commune (WFS data.geopf.fr) ;
  srckm  src par km² (surface geo.api.gouv.fr), 2 décimales.
Sur les fiches d'origine, src tombe juste pour ~3/4 des communes et n'est jamais
plus haut : l'ancienne source en comptait un peu plus (voir README).
"""
import time
import urllib.parse

from lib import http_json, log

WFS = "https://data.geopf.fr/wfs/ows?"
NATURES = ("Source", "Source captée", "Fontaine", "Lavoir")
PAGE = 5000


def run(com, arr):
    deps = sorted({c["dep"] for c in com.values()})
    count = {}
    nat = ",".join("'" + n.replace("'", "''") + "'" for n in NATURES)
    for dep in deps:
        start = 0
        while True:
            q = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "BDTOPO_V3:detail_hydrographique",
                 "OUTPUTFORMAT": "application/json", "CQL_FILTER": f"insee_commune LIKE '{dep}%' AND nature IN ({nat})",
                 "PROPERTYNAME": "nature,insee_commune", "COUNT": str(PAGE), "STARTINDEX": str(start), "SORTBY": "cleabs"}
            d = http_json(WFS + urllib.parse.urlencode(q), timeout=180)
            for f in d.get("features") or []:
                c = (f.get("properties") or {}).get("insee_commune") or ""
                c = arr.get(c, c)
                count[c] = count.get(c, 0) + 1
            if len(d.get("features") or []) < PAGE:
                break
            start += PAGE
            time.sleep(1)
        time.sleep(1)
    log(f"eau : {sum(count.values())} sources et fontaines")
    out = {}
    for code, c in com.items():
        n = count.get(code, 0)
        out[code] = {"src": n, "srckm": round(n / (c["surface"] / 100), 2) if c.get("surface") else None}
    return out
