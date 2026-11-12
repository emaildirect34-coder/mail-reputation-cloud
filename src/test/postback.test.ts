import { describe, it, expect } from 'vitest';
import { parsePostback, fillClickId, purchasePostbackSignal } from '../lib/postback';
const t = 'a'.repeat(36);
describe('postback', () => {
  it('parses payout in cents and defaults to approved', () => { expect(parsePostback(new URLSearchParams(`click_id=${t}&payout=12.5&txid=X1`))).toEqual({ clickId: t, txid: 'X1', amountCents: 1250, status: 'approved', currency: null }); });
  it('maps reversed to rejected', () => { const r = parsePostback(new URLSearchParams(`sub1=${t}&amount=3&status=reversed`)); expect('status' in r && r.status).toBe('rejected'); });
  it('rejects unknown click ids', () => { expect(parsePostback(new URLSearchParams('click_id=abc'))).toEqual({ error: 'click_id invalide' }); });
  it('fills the click macro', () => { expect(fillClickId('https://x.com/?s={click_id}', t)).toBe(`https://x.com/?s=${t}`); });
  it('requires an explicit transaction and status before treating a postback as a purchase signal', () => {
    const signal = (value: string) => purchasePostbackSignal(new URLSearchParams(value));
    expect(signal('event=purchase&status=approved')).toEqual({ event: null, status: null });
    expect(signal('txid=order-1&event=purchase')).toEqual({ event: 'purchase', status: null });
    expect(signal('txid=order-1&event_id=42&status=confirmed')).toEqual({ event: '42', status: 'approved' });
    expect(signal('txid=order-1&status=refunded')).toEqual({ event: null, status: 'rejected' });
    expect(signal('txid=%7Btransaction_id%7D&event=purchase&status=approved').status).toBeNull();
  });
});
