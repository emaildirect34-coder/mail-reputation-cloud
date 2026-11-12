import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, Panel, Pill } from '@/components/dash/kit';
import { supabase } from '@/integrations/supabase/client';
import { manageOperationsIncident, readIncidentSmtpTimeline, readOperationalJobHealth, readOperationsIncidents } from '@/lib/operations-incidents.functions';

export const Route = createFileRoute('/dashboard/incidents')({
  head: () => ({ meta: [{ title: 'Centre d’incidents — Email Direct' }] }),
  component: IncidentsPage,
});

type Report = NonNullable<Awaited<ReturnType<typeof readOperationsIncidents>>>;
type Incident = Report['incidents'][number];
const kindLabels = { campaign_blocked: 'Campagne bloquée', campaign_stalled:'Envoi sans progression', injection_uncertain: 'Injection à vérifier', agent_offline: 'Agent d’envoi indisponible' };
const number = new Intl.NumberFormat('fr-FR');
const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function IncidentTimeline({ incident }: { incident: Incident }) {
  const [open, setOpen] = useState(false);
  const read = useServerFn(readIncidentSmtpTimeline);
  const events = useQuery({ queryKey: ['incident-smtp-timeline', incident.id, incident.signal_cleared_at],
    queryFn: () => read({ data: { id: incident.id } }), enabled: open });
  const labels: Record<string, string> = { deferred: 'Report SMTP', bounce: 'Rebond SMTP', complaint: 'Plainte reçue' };
  const points = [
    ...(events.data ?? []).map(row => ({ id: row.id, at: row.occurred_at,
      text: `${labels[row.event_type]} · ${row.isp}${row.smtp_code ? ` · ${row.smtp_code}` : ''}` })),
    { id: 'opened', at: incident.started_at, text: incident.kind === 'campaign_blocked' ? 'Blocage de campagne observé' : 'Signal détecté' },
    ...(incident.signal_cleared_at ? [{ id: 'clear', at: incident.signal_cleared_at, text: 'Signal levé' }] : []),
    ...(incident.resolved_at ? [{ id: 'resolved', at: incident.resolved_at, text: 'Suivi marqué comme résolu' }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return <details className="rounded-md border p-2 text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">Chronologie</summary>
    {open && <>
      {events.isPending && <p role="status">Recherche des retours SMTP…</p>}
      {events.error && <p role="alert" className="text-destructive">{events.error.message}</p>}
      <ol className="mt-2 max-h-52 space-y-1 overflow-auto">
        {points.map(point => <li key={point.id}><time dateTime={point.at}>{date.format(new Date(point.at))}</time> · {point.text}</li>)}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">Les 15 premiers retours observés dans le périmètre apparaissent à partir de 30 minutes avant le signal.</p>
    </>}
  </details>;
}

function IncidentCard({ incident, isAdmin, assignees }: { incident: Incident; isAdmin: boolean; assignees: Report['assignees'] }) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const manage = useServerFn(manageOperationsIncident);
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: manage,
    onSuccess: async () => {
      setClosing(false);
      setNote('');
      await client.invalidateQueries({ queryKey: ['operations-incidents'] });
    },
    onError: error => toast.error(error.message),
  });
  const resolved = !!incident.resolved_at;
  const active = !incident.signal_cleared_at;
  const eligibleAssignee = assignees.some(person => person.id === incident.assigned_to);

  return <article className="space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-semibold">{incident.title}</h2>
      <Pill>{kindLabels[incident.kind]}</Pill>
      <Pill tone={active ? 'warn' : 'ok'}>{active ? 'Signal actif' : 'Signal levé'}</Pill>
      {resolved && <Pill tone="ok">Résolu</Pill>}
    </div>
    <p className="text-sm">{incident.detail}{incident.affected_messages != null && <> · {number.format(incident.affected_messages)} message(s)</>}</p>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>Depuis le <time dateTime={incident.started_at}>{date.format(new Date(incident.started_at))}</time></span>
      {incident.signal_cleared_at && <span>Signal levé le <time dateTime={incident.signal_cleared_at}>{date.format(new Date(incident.signal_cleared_at))}</time></span>}
      {incident.resolved_at && <span>Résolu le <time dateTime={incident.resolved_at}>{date.format(new Date(incident.resolved_at))}</time></span>}
    </div>
    {!!incident.campaigns.length && <div className="space-y-1 text-sm">
      <h3 className="font-medium">Campagnes touchées</h3>
      <ul className="max-h-40 space-y-1 overflow-auto">
        {incident.campaigns.map(campaign => <li key={campaign.id}>{isAdmin
          ? <Link className="text-primary underline" to="/dashboard/campaigns/list" search={{ monitor: campaign.id }}>{campaign.name}</Link>
          : campaign.name}</li>)}
      </ul>
    </div>}
    <IncidentTimeline incident={incident} />
    {incident.resolution_note && <p className="whitespace-pre-wrap break-words text-sm">{incident.resolution_note}</p>}
    <div className="flex flex-wrap items-end gap-2">
      {isAdmin && incident.server_id && <Button asChild variant="outline" size="sm">
        <Link to="/dashboard/servers" search={{ server: incident.server_id }}>Voir le serveur</Link>
      </Button>}
      {isAdmin && !resolved && <label className="grid min-w-36 gap-1 text-xs">
        Responsable
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={incident.assigned_to ?? ''} disabled={action.isPending}
          onChange={event => action.mutate({ data: { id: incident.id, action: 'assign', assignee: event.target.value || null } })}>
          <option value="">Non assigné</option>
          {incident.assigned_to && !eligibleAssignee && <option value={incident.assigned_to} disabled>Compte sans accès</option>}
          {assignees.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}
        </select>
      </label>}
      {resolved ? isAdmin && <Button variant="outline" size="sm" disabled={action.isPending}
        onClick={() => action.mutate({ data: { id: incident.id, action: 'reopen' } })}>Rouvrir le suivi</Button>
        : !closing && <Button size="sm" disabled={action.isPending} onClick={() => setClosing(true)}>Marquer comme résolu</Button>}
    </div>
    {closing && !resolved && <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      action.mutate({ data: { id: incident.id, action: 'resolve', note } });
    }}>
      {active && <p className="text-sm text-muted-foreground">Le signal est toujours actif. Il restera visible dans l’historique de l’incident.</p>}
      <label className="grid max-w-xl gap-1 text-sm">Note de résolution (facultative)
        <Textarea value={note} maxLength={500} onChange={event => setNote(event.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={action.isPending}>Enregistrer la résolution</Button>
        <Button type="button" variant="outline" size="sm" disabled={action.isPending} onClick={() => setClosing(false)}>Annuler</Button>
      </div>
    </form>}
  </article>;
}

