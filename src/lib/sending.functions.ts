import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';
import { listInput, importInput, suppressionInput, launchInput, campaignStatusInput, concentratedImport, parseContacts, assignServers } from './sending.schemas';
import { campaignTimeZone, planRecipientSchedule, scheduledInstant } from './campaign-schedule';
import { isCampaignRoleMailbox, probableMailDomainTypo, recipientDomain } from './email-address';
import { renderWeeklyDigest } from './weekly-digest';
import { campaignDeliveryGroups } from './campaign-delivery-monitor';
import { z } from 'zod';
import { canOpen } from './access';

async function admin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'superadmin' });
  if (error || !data) throw new Error('Accès réservé au Superadmin');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}
const check = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export const readCampaignList = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
    check(role.error);
    const isAdmin = role.data === true;
    let db = context.supabase;
    if (!isAdmin) {
      const tasks = await db.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
      check(tasks.error);
      if (!canOpen({ role: 'worker', paths: (tasks.data ?? []).flatMap(task => task.allowed_paths) }, '/dashboard/campaigns/list')) {
        throw new Error('Accès aux campagnes non autorisé.');
      }
      db = (await import('@/integrations/supabase/client.server')).supabaseAdmin;
    }
    const fields = 'id,name,subject,status,total,suppressed,created_at,auto_pause_reason';
    const campaigns = await db.from('campaigns').select(fields).order('created_at', { ascending: false }).limit(50);
    check(campaigns.error);
    const rows = campaigns.data ?? [];
    const stats = rows.length ? await db.rpc('campaign_stats').in('campaign_id', rows.map(row => row.id)) : null;
    check(stats?.error ?? null);
    const byId = new Map(stats?.data?.map(stat => [stat.campaign_id, stat]));
    return {
      isAdmin,
      rows: rows.map(campaign => ({
        ...campaign, queued: byId.get(campaign.id)?.queued ?? 0,
        injected: byId.get(campaign.id)?.sent ?? 0, failed: byId.get(campaign.id)?.failed ?? 0,
      })),
    };
  });

async function frequencyPolicy(db: Awaited<ReturnType<typeof admin>>) {
  const result = await db.from('campaign_frequency_policy').select('hours').eq('singleton', true).single();
  if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
  check(result.error);
  return result.data?.hours ?? null;
}

export const readCampaignFrequencyPolicy = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => frequencyPolicy(await admin(context)));

export const setCampaignFrequencyPolicy = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.union([z.literal(0), z.literal(24), z.literal(48)]).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const updated = await db.from('campaign_frequency_policy').update({ hours: data }).eq('singleton', true).select('hours').single();
    check(updated.error);
    return updated.data?.hours ?? null;
  });

export const createSubscriptionConfirmation = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ listId: z.string().uuid(), email: z.string().trim().min(3).max(254) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const list = await db.from('contact_lists').select('id,name').eq('id', data.listId).is('quarantined_at', null).maybeSingle();
    check(list.error);
    if (!list.data) throw new Error('Liste indisponible.');
    const { issueSubscriptionToken } = await import('./subscription-confirmation.server');
    const { token, expires } = await issueSubscriptionToken(data.email.toLowerCase(), data.listId, list.data.name);
    return { expires, url: new URL(`/confirm-subscription/${token}`, getRequest().url).href };
  });

export const exportSubscriptionProofs = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ listId: z.string().uuid(), email: z.string().trim().max(254) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const email = data.email.toLowerCase();
    if (!recipientDomain(email)) throw new Error('Adresse e-mail invalide.');
    const result = await db.rpc('read_contact_subscription_proofs', { _list: data.listId, _email: email });
    check(result.error);
    if (!result.data?.length) throw new Error('Aucune confirmation enregistrée pour cette adresse et cette liste.');
    const { verifySubscriptionProof } = await import('./subscription-proof.server');
    const proofs = await Promise.all(result.data.map(async row => ({
      confirmedAt: row.confirmed_at,
      payload: row.proof_payload,
      signature: row.proof_signature,
      verified: row.proof_payload && row.proof_signature
        ? await verifySubscriptionProof(row.proof_payload, row.proof_signature, row.token_hash, data.listId, email)
        : false,
    })));
    return { email, listId: data.listId, algorithm: 'HMAC-SHA256', proofs };
  });

