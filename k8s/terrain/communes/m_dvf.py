"""Ventes de terrains à bâtir (DVF géolocalisées, data.gouv.fr) → prix, m2, eurm2, nv, big.

Source : jeu « demandes-de-valeurs-foncieres-geolocalisees », un fichier national
par année (full-AAAA.csv.gz, ~100 Mo). Chaque fichier n'est lu qu'une fois par
version : on le décompresse à la volée et on ne garde que les départements de
la zone et les colonnes utiles (CACHE/dvf/AAAA.json).

Une vente compte si (règle qui reproduit le mieux les fiches d'origine) :
  - nature « Vente » ou « Vente terrain à bâtir », une seule commune ;
  - aucun local (ni maison, ni appartement, ni dépendance) ;
  - toutes ses parcelles en terrain à bâtir (AB), sol (S), agrément (AG) ou
    jardin (J) : les prés, terres, bois, vignes sont écartés ;
  - surface totale ≥ MIN_M2 et prix entre MIN_EUR_M2 et MAX_EUR_M2 €/m²
    (sous 30 €/m² c'est du foncier agricole, au-dessus de 1 500 un bâti non déclaré).
Période : les YEARS dernières années complètes publiées.
prix, m2, eurm2 : médianes (prix, surface, prix au m²) ; nv : nombre de ventes ;
big : ventes de BIG_M2 m² ou plus.
"""
import csv
import json
import os
import re
import statistics

from lib import cache_path, datagouv_resources, load_json, log, save_json, stream_gz_lines

SLUG = "demandes-de-valeurs-foncieres-geolocalisees"
YEARS = 3
NATURES = {"Vente", "Vente terrain à bâtir"}
CULTURES = {"AB", "S", "AG", "J", ""}
MIN_M2, BIG_M2 = 300, 1500
MIN_EUR_M2, MAX_EUR_M2 = 30, 1500
COLS = ("id_mutation", "date_mutation", "nature_mutation", "valeur_fonciere", "code_commune",
        "id_parcelle", "type_local", "code_nature_culture", "surface_terrain")


def year_files():
    """{année: url} des fichiers annuels complets (pas les semestres)."""
    out = {}
    for r in datagouv_resources(SLUG):
        m = re.fullmatch(r"DVF (\d{4})", r["title"].strip())
        if m and r["url"].endswith(".csv.gz"):
            out[int(m.group(1))] = r["url"]
    return out


def extract(url, deps):
    """Mutations des départements deps, regroupées : {id: [date, nature, valeur, commune, local?, cultures, surface]}."""
    resp, f = stream_gz_lines(url)
    muts = {}
    with resp:
        r = csv.reader(f)
        h = {k: i for i, k in enumerate(next(r))}
        idx = [h[c] for c in COLS]
        idep = h["code_departement"]
        for row in r:
            if row[idep] not in deps:
                continue
            mid, date, nat, val, cc, par, loc, cult, surf = (row[i] for i in idx)
            m = muts.get(mid)
            if m is None:
                m = muts[mid] = [date, nat, val, set(), False, set(), 0.0]
            m[3].add(cc)
            m[4] = m[4] or bool(loc)
            m[5].add(cult)
            if par and surf:
                m[6] += float(surf)
    return {k: [m[0], m[1], m[2], sorted(m[3]), m[4], sorted(m[5]), m[6]] for k, m in muts.items()}


def run(com, arr):
    deps = sorted({c["dep"] for c in com.values()})
    files = year_files()
    years = sorted(files)[-YEARS:]
    if len(years) < YEARS:
        raise RuntimeError(f"DVF : {len(years)} années complètes seulement")
    sales = {}
    for y in years:
        p = cache_path("dvf", f"{y}.json")
        meta = load_json(p + ".meta", {})
        if meta.get("url") != files[y] or not set(deps) <= set(meta.get("deps", [])) or not os.path.exists(p):
            log(f"dvf : lecture de {files[y].rsplit('/', 1)[-1]}…")
            save_json(p, extract(files[y], set(deps)))
            save_json(p + ".meta", {"url": files[y], "deps": deps})
        for d, nat, val, cc, loc, cult, surf in load_json(p).values():
            if nat not in NATURES or loc or len(cc) != 1 or not val or not set(cult) <= CULTURES or surf < MIN_M2:
                continue
            v = float(val)
            if not MIN_EUR_M2 <= v / surf <= MAX_EUR_M2:
                continue
            code = arr.get(cc[0], cc[0])
            sales.setdefault(code, []).append((v, surf))
    out = {}
    for code in com:
        L = sales.get(code, [])
        out[code] = {
            "prix": round(statistics.median(v for v, _ in L)) if L else None,
            "m2": round(statistics.median(s for _, s in L)) if L else None,
            "eurm2": round(statistics.median(v / s for v, s in L)) if L else None,
            "nv": len(L), "big": sum(s >= BIG_M2 for _, s in L),
        }
    log(f"dvf : {years[0]}–{years[-1]}, {sum(len(v) for v in sales.values())} ventes de terrain")
    return out, f"{years[0]}–{years[-1]}"
