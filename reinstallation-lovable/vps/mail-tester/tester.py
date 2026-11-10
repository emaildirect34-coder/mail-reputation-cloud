import asyncio
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import subprocess
import time
from contextlib import asynccontextmanager, closing
from email import policy
from email.parser import BytesParser
from urllib.request import Request, urlopen

import dns.resolver
import dns.reversename
from aiosmtpd.controller import Controller
from fastapi import FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from advanced import advanced_checks

DOMAIN = os.environ["MAIL_DOMAIN"].lower()
TOKEN = os.environ["API_TOKEN"].encode()
if len(TOKEN) < 32:
    raise RuntimeError("API_TOKEN must contain at least 32 characters")
DB_PATH = os.getenv("DB_PATH", "tests.sqlite")
TTL = 7 * 86400
ID = re.compile(r"[0-9a-f]{32}")
bearer = HTTPBearer(auto_error=False)


def db():
    return closing(sqlite3.connect(DB_PATH, timeout=10))


def authorize(credentials: HTTPAuthorizationCredentials | None = Security(bearer)):
    if not credentials or not hmac.compare_digest(credentials.credentials.encode(), TOKEN):
        raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})


def test_id(address):
    local, _, domain = address.lower().rpartition("@")
    candidate = local.removeprefix("test-")
    if domain == DOMAIN and local.startswith("test-") and ID.fullmatch(candidate):
        return candidate
    return None


class Sink:
    async def handle_RCPT(self, server, session, envelope, address, options):
        with db() as conn:
            row = conn.execute(
                "SELECT 1 FROM tests WHERE id=? AND raw IS NULL AND result IS NULL",
                (test_id(address),),
            ).fetchone()
        if not row:
            return "550 5.1.1 No waiting test at this address"
        if len(envelope.rcpt_tos) >= 5:
            return "452 4.5.3 Too many recipients"
        envelope.rcpt_tos.append(address)
        return "250 2.1.5 OK"

    async def handle_DATA(self, server, session, envelope):
        with db() as conn, conn:
            conn.executemany(
                """UPDATE tests SET raw=?, ip=?, sender=?, helo=?, expires=?
                   WHERE id=? AND raw IS NULL AND result IS NULL""",
                [
                    (envelope.original_content, session.peer[0], envelope.mail_from,
                     session.host_name, time.time() + TTL, test_id(address))
                    for address in envelope.rcpt_tos
                ],
            )
        return "250 2.0.0 Queued"


