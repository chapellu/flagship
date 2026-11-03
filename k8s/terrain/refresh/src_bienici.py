"""Bien'ici : l'API JSON qu'utilise leur propre site (realEstateAds.json).

Zone : les départements des communes de la zone (refresh.zone_communes, qui
suit la grille de trajets), traduits en identifiants de zone Bien'ici par leur
moteur de suggestion (res.bienici.com/suggest.json?q=<nom du département> : les
entrées de type « department » dont le code INSEE est celui du département ; le
Rhône y est coupé en 69D et 69M, Métropole de Lyon). search.bienici.zoneIds dans
config.json s'y ajoute (facultatif) ; si un département ne se traduit pas, le
relevé est incomplet (rien n'est marqué parti).
Chaque annonce porte son code INSEE (district.insee_code), parfois celui d'une
commune déléguée, parfois aucun (code postal seul) : refresh.locate s'en charge.
Pas de filtre de prix : tout le marché de la zone est relevé.
"""
import json
import time
import urllib.parse

from refresh import http_json, is_constructeur

NAME = "bienici"
PAGE = 100
VENDEUR = {"mandatary": "mandataire", "agency": "agence", "private": "particulier", "builder": "constructeur"}


def dep_zones(dep):
    """Identifiants de zone Bien'ici d'un département (code INSEE « 01 », « 69 »…)."""
    nom = http_json("https://geo.api.gouv.fr/departements/" + dep)["nom"]
    ids = set()
    for e in http_json("https://res.bienici.com/suggest.json?" + urllib.parse.urlencode({"q": nom})):
        codes = e.get("insee_codes") or [e.get("insee_code")]
        # « 69D », « 69M » : les deux moitiés du Rhône ; pas « 013 » pour « 01 »
        if (e.get("type") or "").endswith("department") and codes and all(
                c and c.startswith(dep) and not c[len(dep):].isdigit() for c in codes):
            ids.update(e.get("zoneIds") or [])
    return ids


def fetch(search, communes):
    zone, complete_zone = set((search.get("bienici") or {}).get("zoneIds") or []), True
    for dep in sorted({c[:2] for c in communes}):
        try:
            ids = dep_zones(dep)
        except Exception as e:  # suggestion indisponible : la zone configurée seule
            print(f"bienici {dep}: zone introuvable ({type(e).__name__}: {e})")
            ids = set()
        if not ids:
            complete_zone = False
        zone |= ids
        time.sleep(0.5)
    if not zone:
        raise ValueError("aucune zone Bien'ici (départements introuvables, config.search.bienici.zoneIds vide)")
    zone = sorted(zone)
    print(f"bienici : {len(zone)} zones")
    flt = {
        "size": PAGE, "from": 0, "filterType": "buy", "propertyType": ["terrain"],
        "sortBy": "publicationDate", "sortOrder": "desc", "onTheMarket": [True],
        "zoneIdsByTypes": {"zoneIds": zone},
    }
    out, total = [], None
    while total is None or flt["from"] < total:
        d = http_json("https://www.bienici.com/realEstateAds.json?filters=" + urllib.parse.quote(json.dumps(flt)))
        total = d.get("total", 0)
        page = d.get("realEstateAds") or []
        if not page:
            break
        out += page
        flt["from"] += PAGE
        time.sleep(1.5)
    complete = complete_zone and total is not None and len({a["id"] for a in out}) >= 0.97 * total
    ads = []
    for a in out:
        # programmes neufs : prix et surfaces en fourchette [min, max] → « à partir de », plus grand lot
        prix, m2 = a.get("price"), a.get("landSurfaceArea") or a.get("surfaceArea")
        prix = min(prix) if isinstance(prix, list) and prix else prix
        m2 = max(m2) if isinstance(m2, list) and m2 else m2
        dist = a.get("district") or {}
        insee = dist.get("insee_code") or dist.get("code_insee")
        blur = a.get("blurInfo") or {}
        pos = blur.get("position") or blur.get("centroid") or {}
        if not pos and insee in communes:
            pos = {"lat": communes[insee]["lat"], "lon": communes[insee]["lon"]}
        photos = a.get("photos") or []
        ads.append({
            "id": "bienici:" + a["id"], "src": NAME, "url": "https://www.bienici.com/annonce/" + a["id"],
            "insee": insee, "commune": a.get("city"), "lat": pos.get("lat"), "lon": pos.get("lon"),
            "pos": {"exact": "exact", "disk": "approx"}.get(blur.get("type"), "commune"),
            "prix": prix or None, "m2": m2 or None,
            "titre": a.get("title"), "desc": a.get("description"),
            "vendeur": a.get("accountDisplayName") if a.get("accountType") == "agency" else VENDEUR.get(a.get("accountType"), a.get("accountType")),
            "constructeur": a.get("propertyType") == "programme" or is_constructeur(a.get("title"), a.get("description")),
            "photo": photos[0].get("url") if photos else None,
            # les annonces importées d'agences ont souvent 1970-01-01 : pas de date
            "published": p if (p := (a.get("publicationDate") or "")[:10]) >= "2000" else None,
        })
    return ads, complete
