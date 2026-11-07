import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { poolInput, assignmentInput, bindingInput, warmupInput, uuidInput, infrastructurePaths } from './infrastructure.schemas';
import type { Tables } from '@/integrations/supabase/types';

async function admin(ctx: { supabase: any; userId: string }) {
  const {data,error} = await ctx.supabase.rpc('has_role',{_user_id:ctx.userId,_role:'superadmin'});
  if (error || !data) throw new Error('Accès réservé au Superadmin');
  const {supabaseAdmin} = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}
const check = (error: {message:string} | null) => { if (error) throw new Error(error.message); };

export const readInfrastructure = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator((i:{path:string}) => z.object({path:z.enum(['/dashboard/servers','/dashboard/ips','/dashboard/pools','/dashboard/warmup'])}).parse(i))
  .handler(async ({data,context}) => {
    const {data:superadmin} = await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'superadmin'});
    if (!superadmin) {
      const tasks = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id',context.userId).eq('status','active');
      if (!tasks.data?.some(t => t.allowed_paths.includes(data.path))) throw new Error('Accès non autorisé');
    }
    const db = context.supabase;
    const results = await Promise.all([
      db.from('managed_servers').select('*').order('created_at'),
      db.from('server_ips').select('*').order('address'),
      db.from('vmta_pools').select('*').order('name'),
      db.from('warmup_plans').select('*').order('created_at'),
      db.from('server_agents').select('server_id,status,agent_version,kumo_version,config_hash,applied_hash,metrics,last_error,last_seen'),
    ]);
    for (const r of results) check(r.error);
    return {servers:results[0].data ?? [] as Tables<'managed_servers'>[], ips:results[1].data ?? [] as Tables<'server_ips'>[], pools:results[2].data ?? [] as Tables<'vmta_pools'>[], warmups:results[3].data ?? [] as Tables<'warmup_plans'>[], agents:results[4].data ?? [], isAdmin:!!superadmin};
  });

export const syncInventory = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>uuidInput.parse(i))
  .handler(async ({data,context}) => {
    const db = await admin(context);
    const acc = await db.from('provider_accounts').select('*').eq('id',data.id).single(); check(acc.error);
    if (!acc.data) throw new Error('Compte introuvable');
    const {inventory} = await import('./providers.server');
    const remote = await inventory(acc.data); const now = new Date().toISOString();
    const saved = await db.from('managed_servers').select('id,external_id').eq('account_id',data.id); check(saved.error);
    for (const s of remote) {
      const {ips,...row} = s;
      const r = await db.from('managed_servers').upsert({...row,account_id:data.id,provider:acc.data.provider,synced_at:now},{onConflict:'account_id,external_id'}).select('id').single(); check(r.error);
      if (!r.data) throw new Error('Serveur non enregistré');
      if (ips.length) { const u = await db.from('server_ips').upsert(ips.map(ip=>({...ip,server_id:r.data.id,active:true,synced_at:now})),{onConflict:'server_id,address'}); check(u.error); }
      const old = await db.from('server_ips').select('id,address').eq('server_id',r.data.id); check(old.error);
      const absent = (old.data ?? []).filter(ip=>!ips.some(i=>i.address===ip.address)).map(ip=>ip.id);
      if (absent.length) { const u = await db.from('server_ips').update({active:false,synced_at:now}).in('id',absent); check(u.error); }
    }
    const missing = (saved.data ?? []).filter(s=>!remote.some(r=>r.external_id===s.external_id)).map(s=>s.id);
    if (missing.length) { check((await db.from('managed_servers').update({status:'absent',synced_at:now}).in('id',missing)).error); check((await db.from('server_ips').update({active:false}).in('server_id',missing)).error); }
    return {servers:remote.length,ips:remote.reduce((n,s)=>n+s.ips.length,0)};
  });

export const createPool = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>poolInput.parse(i))
  .handler(async ({data,context}) => {const db=await admin(context); check((await db.from('vmta_pools').insert({...data,created_by:context.userId})).error); return {ok:true};});
export const assignIpPool = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>assignmentInput.parse(i))
  .handler(async ({data,context}) => {const db=await admin(context); const r=await db.from('server_ips').update({pool_id:data.poolId}).eq('id',data.ipId).eq('active',true).select('id').single(); check(r.error); return {ok:true};});
export const saveWarmup = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>warmupInput.parse(i))
  .handler(async ({data,context}) => {const db=await admin(context); const ip=await db.from('server_ips').select('id').eq('id',data.ipId).eq('active',true).eq('family',4).single(); check(ip.error); check((await db.from('warmup_plans').upsert({ip_id:data.ipId,isp:data.isp,daily_limits:data.dailyLimits,status:'draft',current_day:1,created_by:context.userId},{onConflict:'ip_id,isp'})).error); return {ok:true};});
export const pauseWarmup = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>uuidInput.parse(i))
  .handler(async ({data,context}) => {const db=await admin(context); check((await db.from('warmup_plans').update({status:'paused'}).eq('id',data.id).select('id').single()).error); return {ok:true};});

export const bindDomainServer = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>bindingInput.parse(i))
  .handler(async ({data,context}) => {
    const db=await admin(context);
    const s=await db.from('managed_servers').select('id,status').eq('id',data.serverId).single(); check(s.error);
    if (s.data?.status==='absent') throw new Error('Serveur absent du fournisseur');
    const existing=await db.from('server_domain_bindings').select('id').eq('server_id',data.serverId).eq('domain_id',data.domainId).maybeSingle(); check(existing.error);
    if (!existing.data) check((await db.from('server_domain_bindings').insert({server_id:data.serverId,domain_id:data.domainId})).error);
    return {status:'pending_agent'};
  });
export const listDomainBindings = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .handler(async ({context}) => {const db=await admin(context); const r=await db.from('server_domain_bindings').select('id,server_id,domain_id,status,installed_at').order('created_at'); check(r.error); return r.data ?? [];});
export const issueAgentToken = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>uuidInput.parse(i))
  .handler(async ({data,context}) => {
    const db=await admin(context);
    const {newToken,sha256}=await import('./kumo.server');
    const token=newToken();
    check((await db.from('server_agents').upsert({server_id:data.id,token_hash:await sha256(token),status:'awaiting',last_error:null},{onConflict:'server_id'})).error);
    return {token};
  });
export const previewAgentConfig = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(i=>uuidInput.parse(i))
  .handler(async ({data,context}) => {const db=await admin(context); const {buildBundle}=await import('./kumo.server'); const b=await buildBundle(db,data.id,false); return {lua:b.lua,hash:b.hash};});
