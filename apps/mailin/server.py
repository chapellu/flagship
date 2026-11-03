#!/usr/bin/env python3
"""mailin — serveur SMTP de réception, minimal, pour les alertes terrain.

Reçoit les e-mails d'UNE seule adresse (MAILIN_ADDRESS, gardée dans un Secret
chiffré, jamais dans le dépôt) et les dépose, un fichier .eml par message,
dans MAILIN_DIR (volume terrain-inbox, lu chaque matin par le relevé). Tout
autre destinataire est refusé dès RCPT TO : ce n'est pas un relais.

Exposé à Internet sur le port 25 (enregistrement MX de in.chapellu.fr), donc :
- aiosmtpd (bibliothèque maintenue) plutôt qu'un protocole écrit à la main ;
- taille de message plafonnée, délai d'inactivité court ;
- boîte plafonnée (nombre et poids) : au-delà, refus temporaire 452 ;
- STARTTLS si le certificat (cert-manager) est présent ; sinon en clair, comme
  le permet SMTP entre serveurs. Le pod redémarre quand le certificat change.
- aucun contenu de message dans les journaux.
"""
import logging
import os
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP

ADDRESS = os.environ.get("MAILIN_ADDRESS", "").strip().lower()
DIR = os.environ.get("MAILIN_DIR", "/inbox")
PORT = int(os.environ.get("MAILIN_PORT", "2525"))
HOSTNAME = os.environ.get("MAILIN_HOSTNAME", "localhost")
CERT = os.environ.get("MAILIN_CERT", "/tls/tls.crt")
KEY = os.environ.get("MAILIN_KEY", "/tls/tls.key")
MAX_SIZE = int(os.environ.get("MAILIN_MAX_SIZE", str(3 * 1024 * 1024)))   # par message
MAX_FILES = int(os.environ.get("MAILIN_MAX_FILES", "2000"))               # dans la boîte
MAX_BYTES = int(os.environ.get("MAILIN_MAX_BYTES", str(300 * 1024 * 1024)))

log = logging.getLogger("mailin")


def inbox_full():
    n = size = 0
    with os.scandir(DIR) as it:
        for e in it:
            if e.is_file():
                n += 1
                size += e.stat().st_size
    return n >= MAX_FILES or size >= MAX_BYTES


class Handler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        if address.strip().lower() != ADDRESS:
            log.info("refus RCPT de %s", session.peer[0])
            return "550 5.1.1 Mailbox unavailable"
        if envelope.rcpt_tos:  # une seule adresse acceptée : pas besoin de plus
            return "452 4.5.3 Too many recipients"
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(self, server, session, envelope):
        if inbox_full():
            log.warning("boîte pleine, message refusé temporairement")
            return "452 4.2.2 Mailbox full"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        name = f"{stamp}-{uuid.uuid4().hex[:12]}.eml"
        tmp = os.path.join(DIR, "." + name)
        data = envelope.original_content or envelope.content
        if isinstance(data, str):
            data = data.encode("utf-8", "replace")
        with open(tmp, "wb") as f:
            f.write(data)
        os.chmod(tmp, 0o640)
        os.replace(tmp, os.path.join(DIR, name))  # atomique : le relevé ne lit jamais un fichier à moitié écrit
        log.info("reçu %s (%d octets) de %s", name, len(data), session.peer[0])
        return "250 Message accepted"


def tls_context():
    if not (os.path.exists(CERT) and os.path.exists(KEY)):
        log.warning("pas de certificat : STARTTLS désactivé")
        return None
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(CERT, KEY)
    return ctx


def watch_cert():
    """cert-manager renouvelle le certificat : on redémarre pour le recharger."""
    def mtime():
        try:
            return os.stat(CERT).st_mtime
        except OSError:
            return None
    first = mtime()
    while True:
        time.sleep(600)
        if mtime() != first:
            log.info("certificat changé : redémarrage")
            os._exit(0)


class Mailin(Controller):
    def factory(self):
        return SMTP(self.handler, hostname=HOSTNAME, data_size_limit=MAX_SIZE,
                    tls_context=self.ssl_ctx, require_starttls=False, timeout=60,
                    enable_SMTPUTF8=True, ident="mailin",
                    # réception seulement : aucune authentification proposée
                    auth_exclude_mechanism=["LOGIN", "PLAIN"])


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    # le journal d'aiosmtpd écrit les adresses : l'adresse acceptée ne doit pas fuiter dans les logs
    logging.getLogger("mail.log").setLevel(logging.WARNING)
    if "@" not in ADDRESS:
        sys.exit("MAILIN_ADDRESS manquant")
    os.makedirs(DIR, exist_ok=True)
    c = Mailin(Handler(), hostname="0.0.0.0", port=PORT)
    c.ssl_ctx = tls_context()
    c.start()
    log.info("en écoute sur %d (STARTTLS %s), une seule adresse acceptée", PORT, "oui" if c.ssl_ctx else "non")
    threading.Thread(target=watch_cert, daemon=True).start()
    try:
        threading.Event().wait()
    finally:
        c.stop()


if __name__ == "__main__":
    main()
