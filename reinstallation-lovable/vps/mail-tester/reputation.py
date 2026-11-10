"""DNSBL results count only zones with a working positive control."""
import ipaddress
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import dns.exception
import dns.reversename

from advanced import lookup, org

# Each entry is (label, query zone, scope, positive control, answer prefix).
# ZEN covers SBL, XBL and PBL, so it contributes only one to the denominator.
SPAMHAUS = [
    ("Spamhaus ZEN (SBL/XBL/PBL)", "zen.spamhaus.org", "ip", "2.0.0.127", "127.0.0."),
    ("Spamhaus DBL", "dbl.spamhaus.org", "domain", "dbltest.com", "127.0.1."),
 ]

PUBLIC = [
    ("SpamCop", "bl.spamcop.net", "ip4", "2.0.0.127", "127.0.0."),
    ("UCEPROTECT 1", "dnsbl-1.uceprotect.net", "ip4", "2.0.0.127", "127.0.0."),
    ("UCEPROTECT 2", "dnsbl-2.uceprotect.net", "ip4", "2.0.0.127", "127.0.0."),
    ("UCEPROTECT 3", "dnsbl-3.uceprotect.net", "ip4", "2.0.0.127", "127.0.0."),
    ("DroneBL", "dnsbl.dronebl.org", "ip4", "2.0.0.127", "127.0.0."),
    ("PSBL", "psbl.surriel.com", "ip4", "2.0.0.127", "127.0.0."),
]

# Opt in only after obtaining provider access for this resolver and workload.
OPTIONAL = {
    "spamhaus-zen": SPAMHAUS[0],
    "spamhaus-dbl": SPAMHAUS[1],
    "barracuda": ("Barracuda", "b.barracudacentral.org", "ip4", "2.0.0.127", "127.0.0."),
    "surbl": ("SURBL", "multi.surbl.org", "url", "surbl-org-permanent-test-point.com", "127.0.0."),
}
ZONE_ERRORS = (dns.exception.DNSException, ValueError)


def zones():
    configured = [OPTIONAL[key] for key in os.getenv("DNSBL_OPT_IN", "").split(",") if key in OPTIONAL]
    key = os.getenv("SPAMHAUS_DQS_KEY", "").strip()
    if key and key.isalnum() and key.isascii():
        for label, zone, scope, test, prefix in SPAMHAUS:
            dataset = zone.split(".", 1)[0]
            configured = [entry for entry in configured if entry[0] != label]
            configured.append((label, f"{key}.{dataset}.dq.spamhaus.net", scope, test, prefix))
    configured.extend(tuple(entry) for entry in json.loads(os.getenv("DNSBL_EXTRA_JSON", "[]")))
    merged = {}
    for entry in [*PUBLIC, *configured]:
        label, zone, scope, test, prefix = entry
        if not all(isinstance(value, str) and value for value in entry):
            raise ValueError("Invalid DNSBL entry")
        if scope not in ("ip", "ip4", "domain", "url") or not prefix.startswith("127.0."):
            raise ValueError("Invalid DNSBL scope or response prefix")
        merged[zone] = (label, zone, scope, test, prefix)
    return list(merged.values())


def answer(name, prefix):
    addresses = [rr.address for rr in lookup(name, "A")[0]]
    if any(not address.startswith(prefix) or address in ("127.0.1.255", "127.0.0.1", "127.0.0.255") for address in addresses):
        raise ValueError("réponse DNSBL inattendue")
    return addresses


@lru_cache(maxsize=256)
def control(zone, test, prefix, period):
    try:
        return bool(answer(test + "." + zone, prefix))
    except ZONE_ERRORS:
        return False


def reversed_ip(ip):
    return str(dns.reversename.from_address(str(ip))).split(".in-addr.arpa")[0].split(".ip6.arpa")[0]


def report(ip, domains, urls):
    configured = zones()

    def probe(entry):
        label, zone, scope, test, prefix = entry
        if scope == "ip4" and ip.version != 4:
            return label, "inapplicable", []
        targets = ([str(ip)] if scope.startswith("ip") else urls if scope == "url" else domains)
        if not targets:
            return label, "inapplicable", []
        if not control(zone, test, prefix, int(time.monotonic() // 300)):
            return label, "unavailable", []
        hits = []
        state = "checked"
        for target in targets:
            query = reversed_ip(ip) if scope.startswith("ip") else target
            try:
                codes = answer(query + "." + zone, prefix)
                if codes:
                    hits.append((target, codes))
            except ZONE_ERRORS:
                state = "unavailable"
        return label, state, hits

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(probe, configured))
    checked = sum(state == "checked" for _, state, _ in results)
    unavailable = [label for label, state, _ in results if state == "unavailable"]
    hits = [(label, entries) for label, _, entries in results if entries]
    text = f"{len(hits)} liste(s) avec signalement; {checked}/{len(configured)} entièrement vérifiées"
    if hits:
        text += "; " + "; ".join(f"{label}: {entries}" for label, entries in hits)
    if unavailable:
        text += "; indisponibles : " + ", ".join(unavailable)
    fix = (
        "Traitez la cause du signalement pour chaque IP/domaine indiqué et demandez le retrait auprès de la liste correspondante."
        if hits else "Configurez l’accès aux zones DNSBL et validez leurs requêtes de contrôle positives."
    )
    return not (hits or unavailable), text, fix, 1.5 if hits else 0


def subnet(ip):
    if ip.version != 4 or not ip.is_global:
        return False, "Échantillon /24 indisponible pour cette IP", "Envoyez le test depuis une IPv4 publique.", 0
    network = ipaddress.ip_network(f"{ip}/24", strict=False)
    nearby = sorted((addr for addr in network.hosts() if addr != ip),
                    key=lambda addr: abs(int(ip) - int(addr)))[:5]
    zen = next((entry for entry in zones() if entry[0] == SPAMHAUS[0][0]), None)
    if not zen:
        return False, "Sondage /24 sans accès Spamhaus ZEN", "Configurez SPAMHAUS_DQS_KEY sur le testeur.", 0
    _, zone, _, test, prefix = zen
    if not control(zone, test, prefix, int(time.monotonic() // 300)):
        return False, "Spamhaus ZEN indisponible pour le sondage /24", "Rétablissez l’accès à Spamhaus ZEN ou DQS.", 0

    def probe(address):
        try:
            return address, answer(reversed_ip(address) + "." + zone, prefix)
        except ZONE_ERRORS:
            return address, None

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(probe, nearby))
    hits = [f"{addr} ({', '.join(codes)})" for addr, codes in results if codes]
    available = sum(codes is not None for _, codes in results)
    detail = f"{network} : {len(hits)} signalement(s) sur {available}/{len(nearby)} voisins vérifiés"
    if hits:
        detail += "; " + ", ".join(hits)
    return not hits and available == len(nearby), detail, (
        f"Communiquez les IP listées à l’hébergeur du bloc {network}."
        if hits else "Vérifiez l’accès DNS à Spamhaus ZEN puis relancez le test."
    ), 0
