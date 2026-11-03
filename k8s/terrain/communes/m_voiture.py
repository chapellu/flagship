"""Minutes de voiture sans trafic du centre de la commune aux lieux de config.json.

Même méthode que grid.json (OSRM, serveur de démonstration, arrondi à la
minute) : sur les communes de l'étude d'origine, workcar, famA, famB et car
tombent à la minute près (car : vers le lieu « city »).

workpr : voiture + PARK_WORK minutes (se garer, finir à pied). C'est la règle
qui reproduit le mieux l'ancien champ (~2/3 des communes à la minute) ; l'app
ne s'en sert pas.
"""
PLACES = {"workcar": "work", "famA": "famA", "famB": "famB", "car": "city"}
PARK_WORK = 7


def run(com, cfg, osrm):
    places = cfg.get("places") or {}
    keys = [(f, places[p]) for f, p in PLACES.items() if p in places]
    dst = [(p["lat"], p["lon"]) for _, p in keys]
    codes = sorted(com)
    rows = osrm.minutes([(com[c]["lat"], com[c]["lon"]) for c in codes], [dst] * len(codes))
    out = {}
    for code, row in zip(codes, rows):
        r = {f: m for (f, _), m in zip(keys, row)}
        if r.get("workcar") is not None:
            r["workpr"] = r["workcar"] + PARK_WORK
        out[code] = r
    return out
