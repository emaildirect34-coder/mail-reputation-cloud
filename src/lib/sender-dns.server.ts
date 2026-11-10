import { lookup } from './mail-dns.server';
import { z } from 'zod';

const ipAddress = { ip4: z.string().ip({ version: 'v4' }), ip6: z.string().ip({ version: 'v6' }) };

export async function senderRecords(name: string, type: 'TXT' | 'PTR' | 'A', signal: AbortSignal) {
  try {
    const dns = await lookup(name, type, signal);
    if (dns.TC || (dns.Status !== 0 && dns.Status !== 3)) return null;
    return (dns.Answer ?? []).filter(row => row.type === ({ TXT: 16, PTR: 12, A: 1 })[type])
      .map(row => row.data.replace(/"\s*"/g, '').replace(/^"|"$/g, ''));
  } catch {
    return null;
  }
}

export async function forwardConfirmedIpv4(ip: string, signal: AbortSignal) {
  const ptr = await senderRecords(ip.split('.').reverse().join('.') + '.in-addr.arpa', 'PTR', signal);
  if (!ptr) return { status: 'unknown' } as const;
  const names = ptr.map(name => name.replace(/\.$/, '').toLowerCase());
  if (!names.length) return { status: 'missing-ptr' } as const;
  if (names.length > 8) return { status: 'unknown' } as const;
  const results = await Promise.all(names.map(async name => ({ name, ips: await senderRecords(name, 'A', signal) })));
  const matched = results.find(row => row.ips?.includes(ip));
  if (matched) return { status: 'ok', hostname: matched.name } as const;
  if (results.some(row => row.ips === null)) return { status: 'unknown' } as const;
  return { status: 'mismatch', records: results } as const;
}

type SpfBudget = { status: 'ok' | 'missing' | 'invalid' | 'unknown' | 'over'; terms: number };

/** Static upper bound, including repeated include/redirect references. This is not an SPF evaluator. */
export async function spfLookupBudget(domain: string, readTxt: (name: string) => Promise<string[] | null>): Promise<SpfBudget> {
  let terms = 0;
  const cache = new Map<string, Promise<string[] | null>>();
  async function walk(name: string, path: string[]): Promise<SpfBudget['status']> {
    if (path.includes(name)) return 'invalid';
    let read = cache.get(name);
    if (!read) { read = readTxt(name); cache.set(name, read); }
    const records = await read;
    if (!records) return 'unknown';
    const spf = records.filter(value => /^v=spf1(?:\s|$)/i.test(value));
    if (spf.length !== 1) return spf.length || path.length ? 'invalid' : 'missing';
    let redirect: string | undefined;
    for (const term of spf[0]!.trim().split(/\s+/).slice(1)) {
      const modifier = /^([a-z][\w.-]*)=(.*)$/i.exec(term);
      if (modifier) {
        if (modifier[1]?.toLowerCase() === 'redirect') {
          if (redirect !== undefined) return 'invalid';
          redirect = modifier[2] ?? '';
        }
        continue;
      }
      if (/^[+?~-]?all$/i.test(term)) return 'ok';
      const literal = /^[+?~-]?(ip[46]):([^/]+)(?:\/(\d{1,3}))?$/i.exec(term);
      if (literal) {
        const family = literal[1]!.toLowerCase() as keyof typeof ipAddress;
        if (!ipAddress[family].safeParse(literal[2]).success || Number(literal[3] ?? 0) > (family === 'ip4' ? 32 : 128)) return 'invalid';
        continue;
      }
      if (!/^[+?~-]?(?:include|a|mx|ptr|exists)(?=[:/]|$)/i.test(term)) return 'invalid';
      if (++terms > 10) return 'over';
      if (term.includes('%')) return 'unknown';
      const included = /^[+?~-]?include:(.+)$/i.exec(term)?.[1];
      if (included) {
        const result = await follow(included, [...path, name]);
        if (result !== 'ok') return result;
      } else if (/^[+?~-]?include(?=:|$)/i.test(term)) return 'invalid';
    }
    if (redirect === undefined) return 'ok';
    if (++terms > 10) return 'over';
    return follow(redirect, [...path, name]);
  }
  function follow(name: string, path: string[]) {
    const host = name.toLowerCase().replace(/\.$/, '');
    if (host.includes('%')) return Promise.resolve('unknown' as const);
    if (!/^(?:[a-z0-9_-]+\.)+[a-z0-9_-]+$/.test(host) || host.length > 253) return Promise.resolve('invalid' as const);
    return walk(host, path);
  }
  return { status: await walk(domain, []), terms };
}
