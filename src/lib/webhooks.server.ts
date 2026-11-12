// Outgoing webhooks: HMAC-SHA256 signed JSON POSTs to registered endpoints.
export const WEBHOOK_EVENTS = ['delivered', 'bounce', 'deferred', 'complaint', 'unsubscribe', 'daily_report', 'tls_expiration', 'test'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function deliver(db: any, ep: { id: string; url: string; secret: string; fail_count: number; sent_count: number }, event: string, data: unknown) {
  // Slack / Discord incoming webhooks expect plain text, not our signed JSON envelope.
  const text = (data as any)?.text ?? `Email Direct — ${event}`;
  const body = /hooks\.slack\.com/.test(ep.url) ? JSON.stringify({ text }) : /discord(app)?\.com\/api\/webhooks/.test(ep.url) ? JSON.stringify({ content: String(text).slice(0, 1900) }) : JSON.stringify({ event, sent_at: new Date().toISOString(), data });
  const ts = Math.floor(Date.now() / 1000).toString();
  let status = 0, error: string | null = null;const started=Date.now();
  try {
    const r = await fetch(ep.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ED-Event': event, 'X-ED-Timestamp': ts, 'X-ED-Signature': 'sha256=' + await sign(ep.secret, ts + '.' + body) }, body, signal: AbortSignal.timeout(8000) });
    status = r.status; if (!r.ok) error = `HTTP ${r.status}`;
  } catch (e) { error = (e as Error).message.slice(0, 200); }
  const durationMs=Math.max(0,Date.now()-started);
  const fails = error ? ep.fail_count + 1 : 0;
  await db.from('webhook_endpoints').update({ last_status: status || null, last_error: error, last_duration_ms:durationMs,fail_count: fails, sent_count: ep.sent_count + 1, last_sent_at: new Date().toISOString(), ...(fails >= 20 ? { active: false } : {}) }).eq('id', ep.id);
  try{await db.from('webhook_delivery_attempts').insert({endpoint_id:ep.id,event,ok:!error,status_code:status||null,duration_ms:durationMs,error});}catch{/* Keep delivery independent from metrics retention. */}
  return { ok: !error, status, error,durationMs };
}

// Fire-and-forget to every active endpoint subscribed to the event. Never throws.
export async function fireWebhooks(event: WebhookEvent, data: unknown) {
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db: any = supabaseAdmin;
    const r = await db.from('webhook_endpoints').select('id,url,secret,fail_count,sent_count').eq('active', true).contains('events', [event]);
    await Promise.all((r.data ?? []).map(async ep => {
      const result = await deliver(db, ep, event, data);
      if (!result.ok) {
        const queued = await db.from('webhook_retry_deliveries').insert({ endpoint_id: ep.id, event, payload: data, attempt_count: 1, next_attempt_at: new Date(Date.now() + 60_000).toISOString(), last_status: result.status || null, last_error: result.error });
        if (queued.error) console.error('Webhook retry could not be queued', ep.id, queued.error.code);
      }
    }));
    return (r.data?.length ?? 0)>0;
  } catch { /* webhooks must never break delivery */ return false; }
}

export async function retryDueWebhooks(db: any, limit = 50) {
  const claimed = await db.rpc('claim_webhook_retries', { _limit: limit });
  if (claimed.error) throw new Error('Impossible de récupérer la file de nouvelles tentatives.');
  let sent = 0, deferred = 0, dead = 0;
  for (const row of claimed.data ?? []) {
    const endpoint = await db.from('webhook_endpoints').select('id,url,secret,fail_count,sent_count,active').eq('id', row.endpoint_id).maybeSingle();
    if (endpoint.error || !endpoint.data?.active) {
      await db.from('webhook_retry_deliveries').update({ status: 'dead', lease_until: null, last_error: endpoint.data ? 'Endpoint désactivé' : 'Endpoint supprimé' }).eq('id', row.id);
      dead++; continue;
    }
    const outcome = await deliver(db, endpoint.data, row.event, row.payload);
    if (outcome.ok) {
      await db.from('webhook_retry_deliveries').update({ status: 'sent', sent_at: new Date().toISOString(), lease_until: null, last_status: outcome.status, last_error: null }).eq('id', row.id);
      sent++; continue;
    }
    const attempts = row.attempt_count + 1;
    const terminal = attempts >= 12;
    const delayMs = Math.min(24 * 60 * 60_000, 60_000 * 2 ** Math.min(attempts - 1, 10));
    await db.from('webhook_retry_deliveries').update({ status: terminal ? 'dead' : 'queued', attempt_count: attempts, next_attempt_at: new Date(Date.now() + delayMs).toISOString(), lease_until: null, last_status: outcome.status || null, last_error: outcome.error }).eq('id', row.id);
    if (terminal) dead++; else deferred++;
  }
  return { claimed: claimed.data?.length ?? 0, sent, deferred, dead };
}
