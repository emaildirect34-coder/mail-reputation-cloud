import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database, TablesInsert } from '@/integrations/supabase/types';
import { listInput, importInput, suppressionInput, launchInput, campaignStatusInput, campaignConflictsInput, senderQuotaForecastInput, concentratedImport, parseContacts, assignServers } from './sending.schemas';
import { campaignSendDeadline, campaignTimeZone, planRecipientSchedule, scheduledInstant } from './campaign-schedule';
import { isCampaignRoleMailbox, probableMailDomainTypo, recipientDomain } from './email-address';
import { renderWeeklyDigest } from './weekly-digest';
import { campaignDeliveryGroups } from './campaign-delivery-monitor';
import { campaignVersionKey, campaignVersionSnapshot } from './campaign-version';
import { projectSenderQuota, quotaForecastThrough, type QuotaDraftDay } from './sender-quota-forecast';
import { z } from 'zod';
import { canOpen } from './access';

async function admin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'superadmin' });
  if (error || !data) throw new Error('Accès réservé au Superadmin');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}
const check = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export const readDeliverySourceQuality = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const result = await db.rpc('read_sponsor_delivery_quality', { _offer: null });
    if (result.error?.code === 'PGRST202') return null;
    check(result.error);
    return result.data ?? [];
  });

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
    const fields = 'id,name,subject,status,total,suppressed,created_at,auto_pause_reason,server_ids';
    const campaigns = await db.from('campaigns').select(fields).order('created_at', { ascending: false }).limit(50);
    check(campaigns.error);
    const rows = campaigns.data ?? [];
    const serverIds = isAdmin ? [...new Set(rows.flatMap(row => row.server_ids))] : [];
    const [stats, servers] = await Promise.all([
      rows.length ? db.rpc('campaign_stats').in('campaign_id', rows.map(row => row.id)) : null,
      serverIds.length ? db.from('managed_servers').select('id,label').in('id', serverIds) : null,
    ]);
    check(stats?.error ?? null);
    check(servers?.error ?? null);
    const byId = new Map(stats?.data?.map(stat => [stat.campaign_id, stat]));
    const serverNames = new Map(servers?.data?.map(server => [server.id, server.label]));
    return {
      isAdmin,
      rows: rows.map(({ server_ids, ...campaign }) => ({
        ...campaign, serverNames: isAdmin ? server_ids.map(id => serverNames.get(id) ?? 'Serveur retiré') : [],
        queued: byId.get(campaign.id)?.queued ?? 0,
        injected: byId.get(campaign.id)?.sent ?? 0, failed: byId.get(campaign.id)?.failed ?? 0,
      })),
    };
  });

export const exportCampaignExclusions = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ campaignId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const campaign = await db.from('campaigns').select('id,name').eq('id', data.campaignId).maybeSingle();
    check(campaign.error);
    if (!campaign.data) throw new Error('Campagne introuvable.');
    const rows: { contact_id: string | null; email_md5: string; reason: string }[] = [];
    for (let offset = 0; offset <= 100_000; offset += 1000) {
      const batch = await db.from('campaign_exclusions').select('contact_id,email_md5,reason')
        .eq('campaign_id', data.campaignId).order('email_md5').range(offset, offset + 999);
      if (batch.error?.code === 'PGRST205' || batch.error?.code === '42P01') return null;
      check(batch.error);
      rows.push(...(batch.data ?? []));
      if ((batch.data ?? []).length < 1000) break;
    }
    if (rows.length > 100_000) throw new Error('Export supérieur à 100 000 lignes. Filtrez ou exportez par campagne plus petite.');
    const emails = new Map<string, string>();
    for (let offset = 0; offset < rows.length; offset += 500) {
      const ids = [...new Set(rows.slice(offset, offset + 500).flatMap(row => row.contact_id ? [row.contact_id] : []))];
      if (!ids.length) continue;
      const found = await db.from('contacts').select('id,email').in('id', ids);
      check(found.error);
      for (const item of found.data ?? []) emails.set(item.id, item.email);
    }
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: 'campaign.exclusions_exported', entityType: 'campaign', entityId: data.campaignId,
      summary: { rows: rows.length } });
    return { campaignName: campaign.data.name, rows: rows.map(row => ({ email: row.contact_id ? emails.get(row.contact_id) ?? null : null, email_md5: row.email_md5, reason: row.reason })) };
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
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: 'campaign.frequency_policy_changed', entityType: 'campaign_settings', summary: { hours: data } });
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

async function checkCampaignPool(db: Awaited<ReturnType<typeof admin>>, poolId: string, serverId: string) {
  const pool = (await marketingPools(db)).find(candidate => candidate.id === poolId);
  if (!pool?.serverIds.includes(serverId)) {
    throw new Error('Le pool marketing doit être actif et disposer d’une IPv4 utilisable sur le serveur choisi.');
  }
}

