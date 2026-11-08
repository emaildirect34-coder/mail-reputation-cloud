import { describe, it, expect } from 'vitest';
import { parsePostback, fillClickId } from '@/lib/postback';
const t = 'a'.repeat(36);
describe('postback', () => {
  it('parses payout in cents and defaults to approved', () => { expect(parsePostback(new URLSearchParams(`click_id=${t}&payout=12.5&txid=X1`))).toEqual({ clickId: t, txid: 'X1', amountCents: 1250, status: 'approved', currency: null }); });
  it('maps reversed to rejected', () => { const r = parsePostback(new URLSearchParams(`sub1=${t}&amount=3&status=reversed`)); expect('status' in r && r.status).toBe('rejected'); });
  it('rejects unknown click ids', () => { expect(parsePostback(new URLSearchParams('click_id=abc'))).toEqual({ error: 'click_id invalide' }); });
  it('fills the click macro', () => { expect(fillClickId('https://x.com/?s={click_id}', t)).toBe(`https://x.com/?s=${t}`); });
});
