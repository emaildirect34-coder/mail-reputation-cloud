"""Gmail seed management and placement endpoints for the existing Mail-Tester."""
import asyncio
import imaplib
import os
import re
import secrets
import ssl
import time
from contextlib import asynccontextmanager, contextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path

import yaml
from cryptography.fernet import Fernet
from fastapi import HTTPException, Security
from pydantic import BaseModel, SecretStr

from tester import app, authorize, db
import report_v2  # Registers the versioned SMTP report on the shared app.

cipher = Fernet(os.environ["PLACEMENT_KEY"])
auth = [Security(authorize)]
base = "/api/v1/placement"
gmail = re.compile(r"[a-z0-9][a-z0-9.+_-]{0,62}@gmail\.com")
folder_pattern = re.compile(rb'^\(([^)]*)\)\s+(?:"[^"]*"|NIL)\s+(.+)$')


class SeedInput(BaseModel):
    address: str
    password: SecretStr


@contextmanager
def mailbox(address, password, host="imap.gmail.com", port=993, username=None):
    with imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=8) as client:
        client.login(username or address, password)
        yield client


def accounts(conn):
    result = {address: dict(provider="Gmail", password=cipher.decrypt(password).decode(), google=True)
              for address, password in conn.execute("SELECT address,password FROM placement_accounts")}
    path = Path(os.getenv("PLACEMENT_SEEDS_FILE", "/etc/mailtester/seeds.yml"))
    if path.exists():
        try:
            config = yaml.safe_load(path.read_text(encoding="utf-8")) or []
            if not isinstance(config, list) or len(config) > 20:
                raise ValueError()
            for entry in config:
                address = entry["address"].strip().lower()
                provider = entry["provider"].strip()
                host = entry["host"].strip()
                port = int(entry.get("port", 993))
                if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", address) or not provider or not host or not 0 < port < 65536 or not isinstance(entry["password"], str):
                    raise ValueError()
                result[address] = dict(provider=provider, password=entry["password"], host=host,
                                       port=port, username=entry.get("username"),
                                       google=host == "imap.gmail.com", spam=entry.get("spam_folder"),
                                       other=entry.get("other_folder"))
        except (KeyError, TypeError, ValueError, AttributeError, OSError, yaml.YAMLError):
            raise HTTPException(503, "Configuration des boîtes témoins du VPS invalide.") from None
    return result


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def initialize():
    with db() as conn, conn:
        conn.execute("CREATE TABLE IF NOT EXISTS placement_accounts (address TEXT PRIMARY KEY, password BLOB NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS placement_tests (id TEXT PRIMARY KEY, token TEXT NOT NULL, deadline REAL NOT NULL)")
        conn.execute("""CREATE TABLE IF NOT EXISTS placement_results (
            test_id TEXT NOT NULL, address TEXT NOT NULL, placement TEXT NOT NULL DEFAULT 'pending',
            folder TEXT, received_at TEXT, PRIMARY KEY(test_id, address))""")
        if not any(row[1] == "provider" for row in conn.execute("PRAGMA table_info(placement_results)")):
            conn.execute("ALTER TABLE placement_results ADD COLUMN provider TEXT NOT NULL DEFAULT 'Gmail'")


@app.get(base + "/seeds", dependencies=auth)
def list_seeds():
    with db() as conn:
        return [{"address": row[0]} for row in conn.execute("SELECT address FROM placement_accounts ORDER BY address")]


@app.put(base + "/seeds", dependencies=auth)
def save_seed(seed: SeedInput):
    address = seed.address.strip().lower()
    password = seed.password.get_secret_value().replace(" ", "")
    if not gmail.fullmatch(address) or not re.fullmatch(r"[a-zA-Z0-9]{16}", password):
        raise HTTPException(400, "Adresse Gmail ou mot de passe d’application invalide.")
    try:
        with mailbox(address, password) as client:
            if client.select("INBOX", readonly=True)[0] != "OK":
                raise imaplib.IMAP4.error("INBOX unavailable")
    except (OSError, imaplib.IMAP4.error):
        raise HTTPException(422, "Connexion Gmail IMAP refusée ou indisponible.") from None
    with db() as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        count = conn.execute("SELECT count(*) FROM placement_accounts WHERE address<>?", (address,)).fetchone()[0]
        if count >= 20:
            raise HTTPException(409, "Limite de 20 boîtes témoins atteinte.")
        conn.execute("INSERT OR REPLACE INTO placement_accounts VALUES (?, ?)", (address, cipher.encrypt(password.encode())))
    return {"address": address}


@app.delete(base + "/seeds/{address}", dependencies=auth)
def delete_seed(address: str):
    with db() as conn, conn:
        conn.execute("DELETE FROM placement_accounts WHERE address=?", (address,))
        conn.execute("UPDATE placement_results SET placement='missing' WHERE address=? AND placement='pending'", (address,))
    return {"ok": True}


def results(conn, identifier):
    rows = conn.execute("SELECT address,placement,folder,received_at,provider FROM placement_results WHERE test_id=? ORDER BY address", (identifier,))
    return [dict(provider=provider, address=a, placement=p, folder=f, received_at=t) for a, p, f, t, provider in rows]


