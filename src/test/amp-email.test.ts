import { describe, expect, it } from 'vitest';
import { AMP_EMAIL_EXAMPLE, AMP_EMAIL_LIMIT, prepareAmpEmail } from '@/lib/amp-email';
import { renderMessage } from '@/lib/sending.server';

const campaign = {
  from_name: 'Email Direct', from_email: 'news@example.org', reply_to: null,
  subject: 'Nouveautés', html: '<h1>Bonjour {first_name}</h1><p>Déjà disponible &amp; <a href="https://example.org/promo">Découvrir</a></p>',
};
const recipient = {
  id: '11111111-2222-3333-4444-555555555555', email: 'contact@example.net',
  first_name: 'Zoé', unsub_token: 'recipient-token',
};
const origin = 'https://dashboard.example.org';
const unsubscribe = origin + '/api/public/unsub/recipient-token';

function parts(message: string) {
  const boundary = message.match(/boundary="([^"]+)"/)?.[1];
  expect(boundary).toBeTruthy();
  expect(message).toMatch(/--ed-[a-f0-9-]+--\r\n$/);
  return message.split('--' + boundary).slice(1, -1).map(part => {
    const [headers, body] = part.split('\r\n\r\n');
    expect(headers).toContain('Content-Transfer-Encoding: base64');
    const lines = body!.trim().split('\r\n');
    expect(lines.every(line => line.length <= 76)).toBe(true);
    return {
      type: headers?.match(/Content-Type: ([^;]+)/)?.[1],
      body: Buffer.from(lines.join(''), 'base64').toString('utf8'),
    };
  });
}

describe('AMP email', () => {
  it('prechecks structure, limits bytes, and requires HTTPS for dynamic endpoints', () => {
    expect(prepareAmpEmail(AMP_EMAIL_EXAMPLE)).toContain('href="{unsubscribe_url}"');
    expect(() => prepareAmpEmail('<p>HTML ordinaire</p>')).toThrow('doctype');
    expect(() => prepareAmpEmail(AMP_EMAIL_EXAMPLE.replace('cdn.ampproject.org', 'example.org'))).toThrow('extensions AMP');
    expect(() => prepareAmpEmail(AMP_EMAIL_EXAMPLE.replace('</body>', '<form action-xhr="http://example.org"></form></body>'))).toThrow('HTTPS');
    expect(() => prepareAmpEmail(AMP_EMAIL_EXAMPLE.replace('</body>', '<a href="java&#x9;script:alert(1)">Lancer</a></body>'))).toThrow('interdit');
    expect(() => prepareAmpEmail(AMP_EMAIL_EXAMPLE.replace('</body>', 'é'.repeat(AMP_EMAIL_LIMIT / 2) + '</body>'))).toThrow('200 ko');
  });

  it('sends plain text, AMP, and HTML in order while retaining recipient opt-outs', () => {
    const amp_html = prepareAmpEmail(AMP_EMAIL_EXAMPLE.replace('</body>', '<p>{{unsubscribe_url}}</p></body>'));
    const message = renderMessage({ ...campaign, amp_html }, recipient, origin);
    expect(message).toContain('List-Unsubscribe: <' + unsubscribe + '>');
    expect(message).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    const alternatives = parts(message);
    expect(alternatives.map(part => part.type)).toEqual(['text/plain', 'text/x-amp-html', 'text/html']);
    expect(alternatives[0]?.body).toContain('Bonjour Zoé');
    expect(alternatives[0]?.body).toContain('Déjà disponible & Découvrir https://example.org/promo');
    expect(alternatives[0]?.body).toContain(unsubscribe);
    expect(alternatives[1]?.body).toContain('{{unsubscribe_url}}');
    expect(alternatives[1]?.body).toContain('href="' + unsubscribe + '"');
    expect(alternatives[1]?.body).toContain('/preferences/recipient-token');
    expect(alternatives[1]?.body).toContain('</p>\n</body>');
    expect(alternatives[1]?.body).not.toContain('/api/public/t/');
    expect(alternatives[2]?.body).toContain('/api/public/c/');
    expect(alternatives[2]?.body).toContain('/api/public/t/');
  });

  it('keeps plain text and HTML available without AMP or when AMP exceeds the size limit', () => {
    expect(parts(renderMessage(campaign, recipient, origin)).map(part => part.type)).toEqual(['text/plain', 'text/html']);
    const source = AMP_EMAIL_EXAMPLE.replace('</body>', '<p>PAD</p></body>');
    const padding = 'a'.repeat(AMP_EMAIL_LIMIT - new TextEncoder().encode(prepareAmpEmail(source)).length - 10);
    const amp_html = prepareAmpEmail(source.replace('PAD', padding));
    expect(parts(renderMessage({ ...campaign, amp_html }, recipient, origin)).map(part => part.type)).toEqual(['text/plain', 'text/html']);
  });
});
