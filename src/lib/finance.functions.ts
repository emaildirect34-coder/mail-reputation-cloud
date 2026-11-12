import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { canOpen } from './access';
import { accountInput,offerInput,financeFilters,entryBatch,entryStatus,day } from './finance.schemas';
import { purchaseReviewUrl } from './sponsor-buyers';
import { linkCheckSchema, reconciliationSchema } from './sponsor-oversight';
import { sponsorWidgetSchema } from './operations-widgets';
async function authorize(ctx:{supabase:SupabaseClient<Database>;userId:string},path:string,write=false){
  const role=await ctx.supabase.rpc('has_role',{_user_id:ctx.userId,_role:'superadmin'});
  if(role.error) throw new Error('Droits indisponibles');
  if(role.data) return true;
  if(write) throw new Error('Modification réservée aux Superadmins');
  const tasks=await ctx.supabase.from('worker_tasks').select('allowed_paths').eq('user_id',ctx.userId).eq('status','active');
  if(tasks.error||!canOpen({role:'worker',paths:(tasks.data??[]).flatMap(t=>t.allowed_paths)},path)) throw new Error('Accès non autorisé');
  return false;
}
const check=(error:{message:string}|null)=>{if(error) throw new Error('Opération impossible : '+error.message);};
export const readSponsors=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const isAdmin=await authorize(context,'/dashboard/templates');
  const [accounts,offers]=await Promise.all([context.supabase.from('sponsor_accounts').select('*').order('name'),context.supabase.from('sponsor_offers').select('*').order('name')]);
  check(accounts.error);check(offers.error);return {accounts:accounts.data??[],offers:offers.data??[],isAdmin};
});
export const campaignOffers=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  await authorize(context,'/dashboard/campaigns');
  const r=await context.supabase.from('sponsor_offers').select('id,name,subject,html,tracking_url,currency,payout,account_id').eq('status','active');check(r.error);return r.data??[];
});
export const saveSponsorAccount=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>accountInput.parse(i)).handler(async({data,context})=>{
  await authorize(context,'/dashboard/templates',true);
  if(data.provider==='everflow'&&!data.apiKey.trim()) throw new Error('Clé API affilié Everflow requise');
  const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  const r=await supabaseAdmin.from('sponsor_accounts').insert({name:data.name,provider:data.provider,currency:data.currency,created_by:context.userId}).select('id').single();check(r.error);if(!r.data) throw new Error('Compte non créé');
  if(data.apiKey) {const key=await supabaseAdmin.from('sponsor_credentials').insert({account_id:r.data.id,api_key:data.apiKey});if(key.error){await supabaseAdmin.from('sponsor_accounts').delete().eq('id',r.data.id);throw new Error('Clé non enregistrée');}}
  return {id:r.data.id};
});
export const saveSponsorOffer=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>offerInput.parse(i)).handler(async({data,context})=>{
  await authorize(context,'/dashboard/templates',true);
  const row={account_id:data.accountId,external_id:data.externalId??null,name:data.name,category:data.category,model:data.model,payout:data.payout,currency:data.currency,geo:data.geo,status:data.status,tracking_url:data.trackingUrl,subject:data.subject,html:data.html,rules:data.rules};
  const r=data.id?await context.supabase.from('sponsor_offers').update(row).eq('id',data.id):await context.supabase.from('sponsor_offers').insert(row);check(r.error);return {ok:true};
});
export const syncSponsorOffers=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>z.object({id:z.string().uuid()}).parse(i)).handler(async({data,context})=>{
  await authorize(context,'/dashboard/templates',true);
  const {syncEverflow}=await import('./sponsors.server');return syncEverflow(data.id);
});
export const readFinance=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>financeFilters.parse(i)).handler(async({data,context})=>{
  const isAdmin=await authorize(context,'/dashboard/finance');
  let q=context.supabase.from('finance_entries').select('*').gte('occurred_on',data.from).lte('occurred_on',data.to).eq('currency',data.currency).order('occurred_on',{ascending:false}).order('id');
  if(data.accountId)q=q.eq('account_id',data.accountId);if(data.campaignId)q=q.eq('campaign_id',data.campaignId);
  const entries:Database['public']['Tables']['finance_entries']['Row'][]=[];
  for(let offset=0;;offset+=1000){const r=await q.range(offset,offset+999);check(r.error);entries.push(...(r.data??[]));if((r.data??[]).length<1000)break;if(offset>=99000)throw new Error('Réduisez la période : plus de 100 000 écritures');}
  const [accounts,campaigns,offers]=await Promise.all([context.supabase.from('sponsor_accounts').select('id,name,currency'),context.supabase.rpc('finance_campaign_metrics',{_from:data.from,_to:data.to}),context.supabase.from('sponsor_offers').select('id,name,account_id')]);
  for(const r of [accounts,campaigns,offers])check(r.error);
  return {entries,accounts:accounts.data??[],campaigns:campaigns.data??[],offers:offers.data??[],isAdmin};
});
export const recordFinanceEntries=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>entryBatch.parse(i)).handler(async({data,context})=>{
  await authorize(context,'/dashboard/finance',true);
  const r=await context.supabase.from('finance_entries').upsert(data.entries.map(e=>({account_id:e.accountId,campaign_id:e.campaignId??null,offer_id:e.offerId??null,external_id:e.externalId,kind:e.kind,status:e.status,amount_cents:e.amountCents,currency:e.currency,category:e.category,description:e.description,occurred_on:e.occurredOn,due_on:e.dueOn??null,source:data.entries.length>1?'import':'manual',created_by:context.userId})),{onConflict:'account_id,external_id',ignoreDuplicates:true}).select('id');check(r.error);return {inserted:r.data?.length??0};
});
export const updateFinanceStatus=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>entryStatus.parse(i)).handler(async({data,context})=>{
  await authorize(context,'/dashboard/finance',true);check((await context.supabase.from('finance_entries').update({status:data.status}).eq('id',data.id)).error);return {ok:true};
});export const createPostback=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>z.object({id:z.string().uuid()}).parse(i)).handler(async({data,context})=>{
  await authorize(context,'/dashboard/templates',true);
  const {sha256Hex}=await import('./postback');
  const bytes=crypto.getRandomValues(new Uint8Array(24));const token='pb_'+[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  const r=await supabaseAdmin.from('sponsor_postbacks').upsert({account_id:data.id,token_hash:await sha256Hex(token),hits:0,last_at:null},{onConflict:'account_id'});check(r.error);
  return {token};
});
export const postbackStats=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  if(!await authorize(context,'/dashboard/templates')) return [];
  const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  const r=await supabaseAdmin.from('sponsor_postbacks').select('account_id,hits,last_at,created_at');check(r.error);return r.data??[];
});

