import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Download, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel, Pill, DataTable, Stat } from '@/components/dash/kit';
import { readDeliveryEngagement, readDeliveryLogs } from '@/lib/delivery.functions';
import { AiDiagnostic } from '@/components/dash/ai-diagnostic';
import { MessageTrace } from '@/components/dash/message-trace';

export const Route = createFileRoute('/dashboard/logs')({
  head:()=>({meta:[{title:'Journaux de livraison & alertes — Email Direct'},{name:'description',content:'Livraisons SMTP, rebonds, reports et plaintes KumoMTA avec protection automatique des campagnes.'},{property:'og:title',content:'Journaux de livraison — Email Direct'},{property:'og:description',content:'Suivi des événements réels et des alertes de délivrabilité.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),
  component:Logs,
});
const labels = {all:'Tous',delivered:'Délivrés',bounce:'Rebonds durs',deferred:'Reports',complaint:'Plaintes'};
function Logs(){
  const read = useServerFn(readDeliveryLogs);
  const readEngagement = useServerFn(readDeliveryEngagement);
  const [type,setType]=useState<keyof typeof labels>('all');
  const [search,setSearch]=useState(''); const [page,setPage]=useState(0);
  const [messageInput, setMessageInput] = useState('');
  const [messageReference, setMessageReference] = useState('');
  const query=useQuery({queryKey:['delivery-logs',type,search,page],queryFn:()=>read({data:{type,search,page}}),refetchInterval:30000});
  const engagement=useQuery({queryKey:['delivery-engagement'],queryFn:()=>readEngagement(),refetchInterval:120000,staleTime:120000});
  const data=query.data; const summary=data?.summary;
  function download(){
    if (!data) return;
    const quote=(s:unknown)=>`"${String(s ?? '').replaceAll('"','""').replace(/^[=+@-]/,"'$&")}"`;
    const csv=[['Date','Événement','Campagne','Destinataire','FAI','Code SMTP','Détail','Message ID'],...data.events.map(e=>[e.occurred_at,e.event_type,e.campaign_name,e.recipient,e.isp,e.smtp_code,e.detail,e.message_id])].map(r=>r.map(quote).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='email-direct-journaux.csv';a.click();URL.revokeObjectURL(url);
  }
  return <>
    <PageHeader title="Logs & événements" desc="Livraisons SMTP et protection des campagnes" action={<Button variant="outline" size="sm" disabled={query.isFetching || engagement.isFetching} onClick={()=>void Promise.all([query.refetch(),engagement.refetch()])}><RefreshCw className="h-4 w-4"/>Actualiser</Button>}/>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat label="Délivrés · 24 h" value={String(summary?.delivered ?? '—')}/><Stat label="Rebonds durs · 24 h" value={String(summary?.bounced ?? '—')}/><Stat label="Reports · 24 h" value={String(summary?.deferred ?? '—')}/><Stat label="Plaintes · 24 h" value={String(summary?.complaints ?? '—')}/>
    </div>
    <Panel title="Protection automatique" action={<AiDiagnostic compact input={{skill:'logs'}}/>}>
      <div className="flex flex-wrap gap-3 text-sm">
        <Pill tone="warn">Rebonds durs &gt; 3 % · premiers 500 messages</Pill>
        <Pill tone="warn">Rebonds durs ≥ 5 % · campagne, à partir de 20 messages</Pill>
        <Pill tone="bad">Plaintes &gt; 0,08 % ou 3 successives · par FAI</Pill>
        <Pill tone="bad">SMTP 421 4.7.x ou 3 reports 421 · par FAI</Pill>
      </div>
      {(data?.alerts ?? []).map(a=><div key={a.id} className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm"><ShieldAlert className="h-4 w-4 text-destructive"/><strong>{a.campaign_name}</strong><Pill tone="bad">Alerte enregistrée</Pill><span>{a.rule==='throttle' ? `Limitation SMTP 421 · ${a.isp} · ${a.sample_size} message(s) concerné(s)` : `${a.rule==='complaint'?'Plaintes':'Rebonds durs'} · ${a.isp} · ${(a.rate*100).toFixed(3)} % / ${a.sample_size} messages`}</span><span className="text-muted-foreground">{new Date(a.created_at).toLocaleString('fr-FR')}</span></div>)}
      {data && !data.alerts.length && <p className="mt-3 text-sm text-muted-foreground">Aucune alerte enregistrée.</p>}
    </Panel>
    <Panel title="Écarts d’engagement après acceptation SMTP">
      <p className="text-sm text-muted-foreground">Sur Microsoft et Orange, le journal compare les 500 premiers messages distincts acceptés sur une heure avec au moins trois campagnes historiques au même créneau UTC. Chaque message dispose de 15 minutes d’observation. Le code 250 atteste l’acceptation SMTP. Les réglages de confidentialité et le blocage du suivi peuvent modifier la mesure. Cette alerte informative invite à vérifier le suivi et le placement en boîte.</p>
      {engagement.isPending ? <p role="status" className="mt-2 text-sm">Calcul des écarts…</p> : engagement.isError ? <p role="alert" className="mt-2 text-sm text-destructive">{engagement.error.message}</p> : engagement.data?.configured === false ? <p className="mt-2 text-sm text-muted-foreground">La migration de suivi des écarts reste à appliquer.</p> : engagement.data?.anomalies.length ? (
        <DataTable cols={['Campagne', 'FAI', 'Première acceptation', 'Activité mesurée', 'Historique comparable']} rows={engagement.data.anomalies.map(item=>[
          item.campaign_name, item.isp, new Date(item.first_at).toLocaleString('fr-FR'),
          <Pill tone="warn">{item.engaged} / {item.accepted}</Pill>,
          `${(100 * item.baseline_engaged / item.baseline_accepted).toFixed(1)} % · ${item.baseline_campaigns} campagnes`,
        ])}/>
      ) : <p className="mt-2 text-sm text-muted-foreground">Aucun écart signalé parmi les campagnes disposant d’un historique comparable.</p>}
    </Panel>
    <Panel title="Journal de livraison">
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setMessageReference(messageInput.trim()); }}>
        <label className="grid w-full max-w-md gap-1 text-sm">Rechercher un message
          <Input placeholder="UUID ou Message-ID complet" value={messageInput} maxLength={320} onChange={event => setMessageInput(event.target.value)} />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={!messageInput.trim()}>Afficher la trace</Button>
      </form>
      <MessageTrace reference={messageReference} onClose={() => setMessageReference('')} />
      <div className="mb-4 flex flex-wrap gap-2">{(Object.keys(labels) as (keyof typeof labels)[]).map(t=><Button key={t} size="sm" variant={type===t?'default':'outline'} onClick={()=>{setType(t);setPage(0);}}>{labels[t]}</Button>)}
      <Input aria-label="Rechercher un destinataire" placeholder="Destinataire" className="w-full sm:max-w-xs" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></div>
      {query.isPending ? <p role="status" className="py-6 text-muted-foreground">Chargement des journaux…</p> : query.isError ? <p role="alert" className="py-6 text-destructive">{query.error.message}</p> : !data?.events.length ? <p className="py-6 text-muted-foreground">Aucun événement pour ces filtres.</p> : <DataTable cols={['Date','Événement','Campagne / destinataire','SMTP','Détail']} rows={data.events.map(e=>[
        new Date(e.occurred_at).toLocaleString('fr-FR'),<Pill tone={e.event_type==='delivered'?'ok':e.event_type==='deferred'?'warn':'bad'}>{labels[e.event_type as keyof typeof labels]}</Pill>,<div><strong>{e.campaign_name}</strong><div>{e.recipient} · {e.isp}</div><button type="button" aria-label={`Afficher la trace du message ${e.message_id}`} onClick={() => setMessageReference(e.message_id)} className="font-mono text-[10px] text-primary underline">{e.message_id}</button></div>,e.smtp_code ?? '—',<div className="max-w-sm whitespace-normal break-words">{e.detail || '—'}</div>,
      ])}/>}
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{data?.count ?? 0} événements · page {page+1}</span><div className="flex gap-2"><Button aria-label="Page précédente" title="Page précédente" variant="outline" size="icon" disabled={!page || query.isFetching} onClick={()=>setPage(p=>p-1)}><ChevronLeft className="h-4 w-4"/></Button><Button aria-label="Page suivante" title="Page suivante" variant="outline" size="icon" disabled={!data || (page+1)*50>=data.count || query.isFetching} onClick={()=>setPage(p=>p+1)}><ChevronRight className="h-4 w-4"/></Button></div></div>
    </Panel>
    <Panel title="Actions rapides"><div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={!data?.events.length} onClick={download}><Download className="h-4 w-4"/>Exporter la page CSV</Button><span className="text-xs text-muted-foreground">Dernière lecture : {data ? new Date(data.fetchedAt).toLocaleTimeString('fr-FR') : '—'} · actualisation 30 s</span></div></Panel>
  </>;
}
