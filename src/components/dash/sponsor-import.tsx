import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Panel } from './kit';
import { saveSponsorOffer } from '@/lib/finance.functions';
import { offerInput } from '@/lib/finance.schemas';
import { z } from 'zod';
export function SponsorImport(){
  const [text,setText]=useState(''),[busy,setBusy]=useState(false);
  const save=useServerFn(saveSponsorOffer),qc=useQueryClient();
  async function run(){setBusy(true);let imported=0;try{
    const offers=z.array(offerInput).min(1).max(100).parse(JSON.parse(text));
    for(const offer of offers){await save({data:offer});imported++;}
    toast.success(`${imported} offres importées`);setText('');
  }catch{toast.error(`Import interrompu : ${imported} offres enregistrées. Vérifiez le format et les comptes.`);}finally{setBusy(false);await qc.invalidateQueries({queryKey:['sponsors']});}}
  return <Panel title="Importer des offres JSON"><Textarea aria-label="Import offres JSON" value={text} onChange={e=>setText(e.target.value)} placeholder='[{"accountId":"…","externalId":"offre-123","name":"Offre","model":"CPL","payout":4.2,"currency":"EUR"}]'/><Button className="mt-3" variant="outline" disabled={busy||!text} onClick={()=>void run()}>Importer les offres</Button></Panel>;
}