async function campaignServer(db: Awaited<ReturnType<typeof admin>>, serverId: string) {
  const [server, agent] = await Promise.all([
    db.from('managed_servers').select('id').eq('id', serverId).neq('status', 'absent').maybeSingle(),
    db.from('server_agents').select('metrics').eq('server_id', serverId).maybeSingle(),
  ]);
  check(server.error);
  check(agent.error);
  if (!server.data || !agent.data) throw new Error('Choisissez un serveur disponible avec un agent KumoMTA installé.');
  return agent.data;
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

async function checkCampaignList(db: Awaited<ReturnType<typeof admin>>, listId: string) {
  const list = await db.from('contact_lists').select('quarantined_at,quarantine_reason').eq('id', listId).maybeSingle();
  if (list.error?.code === '42703') throw new Error('La protection des listes nécessite la mise à jour de la base de données.');
  check(list.error);
  if (!list.data) throw new Error('Liste de contacts introuvable.');
  if (list.data.quarantined_at) throw new Error(`Liste de contacts en quarantaine. ${list.data.quarantine_reason ?? ''}`);
}

type CampaignAudienceInput = Pick<z.infer<typeof launchInput>,
  'listId' | 'segmentId' | 'recipientLocalTime' | 'sendWindow' | 'acceptTypoExclusions' | 'sunsetDays' | 'sponsorOfferId'> & { weeklyDigest: boolean };

async function campaignAudience(db: Awaited<ReturnType<typeof admin>>, data: CampaignAudienceInput, sponsorBrandId: string | null) {
  const eligible: { id: string; email: string; first_name: string | null; time_zone: string | null }[] = [];
  const { createHash } = await import('node:crypto');
  const excluded = new Map<string, { contact_id: string; email_md5: string; reason: string }>();
  const exclude = (contact: { id: string; email: string }, reason: string) => excluded.set(contact.id, {
    contact_id: contact.id, email_md5: createHash('md5').update(contact.email.trim().toLowerCase()).digest('hex'), reason,
  });
  const selected = data.segmentId ? await db.from('contact_segments').select('provider,preference')
    .eq('id', data.segmentId).eq('list_id', data.listId).maybeSingle() : null;
  if (selected && (selected.error || !selected.data)) throw new Error('Ce segment est indisponible pour la liste choisie.');
  const segment = selected?.data;
  let suppressedCount = 0;
  let formatExcluded = 0;
  let cursor: string | null = null;
  for (;;) {
    const args: Database['public']['Functions']['campaign_audience_page']['Args'] = {
      _list: data.listId, _after: cursor, _with_time_zone: data.recipientLocalTime === true || !!data.sendWindow, _digest: data.weeklyDigest,
    };
    const result = await db.rpc('campaign_audience_page', args);
    if (result.error?.code === 'PGRST202') throw new Error('Appliquez les migrations jusqu’à 0035 pour préparer les destinataires.');
    check(result.error);
    const page = result.data ?? [];
    const last = page.at(-1);
    if (!last) break;
    const filtered = segment ? await db.rpc('filter_contact_segment_page', {
      _list: data.listId, _ids: page.map(contact => contact.id), _provider: segment.provider, _preference: segment.preference,
    }) : null;
    if (filtered?.error) throw new Error('Le segment ne peut pas être appliqué à cette liste.');
    const matches = filtered ? new Set(filtered.data ?? []) : null;
    for (const contact of page) {
      if (matches && !matches.has(contact.id)) { exclude(contact, 'segment'); continue; }
      if (contact.suppressed) { suppressedCount++; exclude(contact, 'suppression'); }
      else if (contact.format_excluded) { formatExcluded++; exclude(contact, 'format'); }
      else eligible.push(contact);
    }
    cursor = last.id;
  }
  const contactCount = eligible.length + suppressedCount + formatExcluded;
  let typoCount = 0;
  let roleExcluded = 0;
  const candidates = eligible.flatMap(contact => {
    const domain = recipientDomain(contact.email);
    if (!domain) { exclude(contact, 'invalid_address'); return []; }
    if (isCampaignRoleMailbox(contact.email)) {
      roleExcluded++;
      exclude(contact, 'role_address');
      return [];
    }
    if (!probableMailDomainTypo(domain)) return [{ contact, domain }];
    typoCount++;
    exclude(contact, 'domain_typo');
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
  for (const candidate of candidates) if (inactive.has(candidate.contact.id)) exclude(candidate.contact, 'inactive');
  const buyers = new Set<string>();
  const blockedBrands = new Set<string>();
  if (data.sponsorOfferId) {
    for (let offset = 0; offset < engaged.length; offset += 500) {
      const ids = engaged.slice(offset, offset + 500).map(({ contact }) => contact.id);
      const args = { _offer: data.sponsorOfferId, _ids: ids };
      const [result, brandBlocks] = await Promise.all([
        db.rpc('sponsor_followup_blocked_contacts', args),
        sponsorBrandId ? db.rpc('sponsor_preference_blocked_contacts', { _brand: sponsorBrandId, _ids: ids }) : null,
      ]);
      // Keep legacy campaign launches available before the Lovable migration.
      if (result.error?.code === 'PGRST202') break;
      check(result.error);
      for (const id of result.data ?? []) buyers.add(id);
      if (brandBlocks) check(brandBlocks.error);
      for (const id of brandBlocks?.data ?? []) if (!buyers.has(id)) blockedBrands.add(id);
    }
  }
  for (const candidate of engaged) {
    if (buyers.has(candidate.contact.id)) exclude(candidate.contact, 'purchased');
    else if (blockedBrands.has(candidate.contact.id)) exclude(candidate.contact, 'brand_block');
  }
  const audience = engaged.filter(({ contact }) => !buyers.has(contact.id) && !blockedBrands.has(contact.id));
  const { campaignMailRoutes } = await import('./mail-dns.server');
  const dns = await campaignMailRoutes(audience.map(({ domain }) => domain));
  for (const item of audience) if (dns.get(item.domain) === 'no-route') exclude(item.contact, 'dns_unavailable');
  const keep = audience.filter(({ domain }) => dns.get(domain) !== 'no-route').map(({ contact }) => contact);
  const invalid = eligible.length - candidates.length + audience.length - keep.length;
  const dnsUnverified = audience.filter(({ domain }) => !dns.has(domain) || dns.get(domain) === 'unknown').length;
  const buyerExcluded = buyers.size;
  if (!keep.length) throw new Error(`Aucun destinataire envoyable. ${suppressedCount} en suppression, ${formatExcluded} hors format choisi, ${inactive.size} sans engagement récent, ${buyerExcluded} ayant déjà acheté cette offre, ${blockedBrands.size} ayant arrêté les offres de cette marque et ${invalid} adresses écartées.`);
  return { keep, exclusions: [...excluded.values()], contactCount, suppressedCount, formatExcluded, inactive, invalid, dnsUnverified, typoCount, roleExcluded, buyerExcluded, blockedBrands };
}

function planCampaignAudience(
  data: Pick<z.infer<typeof launchInput>, 'recipientLocalTime' | 'schedule' | 'sendWindowHours'>,
  timeZone: string | null, scheduledAt: string | null, contacts: { time_zone: string | null }[],
) {
  const recipientPlan = data.recipientLocalTime && data.schedule && timeZone
    ? planRecipientSchedule(data.schedule, timeZone, contacts.map(contact => contact.time_zone), data.sendWindowHours)
    : null;
  const window = (data.sendWindowHours ?? 0) * 3_600_000;
  const start = scheduledAt ? Date.parse(scheduledAt) : null;
  return {
    campaignStart: recipientPlan?.scheduledAt ?? scheduledAt,
    fallbackTimeZones: recipientPlan?.fallbackCount ?? null,
    availableAtFor: (index: number) => recipientPlan?.availableAt[index] ?? (window && start !== null
      ? new Date(start + Math.floor(index * window / contacts.length)).toISOString() : null),
  };
}

const clockMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

async function prepareScheduledForecast(
  db: Awaited<ReturnType<typeof admin>>, data: z.infer<typeof campaignConflictsInput>, accountTimeZone: unknown,
) {
  await checkCampaignList(db, data.listId);
  const timeZone = campaignTimeZone(accountTimeZone ?? 'UTC');
  if (data.scheduleTimeZone !== timeZone) throw new Error('Le fuseau horaire du compte a changé. Rechargez la page.');
  const scheduledAt = data.recipientLocalTime ? null : scheduledInstant(data.schedule, timeZone);
  const offer = data.sponsorOfferId
    ? await db.from('sponsor_offers').select('status,delivery_paused,brand_id').eq('id', data.sponsorOfferId).maybeSingle()
    : null;
  if (offer) {
    check(offer.error);
    if (offer.data?.status !== 'active' || offer.data.delivery_paused) throw new Error('Cette offre sponsor est inactive ou suspendue.');
  }
  const { keep } = await campaignAudience(db, data, offer?.data?.brand_id ?? null);
  const asOf = new Date().toISOString();
  if (scheduledAt && scheduledAt <= asOf) throw new Error('Choisissez une date de programmation future.');
  const { campaignStart, availableAtFor } = planCampaignAudience(data, timeZone, scheduledAt, keep);
  if (!campaignStart) throw new Error('Choisissez une date de programmation.');
  const draftDeadline = data.sendDeadline ? campaignSendDeadline(data.sendDeadline, timeZone, campaignStart) : null;
  return { keep, asOf, campaignStart, availableAtFor, draftDeadline, timeZone };
}

const quotaCohorts = z.array(z.object({ day: z.string(), last_day: z.string().nullable(), volume: z.number().int().nonnegative() }));

export const forecastSenderDomainQuota = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => senderQuotaForecastInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const domain = recipientDomain(data.fromEmail);
    if (!domain) throw new Error('Adresse expéditeur invalide.');
    const quota = await db.rpc('read_sender_domain_quota', { _domain: domain }).maybeSingle();
    if (quota.error?.code === 'PGRST202') throw new Error('Le plafond du domaine nécessite la migration 0066.');
    check(quota.error);
    if (quota.data?.daily_limit == null) return { kind: 'unconfigured' as const, domain };

    const metadata = context.claims.user_metadata as { campaign_time_zone?: unknown } | undefined;
    const { keep, asOf, campaignStart, availableAtFor, draftDeadline, timeZone } =
      await prepareScheduledForecast(db, data, metadata?.campaign_time_zone);
    const slots = new Map<string, { planned_at: string; zone: string | null; volume: number }>();
    const draft: QuotaDraftDay[] = [];
    const windowStart = data.sendWindow ? clockMinutes(data.sendWindow.start) : null;
    const windowEnd = data.sendWindow ? clockMinutes(data.sendWindow.end) : null;
    async function collectDraftDays() {
      if (!slots.size) return;
      const result = await db.rpc('forecast_sender_domain_draft_days', {
        _slots: [...slots.values()], _window_start: windowStart, _window_end: windowEnd, _deadline: draftDeadline,
      });
      if (result.error?.code === 'PGRST202') throw new Error('La prévision de saturation nécessite la migration 0067.');
      check(result.error);
      draft.push(...(result.data ?? []));
      slots.clear();
    }
    for (const [index, contact] of keep.entries()) {
      const planned_at = availableAtFor(index) ?? campaignStart;
      const zone = data.sendWindow ? contact.time_zone || timeZone : null;
      const key = planned_at + '|' + (zone ?? '');
      const previous = slots.get(key);
      if (previous) previous.volume++;
      else slots.set(key, { planned_at, zone, volume: 1 });
      if (slots.size === 2500) await collectDraftDays();
    }
    await collectDraftDays();
    if (!draft.length) throw new Error('Aucun créneau de campagne à analyser.');
    const queue = await db.rpc('forecast_sender_domain_queue', {
      _domain: domain, _as_of: asOf, _through: quotaForecastThrough(draft),
    }).maybeSingle();
    check(queue.error);
    if (!queue.data) return { kind: 'unconfigured' as const, domain };
    const { daily_limit: limit, used, cohorts } = queue.data;
    const projection = projectSenderQuota({ asOf, limit, used, deadline: draftDeadline, existing: quotaCohorts.parse(cohorts), draft });
    return { kind: 'forecast' as const, domain, limit, used, asOf, audience: keep.length, ...projection };
  });

const conflictCampaign = z.object({
  id: z.string(), name: z.string(), scheduled_at: z.string().nullable(),
  status: z.enum(['queued', 'paused']), send_priority: z.number(),
  overlap: z.number(), draft_delayed: z.number(), other_delayed: z.number(), uncertain: z.number(),
});

export const forecastCampaignConflicts = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => campaignConflictsInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const metadata = context.claims.user_metadata as { campaign_time_zone?: unknown } | undefined;
    const [capHours, { keep, asOf, campaignStart, availableAtFor, draftDeadline, timeZone }] = await Promise.all([
      frequencyPolicy(db),
      prepareScheduledForecast(db, data, metadata?.campaign_time_zone),
    ]);
    if (capHours === null) throw new Error('Le plafond de fréquence nécessite une mise à jour de la base de données.');

    const { createHash } = await import('node:crypto');
    const recipients = new Map<string, { email_md5: string; planned_at: string; zone: string | null }>();
    for (const [index, contact] of keep.entries()) {
      const email_md5 = createHash('md5').update(contact.email.trim().toLowerCase()).digest('hex');
      const planned_at = availableAtFor(index) ?? campaignStart;
      const previous = recipients.get(email_md5);
      if (!previous || planned_at < previous.planned_at) {
        recipients.set(email_md5, { email_md5, planned_at, zone: data.sendWindow ? contact.time_zone || timeZone : null });
      }
    }

    const all = [...recipients.values()];
    const campaigns = new Map<string, z.infer<typeof conflictCampaign>>();
    let overlap = 0, draftAtRisk = 0;
    for (let offset = 0; offset < all.length; offset += 2500) {
      const result = await db.rpc('forecast_campaign_conflicts', {
        _recipients: all.slice(offset, offset + 2500), _server: data.serverIds[0]!, _priority: data.sendPriority ?? 0,
        _as_of: asOf, _cap_hours: capHours, _window_start: data.sendWindow ? clockMinutes(data.sendWindow.start) : null,
        _window_end: data.sendWindow ? clockMinutes(data.sendWindow.end) : null,
        ...(draftDeadline ? { _draft_deadline: draftDeadline } : {}),
      }).single();
      if (result.error?.code === 'PGRST202') throw new Error(draftDeadline
        ? 'Le calendrier avec date limite nécessite la migration 0062.' : 'Le calendrier des conflits nécessite la migration 0060.');
      check(result.error);
      if (!result.data) throw new Error('Analyse des conflits indisponible.');
      overlap += result.data.overlap;
      draftAtRisk += result.data.draft_at_risk;
      for (const row of conflictCampaign.array().parse(result.data.campaigns)) {
        const prior = campaigns.get(row.id);
        if (prior) {
          row.overlap += prior.overlap;
          row.draft_delayed += prior.draft_delayed;
          row.other_delayed += prior.other_delayed;
          row.uncertain += prior.uncertain;
        }
        campaigns.set(row.id, row);
      }
    }
    return {
      audience: all.length, capHours, overlap, draftAtRisk, asOf,
      campaigns: [...campaigns.values()].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '') || a.name.localeCompare(b.name)),
    };
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
    await checkCampaignList(db, data.listId);
    const metadata = context.claims.user_metadata as { campaign_time_zone?: unknown } | undefined;
    const sendWindow = data.sendWindow;
    const windowTimeZone = sendWindow ? campaignTimeZone(metadata?.campaign_time_zone ?? 'UTC') : null;
    const timeZone = data.schedule || data.sendDeadline ? campaignTimeZone(metadata?.campaign_time_zone ?? 'UTC') : null;
    if (timeZone && data.scheduleTimeZone !== timeZone) throw new Error('Le fuseau horaire du compte a changé. Rechargez la page avant de programmer l’envoi.');
    const scheduledAt = data.schedule && timeZone && !data.recipientLocalTime ? scheduledInstant(data.schedule, timeZone) : null;
    if (data.sendWindowHours && !data.schedule) throw new Error('Choisissez une date de départ pour lisser l’envoi.');
    if (data.recipientLocalTime && !data.schedule) throw new Error('Choisissez une date de départ pour programmer selon les fuseaux des destinataires.');
    if (data.sendWindowHours || data.recipientLocalTime) {
      const capability = await db.from('campaign_messages').select('available_at').limit(1);
      if (capability.error) throw new Error('La programmation individuelle nécessite la mise à jour de la base de données.');
    }
    if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) throw new Error('Choisissez une date de programmation future.');
    let sponsorBrandId: string | null = null;
    if (data.sponsorOfferId) {
      const offer = await db.from('sponsor_offers').select('*').eq('id', data.sponsorOfferId).single();
      check(offer.error);
      if (offer.data?.status !== 'active' || offer.data.delivery_paused) throw new Error('Cette offre sponsor est inactive ou suspendue.');
      sponsorBrandId = offer.data.brand_id ?? null;
      if (data.monitorPlacement && process.env['SPONSOR_AUDIT_HOSTS']) {
        const { trackableHref } = await import('./tracking-request');
        const { hasClickId } = await import('./postback');
        const { checkSponsorDestination } = await import('./sponsor-destination.server');
        const links = [...new Set([...html.matchAll(trackableHref)].map(match => match[1]!.replaceAll('&amp;', '&')).filter(hasClickId))];
        if (links.length > 3) throw new Error('Limitez le contrôle à trois destinations sponsor distinctes.');
        const results = await Promise.all((links.length ? links : [offer.data.tracking_url]).map(checkSponsorDestination));
        const broken = results.find(result => result.status === 'failed');
        if (broken) throw new Error(broken.detail);
      }
    }
    const serverId = data.serverIds[0]!;
    const srv = await campaignServer(db, serverId);
    if (data.senderProfileId) await (await import('./sender-profiles.server')).assertSenderProfile(db, data, serverId);
    const [capHours, domainQuota] = await Promise.all([
      frequencyPolicy(db),
      db.rpc('read_sender_domain_quota', { _domain: recipientDomain(data.fromEmail) ?? '' }).maybeSingle(),
    ]);
    if (domainQuota.error?.code !== 'PGRST202') check(domainQuota.error);
    const { metrics } = srv;
    if ((data.monitorPlacement || data.sponsorOfferId || data.digestText || data.fatigueProtection || data.sendDeadline || sendWindow || capHours || domainQuota.data?.daily_limit) &&
      (!metrics || typeof metrics !== 'object' || Array.isArray(metrics) || metrics['preferencePermit'] !== true)) {
      throw new Error('Mettez à jour l’agent KumoMTA du serveur choisi pour appliquer les protections avant envoi.');
    }
    if (data.vmtaPoolId) {
      await checkCampaignPool(db, data.vmtaPoolId, serverId);
      const capability = await db.from('campaigns').select('vmta_pool_id').limit(1);
      if (capability.error) throw new Error('Le routage par pool nécessite la mise à jour de la base de données.');
    }
    const { keep, exclusions, contactCount, suppressedCount, formatExcluded, inactive, invalid, dnsUnverified, typoCount, roleExcluded, buyerExcluded, blockedBrands } =
      await campaignAudience(db, { ...data, weeklyDigest: !!data.digestText }, sponsorBrandId);
    const { campaignStart, fallbackTimeZones, availableAtFor } = planCampaignAudience(data, timeZone, scheduledAt, keep);
    const sendExpiresAt = data.sendDeadline && timeZone ? campaignSendDeadline(data.sendDeadline, timeZone, campaignStart) : null;
    const { withCampaignDuplicateReview } = await import('./campaign-duplicates.server');
    return withCampaignDuplicateReview(db, context.userId, data, html, keep, async renew => {
      const preparing = 'Préparation des destinataires en cours';
      const placementHold = 'Contrôle des boîtes témoins en attente';
      const campaign: TablesInsert<'campaigns'> = {
        ...amp,
        ...(data.monitorPlacement ? { requires_placement: true } : {}),
        ...(sponsorBrandId ? { sponsor_brand_id: sponsorBrandId } : {}),
        ...(sendWindow ? { send_window_start: clockMinutes(sendWindow.start), send_window_end: clockMinutes(sendWindow.end) } : {}),
        ...(data.sendPriority ? { send_priority: data.sendPriority } : {}),
        ...(data.digestText ? { weekly_digest: true } : {}),
        ...(data.fatigueProtection && !data.digestText ? { fatigue_protection: true } : {}),
        ...(data.topic ? { topic: data.topic } : {}),
        ...(data.vmtaPoolId ? { vmta_pool_id: data.vmtaPoolId } : {}),
        ...(campaignStart ? { scheduled_at: campaignStart, approval_required: true } : {}),
        ...(sendExpiresAt ? { send_expires_at: sendExpiresAt } : {}),
        ...(data.senderProfileId ? { sender_profile_id: data.senderProfileId } : {}),
        auto_pause_reason: preparing, sponsor_offer_id: data.sponsorOfferId ?? null,
        name: data.name, from_name: data.fromName, from_email: data.fromEmail, reply_to: data.replyTo || null,
        subject: data.subject, html, list_id: data.listId, server_ids: data.serverIds, status: 'paused',
        total: keep.length, suppressed: contactCount - keep.length, created_by: context.userId,
      };
      const insert = (values: TablesInsert<'campaigns'>) => db.from('campaigns').insert(values).select('id').single();
      let camp = await insert(data.digestText ? { ...campaign, history_digest_source: data.digestText } : campaign);
      if (data.digestText && camp.error?.message.includes('history_digest_source') && ['PGRST204', '42703'].includes(camp.error.code)) {
        camp = await insert(campaign);
      }
      if (data.topic && camp.error?.message.includes("'topic'")) throw new Error('Appliquez la migration 0031 pour envoyer une campagne avec un thème.');
      if (data.fatigueProtection && camp.error?.message.includes("'fatigue_protection'")) throw new Error('Appliquez la migration 0039 pour activer la protection de cadence.');
      if (sendWindow && camp.error?.message.includes('send_window_')) throw new Error('La plage horaire nécessite la migration 0053.');
      if (data.sendPriority && camp.error?.message.includes('send_priority')) throw new Error('La priorité d’envoi nécessite la migration 0056.');
      if (campaignStart && camp.error?.message.includes('approval_required')) throw new Error('La validation des campagnes programmées nécessite la migration 0059.');
      if (sendExpiresAt && camp.error?.message.includes('send_expires_at')) throw new Error('La date limite d’envoi nécessite la migration 0062.');
      check(camp.error);
      if(!camp.data)throw new Error('Campagne non créée');
      const campaignId=camp.data.id;
      for (let offset = 0; offset < exclusions.length; offset += 1000) {
        const saved = await db.from('campaign_exclusions').insert(exclusions.slice(offset, offset + 1000).map(row => ({ campaign_id: campaignId, ...row })));
        if (saved.error?.code === 'PGRST205' || saved.error?.code === '42P01') break;
        check(saved.error);
      }
      const rows = assignServers(keep, data.serverIds).map(({ item, server }, index) => {
        const availableAt = availableAtFor(index);
        return {
          campaign_id: campaignId, contact_id: item.id, email: item.email, first_name: item.first_name, server_id: server,
          ...(availableAt ? { available_at: availableAt } : {}),
          ...(windowTimeZone ? { send_time_zone: item.time_zone || windowTimeZone } : {}),
        };
      });
      try {
        for (let i = 0; i < rows.length; i += 1000) {
          await renew();
          check((await db.from('campaign_messages').insert(rows.slice(i, i + 1000))).error);
        }
        await renew(true);
        if (sendExpiresAt && Date.parse(sendExpiresAt) <= Date.now()) throw new Error('La date limite a été atteinte pendant la préparation.');
        const queued = await db.from('campaigns').update(data.monitorPlacement
          ? { status: 'paused', auto_pause_reason: placementHold }
          : { status: 'queued', auto_pause_reason: null })
          .eq('id', campaignId).eq('status', 'paused').eq('auto_pause_reason', preparing).select('id').maybeSingle();
        check(queued.error);
        if (!queued.data) throw new Error('La campagne a changé d’état pendant sa préparation.');
      } catch (error) {
        await db.from('campaigns').delete().eq('id', campaignId).eq('status', 'paused').eq('auto_pause_reason', preparing);
        throw error;
      }
      const placementMonitor = data.monitorPlacement ? await startPlacementMonitor(db, campaignId, data.serverIds[0]!) : 'disabled';
      const { recordAuditEvent } = await import('./audit-log.server');
      await recordAuditEvent(db, { actorId: context.userId, action: 'campaign.created', entityType: 'campaign', entityId: campaignId,
        summary: { recipients: keep.length, servers: data.serverIds.length, scheduled: !!campaignStart, placement_check: data.monitorPlacement } });
      return {
        kind: 'launched' as const, id: campaignId, total: keep.length, suppressed: suppressedCount, inactive: inactive.size, invalid, dnsUnverified, typoCount, roleExcluded, formatExcluded, buyerExcluded, brandExcluded: blockedBrands.size,
        scheduledAt: campaignStart, sendExpiresAt, fallbackTimeZones, placementMonitor,
      };
    });
  });

