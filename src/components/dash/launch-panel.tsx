import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Rocket, Pause, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { campaignTimeZone, scheduledInstant } from '@/lib/campaign-schedule';
import { campaignTopics, campaignTopicLabels, isCampaignTopic } from '@/lib/campaign-topics';
import { recipientDomain } from '@/lib/email-address';
import { Button } from '@/components/ui/button';
import { Pill, DataTable } from './kit';
import { CampaignDeliveryMonitor } from './campaign-delivery-monitor';
import { runDraftPreflight, type Check } from '@/lib/preflight.functions';
import { readSending, readCampaignVmtaPools, launchCampaign, setCampaignStatus } from '@/lib/sending.functions';

const cls = 'h-9 w-full rounded-md border border-border bg-card px-2 text-[12px]';
type Fields = { name: string; fromName: string; fromEmail: string; replyTo: string; subject: string; body: string; ampHtml?: string; digestText?: string; schedule?: string; scheduleMode?: string; sponsorOfferId?: string; vmtaPoolId: string; topic: string };

/** Real sending: picks a contact list and agent-equipped servers, then queues the campaign. */
export function LaunchPanel({ d, testMode, onPoolChange, onTopicChange, servers, setServers }: {
  d: Fields; testMode: boolean; onPoolChange: (id: string) => void; onTopicChange: (topic: string) => void;
  servers: string[]; setServers: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const qc = useQueryClient(), read = useServerFn(readSending), launch = useServerFn(launchCampaign), status = useServerFn(setCampaignStatus);
  const q = useQuery({ queryKey: ['sending'], queryFn: () => read(), refetchInterval: 15000 });
  const readPools = useServerFn(readCampaignVmtaPools);
  const poolQuery = useQuery({ queryKey: ['campaign-vmta-pools'], queryFn: () => readPools() });
  const [listId, setListId] = useState(''), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await qc.invalidateQueries({ queryKey: ['sending'] }); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  const profile = useQuery({ queryKey: ['campaign-time-zone'], queryFn: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return campaignTimeZone(data.user?.user_metadata['campaign_time_zone'] ?? 'UTC');
  } });
  const recipientLocalTime = Boolean(d.schedule && d.scheduleMode === 'recipient');
  let scheduleLabel = '';
  let scheduleError = '';
  if (d.schedule && profile.data) {
    try {
      const displayZone = recipientLocalTime ? 'UTC' : profile.data;
      const instant = scheduledInstant(d.schedule, displayZone);
      if (!recipientLocalTime && Date.parse(instant) <= Date.now()) throw new Error('Choisissez une date de programmation future.');
      scheduleLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: displayZone }).format(new Date(instant));
    } catch (error) {
      scheduleError = error instanceof Error ? error.message : 'Date de programmation invalide.';
    }
  }
  const [sendWindowHours, setSendWindowHours] = useState<2 | 4 | 8 | undefined>();
  const [sunsetDays, setSunsetDays] = useState<'isp' | 'off' | 30 | 60 | 90 | 365>('isp');
  const [typoApproval, setTypoApproval] = useState('');
  const [fatigueProtection, setFatigueProtection] = useState(false);
  const [monitorPlacement, setMonitorPlacement] = useState(true);
  const [monitoredCampaign, setMonitoredCampaign] = useState<string | null>(null);
  const preflight = useServerFn(runDraftPreflight);
  const [audit, setAudit] = useState<{ fingerprint: string; checks: Check[] } | null>(null);
  const [auditing, setAuditing] = useState(false);
  const auditInput = { fromEmail: d.fromEmail, serverIds: servers, listId: listId || null, poolId: d.vmtaPoolId || null, html: d.body };
  const fingerprint = JSON.stringify(auditInput);
  async function auditDraft() {
    setAuditing(true);
    try {
      setAudit({ fingerprint, checks: await preflight({ data: auditInput }) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Audit Gmail indisponible.');
    } finally {
      setAuditing(false);
    }
  }
  const list = q.data?.lists.find(l => l.id === listId);
  const pools = poolQuery.data ?? [];
  const selectedPool = pools.find(pool => pool.id === d.vmtaPoolId);
  const poolUnavailable = Boolean(d.vmtaPoolId && !servers.every(id => selectedPool?.serverIds.includes(id))) || Boolean(d.vmtaPoolId && !selectedPool);
  const senderReady = !!(d.name.trim() && d.fromName.trim() && recipientDomain(d.fromEmail.trim()) && d.subject.trim());
  const serversReady = servers.length > 0 && servers.every(id => q.data?.servers.some(server => server.id === id));
  const submit = () => run(async () => {
    const result = await launch({ data: {
      sponsorOfferId: d.sponsorOfferId || undefined, name: d.name, fromName: d.fromName, fromEmail: d.fromEmail,
      replyTo: d.replyTo, subject: d.subject, html: d.body, ampHtml: d.ampHtml || undefined, digestText: d.digestText || undefined, listId, serverIds: servers, vmtaPoolId: d.vmtaPoolId || undefined, schedule: d.schedule || undefined,
      scheduleTimeZone: d.schedule ? profile.data : undefined, sunsetDays, acceptTypoExclusions: typoApproval === listId,
      topic: isCampaignTopic(d.topic) ? d.topic : undefined,
      fatigueProtection: fatigueProtection && !d.digestText,
      sendWindowHours: d.schedule ? sendWindowHours : undefined, recipientLocalTime,
      monitorPlacement,
    } });
    toast.success(`${result.scheduledAt ? 'Envoi programmé · ' : ''}${result.total} en file · ${result.suppressed} en suppression · ${result.inactive} inactif(s) · ${result.invalid} invalide(s)`, {
      description: [
        result.fallbackTimeZones ? `${result.fallbackTimeZones} contact(s) sans fuseau ont été planifiés dans le fuseau du compte (${profile.data}).` : '',
        result.dnsUnverified ? `${result.dnsUnverified} contact(s) conservés malgré une route DNS non confirmée.` : '',
        result.typoCount ? `Dont ${result.typoCount} domaine(s) avec faute probable.` : '',
        result.roleExcluded ? `Dont ${result.roleExcluded} adresse(s) de rôle exclue(s).` : '',
        result.formatExcluded ? `${result.formatExcluded} destinataire(s) hors format choisi.` : '',
      ].filter(Boolean).join(' ') || undefined,
    });
    if (result.placementMonitor === 'started') setMonitoredCampaign(result.id);
    else if (monitorPlacement) toast.warning('Campagne enregistrée. Le test des boîtes témoins n’a pas démarré.', {
      description: result.placementMonitor === 'migration' ? 'Appliquez la migration 0043.'
        : result.placementMonitor === 'unconfigured' ? 'Configurez Mail-Tester.' : 'Vérifiez Mail-Tester et les boîtes témoins enregistrées.',
    });
  });
  return (
    <section id="envoi" className="card-lux mb-3 scroll-mt-24 p-3.5">
      <h2 className="mb-2 flex items-center gap-2 font-display text-[16px] font-bold text-primary"><Rocket className="size-5" />Envoi réel</h2>
      {q.error && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
      <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
        <div><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Liste de contacts</span>
          <select aria-label="Liste de contacts" className={cls} value={listId} onChange={e => setListId(e.target.value)}><option value="">Choisir une liste</option>{(q.data?.lists ?? []).map(l => <option key={l.id} value={l.id} disabled={!!l.quarantined_at}>{l.name} · {l.quarantined_at ? 'En quarantaine' : `${l.active} actifs`}</option>)}</select></div>
        <div><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Serveurs d’envoi (agent installé requis)</span>
          <div className="flex flex-wrap gap-1.5">{(q.data?.servers ?? []).map(s => { const on = servers.includes(s.id); return <button key={s.id} type="button" onClick={() => setServers(p => on ? p.filter(x => x !== s.id) : [...p, s.id])} className={`rounded-md border px-2 py-1 text-[12px] font-semibold ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'}`}>{s.label}</button>; })}{!q.data?.servers.length && <span className="text-[12px] text-muted-foreground">Aucun serveur. <Link to="/dashboard/servers" className="text-primary underline">Ajouter un serveur</Link></span>}</div></div>
        <Button disabled={busy || testMode || !list || !!list.quarantined_at || !serversReady || !senderReady || d.body.trim().length < 20 || poolUnavailable || (!!d.schedule && (!q.data?.supportsScheduling || !scheduleLabel))} onClick={submit}><Rocket className="h-4 w-4" /> {d.schedule ? 'Programmer l’envoi' : 'Lancer l’envoi'}</Button>
      </div>
      {list?.quarantined_at && <p role="alert" className="mt-2 text-xs text-destructive">Liste en quarantaine. {list.quarantine_reason}</p>}
      <div className="mt-3 space-y-2">
        <Button size="sm" variant="outline" disabled={auditing || !d.fromEmail.trim() || !servers.length} onClick={() => void auditDraft()}>
          {auditing ? 'Audit en cours…' : 'Vérifier la configuration Gmail'}
        </Button>
        {audit?.fingerprint === fingerprint && <DataTable cols={['Contrôle Gmail', 'Résultat', 'Détail']} rows={audit.checks.map(check => [
          check.name, <Pill tone={check.tone}>{check.tone === 'ok' ? 'Vérifié' : check.tone === 'bad' ? 'À corriger' : 'À confirmer'}</Pill>, check.detail,
        ])} />}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={monitorPlacement} onChange={event => setMonitorPlacement(event.target.checked)} />
        <span>Envoyer une copie aux boîtes témoins depuis le premier serveur sélectionné.{d.schedule ? ' La copie part dès la programmation de la campagne.' : ''}</span>
      </label>
      <label className="mt-3 grid max-w-sm gap-1 text-sm">
        Pool VMTA marketing
        <select className={cls} value={d.vmtaPoolId} onChange={event => onPoolChange(event.target.value)}>
          <option value="">Pool par défaut</option>
          {d.vmtaPoolId && !selectedPool && <option value={d.vmtaPoolId}>Pool indisponible</option>}
          {pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">Un pool choisi doit disposer d’une IPv4 utilisable sur chaque serveur sélectionné.</span>
        {poolUnavailable && <span className="text-xs text-destructive">Ce pool ne couvre pas les serveurs choisis.</span>}
        {poolQuery.error && <span role="alert" className="text-xs text-destructive">Impossible de charger les pools.</span>}
      </label>
      <label className="mt-3 grid max-w-sm gap-1 text-sm">
        Thème de la campagne
        <select className={cls} value={d.topic} onChange={event => onTopicChange(event.target.value)}>
          <option value="">Sans thème</option>
          {campaignTopics.map(topic => <option key={topic} value={topic}>{campaignTopicLabels[topic]}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">Un thème applique les centres d’intérêt choisis par les destinataires.</span>
      </label>
      <label className="mt-3 grid max-w-sm gap-1 text-sm">
        Filtrage des contacts sans engagement
        <select className={cls} value={sunsetDays} onChange={e => {
          const value = e.target.value;
          setSunsetDays(value === 'off' ? 'off' : value === '30' ? 30 : value === '60' ? 60 : value === '90' ? 90 : value === '365' ? 365 : 'isp');
        }}>
          <option value="isp">Automatique par fournisseur (30, 60 ou 90 jours)</option>
          <option value="off">Désactivé</option>
          <option value="30">Écarter après 30 jours</option>
          <option value="60">Écarter après 60 jours</option>
          <option value="90">Écarter après 90 jours</option>
          <option value="365">Écarter après 365 jours</option>
        </select>
        <span className="text-xs text-muted-foreground">En mode automatique, Gmail et Yahoo suivent un délai de 30 jours, Orange, SFR et Free de 60 jours, et les autres fournisseurs de 90 jours. Les contacts sans ancienne livraison restent éligibles.</span>
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={!!listId && typoApproval === listId} disabled={!listId} onChange={event => setTypoApproval(event.target.checked ? listId : '')} />
        Confirmer l’exclusion des domaines avec une faute probable si leur proportion est élevée.
      </label>
      <p className="mt-2 text-xs text-muted-foreground">Les adresses mal formées et les domaines dont l’absence de route mail est confirmée sont écartés de la campagne. Le contrôle DNS est limité aux domaines les plus fréquents.</p>
      {!d.digestText && <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={fatigueProtection} onChange={event => setFatigueProtection(event.target.checked)} />
        <span>Espacer les envois aux destinataires très sollicités. Sans clic récent enregistré, les envois de cette campagne sont écartés pendant 14 ou 30 jours selon la fréquence passée.</span>
      </label>}
      {d.schedule && <label className="mt-3 grid max-w-sm gap-1 text-sm">
        Étaler l’envoi après le départ programmé
        <select className={cls} value={sendWindowHours ?? ''} onChange={e => {
          const hours = Number(e.target.value);
          setSendWindowHours(hours === 2 || hours === 4 || hours === 8 ? hours : undefined);
        }}>
          <option value="">Mise en file à l’heure programmée</option>
          <option value="2">Répartir sur 2 heures</option>
          <option value="4">Répartir sur 4 heures</option>
          <option value="8">Répartir sur 8 heures</option>
        </select>
      </label>}
      {d.schedule && <p className="mt-2 text-sm" role="status">
        {q.data?.supportsScheduling === false ? 'La programmation nécessite la mise à jour de la base de données.' : scheduleError || (scheduleLabel
          ? recipientLocalTime
            ? `Envoi prévu le ${scheduleLabel}, à l’heure locale de chaque destinataire. Les contacts sans fuseau utilisent celui du compte (${profile.data}).`
            : `Envoi prévu le ${scheduleLabel} (${profile.data}).`
          : profile.error?.message || 'Chargement du fuseau horaire…')}
      </p>}
      <p className="mt-2 text-[12px] text-muted-foreground">{testMode ? 'Désactivez le Mode Test pour lancer un envoi réel. ' : ''}Les adresses désinscrites ou en liste de suppression sont retirées automatiquement. Un lien de désinscription en un clic est ajouté à chaque email.{list ? ` Liste choisie : ${list.active} contact(s) actif(s).` : ''} <Link to="/dashboard/suppression" className="text-primary underline">Gérer les listes</Link></p>
      {!!q.data?.campaigns.length && <div className="mt-3"><DataTable cols={['Campagne', 'Objet', 'Programmation', 'Envoyés', 'En file', 'Échecs', 'Exclus', 'État', '']} rows={q.data.campaigns.map(c => [c.name, c.subject, c.scheduled_at ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: profile.data ?? 'UTC' }).format(new Date(c.scheduled_at)) + ' (' + (profile.data ?? 'UTC') + ')' : '—', String(c.sent), String(c.queued), String(c.failed), String(c.suppressed),
        <Pill tone={c.status === 'done' ? 'ok' : c.status === 'queued' ? 'warn' : 'neutral'}>{c.status === 'queued' && c.scheduled_at && Date.parse(c.scheduled_at) > Date.now() ? 'Planifiée' : ({ queued: 'En cours', paused: 'En pause', done: 'Terminée', cancelled: 'Annulée' } as Record<string, string>)[c.status] ?? c.status}</Pill>,
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setMonitoredCampaign(c.id)} aria-label={`Suivi de ${c.name}`}>Suivi</Button>
          {c.status !== 'done' && c.status !== 'cancelled' && <>
            {c.status === 'queued' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => status({ data: { id: c.id, status: 'paused' } }))}><Pause className="h-3 w-3" /></Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => status({ data: { id: c.id, status: 'queued' } }))}><Play className="h-3 w-3" /></Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => status({ data: { id: c.id, status: 'cancelled' } }))}><X className="h-3 w-3" /></Button>
          </>}
        </div>])} /></div>}
      <CampaignDeliveryMonitor id={monitoredCampaign} close={() => setMonitoredCampaign(null)} />
    </section>
  );
}
