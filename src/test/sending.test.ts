import { describe, it, expect, vi } from 'vitest';
import { parseContacts, assignServers, concentratedImport } from '@/lib/sending.schemas';
import { renderMessage } from '@/lib/sending.server';
import PostalMime from 'postal-mime';

describe('sending rules', () => {
  it('serializes MIME with CRLF and leaves SMTP transparency to the transport', async () => {
    const html = '<p>Alpha</p>\n.\r<p>Beta</p>\r\n..';
    const mime = renderMessage({ from_name: 'Example', from_email: 'sender@example.org', reply_to: null, subject: 'Hello', html },
      { id: 'message-id', email: 'dest@example.org', first_name: null, unsub_token: 'token' }, 'https://example.org');
    expect(mime.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect((await PostalMime.parse(mime)).html).toContain('Alpha');
    expect((await PostalMime.parse(mime)).html).toContain('..');
    expect((await PostalMime.parse(mime)).text).toContain('Alpha');
    expect((await PostalMime.parse(mime)).text).toContain('/api/public/unsub/token');
  });
  it('uses the same configured Feedback-ID for every recipient of a campaign', () => {
    vi.stubEnv('GMAIL_FEEDBACK_SENDER_ID', 'EmailDirect');
    try {
      const id = 'c30d9512-234c-4f27-baf5-8f0935a949d5';
      const campaign = { id, list_id: id, from_name: 'Example', from_email: 'sender@example.org', reply_to: null, subject: 'Hello', html: '<p>Bonjour</p>' };
      const message = { id: 'message-id', email: 'dest@example.org', first_name: null, unsub_token: 'token' };
      const origin = 'https://app.example.org';
      const headers = (mime: string) => mime.match(/^Feedback-ID:.*$/gm);
      const expected = [`Feedback-ID: ${id}:marketing:EmailDirect`];
      expect(headers(renderMessage(campaign, message, origin))).toEqual(expected);
      expect(headers(renderMessage(campaign, { ...message, email: 'second@gmail.com' }, origin))).toEqual(expected);
      expect(headers(renderMessage({ ...campaign, list_id: null }, message, origin))).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });
  it('emits stable list identifiers and only configured support endpoints', () => {
    const campaign = { from_name: 'Example', from_email: 'sender@example.org', reply_to: null, subject: 'Hello', html: '<p>Bonjour</p>' };
    const message = { id: 'message-id', email: 'dest@example.org', first_name: null, unsub_token: 'token' };
    const origin = 'https://app.example.org';
    const id = 'c30d9512-234c-4f27-baf5-8f0935a949d5';
    vi.stubEnv('LIST_ID_DOMAIN', 'lists.example.org');
    vi.stubEnv('LIST_HELP_URL', 'https://help.example.org/newsletter');
    vi.stubEnv('LIST_OWNER_EMAIL', 'support@example.org');
    vi.stubEnv('LIST_ARCHIVE_URL', '');
    try {
      const sent = renderMessage({ ...campaign, list_id: id }, message, origin);
      expect(sent).toContain(`List-Id: <${id}.lists.example.org>`);
      expect(sent).toContain('List-Help: <https://help.example.org/newsletter>');
      expect(sent).toContain('List-Owner: <mailto:support@example.org>');
      expect(sent).toContain('Precedence: bulk\r\n');
      expect(sent).toContain('X-Auto-Response-Suppress: OOF, AutoReply\r\n');
      expect(renderMessage(campaign, message, origin)).not.toContain('List-Id:');
      expect(renderMessage(campaign, message, origin)).not.toContain('Precedence: bulk');
      expect(sent).not.toContain('List-Archive:');
      vi.stubEnv('LIST_ARCHIVE_URL', 'https://lists.example.org/archive');
      expect(renderMessage({ ...campaign, list_id: id }, message, origin)).toContain('List-Archive: <https://lists.example.org/archive>');
    } finally { vi.unstubAllEnvs(); }
  });
  it('folds long Unicode subjects and keeps display names and message identity readable', async () => {
    const subject = 'Café ☕ '.repeat(40).trimEnd();
    const mime = renderMessage({ from_name: 'Club, Paris', from_email: 'sender@example.org', reply_to: null, subject, html: '<p>Bonjour</p>' },
      { id: 'message-id', email: 'dest@example.org', first_name: null, unsub_token: 'token' }, 'https://example.org');
    const subjectHeader = mime.match(/^Subject: [^\r\n]*(?:\r\n [^\r\n]*)*/m)?.[0];
    expect(subjectHeader?.split('\r\n').every(line => line.length <= 78)).toBe(true);
    const parsed = await PostalMime.parse(mime);
    expect(parsed.subject).toBe(subject);
    expect(parsed.from).toEqual({ name: 'Club, Paris', address: 'sender@example.org' });
    expect(parsed.messageId).toBe('<message-id@example.org>');
  });
  it('drops invalid and duplicate emails, keeps first name', () => {
    expect(parseContacts('Jean@Ex.fr,Jean\nbad\njean@ex.fr,Dup\nm@x.io')).toEqual([{ email: 'jean@ex.fr', first_name: 'Jean' }, { email: 'm@x.io', first_name: null }]);
  });
  it('flags a large concentrated import but allows smaller and mixed batches', () => {
    const orange = Array.from({ length: 200 }, (_, i) => ({ email: `member${i}@orange.fr` }));
    const other = Array.from({ length: 60 }, (_, i) => ({ email: `member${i}@example.org` }));
    expect(concentratedImport([...orange, ...other.slice(0, 50)])).toEqual({ domain: 'orange.fr', count: 200, total: 250 });
    expect(concentratedImport(orange.slice(0, 199))).toBeNull();
    expect(concentratedImport([...orange, ...other])).toBeNull();
  });
  it('spreads recipients across servers in turn', () => {
    expect(assignServers([1, 2, 3], ['a', 'b']).map(r => r.server)).toEqual(['a', 'b', 'a']);
  });
  it('imports explicitly mapped IANA time zones and keeps the legacy two-column behavior', () => {
    expect(parseContacts('j@x.fr,Jean, Europe/Paris \nm@x.io,,', true)).toEqual([
      { email: 'j@x.fr', first_name: 'Jean', time_zone: 'Europe/Paris' },
      { email: 'm@x.io', first_name: null },
    ]);
    expect(parseContacts('j@x.fr,Jean,France')).toEqual([{ email: 'j@x.fr', first_name: 'Jean' }]);
    expect(() => parseContacts('email,prenom,fuseau\nj@x.fr,Jean,+02:00', true)).toThrow('ligne 2');
  });
});
