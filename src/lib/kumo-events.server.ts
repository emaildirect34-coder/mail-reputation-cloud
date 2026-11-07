// This program runs on the managed VPS, not in the site's Worker runtime.
export const eventsScript = String.raw`#!/usr/bin/env python3
import os, json, re, hashlib, datetime, io, urllib.request
from pathlib import Path
import zstandard

def main():
    token = Path('/etc/kumo-agent/env').read_text().strip().split('=',1)[1]
    base = os.environ['KUMO_AGENT_API']
    state_path = Path('/etc/kumo-agent/event-cursors.json')
    try: state = json.loads(state_path.read_text())
    except (FileNotFoundError, ValueError): state = {}
    kinds = {'Delivery':'delivered','Bounce':'bounce','TransientFailure':'deferred','Feedback':'complaint'}
    files = sorted(Path('/var/log/kumomta').rglob('*.zst'))
    pending = []
    def flush():
        if not pending: return
        req = urllib.request.Request(base+'/events', data=json.dumps({'events':[e for e,_,_ in pending]}).encode(), headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200: raise RuntimeError('Events not acknowledged')
        for _, path, line in pending: state[path] = max(state.get(path,0),line)
        tmp = state_path.with_suffix('.tmp'); tmp.write_text(json.dumps(state)); tmp.chmod(0o600); tmp.replace(state_path)
        pending.clear()
    for path in files:
        key = str(path); skip = state.get(key,0)
        try:
            with path.open('rb') as raw, zstandard.ZstdDecompressor().stream_reader(raw) as stream, io.TextIOWrapper(stream) as lines:
                for num, line in enumerate(lines,1):
                    if num <= skip: continue
                    if not line.endswith('\n'): break
                    record = json.loads(line)
                    kind = kinds.get(record.get('type'))
                    sender = str(record.get('sender',''))
                    if record.get('type') == 'Feedback':
                        report = record.get('feedback_report') or {}
                        if report.get('feedback_type') != 'abuse': continue
                        sender = str(report.get('original_mail_from',''))
                    match = re.search(r'bounce\+([0-9a-fA-F-]{36})@',sender)
                    if not kind or not match: continue
                    ts = record.get('timestamp',record.get('created'))
                    if not isinstance(ts,(int,float)): continue
                    response = record.get('response') or {}
                    code = response.get('code') if isinstance(response,dict) else None
                    event = {'eventKey':hashlib.sha256(line.encode()).hexdigest(),'messageId':match.group(1),'type':kind,'occurredAt':datetime.datetime.fromtimestamp(ts,datetime.timezone.utc).isoformat(),'detail':str(response.get('content','') if isinstance(response,dict) else response)[:1000]}
                    if isinstance(code,int) and 100 <= code <= 599: event['smtpCode'] = code
                    pending.append((event,key,num))
                    if len(pending)>=200: flush()
        except (zstandard.ZstdError, json.JSONDecodeError):
            # Open segments are retried; cursors move only after acknowledgment.
            pass
        flush()
if __name__ == '__main__': main()
`;