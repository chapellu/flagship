#!/usr/bin/env python3
"""Suivi partagé des annonces et des parcelles : avis de chacun, étape de la prise
de contact, journal daté. Bibliothèque standard seule.

    GET  /api/suivi   → {"me": "A" | "B" | null, "items": {clé: fiche}}
    POST /api/suivi   {"key": …, "op": "avis" | "etape" | "note" | "vu", "v": …, "txt": …, "snap": {…}}
                      → {"me": …, "key": …, "item": fiche}

Fiche : {"avis": {"A": "aime" | "non"}, "vu": {"A": "2026-11-07"}, "etape": "contacte",
         "journal": [{"t": iso, "qui": "A", "txt": … | "etape": … | "avis": …}],
         "snap": {titre, commune, prix, m2, url, …}, "maj": iso}

Qui parle : l'e-mail du jeton Google (cookie terrain-id-token) que la passerelle
Envoy a déjà vérifié (SecurityPolicy terrain-oidc : seuls OWNER_EMAIL et
PARTNER_EMAIL passent). OWNER_EMAIL est la personne A (1re de config.people),
PARTNER_EMAIL la B. Le service n'est joignable que par la passerelle (HTTPRoute
terrain, règle /api/suivi).

Le fichier SUIVI_FILE est réécrit en entier à chaque changement (écriture atomique),
sous un verrou : les deux personnes peuvent cliquer en même temps sans s'écraser,
puisque chaque requête ne change qu'une fiche.
"""
import base64
import datetime as dt
import json
import os
import tempfile
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FILE = os.environ.get("SUIVI_FILE", "/suivi/suivi.json")
PEOPLE = {e.strip().lower(): k for k, e in (("A", os.environ.get("OWNER_EMAIL", "")), ("B", os.environ.get("PARTNER_EMAIL", ""))) if e.strip()}
DEV = os.environ.get("SUIVI_DEV_ME")  # tests en local : identité forcée
ETAPES = ("a_contacter", "contacte", "reponse", "visite", "visite_faite", "offre", "abandon")
AVIS = ("aime", "non")
SNAP_KEYS = ("t", "titre", "commune", "prix", "m2", "url", "photo", "lat", "lon", "id")
MAX_BODY = 32 * 1024
LOCK = threading.Lock()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d.get("items"), dict) else {"items": {}}
    except FileNotFoundError:
        return {"items": {}}


def save(d):
    folder = os.path.dirname(FILE) or "."
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".suivi.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, FILE)
    except BaseException:
        os.unlink(tmp)
        raise


def who(headers):
    if DEV:
        return DEV
    c = SimpleCookie()
    try:
        c.load(headers.get("Cookie") or "")
        tok = c["terrain-id-token"].value
        body = tok.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:
        return None
    return PEOPLE.get(str(claims.get("email", "")).lower())


def apply(d, key, op, me, body):
    it = d["items"].get(key) or {"avis": {}, "vu": {}, "journal": []}
    t = now()
    snap = body.get("snap")
    if isinstance(snap, dict):
        it["snap"] = {k: snap[k] for k in SNAP_KEYS if k in snap and isinstance(snap[k], (str, int, float))}
    if op == "vu":
        it["vu"].setdefault(me, t[:10])
        d["items"][key] = it
        return it
    elif op == "avis":
        v = body.get("v")
        if v not in AVIS + (None,):
            raise ValueError("avis inconnu")
        if it["avis"].get(me) == v:
            d["items"][key] = it
            return it
        if v is None:
            it["avis"].pop(me, None)
        else:
            it["avis"][me] = v
            it["vu"].setdefault(me, t[:10])
        it["journal"].append({"t": t, "qui": me, "avis": v})
    elif op == "etape":
        v = body.get("v")
        if v not in ETAPES + (None,):
            raise ValueError("étape inconnue")
        if it.get("etape") == v:
            d["items"][key] = it
            return it
        if v is None:
            it.pop("etape", None)
        else:
            it["etape"] = v
        it["journal"].append({"t": t, "qui": me, "etape": v})
    elif op == "note":
        txt = str(body.get("txt") or "").strip()[:2000]
        if not txt:
            raise ValueError("note vide")
        it["journal"].append({"t": t, "qui": me, "txt": txt})
    else:
        raise ValueError("opération inconnue")
    it["maj"] = t
    d["items"][key] = it
    return it


class H(BaseHTTPRequestHandler):
    server_version = "terrain-suivi"

    def send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/healthz":
            return self.send(200, {"ok": True})
        if self.path.split("?")[0] != "/api/suivi":
            return self.send(404, {"err": "inconnu"})
        with LOCK:
            d = load()
        self.send(200, {"me": who(self.headers), "items": d["items"]})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/suivi":
            return self.send(404, {"err": "inconnu"})
        me = who(self.headers)
        if not me:
            return self.send(403, {"err": "personne inconnue"})
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX_BODY:
            return self.send(413, {"err": "requête trop grande"})
        try:
            body = json.loads(self.rfile.read(n))
            key = body.get("key")
            if not isinstance(key, str) or not 0 < len(key) <= 300:
                raise ValueError("clé invalide")
            with LOCK:
                d = load()
                it = apply(d, key, body.get("op"), me, body)
                save(d)
        except (ValueError, json.JSONDecodeError) as e:
            return self.send(400, {"err": str(e)})
        self.send(200, {"me": me, "key": key, "item": it})

    def log_message(self, fmt, *args):  # pas d'e-mail ni de cookie dans les journaux
        print(f"{self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}", flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"suivi : {FILE}, {len(PEOPLE)} personnes, port {port}", flush=True)
    ThreadingHTTPServer(("", port), H).serve_forever()
