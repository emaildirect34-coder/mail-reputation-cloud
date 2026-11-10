import json
import os
import smtplib
import socket
import sys
import time
from email.message import EmailMessage
from urllib.error import HTTPError
from urllib.request import Request, urlopen

with open("/opt/mail-tester/.env") as settings:
    config = dict(line.strip().split("=", 1) for line in settings if "=" in line)

base = f"https://{config['API_HOST']}/api/v1/tests"

if len(sys.argv) == 2:
    original_getaddrinfo = socket.getaddrinfo

    def resolve(host, *args, **kwargs):
        if host in (config["API_HOST"], "mx-check.mailsuite.me"):
            host = sys.argv[1]
        return original_getaddrinfo(host, *args, **kwargs)

    socket.getaddrinfo = resolve

try:
    urlopen(Request(base, method="POST"), timeout=10)
except HTTPError as error:
    assert error.code == 401, error
else:
    raise RuntimeError("Bearer authentication missing")


def request(path="", method="GET"):
    headers = {"Authorization": f"Bearer {config['API_TOKEN']}"}
    with urlopen(Request(base + path, method=method, headers=headers), timeout=10) as response:
        return response.status, json.load(response)


code, test = request(method="POST")
assert code == 201, code
path = "/" + test["test_id"]
assert request(path) == (200, {"status": "waiting"})
message = EmailMessage()
message["From"] = "smoke@example.org"
message["To"] = test["email"]
message["Subject"] = "Mail tester installation check"
message.set_content("A simple message to check SMTP, the queue and the HTTPS result.")
with smtplib.SMTP("mx-check.mailsuite.me", timeout=10) as smtp:
    smtp.send_message(message)
for _ in range(100):
    _, result = request(path)
    if result["status"] == "done":
        print(json.dumps({
            "status": result["status"], "score": result["score"],
            "checks": {name: ("score" in check if name in ("rspamd", "spamassassin") else check["pass"])
                       for name, check in result["checks"].items()},
        }))
        assert all("score" in result["checks"][engine] for engine in ("rspamd", "spamassassin"))
        if os.getenv("EXPECT_ADVANCED"):
            assert {"rbl", "links", "rfc8058", "dmarc_alignment", "mta_sts", "dane_tlsa",
                    "bimi_vmc", "subnet24", "fr_isp", "gmail_yahoo_2024"} <= result["checks"].keys()
        assert all(check["pass"] or check.get("fix") for check in result["checks"].values())
        break
    time.sleep(1)
else:
    raise RuntimeError("Analysis timed out")
