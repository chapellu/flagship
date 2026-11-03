"""Alertes e-mail Leboncoin / SeLoger (et Logic-Immo), lues dans une boîte IMAP.

Ces sites bloquent la lecture automatique (DataDome, robots.txt). La voie
propre : les alertes de recherche que l'on reçoit soi-même par e-mail. On les
fait arriver (directement ou par transfert) dans une boîte dédiée, que ce
module lit en IMAP, sans rien marquer comme lu (BODY.PEEK).

Deux façons de recevoir les e-mails :
- boîte à nous : le serveur mailin (apps/mailin) reçoit l'adresse dédiée
  sur in.chapellu.fr et dépose un fichier .eml par message dans le volume
  terrain-inbox, monté ici en TERRAIN_INBOX. Les fichiers de plus de 60 jours
  sont supprimés ;
- boîte IMAP (Gmail…) : TERRAIN_MAIL_USER / TERRAIN_MAIL_PASSWORD (Secret
  terrain-mail), serveur search.alertes.imap (défaut imap.gmail.com).
Sans l'un ni l'autre, la source est ignorée (SkipSource), pas en panne.

Une alerte ne dit pas quand l'annonce disparaît : le relevé n'est jamais
« complet », donc rien n'est marqué parti. La date de l'e-mail sert de date de
mise en ligne (les alertes portent sur des annonces nouvelles).
"""
import email
import email.utils
import html
import imaplib
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from refresh import UA, SkipSource, is_constructeur, norm

NAME = "alertes"
DAYS = 30
SENDERS = ("leboncoin", "seloger", "logic-immo")

# Liens d'annonce, une fois décodés. Leboncoin : /ad/<catégorie>/<id> ou
# /<catégorie>/<id>.htm ; SeLoger/Logic-Immo : /annonces/…/<id>.htm ou /detail/<id>.
AD_URL = re.compile(
    r"https?://(?:www\.)?(?P<site>leboncoin|seloger|logic-immo)\.(?:fr|com)/"
    r"(?:ad/[a-z_]+/(?P<lbc>\d{8,12})|[a-z_]+/(?P<lbc2>\d{8,12})\.htm"
    r"|annonces/[^\s\"'<>]*?/(?P<slg>\d{6,12})\.htm|detail/(?P<slg2>[\w-]{6,40}))", re.I)
PRICE = re.compile(r"(\d{1,3}(?:[\s  .]\d{3})+|\d{4,7})\s*(?:€|&euro;|eur\b)", re.I)
SURF = re.compile(r"(\d{1,3}(?:[\s  .]\d{3})+|\d{2,6})\s*m(?:²|2|&sup2;)", re.I)
PLACE = re.compile(r"([A-ZÀ-Ý][\w'’ \-]{1,60}?)\s*\(?\s*(\d{5})\s*\)?")


def _num(s):
    return int(re.sub(r"\D", "", s))