async function campaignDeadline(db: Awaited<ReturnType<typeof admin>>, id: string) {
  const result = await db.rpc('read_campaign_deadline', { _campaign: id }).maybeSingle();
  if (result.error?.code !== 'PGRST202') check(result.error);
  return result.data;
}

export const setCampaignStatus = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => campaignStatusInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    if (data.status === 'queued' && (await campaignDeadline(db, data.id))?.deadline_reached) throw new Error('La date limite de cette campagne est atteinte.');
    const campaign = await db.from('campaigns').select('auto_pause_reason').eq('id',data.id).single();
    check(campaign.error);
    if (data.status==='queued' && campaign.data?.auto_pause_reason) throw new Error('Campagne bloquée par la protection automatique : '+campaign.data.auto_pause_reason);
    const changed = await db.from('campaigns').update({ status: data.status }).eq('id', data.id).not('status', 'in', '(done,cancelled)').select('id').maybeSingle();
    check(changed.error);
    if (changed.data) {
      const { recordAuditEvent } = await import('./audit-log.server');
      await recordAuditEvent(db, { actorId: context.userId, action: `campaign.status_${data.status}`, entityType: 'campaign', entityId: data.id, summary: { status: data.status } });
    }
    return { ok: !!changed.data };
  });

const inboxTestInput = launchInput.pick({ fromName: true, fromEmail: true, replyTo: true, senderProfileId: true, subject: true, html: true, ampHtml: true, vmtaPoolId: true }).extend({
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
  received_at: z.string().datetime({ offset: true }).nullable().optional(),
  authentication: z.object({
    spf: z.enum(['pass', 'fail', 'unknown']), dkim: z.enum(['pass', 'fail', 'unknown']),
    dmarc: z.enum(['pass', 'fail', 'unknown']), one_click: z.boolean(),
  }).nullable().optional(),
})).min(1).max(20);