export const readSponsorBuyers = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ offerId: z.string().uuid(), page: z.number().int().min(0).max(100000) }).parse(data))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const [settings, buyers, lists, quality, offer, brand, brands] = await Promise.all([
      db.from('sponsor_purchase_settings').select('*').eq('offer_id', data.offerId).maybeSingle(),
      db.rpc('read_sponsor_buyers', { _offer: data.offerId, _offset: data.page * 50 }),
      db.from('contact_lists').select('id,name').is('quarantined_at', null).order('name'),
      db.rpc('read_sponsor_delivery_quality', { _offer: data.offerId }),
      db.from('sponsor_offers').select('*').eq('id', data.offerId).single(),
      db.rpc('read_sponsor_offer_brand', { _offer: data.offerId }),
      db.rpc('list_sponsor_brands'),
    ]);
    for (const result of [settings, buyers, lists, offer]) check(result.error);
    if (quality.error?.code !== 'PGRST202') check(quality.error);
    if (brand.error?.code !== 'PGRST202') check(brand.error);
    if (brands.error?.code !== 'PGRST202') check(brands.error);
    return { settings: settings.data, buyers: buyers.data ?? [], lists: lists.data ?? [], quality: quality.data,
      paused: offer.data?.delivery_paused === true, brand: brand.data, brands: brands.data ?? [], brandAvailable: !brand.error };
  });

export const assignSponsorBrand = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ offerId: z.string().uuid(), name: z.string().trim().min(1).max(100) }).parse(data))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const result = await db.rpc('set_sponsor_offer_brand', { _offer: data.offerId, _name: data.name });
    check(result.error);
    if (!result.data) throw new Error('Offre introuvable.');
    return { ok: true };
  });

export const auditSponsorOffer = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const offer = await db.from('sponsor_offers').select('tracking_url').eq('id', data.id).single();
    check(offer.error);
    const { checkSponsorDestination } = await import('./sponsor-destination.server');
    return checkSponsorDestination(offer.data?.tracking_url ?? '');
  });

export const pauseSponsorOffer = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ id: z.string().uuid(), paused: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/templates', true);
    check((await context.supabase.from('sponsor_offers').update({ delivery_paused: data.paused }).eq('id', data.id)).error);
    return { ok: true };
  });

