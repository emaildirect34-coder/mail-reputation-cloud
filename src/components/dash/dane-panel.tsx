import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { inspectDane } from '@/lib/ops.functions';
import { publishInitialDane } from '@/lib/domains.functions';
import { dmarcDomain } from '@/lib/dmarc-policy';
import { Panel, Pill } from './kit';

const labels = { secure: 'Authentifié DNSSEC', unsigned: 'Non authentifié', absent: 'Absent', unknown: 'Indéterminé' } as const;
type Result = Awaited<ReturnType<typeof inspectDane>>;

export function DanePanel() {
  const inspect = useServerFn(inspectDane);
  const publish = useServerFn(publishInitialDane);
  const [domain, setDomain] = useState('');
  const [mx, setMx] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publication, setPublication] = useState('');
  const host = dmarcDomain(mx);
  const record = host && host.length <= 244 && fingerprint ? `_25._tcp.${host}. IN TLSA 3 1 1 ${fingerprint}` : '';

  async function checkDns() {
    setBusy(true);
    setError('');
    setResult(null);
    setConfirmed(false);
    try {
      setResult(await inspect({ data: { domain, mx } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Contrôle DNS impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function readCertificate(file: File) {
    setReading(true);
    setError('');
    setFingerprint('');
    setCopyMessage('');
    setConfirmed(false);
    setPublication('');
    try {
      if (file.size > 128_000) throw new Error('Certificat trop volumineux.');
      const { tlsaFingerprint } = await import('@/lib/dane');
      setFingerprint(await tlsaFingerprint(await file.text()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Certificat illisible.');
    } finally {
      setReading(false);
    }
  }

  async function publishRecord() {
    if (!confirmed) return;
    setPublishing(true);
    setError('');
    try {
      const status = await publish({ data: { domain, mx, fingerprint, verifiedLiveSmtp: true } });
      setPublication(status === 'published' ? 'TLSA ajouté à Cloudflare. Vérifiez de nouveau le DNS public après propagation.' : 'Cette association est déjà publiée.');
      setConfirmed(false);
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publication impossible.');
    } finally {
      setPublishing(false);
    }
  }

  return <Panel title="DANE / TLSA SMTP">
    <div className="space-y-3">
      <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void checkDns(); }}>
        <label className="grid gap-1 text-sm">Domaine qui reçoit les e-mails
          <Input required placeholder="exemple.fr" value={domain} disabled={busy || publishing} onChange={e => { setDomain(e.target.value); setResult(null); setPublication(''); }} />
        </label>
        <label className="grid gap-1 text-sm">Hôte MX
          <Input required placeholder="mail.exemple.fr" value={mx} disabled={busy || publishing} onChange={e => { setMx(e.target.value); setResult(null); setCopyMessage(''); setPublication(''); }} />
        </label>
        <Button type="submit" variant="outline" disabled={busy || publishing}>{busy ? 'Vérification…' : 'Vérifier le DNS public'}</Button>
      </form>
      {result && <ul className="space-y-1 text-sm" aria-live="polite">
        <li className="flex flex-wrap justify-between gap-1">Hôte dans les MX du domaine <Pill tone={result.mx === 'secure' ? 'ok' : 'warn'}>{labels[result.mx]}</Pill></li>
        <li className="flex flex-wrap justify-between gap-1">TLSA publié pour cet hôte <Pill tone={result.tlsa === 'secure' ? 'ok' : 'warn'}>{labels[result.tlsa]}</Pill></li>
        {fingerprint && <li>{result.fingerprints.includes(fingerprint) ? 'Une entrée TLSA 3 1 1 correspond au certificat fourni.' : 'Aucune entrée TLSA 3 1 1 ne correspond au certificat fourni.'}</li>}
      </ul>}
      <label className="grid gap-1 text-sm">Certificat public SMTP au format PEM
        <Input type="file" accept=".pem,.crt,.cer" disabled={reading || publishing} onChange={event => {
          const file = event.target.files?.[0];
          if (file) void readCertificate(file);
        }} />
      </label>
      {record && <div className="space-y-2">
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{record}</pre>
        <Button type="button" variant="outline" size="sm" onClick={async () => {
          try { await navigator.clipboard.writeText(record); setCopyMessage('Enregistrement copié.'); }
          catch { setCopyMessage('Copiez le texte de l’enregistrement directement.'); }
        }}>Copier le TLSA proposé</Button>
        {copyMessage && <p className="text-xs" role="status">{copyMessage}</p>}
        {result?.canPublish && result.mx === 'secure' && result.authenticatedAbsence && <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmed} disabled={publishing} onCheckedChange={value => setConfirmed(value === true)} />
            J’ai vérifié cette clé sur chaque adresse du MX en SMTP STARTTLS.
          </label>
          <Button type="button" size="sm" disabled={!confirmed || publishing} onClick={() => void publishRecord()}>
            {publishing ? 'Publication…' : 'Publier le premier TLSA sur Cloudflare'}
          </Button>
        </div>}
      </div>}
      {publication && <p className="text-sm" role="status">{publication}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Le certificat reste dans le navigateur. Avant publication, vérifiez la clé réellement présentée en STARTTLS sur chaque adresse du MX. Conservez les anciennes et nouvelles associations TLSA pendant une rotation de clé.</p>
    </div>
  </Panel>;
}
