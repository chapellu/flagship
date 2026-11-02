#!/usr/bin/env python3
"""Écoles et collèges → data/schools.json (fiche « École » de chaque commune).

    python3 tools/ecoles.py BPE25.zip ./data

Sources publiques (data.education.gouv.fr, INSEE) :
  fr-en-annuaire-education               écoles et collèges ouverts : public/privé, contrat, cantine, ULIS, position
  fr-en-ecoles-effectifs-nb_classes      élèves et classes par école (dernière rentrée)
  fr-en-ips-ecoles-ap2022                indice de position sociale des écoles (dernière rentrée)
  fr-en-organisation-du-temps-scolaire   semaine de 4 jours ou 4,5 jours
  fr-en-indicateurs-valeur-ajoutee-colleges  brevet : réussite, note à l'écrit, mentions, valeur ajoutée
  fr-en-ips-colleges-ap2022              IPS des collèges
  BPE25 (INSEE)                          écoles en RPI dispersé (élèves transportés d'un village à l'autre)

Il n'existe pas de classement officiel des écoles primaires : les résultats
des évaluations nationales ne sont publiés qu'au niveau départemental. L'IPS
dit qui fréquente l'école (milieu social), pas ce qu'elle apporte. Pour les
collèges, la valeur ajoutée du brevet est l'indicateur officiel de
« fait mieux ou moins bien qu'attendu, vu ses élèves ».
"""
import csv
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request
import zipfile

API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/{}/exports/json?"


def get(ds, where, select=None):
    q = {"where": where}
    if select:
        q["select"] = select
    with urllib.request.urlopen(API.format(ds) + urllib.parse.urlencode(q), timeout=180) as r:
        return json.load(r)


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


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


def main(bpe_zip, data):
    cfg = json.load(open(os.path.join(data, "config.json")))
    com = json.load(open(os.path.join(data, "communes.json")))
    F = cfg["fields"]
    communes = {r[F.index("code")]: (r[F.index("lat")], r[F.index("lon")]) for r in com["c"]}
    deps = sorted({c[:2] for c in communes})
    # selon le jeu de données, le département s'écrit « 69 » ou « 069 » : on accepte les deux
    dep = lambda f: " or ".join(f'{f}="{p}{d}"' for d in deps for p in ("", "0"))
    d3 = d2 = dep("code_departement")
    print("annuaire…", file=sys.stderr)
    ann = get("fr-en-annuaire-education", f'etat="OUVERT" and (type_etablissement="Ecole" or type_etablissement="Collège") and ({d3})')
    print(len(ann), "établissements", file=sys.stderr)
    eff = latest(get("fr-en-ecoles-effectifs-nb_classes", f"({d3})",
                     "numero_ecole,rentree_scolaire,nombre_total_classes,nombre_total_eleves"), "numero_ecole", "rentree_scolaire")
    ipse = latest(get("fr-en-ips-ecoles-ap2022", dep("code_du_departement")), "uai", "rentree_scolaire")
    ipsc = latest(get("fr-en-ips-colleges-ap2022", dep("code_du_departement")), "uai", "rentree_scolaire")
    va = latest(get("fr-en-indicateurs-valeur-ajoutee-colleges", f"({d2})"), "uai", "session")
    rythme = latest(get("fr-en-organisation-du-temps-scolaire", f"({d3})",
                        "code_uai,annee_scolaire,mercredi_matin_debut,samedi_matin_debut"), "code_uai", "annee_scolaire")

    # RPI dispersé : école partagée entre villages, donc car scolaire entre eux
    rpi = set()
    z = zipfile.ZipFile(bpe_zip)
    f = io.TextIOWrapper(z.open([n for n in z.namelist() if n.lower().endswith(".csv")][0]), encoding="utf-8", errors="replace")
    r = csv.reader(f, delimiter=";")
    h = {k: i for i, k in enumerate(next(r))}
    for row in r:
        if row[h["TYPEQU"]] in ("C107", "C108", "C109") and row[h["RPI"]] == "D":
            rpi.add(row[h["DEPCOM"]])

    out = {"source": "data.education.gouv.fr (annuaire, effectifs, IPS, temps scolaire, valeur ajoutée du brevet) ; INSEE BPE 2025 (RPI)",
           "ref": {}, "com": {}}
    # repères départementaux pour lire l'IPS (dernière rentrée connue)
    for row in ipse.values():
        out["ref"].setdefault(row.get("code_du_departement", "")[-2:], {"ips_public": num(row.get("ips_departemental_public")), "ips_prive": num(row.get("ips_departemental_prive")),
                                    "ips_national": num(row.get("ips_national")), "rentree": row.get("rentree_scolaire")})

    colleges = []
    for e in ann:
        uai = e["identifiant_de_l_etablissement"]
        base = {"uai": uai, "nom": e["nom_etablissement"], "commune": e["nom_commune"], "statut": e["statut_public_prive"],
                "contrat": contrat(e), "cantine": bool(e.get("restauration")), "ulis": bool(e.get("ulis"))}
        if e["type_etablissement"] == "Collège":
            v = va.get(uai, {})
            ic = ipsc.get(uai, {})
            colleges.append({**base, "lat": e.get("latitude"), "lon": e.get("longitude"),
                             "ips": num(ic.get("ips")), "eleves": num(ic.get("effectifs")),
                             "dnb": {"session": v.get("session"), "reussite": num(v.get("taux_de_reussite_g")),
                                     "va_reussite": num(v.get("va_du_taux_de_reussite_g")), "note": num(v.get("note_a_l_ecrit_g")),
                                     "va_note": num(v.get("va_de_la_note_g")), "acces_6_3": num(v.get("taux_d_acces_6eme_3eme")),
                                     "mentions_tb": v.get("nb_mentions_tb_g"), "mentions_b": v.get("nb_mentions_b_g"),
                                     "candidats": v.get("nb_candidats_g")} if v else None})
            continue
        if e["code_commune"] not in communes:
            continue
        ef, ip, ry = eff.get(uai, {}), ipse.get(uai, {}), rythme.get(uai, {})
        c = out["com"].setdefault(e["code_commune"], {"ecoles": [], "rpi": e["code_commune"] in rpi})
        c["ecoles"].append({**base, "mat": bool(e.get("ecole_maternelle")), "elem": bool(e.get("ecole_elementaire")),
                            "classes": num(ef.get("nombre_total_classes")), "eleves": num(ef.get("nombre_total_eleves")),
                            "ips": num(ip.get("ips")), "jours": (4.5 if ry.get("mercredi_matin_debut") or ry.get("samedi_matin_debut") else 4) if ry else None})

    # collèges les plus proches du bourg : 2 publics, 2 privés
    for code, ll in communes.items():
        c = out["com"].setdefault(code, {"ecoles": [], "rpi": code in rpi})
        near = sorted(((km(ll, (k["lat"], k["lon"])), k) for k in colleges if k.get("lat")), key=lambda x: x[0])
        pick = [x for x in near if x[1]["statut"] == "Public"][:2] + [x for x in near if x[1]["statut"] == "Privé"][:2]
        c["colleges"] = [{**{k: v for k, v in col.items() if k not in ("lat", "lon")}, "km": round(d, 1)} for d, col in sorted(pick, key=lambda x: x[0])]

    with open(os.path.join(data, "schools.json"), "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"écrit schools.json : {sum(len(c['ecoles']) for c in out['com'].values())} écoles, {len(colleges)} collèges", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