export const saveSponsorPurchaseSettings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({
    offerId: z.string().uuid(),
    eventKey: z.string().trim().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
    enabled: z.boolean(),
    reviewUrl: z.string().trim().max(2048),
    consentListId: z.string().uuid().nullable(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/templates', true);
    const reviewUrl = data.reviewUrl ? purchaseReviewUrl(data.reviewUrl) : null;
    if (data.reviewUrl && !reviewUrl) throw new Error('Utilisez une adresse HTTPS pour la page d’avis.');
    if (data.enabled && !data.consentListId) throw new Error('Sélectionnez la liste des abonnés qui donnent leur accord.');
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    if (data.consentListId) {
      const list = await db.from('contact_lists').select('id').eq('id', data.consentListId).is('quarantined_at', null).maybeSingle();
      check(list.error);
      if (!list.data) throw new Error('Cette liste est indisponible.');
    }
    check((await db.from('sponsor_purchase_settings').upsert({
      offer_id: data.offerId, event_key: data.eventKey, thank_you_enabled: data.enabled,
      review_url: reviewUrl, consent_list_id: data.consentListId,
    })).error);
    return { ok: true };
  });

export const readSponsorLinkMonitoring = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const result = await db.from('sponsor_link_monitor')
      .select('campaign_id,checked_at,alert_since,result,campaigns!inner(name,sponsor_offers(name))')
      .gt('active_until', new Date().toISOString()).order('alert_since', { ascending: false, nullsFirst: false })
      .order('checked_at', { ascending: false, nullsFirst: false }).limit(50);
    if (result.error && !['PGRST205', '42P01'].includes(result.error.code)) check(result.error);
    return {
      configured: !!process.env['SPONSOR_AUDIT_HOSTS']?.trim(),
      available: !result.error,
      campaigns: (result.data ?? []).map(row => ({
        id: row.campaign_id, name: row.campaigns.name, offer: row.campaigns.sponsor_offers?.name,
        checkedAt: row.checked_at, alertSince: row.alert_since, check: linkCheckSchema.safeParse(row.result).data,
      })),
    };
  });

const reportPeriod = z.object({ campaignId: z.string().uuid(), from: day, to: day });
function verifyReportPeriod({ from, to }: z.infer<typeof reportPeriod>) {
  const interval = Date.parse(to) - Date.parse(from);
  if (interval < 0 || interval > 30 * 86_400_000) throw new Error('Choisis une période de 1 à 31 jours.');
}

export const sponsorConversionCampaigns = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ offerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/finance');
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const result = await db.from('campaigns').select('id,name,created_at')
      .eq('sponsor_offer_id', data.offerId).not('list_id', 'is', null)
      .order('created_at', { ascending: false }).order('id').limit(250);
    check(result.error);
    return result.data ?? [];
  });

export const importSponsorConversionReport = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => reportPeriod.extend({
    transactionIds: z.array(z.string().trim().min(1).max(120).regex(/^[^{}#\x00-\x1f\x7f]+$/)).max(5000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/finance', true);
    verifyReportPeriod(data);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const campaign = await db.from('campaigns').select('id').eq('id', data.campaignId)
      .not('sponsor_offer_id', 'is', null).not('list_id', 'is', null).maybeSingle();
    check(campaign.error);
    if (!campaign.data) throw new Error('Campagne sponsor introuvable.');
    const transactionIds = [...new Set(data.transactionIds)];
    const result = await db.from('sponsor_conversion_reports').upsert({
      campaign_id: data.campaignId, date_from: data.from, date_to: data.to, transaction_ids: transactionIds,
      imported_by: context.userId, imported_at: new Date().toISOString(),
    }, { onConflict: 'campaign_id,date_from,date_to' });
    if (result.error && ['PGRST205', '42P01'].includes(result.error.code)) throw new Error('Appliquez la migration 0069 pour importer le rapport.');
    check(result.error);
    return transactionIds.length;
  });

export const readSponsorConversionReport = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => reportPeriod.extend({ page: z.number().int().min(0).max(100000) }).parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/finance');
    verifyReportPeriod(data);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const result = await db.rpc('read_sponsor_conversion_reconciliation', {
      _campaign: data.campaignId, _from: data.from, _to: data.to, _offset: data.page * 50,
    });
    if (result.error?.code === 'PGRST202') return { available: false, report: null };
    check(result.error);
    return { available: true, report: result.data === null ? null : reconciliationSchema.parse(result.data) };
  });

export const exportSponsorDiscrepancies = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => reportPeriod.parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/finance');
    verifyReportPeriod(data);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    async function read(offset: number) {
      const result = await db.rpc('read_sponsor_conversion_reconciliation', {
        _campaign: data.campaignId, _from: data.from, _to: data.to, _offset: offset,
      });
      check(result.error);
      if (!result.data) throw new Error('Rapport sponsor introuvable.');
      return reconciliationSchema.parse(result.data);
    }
    const report = await read(0);
    const total = report.reported - report.counts.matched + report.counts.local_only;
    if (total > 5000) throw new Error('Réduis la période pour exporter au maximum 5 000 écarts.');
    const issues = [...report.issues];
    for (let offset = 50; offset < total; offset += 250) {
      const offsets = Array.from({ length: Math.min(5, Math.ceil((total - offset) / 50)) }, (_, index) => offset + index * 50);
      const pages = await Promise.all(offsets.map(read));
      for (const page of pages) {
        if (page.importedAt !== report.importedAt || Object.entries(report.counts).some(([reason, count]) => page.counts[reason as keyof typeof report.counts] !== count)) {
          throw new Error('Les écarts ont changé pendant l’export. Actualise le rapport et réessaie.');
        }
        issues.push(...page.issues);
      }
    }
    if (issues.length !== total || new Set(issues.map(issue => issue.transaction_id)).size !== total) {
      throw new Error('Les écarts ont changé pendant l’export. Réessaie.');
    }
    const campaign = await db.from('campaigns').select('name,sponsor_offers(name,sponsor_accounts(name))').eq('id', data.campaignId).single();
    check(campaign.error);
    return {
      ...data, campaignName: campaign.data?.name, offerName: campaign.data?.sponsor_offers?.name,
      accountName: campaign.data?.sponsor_offers?.sponsor_accounts?.name,
      exportedAt: new Date().toISOString(), importedAt: report.importedAt, counts: report.counts, issues,
    };
  });

