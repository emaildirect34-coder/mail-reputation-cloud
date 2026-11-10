import http.client
import ipaddress
import re
from concurrent.futures import ThreadPoolExecutor
from email.utils import parseaddr
from html.parser import HTMLParser
from urllib.parse import urlsplit
from xml.etree import ElementTree

import dkim
import dns.flags
import dns.resolver
import tldextract

from probe_http import fetch

PSL = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)
DOMAIN = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?")
URL = re.compile(r'https?://[^\s<>"\x00-\x1f]+', re.I)
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "buff.ly",
              "is.gd", "cutt.ly", "rebrand.ly", "rb.gy", "shorturl.at", "lnkd.in"}
HTTP_ERRORS = (OSError, ValueError, http.client.HTTPException, UnicodeError)


def hostname(value):
    try:
        value = value.strip().rstrip(".").encode("idna").decode("ascii").lower()
        return value if DOMAIN.fullmatch(value) else ""
    except UnicodeError:
        return ""


def org(domain):
    return PSL(domain).top_domain_under_public_suffix or domain


def domain_of(address):
    return hostname(address.rpartition("@")[2])


def lookup(name, kind, *, secure=False):
    resolver = dns.resolver.Resolver()
    if secure:
        resolver.use_edns(edns=0, ednsflags=dns.flags.DO, payload=1232)
    try:
        answer = resolver.resolve(name + ".", kind, lifetime=2)
        return list(answer), bool(answer.response.flags & dns.flags.AD)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return [], False


def txt(name):
    return [b"".join(record.strings).decode("ascii", "replace") for record in lookup(name, "TXT")[0]]


def tags(value):
    result = {}
    for item in value.split(";"):
        key, separator, val = item.strip().partition("=")
        if separator:
            key = key.strip().lower()
            if key in result:
                return {}
            result[key] = val.strip()
    return result


def signatures(raw, message):
    valid = []
    verifier = dkim.DKIM(raw)
    for index, header in enumerate(message.get_all("DKIM-Signature", [])[:8]):
        fields = tags(str(header))
        domain = hostname(fields.get("d", ""))
        if not domain:
            continue
        try:
            if verifier.verify(idx=index, dnsfunc=lambda name, timeout: dkim_key(name)):
                valid.append((domain, {h.strip().lower() for h in fields.get("h", "").split(":")}))
        except (dkim.DKIMException, ValueError, dns.exception.DNSException):
            continue
    return valid


def dkim_key(name):
    records = txt(name.decode("ascii").rstrip("."))
    return records[0].encode("ascii") if len(records) == 1 else None


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        self.urls.extend(value for key, value in attrs
                         if key in ("href", "src", "action", "poster") and value
                         and value.lower().startswith(("https://", "http://")))


def message_links(message):
    urls = {}
    for part in message.walk():
        if part.get_content_type() not in ("text/html", "text/plain") or part.is_attachment():
            continue
        raw = part.get_payload(decode=True) or b""
        try:
            body = raw.decode(part.get_content_charset() or "utf-8", "replace")
        except LookupError:
            body = raw.decode("utf-8", "replace")
        if part.get_content_type() == "text/html":
            parser = Links()
            parser.feed(body)
            found = parser.urls
        else:
            found = [match.rstrip(".,;!?)") for match in URL.findall(body)]
        for url in found:
            try:
                if len(url) <= 4096 and urlsplit(url).hostname:
                    urls[url.split("#", 1)[0]] = None
            except ValueError:
                continue
    return list(urls)


def link_report(urls, excluded):
    def skip(url):
        target = urlsplit(url)
        return (url in excluded or bool(re.search(
            r"unsubscribe|opt[-_]?out|desinscri", target.path, re.I
        )))
    def probe(url):
        target = urlsplit(url)
        label = target.hostname or ""
        if org(label.lower()) in SHORTENERS:
            return "short", label
        if skip(url):
            return "skipped", label
        try:
            code, _ = fetch(url, redirects=2, skip=skip)
        except HTTP_ERRORS:
            return "unknown", label
        if code is None:
            return "skipped", label
        if code in (404, 410) or 500 <= code <= 599:
            return "broken", f"{label} (HTTP {code})"
        if not 200 <= code < 300:
            return "unknown", f"{label} (HTTP {code})"
        return "ok", label

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(probe, urls[:24]))
    issues = {kind: sorted({label for status, label in results if status == kind})
              for kind in ("short", "broken", "unknown")}
    omitted = max(0, len(urls) - 24)
    failed = issues["short"] or issues["broken"]
    unknown = issues["unknown"] or omitted
    detail = f"{len(urls)} URL distinctes, {sum(status == 'ok' for status, _ in results)} vérifiées par HEAD"
    detail += f", {sum(status == 'skipped' for status, _ in results)} désabonnements ignorés"
    for kind, label in (("short", "réducteurs"), ("broken", "liens cassés"), ("unknown", "non confirmés")):
        if issues[kind]:
            detail += f"; {label} : " + ", ".join(issues[kind])
    if omitted:
        detail += f"; {omitted} au-delà de la limite de sondage"
    fix = "Dans href/src/action, utilisez l’URL HTTPS directe et vérifiez qu’elle renvoie HTTP 200."
    return not (failed or unknown), detail, fix, 0.7 if failed else 0