async function campaignAmp(db: Awaited<ReturnType<typeof admin>>, source: string | undefined) {
  if (!source) return {};
  const { prepareAmpEmail } = await import('./amp-email');
  const amp_html = prepareAmpEmail(source);
  const capability = await db.from('campaigns').select('amp_html').limit(1);
  if (capability.error?.code === '42703') throw new Error('L’envoi AMP nécessite la migration 0030 de la base de données.');
  check(capability.error);
  return { amp_html };
}

export const readSending = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const db = await admin(context);
  const readCampaigns = async () => {
    const result = await db.from('campaigns').select('id,name,subject,status,total,suppressed,created_at,server_ids,scheduled_at').order('created_at', { ascending: false }).limit(50);
    if (result.error?.code !== '42703') return { ...result, supportsScheduling: !result.error };
    const legacy = await db.from('campaigns').select('id,name,subject,status,total,suppressed,created_at,server_ids').order('created_at', { ascending: false }).limit(50);
    return { ...legacy, data: legacy.data?.map(c => ({ ...c, scheduled_at: null })) ?? null, supportsScheduling: false };
  };
  const [lists, contacts, supp, camps, stats, servers, agents] = await Promise.all([
    db.from('contact_lists').select('*').order('created_at'),
    db.from('contacts').select('list_id,status'),
    db.from('suppressions').select('reason'),
    readCampaigns(),
    db.rpc('campaign_stats'),
    db.from('managed_servers').select('id,label,status').neq('status', 'absent').order('label'),
    db.from('server_agents').select('server_id'),
  ]);
  for (const r of [lists, contacts, supp, camps, stats, servers, agents]) check(r.error);
  const installed = new Set(agents.data?.map(agent => agent.server_id));
  const count = (l: string, s?: string) => (contacts.data ?? []).filter(c => c.list_id === l && (!s || c.status === s)).length;
  const bySupp: Record<string, number> = {};
  for (const s of supp.data ?? []) bySupp[s.reason] = (bySupp[s.reason] ?? 0) + 1;
  return {
    lists: (lists.data ?? []).map(l => ({
      id: l.id, name: l.name, created_at: l.created_at,
      quarantined_at: l.quarantined_at ?? null, quarantine_reason: l.quarantine_reason ?? null,
      total: count(l.id), active: count(l.id, 'active'),
    })),
    suppressions: bySupp,
    campaigns: (camps.data ?? []).map(c => ({ ...c, ...((stats.data ?? []).find((s: any) => s.campaign_id === c.id) ?? { queued: 0, sent: 0, failed: 0 }) })),
    servers: (servers.data ?? []).filter(server => installed.has(server.id)),
    supportsScheduling: camps.supportsScheduling,
  };
});

export const createList = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => listInput.parse(i))
  .handler(async ({ data, context }) => { const db = await admin(context); check((await db.from('contact_lists').insert({ name: data.name, created_by: context.userId })).error); return { ok: true }; });

async function marketingPools(db: Awaited<ReturnType<typeof admin>>) {
  const [pools, ips] = await Promise.all([
    db.from('vmta_pools').select('id,name').eq('purpose', 'marketing').eq('status', 'active').order('name'),
    db.from('server_ips').select('server_id,pool_id').eq('active', true).eq('family', 4).is('quarantined_at', null).not('pool_id', 'is', null),
  ]);
  check(pools.error);
  check(ips.error);
  return (pools.data ?? []).map(pool => ({
    ...pool, serverIds: [...new Set((ips.data ?? []).filter(ip => ip.pool_id === pool.id).map(ip => ip.server_id))],
  }));
}

export const readCampaignVmtaPools = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => marketingPools(await admin(context)));