def scan(identifier, raw, ip, sender, helo):
    message = BytesParser(policy=policy.default).parsebytes(raw)
    checks = {}
    penalties = []

    def check(name, passed, detail, fix=None, points=0, **extra):
        checks[name] = {"pass": passed, "detail": detail, **extra}
        if not passed:
            checks[name]["fix"] = fix
            if points:
                penalties.append({"rule": name.upper(), "points": -points,
                                  "description": detail, "fix": fix})

    request = Request(os.environ["RSPAMD_URL"], data=raw, headers={
        "IP": ip, "From": sender, "Helo": helo or "",
        "Rcpt": f"test-{identifier}@{DOMAIN}", "Content-Type": "application/octet-stream",
    })
    try:
        with urlopen(request, timeout=20) as response:
            rspamd = json.load(response)
        symbols = rspamd["symbols"]
        score = float(rspamd["score"])
        check("rspamd", score < float(rspamd["required_score"]),
              ", ".join(sorted(symbols)), "Corrigez les symboles signalés par Rspamd.",
              points=2, score=score)
    except (OSError, ValueError, KeyError, TypeError):
        symbols = None
        check("rspamd", False, "Analyse indisponible",
              "Vérifiez le service Rspamd sur le port interne 11333, puis relancez un test.")

    for name, symbol, fix, points in [
        ("spf", "R_SPF_ALLOW", f"Autorisez {ip} dans l’unique TXT SPF du domaine MAIL FROM.", 1.5),
        ("dkim", "R_DKIM_ALLOW", "Signez avec DKIM et publiez la clé publique du sélecteur dans <s>._domainkey.<d>.", 1.5),
        ("dmarc", "DMARC_POLICY_ALLOW", "Alignez le domaine From avec un domaine DKIM ou SPF validé et publiez le TXT _dmarc.", 2),
        ("arc", "ARC_ALLOW", "Pour un relais, scellez ARC-Authentication-Results, ARC-Message-Signature et ARC-Seal.", 0),
    ]:
        if symbols is None:
            check(name, False, "Analyse indisponible", "Rétablissez Rspamd puis envoyez un nouveau test.")
            continue
        result = symbols.get(symbol)
        details = result.get("options", []) if result else []
        check(name, bool(result), ", ".join(details) or
              (symbol if result else "Validation absente"), fix, points)

    try:
        response = subprocess.run(
            ["spamc", "-x", "-c", "-d", os.environ["SPAMD_HOST"], "-t", "15", "-s", "5242880"],
            input=raw, capture_output=True, timeout=20,
        )
        if response.returncode not in (0, 1):
            raise ValueError("spamc failed")
        score, threshold = map(float, response.stdout.decode("ascii").strip().split("/"))
        if threshold <= 0:
            raise ValueError("invalid threshold")
        check("spamassassin", score < threshold, f"Seuil {threshold:g}",
              "Lancez spamc -R sur le message et corrigez les règles positives du rapport.",
              points=2, score=score)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        check("spamassassin", False, "Analyse indisponible",
              "Vérifiez le service spamd sur le port interne 783, puis relancez un test.")

    try:
        resolver = dns.resolver.Resolver()
        ptr = resolver.resolve(dns.reversename.from_address(ip), "PTR", lifetime=3)
        record = "AAAA" if ipaddress.ip_address(ip).version == 6 else "A"
        confirmed = []
        for answer in list(ptr)[:5]:
            host = str(answer.target)
            try:
                if ipaddress.ip_address(ip) in {
                    ipaddress.ip_address(item.address)
                    for item in resolver.resolve(host, record, lifetime=2)
                }:
                    confirmed.append(host)
            except dns.exception.DNSException:
                continue
        check("rdns", bool(confirmed), ", ".join(confirmed) or "FCrDNS absent",
              f"Configurez le PTR de {ip} vers votre hôte SMTP et faites pointer son {record} vers {ip}.", 1)
    except (dns.exception.DNSException, ValueError):
        check("rdns", False, "PTR absent ou résolution indisponible",
              f"Vérifiez le PTR de {ip} chez votre hébergeur et l’enregistrement direct correspondant.", 1)

    defects = [type(defect).__name__ for part in message.walk() for defect in part.defects]
    check("mime", not defects, ", ".join(defects) or "Structure MIME analysée",
          "Régénérez Content-Type, les délimiteurs multipart et Content-Transfer-Encoding avec votre bibliothèque MIME.", 1)

    advanced_checks(raw, message, ip, sender, helo, checks, check)
    for penalty in penalties:
        penalty["fix"] = checks[penalty["rule"].lower()]["fix"]

    headers = re.split(rb"\r?\n\r?\n", raw, maxsplit=1)[0]
    return {"status": "done", "score": round(max(0, 10 + sum(p["points"] for p in penalties)), 1),
            "checks": checks, "penalties": penalties, "headers": headers.decode("utf-8", "replace")}


def analyze_pending():
    with db() as conn, conn:
        conn.execute("DELETE FROM tests WHERE expires<? AND raw IS NULL", (time.time(),))
        pending = conn.execute(
            "SELECT id, raw, ip, sender, helo FROM tests WHERE raw IS NOT NULL LIMIT 1"
        ).fetchone()
    if pending is None:
        return False
    result = scan(*pending)
    with db() as conn, conn:
        conn.execute("UPDATE tests SET raw=NULL, result=?, expires=? WHERE id=?",
                     (json.dumps(result), time.time() + TTL, pending[0]))
    return True


async def worker():
    while True:
        try:
            if await asyncio.to_thread(analyze_pending):
                continue
        except Exception:
            # Keep queued messages available for retry without logging their contents.
            await asyncio.sleep(10)
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app):
    with db() as conn, conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""CREATE TABLE IF NOT EXISTS tests (
            id TEXT PRIMARY KEY, expires REAL NOT NULL, raw BLOB,
            ip TEXT, sender TEXT, helo TEXT, result TEXT
        )""")
    smtp = Controller(Sink(), hostname="0.0.0.0", port=2525,
                      data_size_limit=5 * 1024 * 1024, timeout=60)
    smtp.start()
    task = asyncio.create_task(worker())
    try:
        yield
    finally:
        task.cancel()
        smtp.stop()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.post("/api/v1/tests", status_code=201, dependencies=[Security(authorize)])
def create_test():
    identifier = secrets.token_hex(16)
    with db() as conn, conn:
        conn.execute("INSERT INTO tests (id, expires) VALUES (?, ?)",
                     (identifier, time.time() + TTL))
    return {"test_id": identifier, "email": f"test-{identifier}@{DOMAIN}"}


@app.get("/api/v1/tests/{identifier}", dependencies=[Security(authorize)])
def get_test(identifier: str):
    with db() as conn:
        row = conn.execute(
            "SELECT result FROM tests WHERE id=? AND (expires>? OR raw IS NOT NULL)",
            (identifier, time.time()),
        ).fetchone()
    if row is None:
        raise HTTPException(404)
    return json.loads(row[0]) if row[0] else {"status": "waiting"}