def dmarc(domain):
    for candidate in dict.fromkeys((domain, org(domain))):
        name = "_dmarc." + candidate
        records = [tags(record) for record in txt(name) if record.startswith("v=DMARC1;")]
        if records:
            fields = records[0]
            valid = (len(records) == 1 and fields.get("p") in ("none", "quarantine", "reject")
                     and all(fields.get(key, "r") in ("s", "r") for key in ("adkim", "aspf")))
            return name, fields if valid else None, True
    return "_dmarc." + org(domain), None, False


def alignment(domain, spf_domain, spf_pass, valid_dkim):
    name, fields, exists = dmarc(domain)
    dns_fix = f'{name}. IN TXT "v=DMARC1; p=none; adkim=r; aspf=r"'
    if fields is None:
        return (False, "Politique DMARC absente ou invalide",
                ("Remplacez les TXT DMARC existants par " if exists else "Publiez ") + dns_fix, 0)
    adkim, aspf = (fields.get(key, "r") for key in ("adkim", "aspf"))

    def aligned(candidate, mode):
        return bool(candidate) and (candidate == domain or mode == "r" and org(candidate) == org(domain))

    dkim_ok = any(aligned(candidate, adkim) for candidate, _ in valid_dkim)
    spf_ok = spf_pass and aligned(spf_domain, aspf)
    exact = (any(candidate == domain for candidate, _ in valid_dkim),
             spf_pass and spf_domain == domain)
    detail = (f"adkim={adkim}, aspf={aspf}; DKIM aligné={dkim_ok}, SPF aligné={spf_ok}; "
              f"correspondance exacte DKIM={exact[0]}, SPF={exact[1]}")
    fix = f"Signez avec DKIM-Signature: ... d={domain}; ... ou utilisez MAIL FROM:<rebonds@{domain}> avec SPF valide."
    return dkim_ok or spf_ok, detail, fix, 0


def one_click(message, valid_dkim, domain):
    unsub = message.get_all("List-Unsubscribe", [])
    post = message.get_all("List-Unsubscribe-Post", [])
    uris = re.findall(r"<([^<>\s]+)>", str(unsub[0])) if len(unsub) == 1 else []
    try:
        https = any(urlsplit(uri).scheme == "https" and urlsplit(uri).hostname
                    and urlsplit(uri).username is None for uri in uris)
        mailto = any(urlsplit(uri).scheme == "mailto" and domain_of(urlsplit(uri).path) for uri in uris)
    except ValueError:
        https = mailto = False
    headers = {"list-unsubscribe", "list-unsubscribe-post"}
    signed = any(headers <= names and org(signer) == org(domain) for signer, names in valid_dkim)
    syntax = bool(https and len(post) == 1 and str(post[0]).strip() == "List-Unsubscribe=One-Click")
    fix = (f"List-Unsubscribe: <https://{domain}/unsubscribe/<jeton>>, <mailto:unsubscribe@{domain}>\n"
           "List-Unsubscribe-Post: List-Unsubscribe=One-Click\n"
           "Remplacez <jeton> par un jeton opaque par destinataire. Implémentez le POST et ajoutez "
           "list-unsubscribe:list-unsubscribe-post à h= avant de signer DKIM.")
    detail = f"HTTPS={bool(https)}, mailto={bool(mailto)}, POST={syntax}, signature DKIM vérifiée={signed}"
    return (syntax and signed, detail, fix, 0), (syntax and signed and mailto, detail, fix, 0), set(uris)


def mx_hosts(domain):
    return sorted({str(record.exchange).rstrip(".").lower()
                   for record in lookup(domain, "MX")[0]} - {""})


