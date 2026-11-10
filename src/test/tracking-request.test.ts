import { describe, expect, it } from 'vitest';
import { activatedNavigation, isSpeculativeRequest, isTemplateLink, localForm, readTrackingForm, singleFormValue } from '../lib/tracking-request';
import { fillClickId, hasClickId } from '../lib/postback';

describe('tracking request qualification', () => {
  it('records an affirmative navigation and treats speculative requests as unqualified', () => {
    const headers = new Headers({ 'Sec-Fetch-User': '?1', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });
    expect(activatedNavigation(headers)).toBe(true);
    headers.set('Sec-Purpose', 'prefetch;prerender');
    expect(isSpeculativeRequest(headers)).toBe(true);
    expect(activatedNavigation(headers)).toBe(false);
    expect(activatedNavigation(new Headers())).toBe(false);
  });

  it('supports explicit same-origin and legacy form submission without a browser fingerprint', () => {
    expect(localForm(new Headers({ 'Sec-Fetch-Site': 'same-origin' }))).toBe(true);
    expect(localForm(new Headers())).toBe(true);
    expect(localForm(new Headers({ 'Sec-Fetch-Site': 'cross-site' }))).toBe(false);
  });

  it('reads both RFC 8058 encodings and rejects duplicate and oversized values', async () => {
    const url = 'https://example.test/api/public/unsub/000000000000000000000000000000000000';
    const encoded = (body: string) => new Request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    expect(singleFormValue(await readTrackingForm(encoded('List-Unsubscribe=One-Click')), 'List-Unsubscribe', 'One-Click')).toBe(true);
    const multipart = new Request(url, {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test-boundary' },
      body: '--test-boundary\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--test-boundary--\r\n',
    });
    expect(singleFormValue(await readTrackingForm(multipart), 'List-Unsubscribe', 'One-Click')).toBe(true);
    expect(singleFormValue(await readTrackingForm(encoded('List-Unsubscribe=One-Click&List-Unsubscribe=One-Click')), 'List-Unsubscribe', 'One-Click')).toBe(false);
    expect(await readTrackingForm(encoded('test=' + 'a'.repeat(9000)))).toBeNull();
  });

  it('recognizes the sponsor macro with either encoding', () => {
    expect(hasClickId('https://example.test/?sub={click_id}')).toBe(true);
    expect(hasClickId('https://example.test/?sub=%7bclick_id%7D')).toBe(true);
    expect(fillClickId('https://example.test/?sub={click_id}', '')).toBe('https://example.test/?sub=');
  });

  it('accepts complete template links and rejects embedded URL fragments', () => {
    const html = '<a href="https://example.test/?next=https://other.test&amp;sub={click_id}">Lien</a>';
    expect(isTemplateLink(html, 'https://example.test/?next=https://other.test&sub={click_id}')).toBe(true);
    expect(isTemplateLink(html, 'https://other.test')).toBe(false);
  });
});