export const importContacts = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => importInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const rows = parseContacts(data.text, data.withTimeZones);
    const concentration = concentratedImport(rows);
    if (concentration) {
      const { sha256 } = await import('./kumo.server');
      const batch = await sha256(JSON.stringify([context.userId, data.listId, !!data.withTimeZones, data.text]));
      if (batch !== data.reviewedBatch) return { review: { ...concentration, batch }, imported: 0, withTimeZone: 0 };
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000);
      if (data.withTimeZones) {
        const result = await db.rpc('import_contacts_with_time_zones', { _list: data.listId, _contacts: batch });
        if (result.error?.code === 'PGRST202') throw new Error('L’import des fuseaux horaires nécessite la mise à jour de la base de données.');
        check(result.error);
      } else {
        check((await db.from('contacts').upsert(batch.map(r => ({ ...r, list_id: data.listId })), { onConflict: 'list_id,email', ignoreDuplicates: true })).error);
      }
    }
    return { review: null, imported: rows.length, withTimeZone: rows.filter(row => row.time_zone).length };
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
    const marketingDomains = process.env['MARKETING_FROM_DOMAINS']?.split(',').map(domain => domain.trim().toLowerCase()).filter(Boolean) ?? [];
    if (marketingDomains.length && !marketingDomains.includes(recipientDomain(data.fromEmail) ?? '')) {
      throw new Error('Utilisez un domaine expéditeur autorisé pour les campagnes marketing.');
    }
    if (data.digestText && (data.ampHtml || data.sponsorOfferId)) throw new Error('Le récapitulatif utilise ses propres rubriques HTML, sans offre sponsor ni AMP.');
    const html = data.digestText ? renderWeeklyDigest(data.digestText) : data.html;
    const amp = await campaignAmp(db, data.ampHtml);
    const list = await db.from('contact_lists').select('quarantined_at,quarantine_reason').eq('id', data.listId).maybeSingle();
    if (list.error?.code === '42703') throw new Error('La protection des listes nécessite la mise à jour de la base de données.');
    check(list.error);
    if (!list.data) throw new Error('Liste de contacts introuvable.');
    if (list.data.quarantined_at) throw new Error(`Liste de contacts en quarantaine. ${list.data.quarantine_reason ?? ''}`);
    const metadata = context.claims.user_metadata as { campaign_time_zone?: unknown } | undefined;
    const timeZone = data.schedule ? campaignTimeZone(metadata?.campaign_time_zone ?? 'UTC') : null;
    if (timeZone && data.scheduleTimeZone !== timeZone) throw new Error('Le fuseau horaire du compte a changé. Rechargez la page avant de programmer l’envoi.');
    const scheduledAt = data.schedule && timeZone && !data.recipientLocalTime ? scheduledInstant(data.schedule, timeZone) : null;
    if (data.sendWindowHours && !data.schedule) throw new Error('Choisissez une date de départ pour lisser l’envoi.');
    if (data.recipientLocalTime && !data.schedule) throw new Error('Choisissez une date de départ pour programmer selon les fuseaux des destinataires.');
    if (data.sendWindowHours || data.recipientLocalTime) {
      const capability = await db.from('campaign_messages').select('available_at').limit(1);
      if (capability.error) throw new Error('La programmation individuelle nécessite la mise à jour de la base de données.');
    }
    if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) throw new Error('Choisissez une date de programmation future.');
    if(data.sponsorOfferId){const offer=await db.from('sponsor_offers').select('id,status').eq('id',data.sponsorOfferId).single();check(offer.error);if(offer.data?.status!=='active')throw new Error('Cette offre sponsor n’est plus active.');}
    const srv = await db.from('server_agents').select('server_id,metrics').in('server_id', data.serverIds); check(srv.error);
    if ((srv.data ?? []).length !== data.serverIds.length) throw new Error('Chaque serveur choisi doit avoir son agent KumoMTA installé.');
    const capHours = await frequencyPolicy(db);
    if ((data.digestText || data.fatigueProtection || capHours) && srv.data?.some(({ metrics }) => !metrics || typeof metrics !== 'object' || Array.isArray(metrics) || metrics['preferencePermit'] !== true)) {
      throw new Error('Mettez à jour les agents KumoMTA sélectionnés pour appliquer les préférences et la protection de cadence.');
    }
    if (data.vmtaPoolId) {
      const pool = (await marketingPools(db)).find(pool => pool.id === data.vmtaPoolId);
      if (!pool || !data.serverIds.every(id => pool.serverIds.includes(id))) {
        throw new Error('Le pool marketing doit être actif et disposer d’une IPv4 utilisable sur chaque serveur choisi.');
      }
      const capability = await db.from('campaigns').select('vmta_pool_id').limit(1);
      if (capability.error) throw new Error('Le routage par pool nécessite la mise à jour de la base de données.');
    }
    const eligible: { id: string; email: string; first_name: string | null; time_zone: string | null }[] = [];
    let suppressedCount = 0;
    let formatExcluded = 0;
    let cursor: string | null = null;
    for (;;) {
      const args: Database['public']['Functions']['campaign_audience_page']['Args'] = {
        _list: data.listId, _after: cursor, _with_time_zone: data.recipientLocalTime === true, _digest: !!data.digestText,
      };
      const result = await db.rpc('campaign_audience_page', args);
      if (result.error?.code === 'PGRST202') throw new Error('Appliquez les migrations jusqu’à 0035 pour préparer les destinataires.');
      check(result.error);
      const page = result.data ?? [];
      const last = page.at(-1);
      if (!last) break;
      for (const contact of page) {
        if (contact.suppressed) suppressedCount++;
        else if (contact.format_excluded) formatExcluded++;
        else eligible.push(contact);
      }
      cursor = last.id;
    }
    const contactCount = eligible.length + suppressedCount + formatExcluded;
    let typoCount = 0;
    let roleExcluded = 0;
    const candidates = eligible.flatMap(contact => {
      const domain = recipientDomain(contact.email);
      if (!domain) return [];
      if (isCampaignRoleMailbox(contact.email)) {
        roleExcluded++;
        return [];
      }
      if (!probableMailDomainTypo(domain)) return [{ contact, domain }];
      typoCount++;
      return [];
    });
    const typoRatio = typoCount ? typoCount / (candidates.length + typoCount) : 0;
    if (typoCount >= 3 && typoRatio >= 0.02 && !data.acceptTypoExclusions) {
      throw new Error(`${typoCount} adresses ont un domaine avec une faute probable (${(100 * typoRatio).toFixed(1)} %). Confirmez leur exclusion avant de lancer.`);
    }
    const inactive = new Set<string>();
    if (data.sunsetDays !== 'off') {
      for (let offset = 0; offset < candidates.length; offset += 500) {
        const ids = candidates.slice(offset, offset + 500).map(({ contact }) => contact.id);
        const result = data.sunsetDays === 'isp'
          ? await db.rpc('campaign_sunset_contacts_by_isp', { _ids: ids })
          : await db.rpc('campaign_sunset_contacts', { _ids: ids, _days: data.sunsetDays });
        if (result.error) throw new Error('Le filtrage par engagement est indisponible. Vérifiez la mise à jour de la base.');
        for (const id of result.data ?? []) inactive.add(id);
      }
    }
    const engaged = candidates.filter(({ contact }) => !inactive.has(contact.id));
    const { campaignMailRoutes } = await import('./mail-dns.server');
    const dns = await campaignMailRoutes(engaged.map(({ domain }) => domain));
    const keep = engaged.filter(({ domain }) => dns.get(domain) !== 'no-route').map(({ contact }) => contact);
    const invalid = eligible.length - candidates.length + engaged.length - keep.length;
    const dnsUnverified = engaged.filter(({ domain }) => !dns.has(domain) || dns.get(domain) === 'unknown').length;
    if (!keep.length) throw new Error(`Aucun destinataire envoyable. ${suppressedCount} en suppression, ${formatExcluded} hors format choisi, ${inactive.size} sans engagement récent et ${invalid} adresses écartées.`);
    const recipientPlan = data.recipientLocalTime && data.schedule && timeZone
      ? planRecipientSchedule(data.schedule, timeZone, keep.map(contact => contact.time_zone), data.sendWindowHours)
      : null;
    const campaignStart = recipientPlan?.scheduledAt ?? scheduledAt;
    const preparing = 'Préparation des destinataires en cours';
    const camp = await db.from('campaigns').insert({
      ...amp,
      ...(data.digestText ? { weekly_digest: true } : {}),
      ...(data.fatigueProtection && !data.digestText ? { fatigue_protection: true } : {}),
      ...(data.topic ? { topic: data.topic } : {}),
      ...(data.vmtaPoolId ? { vmta_pool_id: data.vmtaPoolId } : {}),
      ...(campaignStart ? { scheduled_at: campaignStart } : {}),
      auto_pause_reason: preparing, sponsor_offer_id: data.sponsorOfferId ?? null,
      name: data.name, from_name: data.fromName, from_email: data.fromEmail, reply_to: data.replyTo || null,
      subject: data.subject, html, list_id: data.listId, server_ids: data.serverIds, status: 'paused',
      total: keep.length, suppressed: contactCount - keep.length, created_by: context.userId,
    }).select('id').single();
    if (data.topic && camp.error?.message.includes("'topic'")) throw new Error('Appliquez la migration 0031 pour envoyer une campagne avec un thème.');
    if (data.fatigueProtection && camp.error?.message.includes("'fatigue_protection'")) throw new Error('Appliquez la migration 0039 pour activer la protection de cadence.');
    check(camp.error);
    if(!camp.data)throw new Error('Campagne non créée');
    const campaignId=camp.data.id;
    const window = (data.sendWindowHours ?? 0) * 3_600_000;
    const rows = assignServers(keep, data.serverIds).map(({ item, server }, index) => {
      const availableAt = recipientPlan?.availableAt[index] ??
        (window && scheduledAt ? new Date(Date.parse(scheduledAt) + Math.floor(index * window / keep.length)).toISOString() : null);
      return {
        campaign_id: campaignId, contact_id: item.id, email: item.email, first_name: item.first_name, server_id: server,
        ...(availableAt ? { available_at: availableAt } : {}),
      };
    });
    try {
      for (let i = 0; i < rows.length; i += 1000) check((await db.from('campaign_messages').insert(rows.slice(i, i + 1000))).error);
      const queued = await db.from('campaigns').update({ status: 'queued', auto_pause_reason: null })
        .eq('id', campaignId).eq('status', 'paused').eq('auto_pause_reason', preparing).select('id').maybeSingle();
      check(queued.error);
      if (!queued.data) throw new Error('La campagne a changé d’état pendant sa préparation.');
    } catch (error) {
      await db.from('campaigns').delete().eq('id', campaignId).eq('status', 'paused').eq('auto_pause_reason', preparing);
      throw error;
    }
    const placementMonitor = data.monitorPlacement ? await startPlacementMonitor(db, campaignId, data.serverIds[0]!) : 'disabled';
    return {
      id: campaignId, total: keep.length, suppressed: suppressedCount, inactive: inactive.size, invalid, dnsUnverified, typoCount, roleExcluded, formatExcluded,
      scheduledAt: campaignStart, fallbackTimeZones: recipientPlan?.fallbackCount ?? null, placementMonitor,
    };
  });