def sts(domain, mx):
    record = f"_mta-sts.{domain}. IN TXT \"v=STSv1; id=2026110801\""
    url = f"https://mta-sts.{domain}/.well-known/mta-sts.txt"
    fix = (f"Publiez ou mettez à jour {record}. Servez {url} en HTTPS avec "
           "version: STSv1, mode: enforce, max_age: 86400 et une ligne mx: par MX autorisé."
           + "".join(f"\nmx: {host}" for host in mx))
    records = [tags(item) for item in txt("_mta-sts." + domain) if item.startswith("v=STSv1;")]
    if len(records) != 1 or not re.fullmatch(r"[A-Za-z0-9]{1,32}", records[0].get("id", "")):
        return False, "TXT MTA-STS absent ou invalide", fix, 0
    code, data = fetch(url, limit=65536, https_only=True)
    fields = {}
    for line in data.decode("utf-8").splitlines():
        key, sep, value = line.partition(":")
        if sep:
            fields.setdefault(key.strip(), []).append(value.strip())
    mode = fields.get("mode", [])
    max_age = fields.get("max_age", [])
    patterns = [item.lower() for item in fields.get("mx", [])]

    def covered(host):
        return any(host == pattern or (pattern.startswith("*.") and
                   host.endswith(pattern[1:]) and host.count(".") == pattern.count("."))
                   for pattern in patterns)

    passed = (code == 200 and fields.get("version") == ["STSv1"]
              and mode in (["enforce"], ["testing"]) and len(max_age) == 1
              and re.fullmatch(r"[0-9]{1,10}", max_age[0]) and 0 < int(max_age[0]) <= 31557600
              and mx and all(covered(host) for host in mx))
    return bool(passed), f"HTTP {code}; mode={','.join(mode)}; MX couverts={sum(map(covered, mx))}/{len(mx)}", fix, 0


def dane(domain, mx):
    verified, published = [], []
    for host in mx:
        records, authenticated = lookup("_25._tcp." + host, "TLSA", secure=True)
        if records:
            published.append(host)
        if authenticated and any(record.usage in (2, 3) and record.selector in (0, 1)
                                 and record.mtype in (0, 1, 2) and
                                 (record.mtype == 0 or len(record.cert) == {1: 32, 2: 64}[record.mtype])
                                 for record in records):
            verified.append(host)
    fix = "\n".join(f"{host}: activez DNSSEC et publiez _25._tcp.{host}. IN TLSA 3 1 1 <SHA256-SPKI>"
                    for host in mx if host not in verified)
    return bool(mx and verified == mx), (
        f"TLSA présents : {len(published)}/{len(mx)}; authentifiés par le résolveur : {len(verified)}/{len(mx)}. "
        "Certificat SMTP non comparé."
    ), fix or f"Publiez d’abord les MX de {domain}.", 0


def bimi(domain):
    name = "default._bimi." + domain
    fix = (f'{name}. IN TXT "v=BIMI1; l=https://{domain}/bimi/logo.svg; a=https://{domain}/bimi/vmc.pem"'
           "\nHébergez un SVG Tiny PS et le certificat d’autorité délivré pour ce logo à ces URL.")
    records = [tags(item) for item in txt(name) if item.startswith("v=BIMI1;")]
    if len(records) != 1 or not records[0].get("l"):
        return False, "TXT BIMI ou URL du logo manquant", fix, 0
    code, data = fetch(records[0]["l"], limit=32768, https_only=True)
    if code != 200 or b"<!DOCTYPE" in data.upper():
        return False, f"Logo SVG inaccessible ou invalide (HTTP {code})", fix, 0
    root = ElementTree.fromstring(data)
    svg = (root.tag == "{http://www.w3.org/2000/svg}svg" and root.get("version") == "1.2"
           and root.get("baseProfile") == "tiny-ps"
           and root.find("{http://www.w3.org/2000/svg}title") is not None)
    certificate = records[0].get("a")
    pem = False
    if certificate:
        cert_code, cert = fetch(certificate, limit=65536, https_only=True)
        pem = cert_code == 200 and b"-----BEGIN CERTIFICATE-----" in cert
    return bool(svg and pem), f"SVG Tiny PS (structure)={svg}; certificat PEM accessible={pem}; chaîne VMC non validée", fix, 0