@app.post(base, status_code=201, dependencies=auth)
def create_placement():
    identifier, token, deadline = secrets.token_hex(16), "ED-" + secrets.token_hex(5).upper(), time.time() + 900
    with db() as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        seeds = accounts(conn)
        if not seeds:
            raise HTTPException(409, "Ajoutez une boîte témoin Gmail dans Paramètres.")
        if len(seeds) > 20:
            raise HTTPException(409, "Limite de 20 boîtes témoins atteinte.")
        if conn.execute("SELECT count(*) FROM placement_tests WHERE deadline>?", (time.time(),)).fetchone()[0] >= 30:
            raise HTTPException(429, "Trop de tests récents. Réessayez dans quelques minutes.")
        conn.execute("INSERT INTO placement_tests VALUES (?, ?, ?)", (identifier, token, deadline))
        conn.executemany("INSERT INTO placement_results(test_id,address,provider) VALUES (?,?,?)",
                         [(identifier, address, seed["provider"]) for address, seed in seeds.items()])
        return dict(id=identifier, token=token, expires_at=iso(deadline), seeds=results(conn, identifier))


@app.get(base + "/{identifier}", dependencies=auth)
def get_placement(identifier: str):
    with db() as conn, conn:
        row = conn.execute("SELECT token,deadline FROM placement_tests WHERE id=?", (identifier,)).fetchone()
        if not row or row[1] < time.time() - 7 * 86400:
            raise HTTPException(404)
        if row[1] <= time.time():
            conn.execute("UPDATE placement_results SET placement='missing' WHERE test_id=? AND placement='pending'", (identifier,))
        seeds = results(conn, identifier)
        return dict(id=identifier, token=row[0], expires_at=iso(row[1]),
                    status="waiting" if any(s["placement"] == "pending" for s in seeds) else "done", seeds=seeds)


def inspect_seed(address, seed, pending):
    with mailbox(address, seed["password"], seed.get("host", "imap.gmail.com"), seed.get("port", 993), seed.get("username")) as client:
        status, entries = client.list()
        if status != "OK":
            return
        folders = []
        for key, placement in (("spam", "spam"), ("other", "promotions")):
            if seed.get(key):
                folders.append((client._quote(seed[key]).encode("ascii"), placement))
        for entry in entries:
            match = folder_pattern.fullmatch(entry or b"")
            if match and b"\\Spam" in match[1].split():
                folders.append((match[2], "spam"))
        folders.append((b"INBOX", "inbox"))
        for folder, placement in folders:
            if not pending or client.select(folder, readonly=True)[0] != "OK":
                continue
            for identifier, token in tuple(pending.items()):
                status, hits = client.uid("SEARCH", None, "OR", "SUBJECT", token, "BODY", token)
                if status != "OK" or not hits or not hits[0]:
                    continue
                uid = hits[0].split()[-1]
                status, metadata = client.uid("FETCH", uid, "(INTERNALDATE)")
                if status != "OK":
                    continue
                info = b" ".join(item for item in metadata if isinstance(item, bytes))
                category = placement
                if placement == "inbox" and seed["google"]:
                    category_status, matches = client.uid("SEARCH", None, "UID", uid, "X-GM-RAW", '"category:promotions"')
                    if category_status != "OK":
                        continue
                    if matches and matches[0]:
                        category = "promotions"
                date = imaplib.Internaldate2tuple(info)
                received = iso(time.mktime(date)) if date else None
                with db() as conn, conn:
                    conn.execute("""UPDATE placement_results SET placement=?, folder=?, received_at=?
                        WHERE test_id=? AND address=? AND placement='pending'""",
                        (category, folder.decode("ascii", "replace").strip('"'), received, identifier, address))
                del pending[identifier]


def poll():
    now = time.time()
    with db() as conn, conn:
        conn.execute("DELETE FROM placement_results WHERE test_id IN (SELECT id FROM placement_tests WHERE deadline<?)", (now - 7 * 86400,))
        conn.execute("DELETE FROM placement_tests WHERE deadline<?", (now - 7 * 86400,))
        configured = accounts(conn)
        rows = conn.execute("""SELECT r.address,t.id,t.token FROM placement_results r JOIN placement_tests t ON t.id=r.test_id
            WHERE r.placement='pending' AND t.deadline>?""", (now,)).fetchall()
    seeds = {}
    for address, identifier, token in rows:
        if address in configured:
            seeds.setdefault(address, (configured[address], {}))[1][identifier] = token
    return seeds


async def worker():
    throttle = asyncio.Semaphore(5)

    async def scan(address, password, pending):
        async with throttle:
            with suppress(OSError, imaplib.IMAP4.error, UnicodeError):
                await asyncio.to_thread(inspect_seed, address, password, pending)

    while True:
        started = time.monotonic()
        try:
            seeds = await asyncio.to_thread(poll)
        except HTTPException:
            await asyncio.sleep(20)
            continue
        await asyncio.gather(*(scan(address, password, pending) for address, (password, pending) in seeds.items()))
        await asyncio.sleep(max(1, 20 - (time.monotonic() - started)))


original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with original_lifespan(application):
        initialize()
        task = asyncio.create_task(worker())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app.router.lifespan_context = lifespan
