// Runs on the sending host. Local KumoMTA admin endpoints stay on loopback.
export const campaignControlScript = String.raw`#!/usr/bin/env python3
import json, os, re
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

REASON = 'Email Direct campaign hold'
PROVIDER_REASON = 'Email Direct destination hold'
LOCAL = 'http://127.0.0.1:8000/api/admin/suspend/v1'
UUID = re.compile(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}')
DOMAIN = re.compile(r'[a-z0-9][a-z0-9.-]{0,252}')

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = build_opener(NoRedirect())

def request(url, method='GET', payload=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    body = json.dumps(payload).encode() if payload is not None else None
    with opener.open(Request(url, headers=headers, data=body, method=method), timeout=10) as response:
        data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError('Campaign control response too large')
        return json.loads(data) if data and method != 'DELETE' else None

def ids(data, key):
    values = data[key]
    if not isinstance(values, list) or not all(isinstance(x, str) and UUID.fullmatch(x) for x in values):
        raise ValueError('Invalid campaign control response')
    return set(values)

def synchronize(api, token):
    data = request(api, token=token)
    desired = ids(data, 'holds')
    local = request(LOCAL)
    if not isinstance(local, list):
        raise ValueError('Invalid KumoMTA suspend list')
    if 'providerHolds' in data:
        sync_provider_holds(data['providerHolds'], local)
    exact = [rule for rule in local if rule.get('campaign') and not any(rule.get(k) for k in ('domain', 'tenant', 'queue_names'))]
    present = {rule['campaign'] for rule in exact}
    owned = {rule['campaign']: rule['id'] for rule in exact if rule.get('reason') == REASON}

    for campaign in sorted(desired - present):
        request(LOCAL, 'POST', {'campaign': campaign, 'duration': '365 days', 'reason': REASON})

    candidates = sorted(set(owned) - desired)
    for start in range(0, len(candidates), 200):
        batch = candidates[start:start + 200]
        releases = ids(request(api, 'POST', {'action': 'release', 'ids': batch}, token), 'releases')
        for campaign in releases.intersection(batch):
            try:
                request(LOCAL, 'DELETE', {'id': owned[campaign]})
            except HTTPError as error:
                if error.code != 404:
                    raise

def sync_provider_holds(values, local):
    desired = {}
    for rule in values:
        campaign, domain, until = rule['campaign'], rule['domain'], rule['until_at']
        if not UUID.fullmatch(campaign) or not DOMAIN.fullmatch(domain):
            raise ValueError('Invalid provider hold')
        key = (campaign, domain)
        if key not in desired or until is None:
            desired[key] = until
    owned = {}
    for rule in local:
        reason = rule.get('reason') or ''
        if reason.startswith(PROVIDER_REASON + '|') and rule.get('campaign') and rule.get('domain'):
            owned.setdefault((rule['campaign'], rule['domain']), []).append(rule)
    for key, until in desired.items():
        campaign, domain = key
        reason = PROVIDER_REASON + '|' + (until or 'manual')
        if not any(rule.get('reason') == reason for rule in owned.get(key, [])):
            expiry = {'expires': until} if until else {'duration': '365 days'}
            request(LOCAL, 'POST', {'campaign': campaign, 'domain': domain, 'reason': reason, **expiry})
        owned[key] = [rule for rule in owned.get(key, []) if rule.get('reason') != reason]
    for rules in owned.values():
        for rule in rules:
            try:
                request(LOCAL, 'DELETE', {'id': rule['id']})
            except HTTPError as error:
                if error.code != 404:
                    raise

if __name__ == '__main__':
    bearer = Path('/etc/kumo-agent/env').read_text().strip().split('=', 1)[1]
    synchronize(os.environ['KUMO_AGENT_API'] + '/campaign-control', bearer)
`;