export const setCampaignStatus = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => campaignStatusInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const campaign = await db.from('campaigns').select('auto_pause_reason').eq('id',data.id).single();
    check(campaign.error);
    if (data.status==='queued' && campaign.data?.auto_pause_reason) throw new Error('Campagne bloquée par la protection automatique : '+campaign.data.auto_pause_reason);
    const changed = await db.from('campaigns').update({ status: data.status }).eq('id', data.id).not('status', 'in', '(done,cancelled)').select('id').maybeSingle();
    check(changed.error);
    return { ok: !!changed.data };
  });

const inboxTestInput = launchInput.pick({ fromName: true, fromEmail: true, replyTo: true, subject: true, html: true, ampHtml: true }).extend({
  serverId: z.string().uuid(),
}).refine(data => !/[\r\n]/.test(data.fromName + data.subject), 'Les en-têtes doivent tenir sur une seule ligne.');

const placementTest = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{4,64}$/),
  token: z.string().regex(/^ED-[A-Z0-9]{5,32}$/),
  expires_at: z.string(),
  seeds: z.array(z.object({ provider: z.string(), address: z.string().email(), placement: z.literal('pending') })).min(1).max(20),
});

const observedSeeds = z.array(z.object({
  provider: z.string(), address: z.string().email(),
  placement: z.enum(['inbox', 'promotions', 'spam', 'pending', 'missing']),
  received_at: z.string().nullable().optional(),
})).min(1).max(20);

