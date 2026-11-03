"""Écoles et collèges → data/schools.json et champs cl19, cl25, priv, col, colc, colkm, va.

Sources publiques (data.education.gouv.fr, INSEE) :
  fr-en-annuaire-education               écoles et collèges ouverts : public/privé, contrat, cantine, ULIS, position
  fr-en-ecoles-effectifs-nb_classes      élèves et classes par école et par rentrée
  fr-en-ips-ecoles-ap2022                indice de position sociale des écoles (dernière rentrée)
  fr-en-organisation-du-temps-scolaire   semaine de 4 jours ou 4,5 jours
  fr-en-indicateurs-valeur-ajoutee-colleges  brevet : réussite, note à l'écrit, mentions, valeur ajoutée
  fr-en-ips-colleges-ap2022              IPS des collèges
  BPE (INSEE)                            écoles en RPI dispersé (élèves transportés d'un village à l'autre)

Champs de communes.json (reproduisent les fiches d'origine) :
  cl25  classes des écoles ouvertes de la commune, dernière rentrée publiée ;
  cl19  classes de ces mêmes écoles à la rentrée BASE (2019) ;
  priv  nombre d'écoles privées sous contrat ;
  col, colc, colkm  collège privé sous contrat le plus proche du centre (nom,
        commune, km à vol d'oiseau) ; va : sa valeur ajoutée de la note à l'écrit
        du brevet (dernière session).

Il n'existe pas de classement officiel des écoles primaires : l'IPS dit qui
fréquente l'école (milieu social), pas ce qu'elle apporte. Pour les collèges,
la valeur ajoutée du brevet est l'indicateur officiel de « fait mieux ou moins
bien qu'attendu, vu ses élèves ».
"""
import urllib.parse

from lib import http_json, km, log

API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/{}/exports/json?"
BASE = "2019"


def get(ds, where, select=None):
    q = {"where": where}
    if select:
        q["select"] = select
    return http_json(API.format(ds) + urllib.parse.urlencode(q), timeout=300, pause=1)


def latest(rows, key, year):
    """Garde, pour chaque établissement, la ligne de l'année la plus récente."""
    out = {}
    for r in rows:
        k = r.get(key)
        if k and (k not in out or str(r.get(year)) > str(out[k].get(year))):
            out[k] = r
    return out


def num(v):
    try:
        return round(float(str(v).replace(",", ".").replace("%", "")), 1)
    except (TypeError, ValueError):
        return None


def contrat(r):
    if r.get("statut_public_prive") != "Privé":
        return None
    t = (r.get("type_contrat_prive") or "").upper()
    return "hors contrat" if "HORS" in t else "sous contrat" if "CONTRAT" in t else t.lower() or None