async function startPlacementMonitor(db: Awaited<ReturnType<typeof admin>>, campaignId: string, serverId: string) {
  try {
    const { mailTesterRequest } = await import('./mail-tester.server');
    const response = await mailTesterRequest('/api/v1/placement', { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) });
    if (!response.configured) return 'unconfigured';
    const test = placementTest.parse(response.body);
    const result = await db.rpc('start_campaign_preflight', {
      _campaign: campaignId, _server: serverId, _placement: test.id, _token: test.token, _expires: test.expires_at, _seeds: test.seeds,
    });
    if (result.error?.code === 'PGRST202') return 'migration';
    return result.error ? 'failed' : 'started';
  } catch {
    return 'failed';
  }
}

export const retryCampaignPreflight = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    if ((await campaignDeadline(db, data.id))?.deadline_reached) throw new Error('La date limite de cette campagne est atteinte.');
    const campaign = await db.from('campaigns').select('server_ids,requires_placement,status').eq('id', data.id).single();
    check(campaign.error);
    if (!campaign.data?.requires_placement || !['queued', 'paused'].includes(campaign.data.status)) throw new Error('Contrôle indisponible.');
    return startPlacementMonitor(db, data.id, campaign.data.server_ids[0]!);
  });

export const releaseCampaignProvider = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid(), provider: z.string().min(1).max(253) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const release = await db.rpc('release_campaign_provider', { _campaign: data.id, _provider: data.provider });
    check(release.error);
    if (!release.data) throw new Error('Ce fournisseur est encore en attente d’un test complet et conforme.');
    return { ok: true };
  });

