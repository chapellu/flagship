"""Crèches → data/creches.json (option « travail en crèche près de chez nous »).

BPE de l'INSEE, équipement D502 « établissement d'accueil du jeune enfant »
(crèches collectives, parentales, micro-crèches, haltes-garderies financées par
la CAF), géolocalisé.

Sortie (inchangée depuis tools/creches.py) :
  sites  [[lat, lon, nom, commune, places, type], …] dans l'emprise de grid.json
  grid   minutes de voiture sans trafic vers la crèche la plus proche, même
         grille que grid.json (null si injoignable)
  com    { insee: minutes } depuis le centre de chaque commune

Temps : OSRM, comme grid.json. Pour chaque point, les K crèches les plus proches
à vol d'oiseau.
"""
from lib import grid_box, grid_points, log, nearest

K = 5


def nearest_minutes(points, sites, osrm):
    cand = nearest(points, [s[:2] for s in sites], K)
    rows = osrm.minutes(points, [[tuple(sites[j][:2]) for j in c] for c in cand])
    return [min((m for m in row if m is not None), default=None) for row in rows]


def run(com, grid, bpe, osrm):
    box = grid_box(grid, 0.1)  # une crèche juste hors cadre compte
    sites = [s for s in bpe["creches"] if box[0] <= s[0] <= box[1] and box[2] <= s[1] <= box[3]]
    log(f"crèches : {len(sites)} dans l'emprise")
    codes = sorted(com)
    cm = nearest_minutes([(com[c]["lat"], com[c]["lon"]) for c in codes], sites, osrm)
    gm = nearest_minutes(grid_points(grid), sites, osrm)
    return {"source": f"{bpe['label']} (D502, CNAF) ; temps OSRM sans trafic vers la crèche la plus proche",
            "sites": sites, "grid": gm, "com": dict(zip(codes, cm))}
