"""ParuVendu : pages de liste publiques /immobilier/vente/terrain/<lieu>/ (HTML).

Pas d'API ouverte : le moteur de recherche du site (/immobilier/annonceimmofo/…,
tri, filtres de prix) est interdit par robots.txt. On ne lit donc que les pages
de liste autorisées :

1. la page département (« rhone-69 »), paginée par ?p=N, triée par date de mise
   à jour. Le site la plafonne à 5 pages (~160 annonces) ;
2. si le département dépasse ce plafond, les pages commune
   (« pollionnay-69290 ») des seules communes de la zone. Une commune sans
   annonce redirige vers la page département ; une commune inconnue du site
   (fusion récente…) répond 404.

Les slugs (nom + code postal) sont construits à partir de l'API publique
geo.api.gouv.fr ; pour les communes nouvelles, on interroge aussi les anciens
noms (communes déléguées), que ParuVendu utilise souvent. Coût : ~250 pages
par jour quand un département dépasse le plafond (≈ 10-15 min avec la pause). Configuration facultative dans config.json :
    "paruvendu": {"communes": false}   → pas de passe commune (relevé incomplet)

Les annonces n'ont ni code INSEE ni coordonnées : on retrouve la commune par
son nom (norm) et son département, et on la place au centre de la commune.
"""
import html
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from refresh import UA, http_json, is_constructeur, norm

NAME = "paruvendu"
BASE = "https://www.paruvendu.fr"
LISTE = BASE + "/immobilier/vente/terrain/{}/"
GEO = "https://geo.api.gouv.fr"
PAUSE = 2


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def get(url, essais=3):
    """(html, url finale) ; None si 404/410 (lieu inconnu du site).
    Erreur serveur passagère (5xx, délai) : on réessaie après une pause."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
    for n in range(essais):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode(r.headers.get_content_charset() or "utf-8", "replace"), r.geturl()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            if e.code < 500 or n == essais - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if n == essais - 1:
                raise
        time.sleep(15 * (n + 1))


def txt(s):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", s or "")).split())


def parse(page):
    """Annonces d'une page de liste : dict id → champs bruts, et le total annoncé."""
    m = re.search(r'"offerCount":\s*(\d+)', page)
    total = int(m.group(1)) if m else None
    ads = {}
    for b in re.split(r'<div[^>]*class="blocAnnonce', page)[1:]:
        b = b.split('<div id="annonce_')[0]
        i = re.search(r'data-id="(\d+)"', b)
        h3 = re.search(r"<h3.*?</h3>", b, re.S)
        if not (i and h3):
            continue
        prix = re.search(r"<!-- Prix -->\s*<div>\s*([\d\s\u00a0\u202f]+)(?:&euro;|€)", b)
        href = re.search(r'href="((?:https://www\.paruvendu\.fr)?/immobilier/vente/[^"#]+)"', b)
        span = re.search(r"<h3.*?<span>(.*?)</span>", b, re.S)
        lignes = [txt(x) for x in (span.group(1) if span else "").splitlines() if txt(x)]
        lieu = re.match(r"(.+?)\s*\((\d[\dAB])\)$", lignes[-1]) if lignes else None  # « Villechenève (69) »
        titre = txt(h3.group(0))  # « Terrain 732 m2 (94€/m²) Villechenève (69) »
        desc = re.search(r'<p class="text-sm text-justify[^"]*">(.*?)</p>', b, re.S)
        desc = txt(desc.group(1)) if desc else ""
        surf = re.search(r"(\d[\d\s]*)\s*m\s*2", titre) or re.search(r"(\d[\d\s.]*)\s*m(?:²|2)", desc)
        # première photo : posée en JS (lazy) ou src directe, hors images de remplissage
        photos = re.findall(r"imageElement\.src = '(https://[^']+)'", b) + re.findall(r'<img[^>]*?\ssrc="(https://img\.paruvendu\.fr/media_ext/[^"]+)"', b)
        pro = re.search(r'title="Toutes les annonces de ([^"]+)"', b)
        part = "imgPart" in b or ">Particulier<" in b
        ads[i.group(1)] = {
            "url": urllib.parse.urljoin(BASE, href.group(1)) if href else None,
            "titre": re.sub(r"\s*\([^)]*€/m²\)", "", " ".join(lignes[:-1])).replace(" m 2", " m²") or None,
            "ville": lieu.group(1) if lieu else None, "dep": lieu.group(2) if lieu else None,
            "m2": int(re.sub(r"\D", "", surf.group(1))) if surf else None,
            "prix": int(re.sub(r"\D", "", prix.group(1))) if prix else None,
            "photo": photos[0] if photos else None,
            "desc": desc,
            "vendeur": "particulier" if part else (html.unescape(pro.group(1)).strip() if pro else None),
        }
    return ads, total