export const setCampaignPriority = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid(), priority: z.number().int().min(-1).max(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('campaigns').update({ send_priority: data.priority }).eq('id', data.id)
      .neq('status', 'cancelled').select('id').maybeSingle();
    check(result.error);
    if (!result.data) throw new Error('Campagne indisponible.');
    return { ok: true };
  });

export const setCampaignServerCapacity = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ serverId: z.string().uuid(), perMinute: z.number().int().min(1).max(100000).nullable() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('set_server_campaign_capacity', { _server: data.serverId, _per_minute: data.perMinute });
    check(result.error);
    if (!result.data) throw new Error('Serveur indisponible.');
    return { ok: true };
  });

export const retryConfirmedCampaignMessages = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    if ((await campaignDeadline(db, data.id))?.deadline_reached) throw new Error('La date limite de cette campagne est atteinte.');
    const result = await db.rpc('retry_confirmed_campaign_messages', { _campaign: data.id }).single();
    check(result.error);
    if (!result.data) throw new Error('Reprise indisponible.');
    return result.data;
  });

export const prepareCampaignUnsubscribeProbe = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('prepare_campaign_unsubscribe_probe', { _campaign: data.id });
    check(result.error);
    return result.data?.[0] ?? null;
  });

export const finishCampaignUnsubscribeProbe = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid(), acknowledged: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('finish_campaign_unsubscribe_probe', { _probe: data.id, _http_ok: data.acknowledged });
    check(result.error);
    return { ok: result.data === true };
  });