def _text(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</(p|div|td|tr|li|h\d)>", "\n", h)
    return html.unescape(re.sub(r"<[^>]+>", " ", h))


def _resolve(url):
    """Lien de suivi (redirection) → URL réelle, sans charger la page cible."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    try:
        op = urllib.request.build_opener(NoRedirect)
        op.open(urllib.request.Request(url, headers={"User-Agent": UA}, method="HEAD"), timeout=15)
    except urllib.error.HTTPError as e:
        return e.headers.get("Location") or url
    except Exception:
        return url
    return url


def _decode(u):
    """Les liens d'e-mail sont souvent encodés dans un paramètre (url=, u=, …)."""
    for _ in range(3):
        m = re.search(r"https?%3A%2F%2F[^&\"'\s]+", u)
        if not m:
            break
        u = urllib.parse.unquote(m.group(0))
    return html.unescape(u)


def parse_mail(body_html, communes, index, resolve=True):
    """Annonces d'un e-mail d'alerte. Chaque annonce = son bloc dans l'e-mail : du
    premier lien vers elle jusqu'au premier lien vers l'annonce suivante. Le texte
    (prix, surface, commune) n'est cherché que là, jamais chez les voisines."""
    hits = []  # (position du lien, clé, url, site)
    for lm in re.finditer(r"""href\s*=\s*["']([^"']+)["']""", body_html, re.I):
        raw = lm.group(1)
        u = _decode(raw)
        m = AD_URL.search(u)
        if not m and resolve and re.search(r"leboncoin|seloger|logic-immo", raw, re.I):
            m = AD_URL.search(_decode(_resolve(html.unescape(raw))))
        if not m:
            continue
        site = m.group("site").lower()
        aid = m.group("lbc") or m.group("lbc2") or m.group("slg") or m.group("slg2")
        hits.append((lm.start(), f"{'leboncoin' if site == 'leboncoin' else 'seloger'}-{aid}", m.group(0).split("?")[0], site))
    out = {}
    starts = []  # début du bloc de chaque annonce, dans l'ordre
    for pos, key, url, site in hits:
        if not starts or starts[-1][1] != key:
            starts.append((pos, key, url, site))
    for n, (pos, key, url, site) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(body_html)
        block = _text(body_html[pos:end])
        prix, surf = PRICE.search(block), SURF.search(block)
        insee = None
        for name, cp in PLACE.findall(block):
            insee = index.get((norm(name), cp[:2]))
            if insee:
                break
        if key in out and (out[key]["prix"] or not prix):
            continue  # même annonce citée deux fois : on garde la version la plus complète
        c = communes.get(insee) or {}
        txt = " ".join(block.split())
        out[key] = {
            "id": f"{NAME}:{key}", "src": NAME, "url": url,
            "insee": insee, "commune": c.get("nom"), "lat": c.get("lat"), "lon": c.get("lon"), "pos": "commune",
            "prix": _num(prix.group(1)) if prix else None, "m2": _num(surf.group(1)) if surf else None,
            "titre": txt[:140] or None, "desc": txt[:600],
            "vendeur": "leboncoin" if site == "leboncoin" else site,
            "constructeur": is_constructeur(txt), "photo": None, "published": None,
        }
    return list(out.values())


KEEP_DAYS = 60


def inbox_messages(path):
    """Messages déposés par mailin (fichiers .eml) ; purge des plus vieux."""
    now = datetime.now(timezone.utc).timestamp()
    for e in sorted(os.scandir(path), key=lambda e: e.name):
        if not e.is_file() or not e.name.endswith(".eml"):
            continue
        age = (now - e.stat().st_mtime) / 86400
        if age > KEEP_DAYS:
            os.remove(e.path)
            continue
        if age <= DAYS:
            with open(e.path, "rb") as f:
                yield f.read()


def imap_messages(host, user, pwd):
    since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).strftime("%d-%b-%Y")
    with imaplib.IMAP4_SSL(host, timeout=60) as M:
        M.login(user, pwd)
        M.select("INBOX", readonly=True)
        _, data = M.search(None, "SINCE", since)
        for num in (data[0] or b"").split():
            _, msg = M.fetch(num, "(BODY.PEEK[])")
            yield msg[0][1]


def fetch(search, communes):
    inbox = os.environ.get("TERRAIN_INBOX")
    user, pwd = os.environ.get("TERRAIN_MAIL_USER"), os.environ.get("TERRAIN_MAIL_PASSWORD")
    if inbox and os.path.isdir(inbox):
        raws = inbox_messages(inbox)
    elif user and pwd:
        raws = imap_messages((search.get("alertes") or {}).get("imap", "imap.gmail.com"), user, pwd)
    else:
        raise SkipSource("boîte d'alertes non configurée")
    index = {(norm(c["nom"]), code[:2]): code for code, c in communes.items()}
    ads = {}
    for raw in raws:
        m = email.message_from_bytes(raw)
        if not any(s in (m.get("From", "") + m.get("Subject", "")).lower() or s in str(m).lower()[:20000] for s in SENDERS):
            continue
        day = None
        if m.get("Date"):
            try:
                day = email.utils.parsedate_to_datetime(m["Date"]).date().isoformat()
            except (TypeError, ValueError):
                pass
        for part in m.walk():
            if part.get_content_type() != "text/html":
                continue
            body = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
            for a in parse_mail(body, communes, index):
                a["published"] = min(filter(None, [a["published"], day]), default=None)
                old = ads.get(a["id"])
                if not old or (a["prix"] and not old["prix"]):
                    ads[a["id"]] = a
                elif old and day and old["published"] and day < old["published"]:
                    old["published"] = day
    return list(ads.values()), False
