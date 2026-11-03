"""Bien'ici : l'API JSON qu'utilise leur propre site (realEstateAds.json).

Zone : search.bienici.zoneIds dans config.json (identifiants de département
Bien'ici, ex. « -4850451 » pour le Rhône ; voir res.bienici.com/suggest.json).
Chaque annonce porte son code INSEE (district.insee_code).
"""
import json
import time
import urllib.parse

from refresh import http_json, is_constructeur

NAME = "bienici"
PAGE = 100
VENDEUR = {"mandatary": "mandataire", "agency": "agence", "private": "particulier", "builder": "constructeur"}


def fetch(search, communes):
    zone = (search.get("bienici") or {}).get("zoneIds")
    if not zone:
        raise ValueError("config.search.bienici.zoneIds manquant")
    flt = {
        "size": PAGE, "from": 0, "filterType": "buy", "propertyType": ["terrain"],
        "sortBy": "publicationDate", "sortOrder": "desc", "onTheMarket": [True],
        "maxPrice": search.get("maxPrice", 250000),
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
    complete = total is not None and len({a["id"] for a in out}) >= 0.97 * total
    ads = []
    for a in out:
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
            "prix": a.get("price"), "m2": a.get("landSurfaceArea") or a.get("surfaceArea"),
            "titre": a.get("title"), "desc": a.get("description"),
            "vendeur": a.get("accountDisplayName") if a.get("accountType") == "agency" else VENDEUR.get(a.get("accountType"), a.get("accountType")),
            "constructeur": a.get("propertyType") == "programme" or is_constructeur(a.get("title"), a.get("description")),
            "photo": photos[0].get("url") if photos else None,
            # les annonces importées d'agences ont souvent 1970-01-01 : pas de date
            "published": p if (p := (a.get("publicationDate") or "")[:10]) >= "2000" else None,
        })
    return ads, complete