export const approveScheduledCampaign = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid(), revision: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('approve_scheduled_campaign', { _campaign: data.id, _revision: data.revision });
    check(result.error);
    if (!result.data) throw new Error('Cette version ne peut plus être validée. Consultez le suivi actualisé.');
  });

export const readCampaignVersions = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => campaignVersionKey.pick({ id: true }).extend({ before: campaignVersionKey.shape.version.optional() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const pageSize = 20;
    let query = db.from('campaign_versions').select('version,created_at,source').eq('campaign_id', data.id).order('version', { ascending: false }).limit(pageSize + 1);
    if (data.before) query = query.lt('version', data.before);
    const result = await query;
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    check(result.error);
    const items = (result.data ?? []).slice(0, pageSize);
    return { items, next: (result.data?.length ?? 0) > pageSize ? items.at(-1)?.version : undefined };
  });

export const readCampaignVersion = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => campaignVersionKey.parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('campaign_versions').select('version,created_at,snapshot')
      .eq('campaign_id', data.id).eq('version', data.version).maybeSingle();
    check(result.error);
    if (!result.data) throw new Error('Version de campagne introuvable.');
    const snapshot = campaignVersionSnapshot.parse(result.data.snapshot);
    const { describeCampaignVersion, recoverCampaignDigest } = await import('./campaign-version.server');
    const offer = snapshot.sponsorId ? await db.from('sponsor_offers').select('tracking_url,status,delivery_paused')
      .eq('id', snapshot.sponsorId).maybeSingle() : null;
    if (offer) check(offer.error);
    let digestSource: string | null = null;
    if (snapshot.weeklyDigest) {
      try {
        if (snapshot.digestSource && renderWeeklyDigest(snapshot.digestSource) === snapshot.html) digestSource = snapshot.digestSource;
      } catch { /* A version with edited HTML can still be restored from its archived content. */ }
      digestSource ??= recoverCampaignDigest(snapshot.html);
    }
    return {
      version: result.data.version,
      createdAt: result.data.created_at,
      snapshot,
      digestSource,
      sponsorAvailable: offer?.data?.status === 'active' && !offer.data.delivery_paused && offer.data.tracking_url === snapshot.sponsorUrl,
      ...describeCampaignVersion(snapshot.html),
    };
  });

