import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
const responseSchema=z.object({offers:z.array(z.object({network_offer_id:z.number(),name:z.string(),offer_status:z.string(),currency_id:z.string(),tracking_url:z.string().default(''),relationship:z.object({payouts:z.object({entries:z.array(z.object({payout_type:z.string(),payout_amount:z.number().default(0),payout_percentage:z.number().default(0)}))}).optional()}).optional()}))});
export async function syncEverflow(id:string){
  const [account,credential]=await Promise.all([supabaseAdmin.from('sponsor_accounts').select('provider').eq('id',id).single(),supabaseAdmin.from('sponsor_credentials').select('api_key').eq('account_id',id).single()]);
  if(account.data?.provider!=='everflow'||!credential.data)throw new Error('Compte API Everflow indisponible');
  let imported=0,skipped=0;
  try{
    for(let page=1;page<=100;page++){
      const r=await fetch(`https://api.eflow.team/v1/affiliates/offersrunnable?page=${page}&page_size=50`,{headers:{'X-Eflow-API-Key':credential.data.api_key},signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw new Error('Everflow a refusé la synchronisation');
      const batch=responseSchema.parse(await r.json()).offers;
      for(const o of batch){
        const p=o.relationship?.payouts?.entries[0];
        const currency=o.currency_id.toUpperCase();
        // Multiple payout tiers must not be flattened to a misleading amount.
        if(!['EUR','USD','GBP'].includes(currency)||!p||o.relationship?.payouts?.entries.length!==1){skipped++;continue;}
        const models:Record<string,string>={cpa:'CPA',cpl:'CPL',cpc:'CPC',cpm:'CPM',revshare:'RevShare',cps:'RevShare'};
        const model=models[p.payout_type.toLowerCase()];if(!model){skipped++;continue;}
        const row={account_id:id,external_id:String(o.network_offer_id),name:o.name,model,payout:model==='RevShare'?p.payout_percentage:p.payout_amount,currency,status:o.offer_status==='active'?'active':'paused',tracking_url:o.tracking_url,rules:'Import Everflow : vérifier les règles GEO, caps et créatifs dans le portail sponsor avant envoi.',synced_at:new Date().toISOString()};
        const write=await supabaseAdmin.from('sponsor_offers').upsert(row,{onConflict:'account_id,external_id'});if(write.error)throw new Error('Enregistrement des offres impossible');imported++;
      }
      if(batch.length<50)break;if(page===100)throw new Error('Catalogue trop volumineux : synchronisation partielle');
    }
    await supabaseAdmin.from('sponsor_accounts').update({synced_at:new Date().toISOString(),last_error:null}).eq('id',id);
    return {imported,skipped};
  }catch{await supabaseAdmin.from('sponsor_accounts').update({last_error:'Synchronisation interrompue; les offres déjà importées sont conservées.'}).eq('id',id);throw new Error('Synchronisation Everflow interrompue. Vérifiez la clé affilié et les droits API.');}
}