def run(com, arr, bpe):
    deps = sorted({c["dep"] for c in com.values()})
    # selon le jeu de données, le département s'écrit « 69 » ou « 069 » : on accepte les deux
    dep = lambda f: " or ".join(f'{f}="{p}{d}"' for d in deps for p in ("", "0"))
    d3 = dep("code_departement")
    ann = get("fr-en-annuaire-education", f'etat="OUVERT" and (type_etablissement="Ecole" or type_etablissement="Collège") and ({d3})')
    effs = get("fr-en-ecoles-effectifs-nb_classes", f"({d3})",
               "numero_ecole,rentree_scolaire,nombre_total_classes,nombre_total_eleves")
    eff = latest(effs, "numero_ecole", "rentree_scolaire")
    base = {r["numero_ecole"]: r for r in effs if str(r.get("rentree_scolaire")) == BASE}
    ipse = latest(get("fr-en-ips-ecoles-ap2022", dep("code_du_departement")), "uai", "rentree_scolaire")
    ipsc = latest(get("fr-en-ips-colleges-ap2022", dep("code_du_departement")), "uai", "rentree_scolaire")
    va = latest(get("fr-en-indicateurs-valeur-ajoutee-colleges", f"({d3})"), "uai", "session")
    rythme = latest(get("fr-en-organisation-du-temps-scolaire", f"({d3})",
                        "code_uai,annee_scolaire,mercredi_matin_debut,samedi_matin_debut"), "code_uai", "annee_scolaire")
    rpi = set(bpe["rpi"])
    log(f"écoles : {len(ann)} établissements")

    out = {"source": f"data.education.gouv.fr (annuaire, effectifs, IPS, temps scolaire, valeur ajoutée du brevet) ; {bpe['label']} (RPI)",
           "ref": {}, "com": {}}
    for row in ipse.values():  # repères départementaux pour lire l'IPS (dernière rentrée connue)
        out["ref"].setdefault(row.get("code_du_departement", "")[-2:], {
            "ips_public": num(row.get("ips_departemental_public")), "ips_prive": num(row.get("ips_departemental_prive")),
            "ips_national": num(row.get("ips_national")), "rentree": row.get("rentree_scolaire")})

    colleges, cl19 = [], {}
    for e in ann:
        uai = e["identifiant_de_l_etablissement"]
        base_ = {"uai": uai, "nom": e["nom_etablissement"], "commune": e["nom_commune"], "statut": e["statut_public_prive"],
                 "contrat": contrat(e), "cantine": bool(e.get("restauration")), "ulis": bool(e.get("ulis"))}
        if e["type_etablissement"] == "Collège":
            v = va.get(uai, {})
            ic = ipsc.get(uai, {})
            colleges.append({**base_, "lat": e.get("latitude"), "lon": e.get("longitude"),
                             "ips": num(ic.get("ips")), "eleves": num(ic.get("effectifs")),
                             "dnb": {"session": v.get("session"), "reussite": num(v.get("taux_de_reussite_g")),
                                     "va_reussite": num(v.get("va_du_taux_de_reussite_g")), "note": num(v.get("note_a_l_ecrit_g")),
                                     "va_note": num(v.get("va_de_la_note_g")), "acces_6_3": num(v.get("taux_d_acces_6eme_3eme")),
                                     "mentions_tb": v.get("nb_mentions_tb_g"), "mentions_b": v.get("nb_mentions_b_g"),
                                     "candidats": v.get("nb_candidats_g")} if v else None})
            continue
        code = arr.get(e["code_commune"], e["code_commune"])
        if code not in com:
            continue
        ef, ip, ry = eff.get(uai, {}), ipse.get(uai, {}), rythme.get(uai, {})
        c = out["com"].setdefault(code, {"ecoles": [], "rpi": code in rpi})
        c["ecoles"].append({**base_, "mat": bool(e.get("ecole_maternelle")), "elem": bool(e.get("ecole_elementaire")),
                            "classes": num(ef.get("nombre_total_classes")), "eleves": num(ef.get("nombre_total_eleves")),
                            "ips": num(ip.get("ips")), "jours": (4.5 if ry.get("mercredi_matin_debut") or ry.get("samedi_matin_debut") else 4) if ry else None})
        cl19[code] = cl19.get(code, 0) + (base.get(uai, {}).get("nombre_total_classes") or 0)

    fields = {}
    for code in sorted(com):
        ll = (com[code]["lat"], com[code]["lon"])
        c = out["com"].setdefault(code, {"ecoles": [], "rpi": code in rpi})
        # à distance égale (deux collèges à la même adresse), par nom
        near = sorted(((km(ll, (k["lat"], k["lon"])), k) for k in colleges if k.get("lat")), key=lambda x: (round(x[0], 3), x[1]["nom"]))
        # collèges les plus proches du bourg : 2 publics, 2 privés (fiche école)
        pick = [x for x in near if x[1]["statut"] == "Public"][:2] + [x for x in near if x[1]["statut"] == "Privé"][:2]
        c["colleges"] = [{**{k: v for k, v in col.items() if k not in ("lat", "lon")}, "km": round(d, 1)} for d, col in sorted(pick, key=lambda x: x[0])]
        sc = next(((d, k) for d, k in near if k["statut"] == "Privé" and k["contrat"] == "sous contrat"), None)
        if sc is not None and sc[1]["uai"] not in {x["uai"] for x in c["colleges"]}:
            c["colleges"].append({**{k: v for k, v in sc[1].items() if k not in ("lat", "lon")}, "km": round(sc[0], 1)})
        ec = c["ecoles"]
        fields[code] = {
            "cl25": round(sum(e["classes"] or 0 for e in ec)),
            "cl19": round(cl19.get(code, 0)),
            "priv": sum(1 for e in ec if e["contrat"] == "sous contrat"),
            "col": sc[1]["nom"] if sc else None, "colc": sc[1]["commune"] if sc else None,
            "colkm": round(sc[0], 1) if sc else None,
            "va": (sc[1]["dnb"] or {}).get("va_note") if sc else None,
        }
    log(f"écoles : {sum(len(c['ecoles']) for c in out['com'].values())} écoles, {len(colleges)} collèges")
    return fields, out
