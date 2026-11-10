import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCampaignRoleMailbox, probableMailDomainTypo, recipientDomain } from '@/lib/email-address';
import { campaignMailRoutes, mailRoute } from '@/lib/mail-dns.server';

afterEach(() => vi.unstubAllGlobals());

describe('campaign address hygiene', () => {
  it('accepts plus-addressing and normalizes IDN domains while rejecting malformed recipients', () => {
    expect(recipientDomain('contact+lettre@exemple.fr')).toBe('exemple.fr');
    expect(recipientDomain('"legacy"@exemple.fr')).toBe('exemple.fr');
    expect(recipientDomain('contact@exämple.fr')).toBe('xn--exmple-cua.fr');
    expect(recipientDomain('double..dot@exemple.fr')).toBeNull();
    expect(recipientDomain('contact@-exemple.fr')).toBeNull();
    expect(recipientDomain('contact@example.fr\r\nBcc: autre@example.fr')).toBeNull();
  });

  it('rejects Null MX without falling back to the domain IP', async () => {
    const lookup = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 15, data: '0 .' }] }));
    vi.stubGlobal('fetch', lookup);
    expect(await mailRoute('null.example')).toBe('no-route');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('allows implicit IPv6 routes and keeps temporary DNS problems separate from missing routes', async () => {
    vi.stubGlobal('fetch', async (url: URL) => {
      if (url.searchParams.get('name') === 'temp.example') return Response.json({ Status: 2 });
      if (url.searchParams.get('name') === 'gone.example') return Response.json({ Status: 3 });
      return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'AAAA' ? [{ type: 28, data: '2001:db8::1' }] : [] });
    });
    expect(await mailRoute('ipv6.example')).toBe('routable');
    expect(await mailRoute('temp.example')).toBe('unknown');
    expect(await mailRoute('gone.example')).toBe('no-route');
  });

  it('deduplicates campaign lookups by domain', async () => {
    const lookup = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.' }] }));
    vi.stubGlobal('fetch', lookup);
    expect(await campaignMailRoutes(['example.fr', 'example.fr'])).toEqual(new Map([['example.fr', 'routable']]));
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
it('recognizes campaign role aliases and keeps typo hints separate from role exclusions', () => {
  expect(isCampaignRoleMailbox('PostMaster+newsletter@example.fr')).toBe(true);
  expect(isCampaignRoleMailbox('"security"@example.fr')).toBe(true);
  expect(isCampaignRoleMailbox('security-team@example.fr')).toBe(false);
  expect(probableMailDomainTypo('gamil.com')).toBe('gmail.com');
});
