// Outgoing webhooks: HMAC-SHA256 signed JSON POSTs to registered endpoints.
export const WEBHOOK_EVENTS = ['delivered', 'bounce', 'deferred', 'complaint', 'unsubscribe', 'daily_report', 'test'] as const;
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
  let status = 0, error: string | null = null;
  try {
    const r = await fetch(ep.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ED-Event': event, 'X-ED-Timestamp': ts, 'X-ED-Signature': 'sha256=' + await sign(ep.secret, ts + '.' + body) }, body, signal: AbortSignal.timeout(8000) });
    status = r.status; if (!r.ok) error = `HTTP ${r.status}`;
  } catch (e) { error = (e as Error).message.slice(0, 200); }
  const fails = error ? ep.fail_count + 1 : 0;
  await db.from('webhook_endpoints').update({ last_status: status || null, last_error: error, fail_count: fails, sent_count: ep.sent_count + 1, last_sent_at: new Date().toISOString(), ...(fails >= 20 ? { active: false } : {}) }).eq('id', ep.id);
  return { ok: !error, status, error };
}

// Fire-and-forget to every active endpoint subscribed to the event. Never throws.
export async function fireWebhooks(event: WebhookEvent, data: unknown) {
  try {
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const r = await db.from('webhook_endpoints').select('id,url,secret,fail_count,sent_count').eq('active', true).contains('events', [event]);
    await Promise.all((r.data ?? []).map(ep => deliver(db, ep, event, data)));
  } catch { /* webhooks must never break delivery */ }
}
