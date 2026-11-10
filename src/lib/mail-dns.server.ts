type RecordAnswer = { name?: string; type: number; data: string };
type DnsReply = { Status?: number; TC?: boolean; AD?: boolean; Answer?: RecordAnswer[] };
export type MailRoute = 'routable' | 'no-route' | 'unknown';

export async function lookup(domain: string, type: 'MX' | 'A' | 'AAAA' | 'TXT' | 'TLSA' | 'PTR', signal: AbortSignal, dnssec = false) {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.search = new URLSearchParams({ name: domain, type }).toString();
  if (dnssec) url.searchParams.set('do', 'true');
  const response = await fetch(url, { headers: { accept: 'application/dns-json' }, signal, redirect: 'manual' });
  if (!response.ok) throw new Error('DNS unavailable');
  return await response.json() as DnsReply;
}

/** DNS describes a domain's mail route, not the existence of a particular mailbox. */
export async function mailRoute(domain: string, timeout = 2500): Promise<MailRoute> {
  const signal = AbortSignal.timeout(timeout);
  try {
    const mx = await lookup(domain, 'MX', signal);
    if (mx.TC) return 'unknown';
    if (mx.Status === 3) return 'no-route';
    if (mx.Status !== 0) return 'unknown';
    const hosts = (mx.Answer ?? []).filter(answer => answer.type === 15);
    if (hosts.length) {
      if (hosts.length === 1 && /^0\s+\.$/.test(hosts[0]!.data.trim())) return 'no-route';
      return hosts.some(answer => /^\d+\s+[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?$/i.test(answer.data.trim())) ? 'routable' : 'unknown';
    }

    const addresses = await Promise.allSettled([lookup(domain, 'A', signal), lookup(domain, 'AAAA', signal)]);
    const addressTypes = [1, 28];
    if (addresses.some((reply, index) => reply.status === 'fulfilled' && !reply.value.TC && reply.value.Status === 0 &&
      reply.value.Answer?.some(answer => answer.type === addressTypes[index]))) return 'routable';
    return addresses.every(reply => reply.status === 'fulfilled' && !reply.value.TC && (reply.value.Status === 0 || reply.value.Status === 3))
      ? 'no-route' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Bound external requests so large heterogeneous lists can still be prepared. */
export async function campaignMailRoutes(domains: string[]) {
  const counts = new Map<string, number>();
  for (const domain of domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 100);
  const results = new Map<string, MailRoute>();
  const deadline = Date.now() + 10_000;
  for (let index = 0; index < common.length; index += 12) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await Promise.all(common.slice(index, index + 12).map(async ([domain]) => {
      results.set(domain, await mailRoute(domain, Math.min(remaining, 2500)));
    }));
  }
  return results;
}