function IncidentsPage() {
  const [state, setState] = useState<'open' | 'resolved'>('open');
  const [page, setPage] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAccountId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  const read = useServerFn(readOperationsIncidents);
  const readJobs = useServerFn(readOperationalJobHealth);
  const jobs = useQuery({ queryKey: ['operational-job-health'], queryFn: () => readJobs(), enabled: !!accountId, refetchInterval: 60_000 });
  const report = useQuery({
    queryKey: ['operations-incidents', accountId, state, page], enabled: !!accountId, gcTime: 0,
    queryFn: () => read({ data: { state, page } }),
    refetchInterval: state === 'open' && page === 0 ? 60_000 : false,
  });
  const data = report.data;
  return <>
    <PageHeader title="Centre d’incidents" desc="Campagnes bloquées, injections à vérifier et agents d’envoi indisponibles." />
    <Panel title="Santé des tâches planifiées">
      <p className="mb-2 text-xs text-muted-foreground">Dernier lancement observé depuis les routes protégées. Vérifie aussi le planificateur externe qui appelle ces routes.</p>
      {jobs.error && <p role="alert" className="text-sm text-destructive">{jobs.error.message}</p>}
      {jobs.data === null && <p className="text-sm text-muted-foreground">Applique la migration 0080 pour enregistrer l’historique.</p>}
      {jobs.data && <div className="grid gap-2 sm:grid-cols-2">{(['daily-report','incident-notifications'] as const).map(job => {
        const item = jobs.data?.find(row => row.job === job);
        const old = item?.started_at ? Date.now() - Date.parse(item.started_at) > 36 * 60 * 60_000 : true;
        const failed = item?.status === 'failed' || (item?.status === 'running' && Date.now() - Date.parse(item.started_at) > 15 * 60_000) || old;
        return <div key={job} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
          <strong className="min-w-40 flex-1">{job === 'daily-report' ? 'Récapitulatif quotidien' : 'Alertes et surveillance'}</strong>
          <Pill tone={!item ? 'neutral' : failed ? 'warn' : item.status === 'succeeded' ? 'ok' : 'neutral'}>{!item ? 'Jamais observée' : item.status === 'succeeded' ? 'Réussie' : item.status === 'failed' ? 'Échec' : 'En cours'}</Pill>
          <span className="text-xs text-muted-foreground">{item ? `${new Date(item.started_at).toLocaleString('fr-FR')}${item.duration_ms != null ? ` · ${item.duration_ms.toLocaleString('fr-FR')} ms` : ''}` : '—'}</span>
        </div>;
      })}</div>}
    </Panel>
    <Panel title={state === 'open' ? 'Incidents à traiter' : 'Incidents résolus'}
      action={<Button size="sm" variant="outline" disabled={!accountId || report.isFetching} onClick={() => void report.refetch()}>Actualiser</Button>}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {(['open', 'resolved'] as const).map(filter => <Button key={filter} size="sm" variant={state === filter ? 'default' : 'outline'}
            aria-pressed={state === filter} onClick={() => { setState(filter); setPage(0); }}>{filter === 'open' ? 'À traiter' : 'Résolus'}</Button>)}
        </div>
        {report.isPending && <p role="status" className="text-sm">Chargement des incidents…</p>}
        {report.error && <p role="alert" className="text-sm text-destructive">{report.error.message}</p>}
        {data === null && <p className="text-sm text-muted-foreground">Le centre d’incidents nécessite la migration 0065.</p>}
        {data?.scanFailed && <p role="alert" className="text-sm text-destructive">La dernière vérification a échoué. Les incidents enregistrés restent consultables.</p>}
        {data && !data.incidents.length && <p className="text-sm text-muted-foreground">{state === 'open' ? 'Aucun incident à traiter sur cette page.' : 'Aucun incident résolu sur cette page.'}</p>}
        {data?.incidents.map(incident => <IncidentCard key={incident.id} incident={incident} isAdmin={data.isAdmin} assignees={data.assignees} />)}
        {data && (page > 0 || data.total > data.pageSize) && <div className="flex items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(p => p - 1)}>Précédent</Button>
          <span>Page {page + 1} · {number.format(data.total)} incident(s)</span>
          <Button size="sm" variant="outline" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>Suivant</Button>
        </div>}
      </div>
    </Panel>
  </>;
}
