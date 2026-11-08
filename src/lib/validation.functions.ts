import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const DISPOSABLE = new Set(['yopmail.com','yopmail.fr','mailinator.com','tempmail.com','temp-mail.org','10minutemail.com','guerrillamail.com','sharklasers.com','trashmail.com','getnada.com','dispostable.com','maildrop.cc','throwawaymail.com','fakeinbox.com','mohmal.com','emailondeck.com','mintemail.com','spamgourmet.com','jetable.org','mailnesia.com','tempail.com','moakt.com','burnermail.io','33mail.com','mailcatch.com','trbvm.com','emltmp.com','tmpmail.org','minuteinbox.com','inboxkitten.com']);
const ROLES = new Set(['admin','info','contact','support','noreply','no-reply','sales','webmaster','postmaster','abuse','hostmaster','billing','office','team','hello','marketing','help','root','security','jobs']);
const TYPOS: Record<string, string> = { 'gmial.com':'gmail.com','gmal.com':'gmail.com','gmai.com':'gmail.com','gnail.com':'gmail.com','gmail.fr':'gmail.com','hotmial.com':'hotmail.com','hotmal.com':'hotmail.com','yaho.com':'yahoo.com','yahooo.com':'yahoo.com','outlok.com':'outlook.com','orage.fr':'orange.fr','wanado.fr':'wanadoo.fr','fre.fr':'free.fr' };

export type Verdict = { email: string; status: 'valid' | 'risky' | 'invalid'; reason: string; suggestion?: string };

async function gate(context: any) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error) throw new Error('Vérification des droits impossible');
  if (role.data) return true;
  const t = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
  if (t.error || !(t.data ?? []).some((r: any) => (r.allowed_paths ?? []).includes('/dashboard/validation'))) throw new Error('Accès non autorisé');
  return false;
}

async function md5(s: string) {
  const { createHash } = await import('node:crypto');
  return createHash('md5').update(s).digest('hex');
}

// MX lookup through DNS-over-HTTPS (works on the edge runtime). Cached per call.
async function hasMx(domain: string, cache: Map<string, Promise<boolean | null>>) {
  if (!cache.has(domain)) cache.set(domain, (async () => {
    try {
      const q = async (t: string) => {
        const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${t}`, { headers: { accept: 'application/dns-json' } });
        const j: any = await r.json();
        return j.Status === 0 && (j.Answer ?? []).some((a: any) => a.type === (t === 'MX' ? 15 : 1));
      };
      return (await q('MX')) || (await q('A'));
    } catch { return null; }
  })());
  return cache.get(domain)!;
}

async function verify(emails: string[], context: any): Promise<Verdict[]> {
  const cache = new Map<string, Promise<boolean | null>>();
  const list = emails.map(e => e.trim().toLowerCase()).filter(Boolean);
  const hashes = await Promise.all(list.map(md5));
  const supp = new Set<string>();
  for (let i = 0; i < hashes.length; i += 500) {
    const r = await context.supabase.from('suppressions').select('email_md5').in('email_md5', hashes.slice(i, i + 500));
    (r.data ?? []).forEach((s: any) => supp.add(s.email_md5));
  }
  const out: Verdict[] = [];
  for (let i = 0; i < list.length; i += 25) {
    out.push(...await Promise.all(list.slice(i, i + 25).map(async (email, k): Promise<Verdict> => {
      if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || email.includes('..')) return { email, status: 'invalid', reason: 'Syntaxe invalide' };
      const [user, domain] = email.split('@') as [string, string];
      if (TYPOS[domain]) return { email, status: 'invalid', reason: 'Faute de frappe probable', suggestion: `${user}@${TYPOS[domain]}` };
      if (supp.has(hashes[i + k]!)) return { email, status: 'invalid', reason: 'Dans la liste de suppression' };
      if (DISPOSABLE.has(domain)) return { email, status: 'invalid', reason: 'Adresse jetable' };
      const mx = await hasMx(domain, cache);
      if (mx === false) return { email, status: 'invalid', reason: 'Domaine sans serveur mail (MX)' };
      if (ROLES.has(user)) return { email, status: 'risky', reason: 'Adresse générique (rôle)' };
      if (mx === null) return { email, status: 'risky', reason: 'DNS injoignable, à revérifier' };
      return { email, status: 'valid', reason: 'Syntaxe, domaine et MX valides' };
    })));
  }
  return out;
}

export const validateEmails = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ emails: z.array(z.string().max(320)).min(1).max(5000) }).parse(d))
  .handler(async ({ data, context }) => { await gate(context); return { results: await verify(data.emails, context) }; });

export const listsForCleaning = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context);
  const [l, c] = await Promise.all([
    context.supabase.from('contact_lists').select('id,name').order('created_at', { ascending: false }),
    context.supabase.from('contacts').select('list_id,status'),
  ]);
  if (l.error || c.error) throw new Error('Lecture des listes impossible');
  return { lists: (l.data ?? []).map((x: any) => {
    const rows = (c.data ?? []).filter((r: any) => r.list_id === x.id);
    return { id: x.id, name: x.name, total: rows.length, active: rows.filter((r: any) => r.status === 'active').length, invalid: rows.filter((r: any) => r.status === 'invalid').length };
  }) };
});

// Marks invalid contacts of a list so campaign launches (active only) skip them.
export const cleanList = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ listId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await gate(context))) throw new Error('Réservé au superadmin');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const rows: { id: string; email: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await supabaseAdmin.from('contacts').select('id,email').eq('list_id', data.listId).eq('status', 'active').range(from, from + 999);
      if (r.error) throw new Error('Lecture de la liste impossible');
      rows.push(...(r.data ?? []));
      if ((r.data ?? []).length < 1000) break;
    }
    let invalid = 0, risky = 0;
    for (let i = 0; i < rows.length; i += 2000) {
      const chunk = rows.slice(i, i + 2000);
      const res = await verify(chunk.map(r => r.email), context);
      const bad = chunk.filter((_, k) => res[k]?.status === 'invalid').map(r => r.id);
      risky += res.filter(r => r.status === 'risky').length;
      invalid += bad.length;
      for (let j = 0; j < bad.length; j += 500) {
        const u = await supabaseAdmin.from('contacts').update({ status: 'invalid' }).in('id', bad.slice(j, j + 500));
        if (u.error) throw new Error('Mise à jour impossible');
      }
    }
    return { checked: rows.length, invalid, risky };
  });
