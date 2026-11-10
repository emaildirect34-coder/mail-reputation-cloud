import { afterEach, expect, it, vi } from 'vitest';
import { forwardConfirmedIpv4, spfLookupBudget } from '@/lib/sender-dns.server';

afterEach(() => vi.unstubAllGlobals());

it('counts repeated SPF references, reports cycles and ignores an unreachable redirect after all', async () => {
  const records: Record<string, string[]> = {
    'root.example': ['v=spf1 include:relay.example include:relay.example -all redirect=missing.example'],
    'relay.example': ['v=spf1 a mx ~all'],
  };
  const read = async (name: string) => records[name] ?? [];
  expect(await spfLookupBudget('root.example', read)).toEqual({ status: 'ok', terms: 6 });
  records['root.example'] = ['v=spf1 ' + 'include:relay.example '.repeat(4) + '-all'];
  expect(await spfLookupBudget('root.example', read)).toEqual({ status: 'over', terms: 11 });
  records['relay.example'] = ['v=spf1 redirect=root.example'];
  expect(await spfLookupBudget('root.example', read)).toEqual({ status: 'invalid', terms: 2 });
});

it('verifies the public PTR and treats a temporary forward lookup failure as unknown', async () => {
  const ip = '192.0.2.5';
  const fetchDns = vi.fn(async (url: URL) => Response.json(url.searchParams.get('type') === 'PTR'
    ? { Status: 0, Answer: [{ type: 12, data: 'mta.example.org.' }] }
    : { Status: 0, Answer: [{ type: 1, data: ip }] }));
  vi.stubGlobal('fetch', fetchDns);
  const signal = AbortSignal.timeout(1000);
  expect(await forwardConfirmedIpv4(ip, signal)).toEqual({ status: 'ok', hostname: 'mta.example.org' });
  fetchDns.mockImplementation(async (url: URL) => Response.json(url.searchParams.get('type') === 'PTR'
    ? { Status: 0, Answer: [{ type: 12, data: 'mta.example.org.' }] }
    : { Status: 2 }));
  expect(await forwardConfirmedIpv4(ip, signal)).toEqual({ status: 'unknown' });
});
