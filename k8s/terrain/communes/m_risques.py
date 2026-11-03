"""Risques (Géorisques, API GASPAR) → inond, sech, mvt, feu, indus.

  inond  nombre d'arrêtés de catastrophe naturelle « inondations » (toutes causes)
  sech   arrêtés « sécheresse » (retrait-gonflement des argiles)
  mvt    arrêtés « glissement / mouvement de terrain / éboulement »
  feu    1 si le risque « feu de forêt » est recensé dans la commune, sinon 0
  indus  1 si le « risque industriel » est recensé, sinon 0
Ces définitions reproduisent toutes les fiches d'origine. Deux requêtes par
commune, une par seconde au plus (l'API coupe les clients trop pressés) ;
chaque réponse est gardée TTL jours (les arrêtés changent rarement), et au plus
MAX_PER_RUN communes sont rafraîchies par passage, les plus anciennes d'abord.
"""
from lib import TODAY, cache_path, http_json, load_json, log, save_json

API = "https://georisques.gouv.fr/api/v1/gaspar/"
TTL = 28
MAX_PER_RUN = 250
PAUSE = 1.0


def fetch(code):
    cat, p = [], 1
    while True:
        d = http_json(f"{API}catnat?code_insee={code}&page_size=100&page={p}", pause=PAUSE)
        cat += [x.get("libelle_risque_jo") or "" for x in d.get("data") or []]
        if p >= (d.get("total_pages") or 1):
            break
        p += 1
    ri = http_json(f"{API}risques?code_insee={code}", pause=PAUSE)
    risques = sorted({x.get("libelle_risque_long") or "" for r in ri.get("data") or [] for x in r.get("risques_detail") or []})
    return {"catnat": cat, "risques": risques, "day": TODAY}


def fields(g):
    cn = lambda f: sum(1 for l in g["catnat"] if f(l.lower()))
    rk = lambda f: int(any(f(l.lower()) for l in g["risques"]))
    return {
        "inond": cn(lambda l: "inondation" in l),
        "sech": cn(lambda l: "sécheresse" in l),
        "mvt": cn(lambda l: "glissement" in l or "mouvement de terrain" in l or "éboulement" in l or "eboulement" in l),
        "feu": rk(lambda l: "feu" in l),
        "indus": rk(lambda l: "industriel" in l),
    }


def run(com):
    p = cache_path("georisques.json")
    cache = load_json(p, {})
    n, out, err, down = 0, {}, 0, False
    # les plus anciennes d'abord : une panne en route n'empêche pas la rotation
    for code in sorted(com, key=lambda c: (cache.get(c) or {}).get("day", -1)):
        g = cache.get(code)
        if not down and n < MAX_PER_RUN and (g is None or TODAY - g["day"] >= TTL):
            try:
                cache[code] = g = fetch(code)
                n += 1
                err = 0
                if n % 50 == 0:
                    save_json(p, cache)
            except Exception as e:
                err += 1
                log(f"géorisques {code} : {type(e).__name__} {e}")
                down = err >= 3  # l'API ne répond plus : on garde le cache, on réessaiera dimanche prochain
        if g is not None:
            out[code] = fields(g)
    save_json(p, cache)
    log(f"géorisques : {n} communes interrogées, {len(out)}/{len(com)} connues")
    if down and len(out) < len(com):
        if not out:
            raise RuntimeError("Géorisques ne répond pas")
        global partial
        partial = f"Géorisques ne répond plus, {len(com) - len(out)} communes sans données"
    return out


partial = None  # lu par build.py : passage incomplet
