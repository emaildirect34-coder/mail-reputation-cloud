"""Bounded HTTP probes with DNS pinning and public-address checks."""
import http.client
import ipaddress
import os
import socket
import ssl
from urllib.parse import urljoin, urlsplit

import dns.resolver

TLS = ssl.create_default_context()
BLOCKED = {item.strip() for item in os.getenv("PROBE_BLOCKED_IPS", "").split(",") if item.strip()}
NAT64 = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))


def public_address(host):
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        resolver = dns.resolver.Resolver()
        addresses = []
        for kind in ("A", "AAAA"):
            try:
                addresses.extend(ipaddress.ip_address(rr.address)
                                 for rr in resolver.resolve(host + ".", kind, lifetime=1.5))
            except dns.exception.DNSException:
                continue
    if not addresses or any(not ip.is_global or ip.is_multicast or str(ip) in BLOCKED or
                            (ip.version == 6 and (ip.ipv4_mapped or ip.sixtofour or ip.teredo or any(ip in net for net in NAT64)))
                            for ip in addresses):
        raise ValueError("adresse publique requise")
    return str(addresses[0])


def fetch(url, *, limit=0, https_only=False, redirects=0, skip=None):
    for hop in range(redirects + 1):
        if skip and skip(url):
            return None, b""
        target = urlsplit(url)
        ports = {"http": 80, "https": 443}
        if (target.scheme not in ports or https_only and target.scheme != "https"
                or not target.hostname or target.username is not None
                or target.port not in (None, ports[target.scheme])
                or any(ord(ch) < 32 for ch in url)):
            raise ValueError("URL ou port non autorisé")
        host = target.hostname.rstrip(".").encode("idna").decode("ascii")
        ip = public_address(host)
        port = ports[target.scheme]
        path = target.path or "/"
        if target.query:
            path += "?" + target.query
        conn = http.client.HTTPConnection(host, port, timeout=3)
        try:
            conn.sock = socket.create_connection((ip, port), timeout=3)
            if target.scheme == "https":
                conn.sock = TLS.wrap_socket(conn.sock, server_hostname=host)
            conn.request("GET" if limit else "HEAD", path,
                         headers={"User-Agent": "MailSuite-Link-Check", "Connection": "close"})
            response = conn.getresponse()
            status = response.status
            location = response.getheader("Location")
            if status in (301, 302, 303, 307, 308) and location and hop < redirects:
                url = urljoin(url, location)
                continue
            if limit and status == 200:
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise ValueError("réponse trop volumineuse")
                return status, data
            return status, b""
        finally:
            conn.close()
