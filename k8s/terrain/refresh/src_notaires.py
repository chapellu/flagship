"""Immobilier.notaires : l'API JSON qu'utilise leur propre site
(pub-services/inotr-www-annonces/v1/annonces).

Zone : les départements déduits des codes INSEE de communes.json (pas de
configuration propre). Chaque annonce porte son code INSEE (inseeCommune) mais
pas de coordonnées : on place l'annonce au centre de la commune.

Le robots.txt du site demande Crawl-delay: 10 ; on le respecte (en pratique la
zone tient en une ou deux pages de 100).
"""
import time
import urllib.parse

from refresh import http_json, is_constructeur

NAME = "notaires"
PAGE = 100
API = "https://www.immobilier.notaires.fr/pub-services/inotr-www-annonces/v1/annonces?"
# VENTE : vente classique ; VNI : vente interactive « 36 h immo » (prix de
# première offre). Les adjudications (VAE) sont exclues : la mise à prix n'est
# pas un prix de marché.
TRANSACTIONS = "VENTE,VNI"


def fetch(search, communes):
    depts = sorted({c[:2] for c in communes})
    q = {
        "parPage": PAGE, "departements": ",".join(depts), "typeBiens": "TER",
        "typeTransactions": TRANSACTIONS,  # pas de prix max : le budget se règle dans l'app
    }
    out, total, page, pages = {}, None, 1, 1
    while page <= pages:
        d = http_json(API + urllib.parse.urlencode({**q, "page": page, "offset": (page - 1) * PAGE}))
        total = d.get("nbTotalAnnonces") or 0
        pages = d.get("nbPages") or 0
        rows = d.get("annonceResumeDto") or []
        if not rows:
            break
        for a in rows:
            out[a["annonceId"]] = a
        page += 1
        if page <= pages:
            time.sleep(10)  # Crawl-delay du robots.txt
    complete = total is not None and len(out) >= total
    ads = []
    for a in out.values():
        if a.get("statut") not in (None, "LIGNE") or a.get("bienVendu") == "OUI" or a.get("bienRetire") == "OUI":
            continue
        insee = a.get("inseeCommune")
        c = communes.get(insee) or {}
        desc = (a.get("descriptionFr") or "").strip()
        ads.append({
            "id": f"notaires:{a['annonceId']}", "src": NAME, "url": a.get("urlDetailAnnonceFr"),
            "insee": insee, "commune": a.get("communeNom"), "lat": c.get("lat"), "lon": c.get("lon"),
            "pos": "commune",
            "prix": a.get("prixAffiche") or a.get("prixTotal"),
            "m2": a.get("surfaceTerrain") or a.get("surface"),
            "titre": desc[:160] or None, "desc": desc,
            "vendeur": "notaire",
            "constructeur": is_constructeur(desc),
            "photo": a.get("urlPhotoPrincipale"),
            "published": (a.get("dateCreation") or "")[:10] or None,
        })
    return ads, complete
