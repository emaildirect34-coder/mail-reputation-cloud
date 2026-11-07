import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { listInput, importInput, suppressionInput, launchInput, campaignStatusInput, parseContacts, assignServers } from './sending.schemas';

async function admin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'superadmin' });
  if (error || !data) throw new Error('Accès réservé au Superadmin');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}
const check = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export const readSending = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const db = await admin(context);
  const [lists, contacts, supp, camps, stats, servers] = await Promise.all([
    db.from('contact_lists').select('id,name,created_at').order('created_at'),
    db.from('contacts').select('list_id,status'),
    db.from('suppressions').select('reason'),
    db.from('campaigns').select('id,name,subject,status,total,suppressed,created_at,server_ids').order('created_at', { ascending: false }).limit(50),
    db.rpc('campaign_stats'),
    db.from('managed_servers').select('id,label,status').neq('status', 'absent').order('label'),
  ]);
  for (const r of [lists, contacts, supp, camps, stats, servers]) check(r.error);
  const count = (l: string, s?: string) => (contacts.data ?? []).filter(c => c.list_id === l && (!s || c.status === s)).length;
  const bySupp: Record<string, number> = {};
  for (const s of supp.data ?? []) bySupp[s.reason] = (bySupp[s.reason] ?? 0) + 1;
  return {
    lists: (lists.data ?? []).map(l => ({ ...l, total: count(l.id), active: count(l.id, 'active') })),
    suppressions: bySupp,
    campaigns: (camps.data ?? []).map(c => ({ ...c, ...((stats.data ?? []).find((s: any) => s.campaign_id === c.id) ?? { queued: 0, sent: 0, failed: 0 }) })),
    servers: servers.data ?? [],
  };
});

export const createList = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => listInput.parse(i))
  .handler(async ({ data, context }) => { const db = await admin(context); check((await db.from('contact_lists').insert({ name: data.name, created_by: context.userId })).error); return { ok: true }; });

export const importContacts = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => importInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context); const rows = parseContacts(data.text);
    for (let i = 0; i < rows.length; i += 1000) check((await db.from('contacts').upsert(rows.slice(i, i + 1000).map(r => ({ ...r, list_id: data.listId })), { onConflict: 'list_id,email', ignoreDuplicates: true })).error);
    return { imported: rows.length };
  });

export const importSuppressions = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => suppressionInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context); const values = data.text.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean); let added = 0;
    for (let i = 0; i < values.length; i += 5000) { const r = await db.rpc('add_suppressions', { _values: values.slice(i, i + 5000), _reason: 'manual', _source: data.source }); check(r.error); added += r.data ?? 0; }
    return { added };
  });

export const launchCampaign = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => launchInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const srv = await db.from('server_agents').select('server_id').in('server_id', data.serverIds); check(srv.error);
    if ((srv.data ?? []).length !== data.serverIds.length) throw new Error('Chaque serveur choisi doit avoir son agent KumoMTA installé.');
    const contacts: { id: string; email: string; first_name: string | null; email_md5: string | null }[] = [];
    for (let from = 0; ; from += 1000) { const r = await db.from('contacts').select('id,email,first_name,email_md5').eq('list_id', data.listId).eq('status', 'active').range(from, from + 999); check(r.error); contacts.push(...(r.data ?? [])); if ((r.data ?? []).length < 1000) break; }
    const blocked = new Set<string>();
    for (let i = 0; i < contacts.length; i += 500) { const r = await db.from('suppressions').select('email_md5').in('email_md5', contacts.slice(i, i + 500).map(c => c.email_md5 ?? '')); check(r.error); (r.data ?? []).forEach(s => blocked.add(s.email_md5)); }
    const keep = contacts.filter(c => !blocked.has(c.email_md5 ?? ''));
    if (!keep.length) throw new Error('Aucun destinataire envoyable dans cette liste.');
    const camp = await db.from('campaigns').insert({ name: data.name, from_name: data.fromName, from_email: data.fromEmail, reply_to: data.replyTo || null, subject: data.subject, html: data.html, list_id: data.listId, server_ids: data.serverIds, status: 'paused', total: keep.length, suppressed: contacts.length - keep.length, created_by: context.userId }).select('id').single();
    check(camp.error);
    const rows = assignServers(keep, data.serverIds).map(({ item, server }) => ({ campaign_id: camp.data!.id, contact_id: item.id, email: item.email, first_name: item.first_name, server_id: server }));
    for (let i = 0; i < rows.length; i += 1000) check((await db.from('campaign_messages').insert(rows.slice(i, i + 1000))).error);
    check((await db.from('campaigns').update({ status: 'queued' }).eq('id', camp.data!.id)).error);
    return { id: camp.data!.id, total: keep.length, suppressed: contacts.length - keep.length };
  });

export const setCampaignStatus = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => campaignStatusInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const campaign = await db.from('campaigns').select('auto_pause_reason').eq('id',data.id).single();
    check(campaign.error);
    if (data.status==='queued' && campaign.data?.auto_pause_reason) throw new Error('Campagne bloquée par la protection automatique : '+campaign.data.auto_pause_reason);
    check((await db.from('campaigns').update({ status: data.status }).eq('id', data.id).neq('status', 'done')).error);
    return { ok: true };
  });
