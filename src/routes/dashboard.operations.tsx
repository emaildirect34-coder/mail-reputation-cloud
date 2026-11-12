import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, CircleAlert, Clock3, Database, Mail, Printer, Server } from 'lucide-react';
import { PageHeader, Panel, Pill } from '@/components/dash/kit';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { readOperationsCenter } from '@/lib/operations-center.functions';
import { BackupRestoreExercise } from '@/components/dash/backup-restore-exercise';
import { exportAuditLog } from '@/lib/operations-center.functions';
import { toast } from 'sonner';

export const Route = createFileRoute('/dashboard/operations')({
  head: () => ({ meta: [{ title: 'Opérations — Email Direct' }] }),
  component: OperationsPage,
});

type Report = { since: string; until: string; campaigns: { created: number; completed: number; paused: number };
  messages: { injected: number; failed: number }; smtp: { smtp_accepted: number; bounces: number; deferred: number; complaints: number };
  incidents: { opened: number; resolved: number; still_open: number } };
const number = new Intl.NumberFormat('fr-FR');
const date = (value: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function OperationsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  const load = useServerFn(readOperationsCenter);
  const exportAudit=useServerFn(exportAuditLog);
  const query = useQuery({ queryKey: ['operations-center', userId], queryFn: () => load(), enabled: !!userId, refetchInterval: 5 * 60_000 });
  const data = query.data;
  const report = data?.report as Report | null | undefined;
  const statusTone = (state: string) => state === 'online' ? 'ok' as const : ['error','stale','missing'].includes(state) ? 'warn' as const : 'neutral' as const;
  const stateLabel: Record<string, string> = { online: 'Opérationnel', error: 'Indisponible', stale: 'Signal ancien', missing: 'Agent absent', maintenance: 'Maintenance', unconfigured: 'Non configuré' };
  const stat = (label: string, value: number | undefined, icon: typeof Activity, note?: string) => <div className="rounded-lg border bg-card p-4">
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{label}</span>{icon({ className: 'h-4 w-4' })}</div>
    <p className="mt-2 text-2xl font-semibold">{value == null ? '—' : number.format(value)}</p>
    {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
  </div>;

  return <div className="space-y-5">
    <PageHeader title="Centre des opérations" desc="État des intégrations, journal des actions sensibles et bilan mesuré des sept derniers jours." />
    {query.error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{query.error.message}</p>}
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">Lecture des services et du bilan…</p>}
    {data && <>
      <Panel title="Santé des intégrations">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.integrations.map(item => <div key={item.id} className="flex items-start gap-3 rounded-lg border p-3">
            {item.id === 'database' ? <Database className="mt-0.5 h-4 w-4" /> : <Mail className="mt-0.5 h-4 w-4" />}
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.label}</strong><Pill tone={statusTone(item.state)}>{stateLabel[item.state] ?? item.state}</Pill></div><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div>
          </div>)}
          {data.servers.map(server => <div key={server.id} className="flex items-start gap-3 rounded-lg border p-3">
            <Server className="mt-0.5 h-4 w-4" />
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="truncate text-sm">{server.label}</strong><Pill tone={statusTone(server.state)}>{stateLabel[server.state]}</Pill></div><p className="mt-1 text-xs text-muted-foreground">{server.detail}{server.lastSeen ? ` · ${date(server.lastSeen)}` : ''}{server.agentVersion ? ` · agent ${server.agentVersion}` : ''}</p></div>
          </div>)}
          {data.jobs.map(job => <div key={job.job} className="flex items-start gap-3 rounded-lg border p-3">
            <Clock3 className="mt-0.5 h-4 w-4" />
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">Tâche · {job.job}</strong><Pill tone={job.status === 'succeeded' ? 'ok' : job.status === 'failed' ? 'warn' : 'neutral'}>{job.status === 'succeeded' ? 'Réussie' : job.status === 'failed' ? 'Échec' : 'En cours'}</Pill></div><p className="mt-1 text-xs text-muted-foreground">Dernier lancement : {date(job.started_at)}{job.duration_ms != null ? ` · ${number.format(job.duration_ms)} ms` : ''}</p></div>
          </div>)}
        </div>
        {!data.jobs.length && <p className="mt-3 text-xs text-muted-foreground">Aucune exécution planifiée enregistrée. L’ordonnanceur reste à configurer séparément.</p>}
      </Panel>

      {data.isAdmin && <Panel title="Coûts mensuels configurés des serveurs">
        <p className="mb-3 text-xs text-muted-foreground">Somme des tarifs enregistrés par fournisseur. Ce n’est pas une facture : les ressources sans tarif et les autres services ne sont pas inclus.</p>
        {data.monthlyCosts.length ? <div className="flex flex-wrap gap-3">{data.monthlyCosts.map(row => <div key={row.currency} className="rounded-lg border px-4 py-3"><p className="text-xs text-muted-foreground">Total déclaré · {row.currency}</p><p className="text-xl font-semibold">{row.currency.startsWith('Unité non vérifiée') ? number.format(row.amount) : new Intl.NumberFormat('fr-FR',{style:'currency',currency:row.currency}).format(row.amount)}</p></div>)}</div>
          : <p className="text-sm text-muted-foreground">Aucun tarif mensuel de serveur enregistré.</p>}
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">{data.servers.filter(server => server.monthlyPrice != null).map(server => <p key={server.id}>{server.label} · {server.provider} · {server.monthlyPrice}</p>)}</div>
      </Panel>}

      {data.isAdmin && <Panel title="Préparer un exercice de restauration"><BackupRestoreExercise /></Panel>}

      <Panel title="Récapitulatif des sept derniers jours" action={<Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Imprimer / PDF</Button>}>
        {report ? <>
          <p className="mb-4 text-xs text-muted-foreground">Du {date(report.since)} au {date(report.until)} · Données observées, sans estimation d’emplacement inbox.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stat('Campagnes créées', report.campaigns.created, Activity)}
            {stat('Messages injectés', report.messages.injected, Mail, 'Injection acceptée par KumoMTA')}
            {stat('Acceptations SMTP', report.smtp.smtp_accepted, CheckCircle2, 'Acceptation par le serveur destinataire, pas preuve inbox')}
            {stat('Rebonds', report.smtp.bounces, CircleAlert)}
            {stat('Reports temporaires', report.smtp.deferred, Clock3)}
            {stat('Plaintes observées', report.smtp.complaints, CircleAlert)}
            {stat('Incidents ouverts', report.incidents.opened, CircleAlert)}
            {stat('Incidents encore actifs', report.incidents.still_open, Activity)}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Campagnes terminées : {number.format(report.campaigns.completed)} · en pause : {number.format(report.campaigns.paused)} · messages en échec : {number.format(report.messages.failed)} · incidents résolus sur la période : {number.format(report.incidents.resolved)}</p>
        </> : <p className="text-sm text-muted-foreground">Applique la migration 0082 pour activer le récapitulatif. Il restera vide si aucun événement réel n’a été enregistré.</p>}
      </Panel>

      {data.isAdmin && <Panel title="Journal des actions sensibles">
        <Button size="sm" variant="outline" disabled={!data.audit?.length} onClick={()=>void exportAudit().then(rows=>{const quote=(value:unknown)=>`"${String(value??'').replaceAll('"','""').replace(/^[=+@-]/,"'$&")}"`;const csv=[['Date UTC','Acteur','Action','Type d’objet','ID objet','Détails JSON'],...rows.map(row=>[row.created_at,row.actor_id,row.action,row.entity_type,row.entity_id,JSON.stringify(row.summary)])].map(row=>row.map(quote).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='email-direct-audit.csv';a.click();URL.revokeObjectURL(url);}).catch(e=>toast.error(e instanceof Error?e.message:'Export impossible'))}>Exporter les 5 000 dernières actions</Button>
        {data.audit === null && <p className="text-sm text-muted-foreground">Applique la migration 0082 pour activer le journal.</p>}
        {!!data.audit?.length && <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Compte</th><th className="p-2">Action</th><th className="p-2">Objet</th><th className="p-2">Détails</th></tr></thead><tbody>
          {data.audit.map(row => <tr key={row.id} className="border-b last:border-0"><td className="whitespace-nowrap p-2">{date(row.created_at)}</td><td className="p-2 font-mono text-xs">{row.actor_id ? `${row.actor_id.slice(0, 8)}…` : 'Compte supprimé'}</td><td className="p-2">{row.action}</td><td className="p-2">{row.entity_type}{row.entity_id ? ` · ${row.entity_id.slice(0, 12)}` : ''}</td><td className="max-w-xs truncate p-2 text-xs text-muted-foreground">{JSON.stringify(row.summary)}</td></tr>)}
        </tbody></table></div>}
        {data.audit?.length === 0 && <p className="text-sm text-muted-foreground">Aucune action enregistrée depuis l’activation du journal.</p>}
        <p className="mt-3 text-xs text-muted-foreground">Le journal commence après l’application de la migration; il n’invente pas d’historique antérieur.</p>
      </Panel>}
    </>}
  </div>;
}
