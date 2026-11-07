import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Download, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel, Pill, DataTable, Stat } from '@/components/dash/kit';
import { readDeliveryLogs } from '@/lib/delivery.functions';
import { AiDiagnostic } from '@/components/dash/ai-diagnostic';

export const Route = createFileRoute('/dashboard/logs')({
  head:()=>({meta:[{title:'Journaux de livraison & alertes — Email Direct'},{name:'description',content:'Livraisons SMTP, rebonds, reports et plaintes KumoMTA avec protection automatique des campagnes.'},{property:'og:title',content:'Journaux de livraison — Email Direct'},{property:'og:description',content:'Suivi des événements réels et des alertes de délivrabilité.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),
  component:Logs,
});
const labels = {all:'Tous',delivered:'Délivrés',bounce:'Rebonds durs',deferred:'Reports',complaint:'Plaintes'};
function Logs(){
  const read = useServerFn(readDeliveryLogs);
  const [type,setType]=useState<keyof typeof labels>('all');
  const [search,setSearch]=useState(''); const [page,setPage]=useState(0);
  const query=useQuery({queryKey:['delivery-logs',type,search,page],queryFn:()=>read({data:{type,search,page}}),refetchInterval:30000});
  const data=query.data; const summary=data?.summary;
  function download(){
    if (!data) return;
    const quote=(s:unknown)=>`"${String(s ?? '').replaceAll('"','""').replace(/^[=+@-]/,"'$&")}"`;
    const csv=[['Date','Événement','Campagne','Destinataire','FAI','Code SMTP','Détail','Message ID'],...data.events.map(e=>[e.occurred_at,e.event_type,e.campaign_name,e.recipient,e.isp,e.smtp_code,e.detail,e.message_id])].map(r=>r.map(quote).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='email-direct-journaux.csv';a.click();URL.revokeObjectURL(url);
  }
  return <>
    <PageHeader title="Logs & événements" desc="Livraisons SMTP et protection des campagnes" action={<Button variant="outline" size="sm" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw className="h-4 w-4"/>Actualiser</Button>}/>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat label="Délivrés · 24 h" value={String(summary?.delivered ?? '—')}/><Stat label="Rebonds durs · 24 h" value={String(summary?.bounced ?? '—')}/><Stat label="Reports · 24 h" value={String(summary?.deferred ?? '—')}/><Stat label="Plaintes · 24 h" value={String(summary?.complaints ?? '—')}/>
    </div>
    <Panel title="Protection automatique" action={<AiDiagnostic compact input={{skill:'logs'}}/>}>
      <div className="flex flex-wrap gap-3 text-sm"><Pill tone="warn">Rebonds durs &gt; 3 % · premiers 500 messages</Pill><Pill tone="bad">Plaintes &gt; 0,08 % · par FAI</Pill></div>
      {(data?.alerts ?? []).map(a=><div key={a.id} className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm"><ShieldAlert className="h-4 w-4 text-destructive"/><strong>{a.campaign_name}</strong><Pill tone="bad">Alerte enregistrée</Pill><span>{a.rule==='complaint'?'Plaintes':'Rebonds durs'} · {a.isp} · {(a.rate*100).toFixed(3)} % / {a.sample_size} messages</span><span className="text-muted-foreground">{new Date(a.created_at).toLocaleString('fr-FR')}</span></div>)}
      {data && !data.alerts.length && <p className="mt-3 text-sm text-muted-foreground">Aucune alerte enregistrée.</p>}
    </Panel>
    <Panel title="Journal de livraison">
      <div className="mb-4 flex flex-wrap gap-2">{(Object.keys(labels) as (keyof typeof labels)[]).map(t=><Button key={t} size="sm" variant={type===t?'default':'outline'} onClick={()=>{setType(t);setPage(0);}}>{labels[t]}</Button>)}
      <Input aria-label="Rechercher un destinataire" placeholder="Destinataire" className="w-full sm:max-w-xs" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></div>
      {query.isPending ? <p role="status" className="py-6 text-muted-foreground">Chargement des journaux…</p> : query.isError ? <p role="alert" className="py-6 text-destructive">{query.error.message}</p> : !data?.events.length ? <p className="py-6 text-muted-foreground">Aucun événement pour ces filtres.</p> : <DataTable cols={['Date','Événement','Campagne / destinataire','SMTP','Détail']} rows={data.events.map(e=>[
        new Date(e.occurred_at).toLocaleString('fr-FR'),<Pill tone={e.event_type==='delivered'?'ok':e.event_type==='deferred'?'warn':'bad'}>{labels[e.event_type as keyof typeof labels]}</Pill>,<div><strong>{e.campaign_name}</strong><div>{e.recipient} · {e.isp}</div><span className="font-mono text-[10px] text-muted-foreground">{e.message_id}</span></div>,e.smtp_code ?? '—',<div className="max-w-sm whitespace-normal break-words">{e.detail || '—'}</div>,
      ])}/>}
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{data?.count ?? 0} événements · page {page+1}</span><div className="flex gap-2"><Button aria-label="Page précédente" title="Page précédente" variant="outline" size="icon" disabled={!page || query.isFetching} onClick={()=>setPage(p=>p-1)}><ChevronLeft className="h-4 w-4"/></Button><Button aria-label="Page suivante" title="Page suivante" variant="outline" size="icon" disabled={!data || (page+1)*50>=data.count || query.isFetching} onClick={()=>setPage(p=>p+1)}><ChevronRight className="h-4 w-4"/></Button></div></div>
    </Panel>
    <Panel title="Actions rapides"><div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={!data?.events.length} onClick={download}><Download className="h-4 w-4"/>Exporter la page CSV</Button><span className="text-xs text-muted-foreground">Dernière lecture : {data ? new Date(data.fetchedAt).toLocaleTimeString('fr-FR') : '—'} · actualisation 30 s</span></div></Panel>
  </>;
}