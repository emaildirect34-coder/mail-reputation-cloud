// Pure parsing of S2S postback parameters (Everflow, Cake, Tune, Affise, CJ…).
export type Postback = { clickId: string; txid: string; amountCents: number; status: 'pending' | 'approved' | 'rejected'; currency: 'EUR' | 'USD' | 'GBP' | null };
const pick = (p: URLSearchParams, keys: string[]) => { for (const k of keys) { const v = p.get(k); if (v && v.trim()) return v.trim(); } return ''; };
export function parsePostback(p: URLSearchParams): Postback | { error: string } {
  const clickId = pick(p, ['click_id', 'clickid', 'sub1', 'aff_sub', 's1', 'subid']).toLowerCase();
  if (!/^[0-9a-f]{36}$/.test(clickId)) return { error: 'click_id invalide' };
  const raw = pick(p, ['payout', 'amount', 'revenue', 'sum']).replace(',', '.') || '0';
  if (!/^\d+(\.\d+)?$/.test(raw)) return { error: 'payout invalide' };
  const amountCents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents > 100000000000) return { error: 'payout trop élevé' };
  const txid = (pick(p, ['txid', 'transaction_id', 'conversion_id', 'order_id']) || clickId).slice(0, 120);
  const s = pick(p, ['status', 'state']).toLowerCase();
  const status = ['rejected', 'reject', 'declined', 'reversed', '0', 'chargeback'].includes(s) ? 'rejected' : ['pending', 'hold', '2'].includes(s) ? 'pending' : 'approved';
  const c = pick(p, ['currency', 'cur']).toUpperCase();
  return { clickId, txid, amountCents, status, currency: c === 'EUR' || c === 'USD' || c === 'GBP' ? c : null };
}
const clickMacro = /\{click_id\}|%7bclick_id%7d/gi;
export const hasClickId = (url: string) => url.search(clickMacro) >= 0;
export const fillClickId = (url: string, token: string) => url.replace(clickMacro, token);
export async function sha256Hex(s: string) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
