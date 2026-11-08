import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

async function gate(context: any) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error) throw new Error('Vérification des droits impossible');
  if (role.data) return;
  const t = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
  if (t.error || !(t.data ?? []).some((r: any) => (r.allowed_paths ?? []).includes('/dashboard/reputation'))) throw new Error('Accès non autorisé');
}

const IP_LISTS = [
  { name: 'Spamhaus ZEN', zone: 'zen.spamhaus.org', delist: 'https://check.spamhaus.org/' },
  { name: 'Barracuda', zone: 'b.barracudacentral.org', delist: 'https://www.barracudacentral.org/rbl/removal-request' },
  { name: 'SpamCop', zone: 'bl.spamcop.net', delist: 'https://www.spamcop.net/bl.shtml' },
  { name: 'UCEPROTECT L1', zone: 'dnsbl-1.uceprotect.net', delist: 'https://www.uceprotect.net/en/rblcheck.php' },
  { name: 'UCEPROTECT L2', zone: 'dnsbl-2.uceprotect.net', delist: 'https://www.uceprotect.net/en/rblcheck.php' },
  { name: 'PSBL', zone: 'psbl.surriel.com', delist: 'https://psbl.org/' },
  { name: 'Mailspike', zone: 'bl.mailspike.net', delist: 'https://mailspike.org/' },
  { name: 'SpamRATS', zone: 'all.spamrats.com', delist: 'https://www.spamrats.com/removal.php' },
  { name: 'DroneBL', zone: 'dnsbl.dronebl.org', delist: 'https://dronebl.org/lookup' },
  { name: '0spam', zone: 'bl.0spam.org', delist: 'https://0spam.org/' },
];
const DOMAIN_LISTS = [
  { name: 'Spamhaus DBL', zone: 'dbl.spamhaus.org', delist: 'https://check.spamhaus.org/' },
  { name: 'SURBL', zone: 'multi.surbl.org', delist: 'https://surbl.org/surbl-analysis' },
  { name: 'URIBL', zone: 'multi.uribl.com', delist: 'https://admin.uribl.com/' },
];

export type ListResult = { list: string; status: 'clean' | 'listed' | 'unknown'; code?: string; delist: string };

async function aLookup(name: string): Promise<string[] | null> {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (j.Status === 3) return [];
    if (j.Status !== 0) return null;
    return (j.Answer ?? []).filter((a: any) => a.type === 1).map((a: any) => a.data);
  } catch { return null; }
}

// Lists return 127.255.255.x / 127.0.0.1 (URIBL) when the query is refused from public resolvers: not a listing.
function interpret(a: string[] | null): Pick<ListResult, 'status' | 'code'> {
  if (a === null) return { status: 'unknown' };
  if (!a.length) return { status: 'clean' };
  const real = a.filter(x => x.startsWith('127.') && !x.startsWith('127.255.') && x !== '127.0.0.1');
  return real.length ? { status: 'listed', code: real.join(', ') } : { status: 'unknown', code: 'requête refusée par la liste' };
}

export function isIPv4(s: string) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(n => +n <= 255); }

export async function scanTarget(target: string) {
  const ip = isIPv4(target);
  const rev = ip ? target.split('.').reverse().join('.') : target.toLowerCase();
  const lists = ip ? IP_LISTS : DOMAIN_LISTS;
  const results: ListResult[] = await Promise.all(lists.map(async l => ({ list: l.name, delist: l.delist, ...interpret(await aLookup(`${rev}.${l.zone}`)) })));
  return { target, kind: ip ? 'ip' as const : 'domain' as const, results, listed: results.filter(r => r.status === 'listed').length };
}

export const scanReputation = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ targets: z.array(z.string().trim().min(3).max(253)).max(60).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await gate(context);
    let targets = data.targets ?? [];
    if (!targets.length) {
      const [ips, doms] = await Promise.all([
        context.supabase.from('server_ips').select('address').eq('active', true).eq('family', 4),
        context.supabase.from('sending_domains').select('domain'),
      ]);
      targets = [...(ips.data ?? []).map((r: any) => r.address), ...(doms.data ?? []).map((r: any) => r.domain)];
    }
    targets = [...new Set(targets.filter(t => isIPv4(t) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)))].slice(0, 60);
    const scans = await Promise.all(targets.map(scanTarget));
    return { scans, scannedAt: new Date().toISOString() };
  });
