// This program runs on the managed VPS, not in the site's Worker runtime.
export const eventsScript = String.raw`#!/usr/bin/env python3
import os, json, re, hashlib, datetime, io, ipaddress, urllib.error, urllib.request, uuid
from pathlib import Path
import zstandard

def delivery_event(record, line):
    kinds = {'Delivery':'delivered','Bounce':'bounce','TransientFailure':'deferred','Feedback':'complaint','OOB':'dsn','Reception':'reception'}
    record_type = record.get('type')
    kind = kinds.get(record_type)
    if not kind: return None
    sender = str(record.get('sender',''))
    if record_type == 'Feedback':
        report = record.get('feedback_report') or {}
        if report.get('feedback_type') != 'abuse': return None
        sender = str(report.get('original_mail_from',''))
    sender = sender.strip().strip('<>')
    match = re.fullmatch(r'bounce\+([0-9a-fA-F-]{36}|[0-9a-fA-F]{32}-\d{10}-[A-Za-z0-9_-]{12})@[^\s@]+',sender)
    if not match or len(sender) > 320: return None
    signed = len(match.group(1)) > 36
    try: message_id = str(uuid.UUID(match.group(1)[:32] if signed else match.group(1)))
    except ValueError: return None
    response = record.get('response') or {}
    code = response.get('code') if isinstance(response,dict) else None
    ts = record.get('created') if record_type == 'OOB' else record.get('timestamp',record.get('created'))
    if not isinstance(ts,(int,float)): return None
    if kind == 'reception':
        if record.get('reception_protocol') != 'HTTP' or type(code) is not int or not 200 <= code < 300: return None
        recipient = record.get('recipient')
        if isinstance(recipient,list) and len(recipient) == 1: recipient = recipient[0]
        if not isinstance(recipient,str) or not 0 < len(recipient.strip()) <= 320: return None
        return {'type':kind,'messageId':message_id,'recipient':recipient.strip(),'occurredAt':datetime.datetime.fromtimestamp(ts,datetime.timezone.utc).isoformat()}
    event = {'eventKey':hashlib.sha256(line.encode()).hexdigest(),'messageId':message_id,'type':kind,'occurredAt':datetime.datetime.fromtimestamp(ts,datetime.timezone.utc).isoformat(),'detail':str(response.get('content','') if isinstance(response,dict) else response)[:1000], 'returnPath':sender}
    if kind in ('delivered','bounce'):
        source = re.fullmatch(r'ip-([0-9]{1,3}(?:_[0-9]{1,3}){3})',str(record.get('egress_source') or ''))
        if source:
            try: event['sourceIpv4'] = str(ipaddress.IPv4Address(source.group(1).replace('_','.')))
            except ipaddress.AddressValueError: pass
    if isinstance(code,int) and 100 <= code <= 599: event['smtpCode'] = code
    if type(code) is int and 400 <= code <= 599 and isinstance(response,dict):
        status = response.get('enhanced_code')
        if isinstance(status,dict) and status.get('class') == code // 100:
            subject, suffix = status.get('subject'), status.get('detail')
            if all(type(part) is int and 0 <= part <= 999 for part in (subject,suffix)):
                prefix = f'{code // 100}.{subject}.{suffix}'
                if not re.match(re.escape(prefix) + r'(?:\s|$)',event['detail']):
                    event['detail'] = (prefix + ' ' + event['detail'])[:1000]
    if record_type == 'OOB':
        # Kumo's parsed OOB record uses sender for the inbound envelope RCPT TO,
        # and recipient for the failed Original-Recipient or Final-Recipient.
        if not signed or not isinstance(code,int) or not 500 <= code <= 599: return None
        status = response.get('enhanced_code')
        if not isinstance(status,dict) or status.get('class') != 5: return None
        parts = [status.get('subject'), status.get('detail')]
        if not all(type(part) is int and 0 <= part <= 999 for part in parts): return None
        recipient = record.get('recipient')
        if isinstance(recipient,list) and len(recipient) == 1: recipient = recipient[0]
        if not isinstance(recipient,str) or not 0 < len(recipient.strip()) <= 320: return None
        event['dsn'] = {'recipient':recipient.strip(), 'status':f'5.{parts[0]}.{parts[1]}'}
        event['detail'] = ''
    return event

def main():
    token = Path('/etc/kumo-agent/env').read_text().strip().split('=',1)[1]
    base = os.environ['KUMO_AGENT_API']
    state_path = Path('/etc/kumo-agent/event-cursors.json')
    try: state = json.loads(state_path.read_text())
    except (FileNotFoundError, ValueError): state = {}
    files = sorted(path for path in Path('/var/log/kumomta').rglob('*') if path.is_file() and
                   (path.suffix == '.zst' or re.fullmatch(r'\d{8}-\d{6}(?:[-.]\d+)?', path.name)))
    pending = []
    def save_state():
        tmp = state_path.with_suffix('.tmp'); tmp.write_text(json.dumps(state)); tmp.chmod(0o600); tmp.replace(state_path)
    def flush():
        if not pending: return
        events = [e for e,_,_ in pending if e['type'] != 'reception']
        receptions = [{k:v for k,v in e.items() if k != 'type'} for e,_,_ in pending if e['type'] == 'reception']
        req = urllib.request.Request(base+'/events', data=json.dumps({'events':events,'receptions':receptions}).encode(), headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200: raise RuntimeError('Events not acknowledged')
        for _, path, line in pending: state[path] = max(state.get(path,0),line)
        save_state()
        pending.clear()
    for path in files:
        key = str(path); skip = state.get(key,0)
        try:
            with path.open('rb') as raw, zstandard.ZstdDecompressor().stream_reader(raw) as stream, io.TextIOWrapper(stream) as lines:
                for num, line in enumerate(lines,1):
                    if num <= skip: continue
                    if not line.endswith('\n'): break
                    record = json.loads(line)
                    if record.get('type') == 'Reception' and str(record.get('recipient','')).lower().startswith('unsubscribe@'):
                        # RFC 8058 mailto fallback: Subject carries the unsubscribe token.
                        subj = str((record.get('headers') or {}).get('Subject',''))
                        tok = re.search(r'\b([0-9a-f]{36})\b', subj)
                        if tok:
                            flush()
                            req = urllib.request.Request(base.rsplit('/agent',1)[0]+'/unsub/'+tok.group(1), data=b'', headers={'Authorization':'Bearer '+token}, method='POST')
                            try:
                                with urllib.request.urlopen(req, timeout=15): pass
                            except urllib.error.HTTPError as error:
                                if error.code != 404: raise
                            state[key] = num
                            save_state()
                        continue
                    event = delivery_event(record, line)
                    if event is None: continue
                    pending.append((event,key,num))
                    if len(pending)>=200: flush()
        except (zstandard.ZstdError, json.JSONDecodeError):
            # Open segments are retried; cursors move only after acknowledgment.
            pass
        flush()
if __name__ == '__main__': main()
`;