async function startPlacementMonitor(db: Awaited<ReturnType<typeof admin>>, campaignId: string, serverId: string) {
  try {
    const { mailTesterRequest } = await import('./mail-tester.server');
    const response = await mailTesterRequest('/api/v1/placement', { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) });
    if (!response.configured) return 'unconfigured';
    const test = placementTest.parse(response.body);
    const result = await db.rpc('start_campaign_placement_monitor', {
      _campaign: campaignId, _server: serverId, _placement: test.id, _token: test.token, _expires: test.expires_at, _seeds: test.seeds,
    });
    if (result.error?.code === 'PGRST202') return 'migration';
    return result.error ? 'failed' : 'started';
  } catch {
    return 'failed';
  }
}

export const readCampaignDeliveryMonitor = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const [campaign, delivery, monitor] = await Promise.all([
      db.from('campaigns').select('id,name,status').eq('id', data.id).single(),
      db.rpc('read_campaign_delivery_by_domain', { _campaign: data.id }),
      db.from('campaign_placement_monitors').select('*').eq('campaign_id', data.id).maybeSingle(),
    ]);
    if (delivery.error?.code === 'PGRST202' || monitor.error?.code === 'PGRST205') {
      throw new Error('Le suivi des campagnes nécessite la migration 0043.');
    }
    for (const result of [campaign, delivery, monitor]) check(result.error);
    if (!campaign.data) throw new Error('Campagne introuvable.');
    let snapshot = monitor.data;
    let placementUnavailable = false;
    if (snapshot && !snapshot.completed_at) {
      const { mailTesterRequest } = await import('./mail-tester.server');
      const observedAt = new Date().toISOString();
      try {
        const response = await mailTesterRequest('/api/v1/placement/' + snapshot.placement_id, { signal: AbortSignal.timeout(5000) });
        if (!response.configured) throw new Error();
        const result = z.object({ id: placementTest.shape.id, status: z.enum(['waiting', 'done']), seeds: observedSeeds }).parse(response.body);
        if (result.id !== snapshot.placement_id) throw new Error();
        const updates = { seeds: result.seeds, observed_at: observedAt, completed_at: result.status === 'done' ? observedAt : null };
        const saved = await db.from('campaign_placement_monitors').update(updates).eq('campaign_id', data.id).is('completed_at', null)
          .or(`observed_at.is.null,observed_at.lt.${observedAt}`).select('*').maybeSingle();
        check(saved.error);
        if (saved.data) snapshot = saved.data;
      } catch {
        placementUnavailable = true;
      }
    }
    const seeds = snapshot ? observedSeeds.parse(snapshot.seeds) : [];
    return {
      campaign: campaign.data,
      groups: campaignDeliveryGroups(delivery.data ?? [], seeds),
      placement: snapshot && {
        serverId: snapshot.server_id, observedAt: snapshot.observed_at, completedAt: snapshot.completed_at,
        expiresAt: snapshot.expires_at, unavailable: placementUnavailable,
      },
    };
  });

