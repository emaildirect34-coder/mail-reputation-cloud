import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { canOpen } from './access';
import { accountInput,offerInput,financeFilters,entryBatch,entryStatus } from './finance.schemas';
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