export const readCampaignDeliveryReconciliation = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('read_campaign_delivery_reconciliation', { _campaign: data.id }).maybeSingle();
    if (result.error?.code === 'PGRST202') return null;
    check(result.error);
    if (!result.data) throw new Error('Campagne introuvable.');
    return { ...result.data, outcomes: z.record(z.number().int().nonnegative()).parse(result.data.outcomes) };
  });

export const readCampaignDeliveryMonitor = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const deadline = await campaignDeadline(db, data.id);
    const [campaign, delivery, monitor, gate, scans, priority, recovery, approval, domainQuota] = await Promise.all([
      db.from('campaigns').select('id,name,status,from_email').eq('id', data.id).single(),
      db.rpc('read_campaign_delivery_by_domain', { _campaign: data.id }),
      db.from('campaign_placement_monitors').select('*').eq('campaign_id', data.id).maybeSingle(),
      db.from('campaigns').select('requires_placement').eq('id', data.id).maybeSingle(),
      db.rpc('read_campaign_smtp_scans', { _campaign: data.id }),
      db.rpc('read_campaign_queue_priority', { _campaign: data.id }),
      db.rpc('read_campaign_retry_status', { _campaign: data.id }).maybeSingle(),
      db.rpc('read_scheduled_campaign_approval', { _campaign: data.id }).maybeSingle(),
      db.rpc('read_campaign_sender_domain_quota', { _campaign: data.id }).maybeSingle(),
    ]);
    if (delivery.error?.code === 'PGRST202' || monitor.error?.code === 'PGRST205') {
      throw new Error('Le suivi des campagnes nécessite la migration 0043.');
    }
    for (const result of [campaign, delivery, monitor]) check(result.error);
    for (const result of [scans, priority, recovery, approval, domainQuota]) if (result.error?.code !== 'PGRST202') check(result.error);
    if (!campaign.data) throw new Error('Campagne introuvable.');
    const holds = await db.from('delivery_provider_holds').select('provider,reason,occurred_at,until_at')
      .eq('sender_domain', recipientDomain(campaign.data.from_email) ?? '')
      .or(`until_at.is.null,until_at.gt.${new Date().toISOString()}`);
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
        const saved = await db.from('campaign_placement_monitors').update(updates).eq('campaign_id', data.id).eq('placement_id', snapshot.placement_id).is('completed_at', null)
          .or(`observed_at.is.null,observed_at.lt.${observedAt}`).select('*').maybeSingle();
        check(saved.error);
        if (saved.data) snapshot = saved.data;
      } catch {
        placementUnavailable = true;
      }
    }
    const seeds = snapshot ? observedSeeds.parse(snapshot.seeds) : [];
    const requiresPlacement = gate.data?.requires_placement === true;
    const releases = requiresPlacement
      ? await db.from('campaign_placement_releases').select('provider').eq('campaign_id', data.id) : null;
    if (releases) check(releases.error);
    const waves = requiresPlacement ? await db.rpc('read_campaign_wave_status', { _campaign: data.id }) : null;
    if (waves?.error && waves.error.code !== 'PGRST202') check(waves.error);
    return {
      campaign: { ...campaign.data, requiresPlacement },
      releasedProviders: (releases?.data ?? []).map(row => row.provider),
      waves: waves?.data ?? [],
      smtpScans: scans.data ?? [],
      queuePriority: priority.data ?? [],
      retryStatus: recovery.data,
      deadline,
      approval: approval.data,
      domainQuota: domainQuota.data,
      holds: holds.data ?? [],
      groups: campaignDeliveryGroups(delivery.data ?? [], seeds),
      placement: snapshot && {
        serverId: snapshot.server_id, observedAt: snapshot.observed_at, completedAt: snapshot.completed_at,
        expiresAt: snapshot.expires_at, unavailable: placementUnavailable,
        id: snapshot.placement_id,
        unsubscribeHttpsRequired: 'unsubscribe_https_verified_at' in snapshot,
        unsubscribeHttpsVerifiedAt: snapshot.unsubscribe_https_verified_at ?? null,
        seeds,
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
    await campaignServer(db, data.serverId);
    if (data.senderProfileId) await (await import('./sender-profiles.server')).assertSenderProfile(db, data, data.serverId);
    if (data.vmtaPoolId) await checkCampaignPool(db, data.vmtaPoolId, data.serverId);

    const { mailTesterRequest } = await import('./mail-tester.server');
    const response = await mailTesterRequest('/api/v1/placement', { method: 'POST', body: '{}' });
    if (!response.configured) throw new Error('Mail-Tester n’est pas configuré.');
    const test = placementTest.parse(response.body);
    const addresses = [...new Set(test.seeds.map(seed => seed.address.toLowerCase()))];
    const campaign = await db.from('campaigns').insert({
      ...amp,
      name: `Test Inbox ${test.token}`, from_name: data.fromName, from_email: data.fromEmail,
      ...(data.senderProfileId ? { sender_profile_id: data.senderProfileId } : {}),
      reply_to: data.replyTo || null, subject: `${data.subject} [${test.token}]`, html: data.html,
      ...(data.vmtaPoolId ? { vmta_pool_id: data.vmtaPoolId } : {}),
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