export const inboxTestServers = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const [agents, servers] = await Promise.all([
      db.from('server_agents').select('server_id'),
      db.from('managed_servers').select('id,label').neq('status', 'absent').order('label'),
    ]);
    check(agents.error);
    check(servers.error);
    const installed = new Set(agents.data?.map(agent => agent.server_id));
    return (servers.data ?? []).filter(server => installed.has(server.id));
  });

export const sendCampaignInboxTest = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => inboxTestInput.parse(i)).handler(async ({ data, context }) => {
    const db = await admin(context);
    const amp = await campaignAmp(db, data.ampHtml);
    const server = await db.from('server_agents').select('server_id').eq('server_id', data.serverId).maybeSingle();
    check(server.error);
    if (!server.data) throw new Error('Le serveur choisi doit avoir son agent KumoMTA installé.');

    const { mailTesterRequest } = await import('./mail-tester.server');
    const response = await mailTesterRequest('/api/v1/placement', { method: 'POST', body: '{}' });
    if (!response.configured) throw new Error('Mail-Tester n’est pas configuré.');
    const test = placementTest.parse(response.body);
    const addresses = [...new Set(test.seeds.map(seed => seed.address.toLowerCase()))];
    const campaign = await db.from('campaigns').insert({
      ...amp,
      name: `Test Inbox ${test.token}`, from_name: data.fromName, from_email: data.fromEmail,
      reply_to: data.replyTo || null, subject: `${data.subject} [${test.token}]`, html: data.html,
      server_ids: [data.serverId], status: 'paused', total: addresses.length, created_by: context.userId,
    }).select('id').single();
    check(campaign.error);
    if (!campaign.data) throw new Error('Impossible de préparer l’envoi de test.');
    const id = campaign.data.id;
    const messages = await db.from('campaign_messages').insert(addresses.map(email => ({ campaign_id: id, server_id: data.serverId, email })));
    if (messages.error) {
      await db.from('campaigns').delete().eq('id', id).eq('status', 'paused');
      check(messages.error);
    }
    check((await db.from('campaigns').update({ status: 'queued' }).eq('id', id).eq('status', 'paused').select('id').single()).error);
    return test;
  });
