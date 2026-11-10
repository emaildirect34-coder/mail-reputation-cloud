#!/usr/bin/env python3
"""Verify the public SMTP key on every address of a DNSSEC-authenticated MX."""

import argparse
import hashlib
import ipaddress
import json
import os
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def json_request(url, headers, payload=None):
    request = Request(url, headers=headers, data=None if payload is None else json.dumps(payload).encode())
    with build_opener(NoRedirect).open(request, timeout=8) as response:
        return json.load(response)


def public_dns(owner, kind):
    query = urlencode({"name": owner, "type": kind, "do": "true"})
    reply = json_request("https://cloudflare-dns.com/dns-query?" + query, {"Accept": "application/dns-json"})
    if reply.get("Status") not in (0, 3) or reply.get("TC") or reply.get("AD") is not True:
        raise ValueError(f"DNSSEC did not authenticate {kind} for {owner}")
    return reply.get("Answer", [])


def addresses_for_mx(domain, mx):
    hosts = [record["data"].split()[-1].rstrip(".").lower()
             for record in public_dns(domain, "MX")
             if record["type"] == 15 and record["name"].rstrip(".").lower() == domain]
    if mx not in hosts:
        raise ValueError("The hostname is not an authenticated MX of the configured domain")
    addresses = {ipaddress.ip_address(record["data"]) for kind, number in [("A", 1), ("AAAA", 28)]
                 for record in public_dns(mx, kind)
                 if record["type"] == number and record["name"].rstrip(".").lower() == mx}
    if not addresses or len(addresses) > 16 or any(not address.is_global for address in addresses):
        raise ValueError("The MX must resolve to between 1 and 16 public addresses")
    return addresses


def openssl(arguments, data=b""):
    result = subprocess.run(["openssl", *arguments], input=data, capture_output=True, timeout=10, check=True)
    return result.stdout


def serving_digest(mx, address):
    endpoint = f"[{address}]:25" if address.version == 6 else f"{address}:25"
    chain = openssl(["s_client", "-starttls", "smtp", "-connect", endpoint, "-servername", mx])
    public_key = openssl(["x509", "-pubkey", "-noout"], chain)
    der = openssl(["pkey", "-pubin", "-outform", "DER"], public_key)
    return hashlib.sha256(der).hexdigest()


def dns_name(value):
    value = value.rstrip(".").lower()
    if len(value) > 244 or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", value):
        raise argparse.ArgumentTypeError("Enter an ASCII DNS name")
    return value


def verify(domain, mx, digest):
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("The approved SHA-256 must have 64 hexadecimal characters")
    owner = "_25._tcp." + mx
    for address in addresses_for_mx(domain, mx):
        if serving_digest(mx, address) != digest:
            raise ValueError(f"The public SMTP key on {address} differs from the approved key")
    return f"{owner}. IN TLSA 3 1 1 {digest}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("domain", type=dns_name)
    parser.add_argument("mx", type=dns_name)
    parser.add_argument("sha256", type=str.lower, help="Approved fingerprint from the DANE Lab")
    parser.add_argument("--app-origin", help="HTTPS application origin. If set, request initial publication after verification.")
    args = parser.parse_args()
    try:
        print(verify(args.domain, args.mx, args.sha256))
        if args.app_origin:
            origin = urlsplit(args.app_origin)
            token = os.environ.get("KAG_TOKEN", "")
            if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
                raise ValueError("Provide only the HTTPS origin of the application")
            if not re.fullmatch(r"kag_[a-f0-9]{64}", token):
                raise ValueError("KAG_TOKEN is required for publication")
            result = json_request(args.app_origin.rstrip("/") + "/api/public/agent/dane-publication",
                                  {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                                  {"domain": args.domain, "mx": args.mx, "fingerprint": args.sha256})
            print(result["status"])
    except HTTPError as error:
        sys.exit(f"TLSA check or publication failed (HTTP {error.code})")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