def liste(lieu):
    """Toutes les pages d'une liste. Renvoie (annonces, complet), ({}, True) si
    le site redirige ailleurs (commune sans annonce), None si le lieu est inconnu."""
    url = LISTE.format(lieu)
    out, total, p = {}, None, 1
    while True:
        r = get(url + (f"?p={p}" if p > 1 else ""))
        time.sleep(PAUSE)
        if r is None:
            if p == 1:
                return None
            break  # au-delà de la dernière page : 404
        page, final = r
        if p == 1 and urllib.parse.urlsplit(final).path != urllib.parse.urlsplit(url).path:
            return {}, True
        ads, total = parse(page)
        new = {k: v for k, v in ads.items() if k not in out}
        out.update(ads)
        if not new or (total is not None and len(out) >= total) or f"?p={p + 1}" not in page:
            break
        p += 1
    return out, total is not None and len(out) >= 0.97 * total


def fetch(search, communes):
    cfg = search.get("paruvendu") or {}
    depts = sorted({c[:2] for c in communes})
    index = {(norm(c["nom"]), code[:2]): code for code, c in communes.items()}
    raw, complete = {}, True
    for dep in depts:
        # Communes nouvelles : ParuVendu range souvent les annonces sous l'ancien
        # nom (« Belleville » pour Belleville-en-Beaujolais). Les communes
        # déléguées/associées servent d'alias, rattachés à la commune actuelle.
        anciens = {}
        for d in http_json(f"{GEO}/communes_associees_deleguees?" + urllib.parse.urlencode(
                {"codeDepartement": dep, "fields": "nom,code,chefLieu", "format": "json"})):
            if d.get("chefLieu") in communes:
                anciens.setdefault(d["chefLieu"], []).append(d["nom"])
                index.setdefault((norm(d["nom"]), dep), d["chefLieu"])
        nom = http_json(f"{GEO}/departements/{dep}")["nom"]
        r = liste(f"{slug(nom)}-{dep}")
        if r is None or not r[0]:
            raise RuntimeError(f"page département introuvable : {dep}")
        ads, ok = r
        raw.update({k: (v, None) for k, v in ads.items()})
        if ok:
            continue
        # Département au-delà du plafond : passe par commune de la zone.
        if cfg.get("communes") is False:
            complete = False
            continue
        geo = http_json(f"{GEO}/communes?" + urllib.parse.urlencode(
            {"codeDepartement": dep, "fields": "code,nom,codesPostaux", "format": "json"}))
        inconnues, erreurs = [], 0
        for g in geo:
            if g["code"] not in communes:
                continue
            if erreurs >= 5:
                print("paruvendu : trop d'erreurs, passe commune abandonnée (relevé partiel)")
                complete = False
                break
            trouve = False
            for n in [g["nom"]] + [x for x in anciens.get(g["code"], []) if norm(x) != norm(g["nom"])]:
                for cp in g.get("codesPostaux") or []:
                    try:
                        r = liste(f"{slug(n)}-{cp}")
                    except Exception as e:  # page en échec : relevé incomplet, on continue
                        print(f"paruvendu {n}: {type(e).__name__}: {e}")
                        complete = False
                        erreurs += 1
                        trouve = True
                        break
                    if r is not None:
                        ads, ok = r
                        complete &= ok
                        raw.update({k: (v, g["code"]) for k, v in ads.items()})
                        trouve = True
                        break
            if not trouve:
                inconnues.append(g["nom"])
        if inconnues:
            print(f"paruvendu {dep}: communes inconnues du site : {', '.join(inconnues)}")
    maxp = search.get("maxPrice", 250000)
    out = []
    for k, (a, insee_page) in raw.items():
        if not a["prix"] or a["prix"] > maxp:
            continue  # sans prix : encart « programme / lotissement » (ni prix ni surface)
        insee = index.get((norm(a["ville"]), a["dep"])) or insee_page
        c = communes.get(insee) or {}
        out.append({
            "id": "paruvendu:" + k, "src": NAME, "url": a["url"],
            "insee": insee, "commune": a["ville"], "lat": c.get("lat"), "lon": c.get("lon"), "pos": "commune",
            "prix": a["prix"], "m2": a["m2"], "titre": a["titre"], "desc": a["desc"],
            "vendeur": a["vendeur"],
            "constructeur": is_constructeur(a["titre"], a["desc"]),
            "photo": a["photo"],
            "published": None,  # la liste ne donne que la date de dernière mise à jour
        })
    return out, complete
