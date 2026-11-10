import { afterEach, describe, expect, it, vi } from 'vitest';
import { dmarcRecord, dmarcTree } from '@/lib/dmarc-policy';
import { readDmarcAuthorization, readDmarcPolicy } from '@/lib/dmarc-policy.server';

const dns = (records: Record<string, string[] | number>) => vi.stubGlobal('fetch', vi.fn(async (request: URL) => {
  const name = request.searchParams.get('name')!;
  const data = records[name];
  const json = Array.isArray(data)
    ? { Status: 0, Answer: data.map(text => ({ type: 16, data: text })) }
    : { Status: data ?? 3 };
  return new Response(JSON.stringify(json), { status: 200 });
}));

afterEach(() => vi.unstubAllGlobals());

describe('DMARC subtree policies', () => {
  it('checks the receiver DNS and rejects an override to an unrelated host', async () => {
    const name = 'example.org._report._dmarc.reports.example.net';
    const check = () => readDmarcAuthorization('example.org', 'reports.example.net');
    dns({ [name]: ['"v=DMARC1; rua=mailto:reports@reports.example.net"'] });
    await expect(check()).resolves.toEqual({ name, status: 'authorized' });
    dns({ [name]: ['"v=DMARC1; rua=mailto:reports@example.com"'] });
    await expect(check()).resolves.toEqual({ name, status: 'missing' });
    dns({ [name]: 2 });
    await expect(check()).resolves.toEqual({ name, status: 'unknown' });
  });
  it('generates a branch record and the external report authorization name', () => {
    const options = { domain: 'MARKETING.Example.COM.', policy: 'quarantine', children: 'reject',
      organizational: true, strict: true, aggregate: 'dmarc@reports.example.net' } as const;
    expect(dmarcRecord(options)).toEqual({
      name: '_dmarc.marketing.example.com',
      value: 'v=DMARC1; p=quarantine; sp=reject; psd=n; adkim=s; aspf=s; rua=mailto:dmarc@reports.example.net',
      authorization: 'marketing.example.com._report._dmarc.reports.example.net',
    });
    expect(dmarcRecord({ ...options, aggregate: 'dmarc@reports.example.net; p=none' })).toBeNull();
    expect(dmarcTree('a.b.c.d.e.f.g.h.i.example.com')).toEqual([
      'a.b.c.d.e.f.g.h.i.example.com', 'e.f.g.h.i.example.com', 'f.g.h.i.example.com',
      'g.h.i.example.com', 'h.i.example.com', 'i.example.com', 'example.com', 'com',
    ]);
  });

  it('applies p on the exact From domain and sp to its inherited branch', async () => {
    dns({
      '_dmarc.marketing.example.com': ['"v=DMARC1; p=quarantine; " "sp=reject; psd=n"'],
      '_dmarc.example.com': ['"v=DMARC1; p=none"'],
    });
    await expect(readDmarcPolicy('marketing.example.com')).resolves.toMatchObject({
      policy: 'quarantine', record: { domain: 'marketing.example.com' },
    });
    await expect(readDmarcPolicy('mta.marketing.example.com')).resolves.toMatchObject({
      policy: 'reject', record: { domain: 'marketing.example.com' },
    });
  });

  it('does not treat an ordinary intermediate record as an organizational boundary', async () => {
    dns({
      '_dmarc.marketing.example.com': ['"v=DMARC1; p=reject; sp=reject"'],
      '_dmarc.example.com': ['"v=DMARC1; p=none; sp=quarantine"'],
    });
    await expect(readDmarcPolicy('mta.marketing.example.com')).resolves.toMatchObject({
      policy: 'quarantine', record: { domain: 'example.com' },
    });
  });

  it('skips conflicting TXT records, applies np for NXDOMAIN, and respects test mode', async () => {
    dns({
      '_dmarc.mta.example.com': ['"v=DMARC1; p=none"', '"v=DMARC1; p=reject"'],
      '_dmarc.example.com': ['"v=DMARC1; p=none; np=reject; t=y"'],
    });
    await expect(readDmarcPolicy('mta.example.com')).resolves.toMatchObject({
      policy: 'quarantine', record: { testing: true }, conflicts: ['_dmarc.mta.example.com'],
    });
  });

  it('distinguishes DNS errors from confirmed absence', async () => {
    dns({ '_dmarc.example.com': 2 });
    await expect(readDmarcPolicy('example.com')).resolves.toMatchObject({ policy: null, uncertain: true });
    dns({});
    await expect(readDmarcPolicy('example.com')).resolves.toMatchObject({ policy: null, uncertain: false });
  });
});
