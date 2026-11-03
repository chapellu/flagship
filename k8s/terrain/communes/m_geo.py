"""Communes de la zone, identité et altitude (geo.api.gouv.fr, IGN RGE ALTI).

Zone : communes.json, plus les autres communes des mêmes départements dont le
centre est dans l'emprise de grid.json (même règle que le relevé des annonces,
refresh.zone_communes). Une commune de communes.json n'en sort jamais.

Champs : nom, lat/lon (centre geo.api, 4 décimales), pop (population
municipale), alt (RGE ALTI au centre, arrondie), sect (secteur, voir sectors()).
Garde aussi surface (ha), département et EPCI pour les autres modules.
"""
import re
import urllib.parse
from collections import Counter

from lib import altitudes, cache_path, http_json, load_json, log, save_json

GEO = "https://geo.api.gouv.fr"


def in_grid(grid, lat, lon):
    return (grid["lon0"] <= lon <= grid["lon0"] + grid["dlon"] * (grid["nx"] - 1)
            and grid["lat0"] <= lat <= grid["lat0"] + grid["dlat"] * (grid["ny"] - 1))


def departements(codes):
    return sorted({c[:3] if c.startswith("97") else c[:2] for c in codes})


def area(existing, grid):
    """{code: commune} : communes de communes.json + voisines dans l'emprise de la grille.
    Lève une erreur si geo.api.gouv.fr ne répond pas : sans lui, pas de fiche fiable."""
    out, arr = {}, {}
    for dep in departements(existing):
        geo = http_json(f"{GEO}/communes?" + urllib.parse.urlencode(
            {"codeDepartement": dep, "fields": "code,nom,centre,population,surface,codeEpci,epci", "format": "json"}), pause=0.3)
        for g in geo:
            lon, lat = ((g.get("centre") or {}).get("coordinates") or (None, None))
            if lat is None:
                continue
            if g["code"] in existing or in_grid(grid, lat, lon):
                out[g["code"]] = {"code": g["code"], "nom": g["nom"], "lat": round(lat, 4), "lon": round(lon, 4),
                                  "pop": g.get("population"), "surface": g.get("surface"), "dep": dep,
                                  "epci": g.get("codeEpci"), "epci_nom": (g.get("epci") or {}).get("nom")}
        # arrondissements municipaux (Lyon, Marseille, Paris) : les sources par commune
        # (DVF, écoles, BD TOPO…) les donnent parfois à la place de la commune
        for a in http_json(f"{GEO}/communes?" + urllib.parse.urlencode(
                {"codeDepartement": dep, "type": "arrondissement-municipal", "fields": "code,codeParent", "format": "json"}), pause=0.3):
            if a.get("codeParent"):
                arr[a["code"]] = a["codeParent"]
    lost = set(existing) - set(out)
    if lost:  # commune fusionnée ou disparue : on garde l'ancienne ligne telle quelle
        log(f"geo : {len(lost)} communes de communes.json inconnues de geo.api.gouv.fr, gardées telles quelles")
    return out, arr


def clean_epci(name):
    """« CC du Pays de Machin (CCPM) » → « Pays de Machin » : nom court par défaut d'un secteur."""
    s = re.sub(r"\s*\([^)]*\)\s*$", "", name or "").strip()
    s = re.sub(r"^(CC|CA|CU|Communauté (de communes|d'agglomération|urbaine))\s+", "", s)
    s = re.sub(r"^(de la|de l'|du|des|de)\s*", "", s)
    s = re.sub(r"\s+Agglom[ée]ration$", "", s)
    return s[:1].upper() + s[1:] if s else "?"


def sectors(com, existing, overrides):
    """Secteur de chaque commune, par EPCI. Ordre de priorité :
    1. config.json « sectors » : {code EPCI ou nom EPCI: secteur} ;
    2. le secteur déjà porté par les communes de cet EPCI dans communes.json
       (majoritaire) : les noms choisis à la main restent ;
    3. le nom de l'EPCI raccourci (clean_epci)."""
    learned = {}
    votes = {}
    for code, c in com.items():
        old = existing.get(code, {}).get("sect")
        if old and c.get("epci"):
            votes.setdefault(c["epci"], Counter())[old] += 1
    for e, v in votes.items():
        learned[e] = v.most_common(1)[0][0]
    for code, c in com.items():
        e, n = c.get("epci"), c.get("epci_nom")
        c["sect"] = (overrides.get(e) or overrides.get(n) or learned.get(e)
                     or (clean_epci(n) if n else existing.get(code, {}).get("sect") or "?"))


def add_altitude(com):
    path = cache_path("alti.json")
    cache = load_json(path, {})
    codes = sorted(com)
    for code, z in zip(codes, altitudes([(com[c]["lat"], com[c]["lon"]) for c in codes], cache)):
        com[code]["alt"] = z
    save_json(path, cache)