export const readSponsorPostbackDiagnostics = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ accountId: z.string().uuid(), transactionId: z.string().trim().max(120) }).parse(input))
  .handler(async ({ context, data }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    let rejectionQuery = db.from('sponsor_postback_rejections').select('reason,attempts,last_seen')
      .eq('account_id', data.accountId).gte('last_seen', since).order('last_seen', { ascending: false }).limit(100);
    if (data.transactionId) {
      const { postbackReferenceFingerprint } = await import('./postback');
      rejectionQuery = rejectionQuery.eq('reference_hash', await postbackReferenceFingerprint(data.accountId, data.transactionId));
    }
    const [rejections, diagnostic] = await Promise.all([
      rejectionQuery,
      db.from('sponsor_postback_diagnostics').select('expected_event,expires_at,checked_at,succeeded,detail')
        .eq('account_id', data.accountId).maybeSingle(),
    ]);
    for (const result of [rejections, diagnostic]) {
      if (result.error && ['PGRST205', '42P01'].includes(result.error.code)) return null;
      check(result.error);
    }
    return { rejections: rejections.data ?? [], diagnostic: diagnostic.data };
  });

export const createSponsorPostbackDiagnostic = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({
    accountId: z.string().uuid(), event: z.string().trim().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
  }).parse(input))
  .handler(async ({ context, data }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { sha256Hex } = await import('./postback');
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
    const token = 'pt_' + secret;
    const result = await db.from('sponsor_postback_diagnostics').upsert({
      account_id: data.accountId, token_hash: await sha256Hex(token), expected_event: data.event,
      expires_at: new Date(Date.now() + 20 * 60_000).toISOString(), checked_at: null, succeeded: null, detail: null,
    }, { onConflict: 'account_id' });
    check(result.error);
    return { token, clickId: secret.slice(0, 36), event: data.event };
  });

export const readSponsorWidgets = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ offerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const [result, cohorts, reviews] = await Promise.all([
      db.rpc('read_sponsor_offer_widgets', { _offer: data.offerId }),
      db.rpc('read_offer_contact_cohorts', { _offer: data.offerId }),
      db.rpc('read_sponsor_purchase_reviews', { _offer: data.offerId }).maybeSingle(),
    ]);
    if (result.error?.code === 'PGRST202') return null;
    check(result.error);
    if (cohorts.error?.code !== 'PGRST202') check(cohorts.error);
    if (reviews.error?.code !== 'PGRST202') check(reviews.error);
    return { ...sponsorWidgetSchema.parse(result.data), cohorts: cohorts.data, reviews: reviews.data };
  });

export const saveSponsorDailyTarget = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ offerId: z.string().uuid(), limit: z.number().int().min(1).max(10_000_000).nullable() }).parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context, '/dashboard/templates', true);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const result = data.limit === null
      ? await db.from('sponsor_offer_daily_targets').delete().eq('offer_id', data.offerId)
      : await db.from('sponsor_offer_daily_targets').upsert({ offer_id: data.offerId, daily_limit: data.limit }, { onConflict: 'offer_id' });
    check(result.error);
    return { ok: true };
  });
