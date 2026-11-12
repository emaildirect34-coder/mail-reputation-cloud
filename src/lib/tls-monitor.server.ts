import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export async function monitorTlsCertificates(db: SupabaseClient<Database>) {
 const storage:any=db;
 const [domainsResult,accountsResult]=await Promise.all([
  db.from('sending_domains').select('id,domain,account_id,zone_id'),
  db.from('provider_accounts').select('id,provider,auth_type,secret,email').eq('provider','cloudflare'),
 ]);
 if(domainsResult.error||accountsResult.error)throw new Error('Impossible de lire les domaines ou comptes Cloudflare.');
 const accounts=accountsResult.data??[];const zonesByAccount=new Map<string,any[]>();const packsByZone=new Map<string,any[]>();
 let checked=0,alerts=0,errors=0;
 for(const domain of domainsResult.data??[]){
  try{
   const accountCandidates=[...accounts].sort((a,b)=>Number(b.id===domain.account_id)-Number(a.id===domain.account_id));let account:any=null,zone:any=null;
   for(const candidate of accountCandidates){
    let zones=zonesByAccount.get(candidate.id);if(!zones){const {cfZones}=await import('./providers.server');zones=await cfZones(candidate);zonesByAccount.set(candidate.id,zones);}
    const match=zones.filter(z=>domain.domain===z.name||domain.domain.endsWith('.'+z.name)).sort((a,b)=>b.name.length-a.name.length)[0];
    if(match&&(!zone||match.name.length>zone.name.length)){account=candidate;zone=match;}
   }
   if(!account||!zone){errors++;continue;}
   const key=`${account.id}:${zone.id}`;let packs=packsByZone.get(key);if(!packs){const {cfCertificatePacks}=await import('./providers.server');packs=await cfCertificatePacks(account,zone.id);packsByZone.set(key,packs);}
   const matches=packs.filter(p=>p.host.split(', ').some((host:string)=>host===domain.domain||host.startsWith('*.')&&domain.domain.endsWith('.'+host.slice(2))&&!domain.domain.slice(0,-host.length+1).includes('.')));
   if(!matches.length){checked++;continue;}
   const nearest=matches.filter((p):p is typeof p & {expires_on:string}=>!!p.expires_on).sort((a,b)=>Date.parse(a.expires_on)-Date.parse(b.expires_on))[0]??null;
   const recentlyAlerted=nearest&&Date.parse(nearest.expires_on)-Date.now()<30*86400000
    ? await storage.from('tls_certificate_checks').select('id').eq('domain_id',domain.id).eq('expires_on',nearest.expires_on).gte('last_alerted_at',new Date(Date.now()-7*86400000).toISOString()).limit(1)
    : {data:[]};
   const {error}=await storage.from('tls_certificate_checks').upsert(matches.map(p=>({domain_id:domain.id,certificate_host:p.host,certificate_status:p.status,expires_on:p.expires_on,checked_at:new Date().toISOString()})),{onConflict:'domain_id,certificate_host'});
   if(error){errors++;continue;}checked++;
   if(nearest&&Date.parse(nearest.expires_on)-Date.now()<30*86400000&&!recentlyAlerted.data?.length){
    const {fireWebhooks}=await import('./webhooks.server');const delivered=await fireWebhooks('tls_expiration',{domain:domain.domain,certificate_host:nearest.host,expires_on:nearest.expires_on,status:nearest.status,days_remaining:Math.ceil((Date.parse(nearest.expires_on)-Date.now())/86400000)});if(delivered){await storage.from('tls_certificate_checks').update({last_alerted_at:new Date().toISOString()}).eq('domain_id',domain.id).eq('certificate_host',nearest.host);alerts++;}
   }
  }catch{errors++;}
 }
 return {checked,alerts,errors};
}
