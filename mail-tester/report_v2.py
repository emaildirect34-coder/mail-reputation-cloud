"""Mail-Tester v2 response and stricter sender checks."""
import ipaddress
import math
import time
from concurrent.futures import ThreadPoolExecutor
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr

from dns.exception import DNSException
from fastapi import Security

import advanced
import tester
import reputation

original_scan = tester.scan


def subnet(ip):
    if ip.version != 4 or not ip.is_global:
        return False, "Sondage /24 réservé aux IPv4 publiques.", "Relancez le test depuis une IPv4 publique.", 0
    network = ipaddress.ip_network(f"{ip}/24", strict=False)
    neighbors = sorted((peer for peer in network.hosts() if peer != ip), key=lambda peer: abs(int(peer) - int(ip)))[:5]
    configured = [entry for entry in reputation.zones() if entry[2] in ("ip", "ip4")]
    period = int(time.monotonic() // 300)

    def probe(entry):
        label, zone, _, control, prefix = entry
        if not reputation.control(zone, control, prefix, period):
            return label, 0, []
        checked, hits = 0, []
        for neighbor in neighbors:
            try:
                codes = reputation.answer(reputation.reversed_ip(neighbor) + "." + zone, prefix)
                checked += 1
                if codes:
                    hits.append(f"{neighbor} ({', '.join(codes)})")
            except reputation.ZONE_ERRORS:
                continue
        return label, checked, hits

    with ThreadPoolExecutor(max_workers=8) as pool:
        reports = list(pool.map(probe, configured))
    completed = sum(count for _, count, _ in reports)
    hits = [f"{label}: {', '.join(addresses)}" for label, _, addresses in reports if addresses]
    detail = f"{network} : {len(neighbors)} voisins échantillonnés, {completed}/{len(neighbors) * len(configured)} réponses DNSBL vérifiées."
    if hits:
        return False, detail + " " + "; ".join(hits), f"Ouvrez un ticket auprès de l’hébergeur du bloc {network} avec les IP et listes ci-dessus.", 0
    if completed != len(neighbors) * len(configured) or not completed:
        return False, detail, "Vérifiez les accès DNSBL du résolveur et relancez le test.", 0
    return True, detail, "", 0


reputation.subnet = subnet


def scan(identifier, raw, ip, sender, helo):
    result = original_scan(identifier, raw, ip, sender, helo)
    checks = result["checks"]
    message = BytesParser(policy=policy.default).parsebytes(raw, headersonly=True)
    domain = advanced.domain_of(parseaddr(str(message.get("From", "")))[1])
    helo_host = advanced.hostname(helo or "")
    confirmed = {name.strip().rstrip(".").lower() for name in checks["rdns"]["detail"].split(",")} if checks["rdns"]["pass"] else set()
    if not helo_host or helo_host not in confirmed:
        host = helo_host or next(iter(sorted(confirmed)), None)
        parsed_ip = ipaddress.ip_address(ip)
        record = "A" if parsed_ip.version == 4 else "AAAA"
        fix = (f"{parsed_ip.reverse_pointer}. IN PTR {host}.\n{host}. IN {record} {ip}\nEHLO {host}"
               if host else checks["rdns"]["fix"])
        checks["fr_isp"]["fix"] = fix
        checks["fr_isp"]["pass"] = False
    checks["fr_isp"]["detail"] = (
        f"Orange, Free, SFR, La Poste : FCrDNS={'oui' if confirmed else 'non'}, "
        f"HELO correspondant au PTR confirmé={'oui' if helo_host in confirmed else 'non'}."
    )

    if domain:
        alignment = checks["dmarc_alignment"]
        strict = "adkim=s, aspf=s;" in alignment["detail"]
        exact = "correspondance exacte DKIM=True" in alignment["detail"] or "SPF=True" in alignment["detail"].partition("correspondance exacte")[2]
        if not (strict and exact and alignment["pass"]):
            alignment["pass"] = False
            try:
                name, fields, _ = advanced.dmarc(domain)
            except DNSException:
                name, fields = None, None
            if fields:
                values = {**fields, "adkim": "s", "aspf": "s"}
                record = "; ".join(f"{key}={value}" for key, value in values.items())
                # An inherited policy belongs to other subdomains as well.
                if name.rstrip(".") != "_dmarc." + domain:
                    name = "_dmarc." + domain
                    values["p"] = values.pop("sp", values["p"])
                    record = "; ".join(f"{key}={value}" for key, value in values.items())
                alignment["fix"] = f'{name.rstrip(".")}. IN TXT "{record}"\n' + alignment.get("fix", "")
            elif name:
                alignment["fix"] = f'{name.rstrip(".")}. IN TXT "v=DMARC1; p=none; adkim=s; aspf=s"'
        alignment["detail"] += "; ARC=" + ("valide" if checks["arc"]["pass"] else "non validé")

    if not any(message.get(header) for header in ("ARC-Seal", "ARC-Message-Signature", "ARC-Authentication-Results")):
        checks["arc"]["status"] = "warn"
        checks["arc"]["detail"] = "Aucune chaîne ARC à vérifier sur ce message."
        checks["arc"]["fix"] = "Pour un relais qui modifie le message, scellez ARC-Authentication-Results, ARC-Message-Signature et ARC-Seal."
    return result


def v2(result):
    if result.get("status") != "done":
        return result
    penalties = result.get("penalties", [])
    engines = {"rspamd", "spamassassin"}
    raw_checks = result["checks"]
    scores = {name: raw_checks[name].get("score") for name in engines if name in raw_checks}
    measured = {name: score for name, score in scores.items() if isinstance(score, (int, float)) and math.isfinite(score)}
    engine_penalties = [row for row in penalties if row["rule"].lower() in engines]
    if engine_penalties:
        worst = min(engine_penalties, key=lambda row: (row["points"], -measured.get(row["rule"].lower(), 0)))
        penalties = [row for row in penalties if row["rule"].lower() not in engines] + [worst]
    points = {row["rule"].lower(): float(row["points"]) for row in penalties}
    rows = []
    for name, check in raw_checks.items():
        status = check.get("status", "pass" if check["pass"] else "fail")
        detail = str(check.get("detail") or "")
        if name in engines:
            if name in measured:
                detail = f"Score {measured[name]:g}. {detail}"
            else:
                status = "warn"
        if name == "subnet24" and not check["pass"] and "ticket" not in str(check.get("fix")):
            status = "warn"
        rows.append(dict(id=name, status=status, points=points.get(name, 0.0), detail=detail,
                         fix=str(check.get("fix") or "") if status != "pass" else ""))
    return {**result, "checks": rows, "penalties": penalties,
            "spam_score": max(measured.values(), default=None),
            "score": round(max(0, 10 + sum(points.values())), 1)}


tester.scan = scan
for route in list(tester.app.router.routes):
    if getattr(route, "path", None) == "/api/v1/tests/{identifier}" and "GET" in route.methods:
        tester.app.router.routes.remove(route)


@tester.app.get("/api/v1/tests/{identifier}", dependencies=[Security(tester.authorize)])
def get_test(identifier: str, version: int = 1):
    result = tester.get_test(identifier)
    return v2(result) if version == 2 else result