def advanced_checks(raw, message, ip, sender, helo, checks, check):
    import reputation

    from_headers = message.get_all("From", [])
    from_domain = domain_of(parseaddr(str(from_headers[0]))[1]) if len(from_headers) == 1 else ""
    spf_domain = domain_of(sender) if sender else hostname(helo or "")
    parsed_ip = ipaddress.ip_address(ip)
    urls = message_links(message)
    url_domains = sorted({org(domain) for url in urls
                          if (domain := hostname(urlsplit(url).hostname or ""))})[:12]
    sender_domains = sorted({candidate for domain in (from_domain, spf_domain) if domain
                             for candidate in (domain, org(domain))})
    safe_errors = (*HTTP_ERRORS, dns.exception.DNSException, ElementTree.ParseError)

    def guarded(fn, fix):
        try:
            return fn()
        except safe_errors:
            return False, "Vérification indisponible ou réponse illisible", fix, 0

    with ThreadPoolExecutor(max_workers=7) as pool:
        dkim_future = pool.submit(signatures, raw, message)
        mx_future = pool.submit(mx_hosts, from_domain) if from_domain else None
        tasks = {
            "rbl": (lambda: reputation.report(parsed_ip, sender_domains, url_domains),
                    "Vérifiez les zones DNSBL configurées et leurs accès."),
            "subnet24": (lambda: reputation.subnet(parsed_ip),
                         "Rétablissez l’accès à Spamhaus ZEN."),
        }
        jobs = {name: pool.submit(guarded, fn, fix) for name, (fn, fix) in tasks.items()}
        valid = dkim_future.result()
        rfc, suite, excluded = one_click(message, valid, from_domain or "votre-domaine.tld")
        check("rfc8058", *rfc)
        check("list_unsubscribe", *suite)
        jobs["links"] = pool.submit(guarded, lambda: link_report(urls, excluded),
                                    "Utilisez des URL HTTPS valides dans les liens du message.")
        if from_domain:
            jobs["dmarc_alignment"] = pool.submit(
                guarded, lambda: alignment(from_domain, spf_domain, checks["spf"]["pass"], valid),
                f"Vérifiez le TXT _dmarc.{org(from_domain)} et l’alignement avec From.",
            )
            jobs["bimi_vmc"] = pool.submit(
                guarded, lambda: bimi(from_domain),
                f'Publiez default._bimi.{from_domain}. IN TXT "v=BIMI1; l=https://{from_domain}/bimi/logo.svg; a=https://{from_domain}/bimi/vmc.pem".',
            )
            try:
                mx = mx_future.result()[:12]
            except dns.exception.DNSException:
                mx = []
            jobs["mta_sts"] = pool.submit(
                guarded, lambda: sts(from_domain, mx),
                f"Vérifiez le TXT _mta-sts.{from_domain} et servez une politique valide sur "
                f"https://mta-sts.{from_domain}/.well-known/mta-sts.txt.",
            )
            jobs["dane_tlsa"] = pool.submit(
                guarded, lambda: dane(from_domain, mx),
                f"Vérifiez les MX de {from_domain} et leur DNSSEC, puis publiez leurs TLSA.",
            )
        else:
            for name in ("dmarc_alignment", "mta_sts", "dane_tlsa", "bimi_vmc"):
                check(name, False, "Domaine From introuvable",
                      "From: Nom de l’expéditeur <envoi@votre-domaine.tld>")
        for name, future in jobs.items():
            check(name, *future.result())

    ehlo = hostname(helo or "")
    rdns = checks["rdns"]["pass"]
    check("fr_isp", rdns and bool(ehlo),
          f"Précontrôles Orange/SFR/Free : FCrDNS={rdns}; HELO/EHLO FQDN={bool(ehlo)}.",
          f"Configurez le PTR de {ip} vers un FQDN public, publiez son "
          f"{'A' if parsed_ip.version == 4 else 'AAAA'} vers {ip} et utilisez ce FQDN dans EHLO.")

    components = ("spf", "dkim", "dmarc_alignment", "rfc8058", "rdns")
    failures = [name for name in components if not checks[name]["pass"]]
    check("gmail_yahoo_2024", not failures,
          ("Précontrôles message en échec : " + ", ".join(failures)) if failures else
          "Précontrôles message réussis. Volume, plaintes et délai de désabonnement non mesurés.",
          "\n".join(dict.fromkeys(checks[name]["fix"] for name in failures)))

    if not checks["spf"]["pass"] and spf_domain and parsed_ip.is_global:
        mechanism = f"ip{parsed_ip.version}:{ip}"
        try:
            existing = [record for record in txt(spf_domain)
                        if record.lower() == "v=spf1" or record.lower().startswith("v=spf1 ")]
        except dns.exception.DNSException:
            existing = None
        if existing == []:
            fix = f'Publiez {spf_domain}. IN TXT "v=spf1 {mechanism} -all"'
        elif existing is not None and len(existing) == 1 and '"' not in existing[0]:
            mechanisms = existing[0].split()[1:]
            replacement = " ".join(("v=spf1", mechanism, *[value for value in mechanisms if value != mechanism]))
            fix = f'Remplacez le TXT SPF existant par {spf_domain}. IN TXT "{replacement}"'
        else:
            fix = f"Consolidez les TXT SPF de {spf_domain} en un seul v=spf1 et insérez {mechanism} juste après v=spf1."
        checks["spf"]["fix"] = fix
    if not checks["dmarc"]["pass"] and from_domain and not checks["dmarc_alignment"]["pass"]:
        checks["dmarc"]["fix"] = checks["dmarc_alignment"]["fix"]

