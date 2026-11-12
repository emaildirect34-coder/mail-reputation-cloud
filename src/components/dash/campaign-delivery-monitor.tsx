import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { finishCampaignUnsubscribeProbe, prepareCampaignUnsubscribeProbe, readCampaignDeliveryMonitor, releaseCampaignProvider, retryCampaignPreflight, setCampaignStatus } from '@/lib/sending.functions';
import { DataTable } from './kit';
import { CampaignQueueControls } from './campaign-queue-controls';
import { ScheduledCampaignApproval } from './scheduled-campaign-approval';
import { CampaignVersionHistory } from './campaign-version-history';
import { CampaignNotebook } from './campaign-workspace';
import { CampaignDeliveryReconciliation } from './campaign-delivery-reconciliation';
import { SenderDomainQuotaUsage } from './sender-domain-quota';

const waveLabels: Record<string, string> = {
  last: 'Dernier lot ouvert',
  hold: 'Campagne ou fournisseur en pause',
  complaint: 'Plainte reçue',
  witness: 'Test témoin en attente ou à renouveler',
  pending: 'Attente de la fin du lot ou de la confirmation d’injection',
  observing: 'Observation pendant 10 minutes après le dernier envoi',
  bounce: 'Trop de rebonds',
  deferred: 'Trop de reports SMTP',
  insufficient: 'Acceptations SMTP insuffisantes',
  telemetry: 'Remontées SMTP en retard',
  unsubscribe: 'Vérification HTTPS du désabonnement en attente',
  ready: 'Prêt pour le prochain passage de l’agent',
};

export function CampaignDeliveryMonitor({ id, close }: { id: string | null; close: () => void }) {
  const read = useServerFn(readCampaignDeliveryMonitor);
  const pause = useServerFn(setCampaignStatus);
  const release = useServerFn(releaseCampaignProvider);
  const retry = useServerFn(retryCampaignPreflight);
  const prepareUnsubscribe = useServerFn(prepareCampaignUnsubscribeProbe);
  const finishUnsubscribe = useServerFn(finishCampaignUnsubscribeProbe);
  const attemptedProbe = useRef('');
  const probeLock = useRef(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeError, setProbeError] = useState('');
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['campaign-delivery-monitor', id],
    enabled: !!id,
    queryFn: () => read({ data: { id: id! } }),
    refetchInterval: ({ state }) => {
      const data = state.data;
      if (!data) return state.error ? false : 20_000;
      const placementActive = data.placement && !data.placement.completedAt && Date.parse(data.placement.expiresAt) + 60_000 > Date.now();
      const smtpActive = data.campaign.status === 'queued' || data.groups.some(row => row.deferred || row.injected > row.accepted + row.bounced + row.complained);
      return placementActive || smtpActive || data.approval?.pending || (data.deadline && !data.deadline.deadline_reached) ? 20_000 : false;
    },
  });
  const data = query.data;
  const probeNeeded = !data?.deadline?.deadline_reached && data?.campaign.requiresPlacement && data.placement?.unsubscribeHttpsRequired && !data.placement.unsubscribeHttpsVerifiedAt;
  const probeKey = probeNeeded ? data?.placement?.id : null;
  const refresh = query.refetch;
  const verifyUnsubscribe = useCallback(async () => {
    if (!id || probeLock.current) return;
    if (window.location.protocol !== 'https:') {
      setProbeError('Ouvrez Email Direct en HTTPS pour exécuter ce contrôle.');
      return;
    }
    probeLock.current = true;
    setProbeBusy(true);
    setProbeError('');
    try {
      const probe = await prepareUnsubscribe({ data: { id } });
      if (!probe) { await refresh(); return; }
      let acknowledged = false;
      try {
        const response = await fetch('/api/public/unsub/' + probe.token, {
          method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(7000),
          body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }),
        });
        acknowledged = response.ok;
      } catch { /* Cleanup and verification still run after a failed request. */ }
      const result = await finishUnsubscribe({ data: { id: probe.id, acknowledged } });
      if (!result.ok) throw new Error('Le désabonnement HTTPS ou le retrait de la file a échoué.');
      await refresh();
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : 'Contrôle de désabonnement indisponible.');
    } finally {
      probeLock.current = false;
      setProbeBusy(false);
    }
  }, [id, prepareUnsubscribe, finishUnsubscribe, refresh]);
  useEffect(() => {
    if (!probeKey || attemptedProbe.current === probeKey) return;
    attemptedProbe.current = probeKey;
    void verifyUnsubscribe();
  }, [probeKey, verifyUnsubscribe]);
  const holdLabels: Record<string, string> = {
    gmail_rate: 'Limitation Gmail 4.7.28. Reprise à débit réduit.',
    outlook_auth: 'Outlook 5.7.515. Corrigez l’authentification, puis relancez le test.',
    orange_connections: 'Orange limite les connexions simultanées.',
  };
  async function preflightAction(provider?: string) {
    if (!id) return;
    try {
      if (provider) {
        await release({ data: { id, provider } });
        toast.success(`Lot ${provider} autorisé.`);
      } else {
        const result = await retry({ data: { id } });
        if (result !== 'started') throw new Error('Le test témoin est indisponible. Vérifiez Mail-Tester.');
      }
      await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['sending'] })]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action indisponible.');
    }
  }
  async function suspend() {
    if (!id) return;
    try {
      const result = await pause({ data: { id, status: 'paused' } });
      await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['sending'] })]);
      if (result.ok) toast.success('Campagne mise en pause.');
      else toast.info('La campagne est déjà terminée ou annulée.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de suspendre la campagne.');
    }
  }

  return <Dialog open={!!id} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-h-[85dvh] max-w-5xl overflow-auto">
      <DialogTitle>{data?.campaign.name ?? 'Suivi de la campagne'}</DialogTitle>
      <DialogDescription>Suivi de la file, des réponses SMTP et des boîtes témoins. Le placement observé concerne uniquement les boîtes testées.</DialogDescription>
      {query.isPending && <p role="status">Chargement du suivi…</p>}
      {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
      {data && <>
        {data.domainQuota?.daily_limit != null && <section className="space-y-1 rounded-md border p-3" aria-label="Plafond journalier du domaine">
          <h3 className="text-sm font-medium">Plafond journalier · {data.domainQuota.domain}</h3>
          <SenderDomainQuotaUsage quota={data.domainQuota} waiting={data.domainQuota.waiting} />
        </section>}
        <CampaignDeliveryReconciliation key={'reconciliation-' + data.campaign.id} id={data.campaign.id} />
        {data.deadline && <section className="space-y-1 rounded-md border p-3 text-sm" aria-label="Date limite d’envoi">
          <h3 className="font-medium">{data.deadline.deadline_reached ? 'Date limite atteinte' : 'Date limite d’envoi'}</h3>
          <p><time dateTime={data.deadline.send_expires_at}>{new Date(data.deadline.send_expires_at).toLocaleString('fr-FR', { timeZoneName: 'short' })}</time></p>
          <p role="status"><strong>{data.deadline.expired.toLocaleString('fr-FR')}</strong> message(s) expiré(s)</p>
        </section>}
        <CampaignVersionHistory key={'history-' + data.campaign.id} id={data.campaign.id} onRestore={close} />
        <CampaignNotebook key={'notes-' + data.campaign.id} id={data.campaign.id} />
        {!data.deadline?.deadline_reached && data.approval && <ScheduledCampaignApproval key={'approval-' + data.campaign.id} id={data.campaign.id} review={data.approval}
          status={data.campaign.status} refresh={() => query.refetch()} />}
        <CampaignQueueControls key={'queue-' + data.campaign.id} campaign={data.campaign} servers={data.queuePriority} recovery={data.retryStatus} deadlineReached={data.deadline?.deadline_reached === true}
          refresh={() => Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['campaign-list'] }), cache.invalidateQueries({ queryKey: ['sending'] })])} />
        {data.holds.map(hold => <p key={hold.provider} role="alert" className="text-sm text-destructive">
          {holdLabels[hold.reason] ?? hold.provider}
          {hold.until_at && ` Pause jusqu’à ${new Date(hold.until_at).toLocaleTimeString('fr-FR')}.`}
        </p>)}
        {data.groups.filter(row => row.placement.spam > 0).map(row => <p key={row.provider} role="alert" className="text-sm font-medium text-destructive">
          {row.provider} · {row.placement.spam} boîte(s) témoin en indésirables{row.accepted > 0 ? ` malgré ${row.accepted} acceptation(s) SMTP sur la campagne` : ''}.
        </p>)}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser</Button>
          {data.campaign.status === 'queued' && data.groups.some(row => row.placement.spam > 0) &&
            <Button size="sm" variant="outline" onClick={() => void suspend()}>Mettre la campagne en pause</Button>}
          {!data.placement && <span>Aucun test témoin rattaché.</span>}
          {!data.deadline?.deadline_reached && data.campaign.requiresPlacement && (!data.placement || data.placement.completedAt || Date.parse(data.placement.expiresAt) <= Date.now()) &&
            <Button size="sm" variant="outline" onClick={() => void preflightAction()}>Relancer le test</Button>}
          {data.placement?.unavailable && <span>Mail-Tester indisponible. Dernier résultat conservé.</span>}
          {data.placement?.observedAt && <span>Placement vérifié à {new Date(data.placement.observedAt).toLocaleString('fr-FR')}.</span>}
          {probeNeeded && <Button size="sm" variant="outline" disabled={probeBusy} onClick={() => void verifyUnsubscribe()}>
            {probeBusy ? 'Vérification HTTPS…' : 'Vérifier le désabonnement HTTPS'}
          </Button>}
          {data.placement?.unsubscribeHttpsVerifiedAt && <span>Désabonnement HTTPS et retrait de la file vérifiés.</span>}
        </div>
        {probeNeeded && probeError && <p role="alert" className="text-sm text-destructive">{probeError}</p>}
        {!!data.smtpScans.length && <DataTable cols={['Serveur', 'Dernière lecture confirmée', 'Journaux couverts jusqu’à', 'Dernier événement reçu', 'Remontées SMTP']}
          rows={data.smtpScans.map(scan => [
            scan.label, scan.reported_at ? new Date(scan.reported_at).toLocaleString('fr-FR') : '—',
            scan.observed_through ? new Date(scan.observed_through).toLocaleString('fr-FR') : '—',
            scan.last_event_at ? new Date(scan.last_event_at).toLocaleString('fr-FR') : '—',
            scan.observed_through
              ? `${scan.current_scan ? 'À jour' : 'En retard'} · ${Math.max(0, Math.floor((Date.now() - Date.parse(scan.observed_through)) / 60_000))} min`
              : 'En attente de l’agent',
          ])} />}
        <DataTable cols={['Fournisseur', 'En file / pris', 'Plus ancien dû', 'Injectés / échecs', 'SMTP acceptés / différés / rebonds / plaintes', 'Boîtes témoins', 'Dernière réception témoin', ...(data.campaign.requiresPlacement ? ['Autorisation'] : [])]}
          rows={data.groups.map(row => [
            row.provider, `${row.queued} / ${row.claimed}`,
            row.oldestDueAt ? new Date(row.oldestDueAt).toLocaleString('fr-FR') : '—',
            `${row.injected} / ${row.injectionFailed}`,
            `${row.accepted} / ${row.deferred} / ${row.bounced} / ${row.complained}`,
            Object.values(row.placement).some(Boolean)
              ? `${row.placement.inbox} réception · ${row.placement.promotions} promotions · ${row.placement.spam} spam · ${row.placement.pending} attente · ${row.placement.missing} non reçu` : '—',
            row.lastReceivedAt ? new Date(row.lastReceivedAt).toLocaleString('fr-FR') : '—',
            ...(data.campaign.requiresPlacement ? [data.releasedProviders.includes(row.provider) &&
                !data.holds.some(hold => hold.provider === row.provider) ? 'Autorisé'
              : !probeNeeded && data.placement?.completedAt && row.queued > 0 && row.authenticatedSeeds > 0 &&
                row.authenticatedSeeds === row.placement.inbox + row.placement.promotions &&
                !row.placement.spam && !row.placement.missing && !row.placement.pending
                ? <Button size="sm" variant="outline" onClick={() => void preflightAction(row.provider)}>Autoriser le lot</Button>
                : 'En attente de témoins conformes'] : []),
          ])} />
        {!!data.waves.length && <section className="space-y-2">
          <h3 className="font-medium">Validation entre les lots</h3>
          <DataTable cols={['Fournisseur', 'Lot ouvert', 'Acceptés / prévus', 'Reports / rebonds / plaintes', 'Après ce lot', 'Prochaine décision']}
            rows={data.waves.map(wave => [
              wave.provider, wave.wave, `${wave.accepted} / ${wave.planned}`,
              `${wave.deferred} / ${wave.bounced} / ${wave.complaints}`, wave.remaining, waveLabels[wave.state] ?? 'En attente',
            ])} />
        </section>}
        {!!data.placement?.seeds.some(seed => seed.authentication) && <details className="text-sm">
          <summary>Authentification des témoins reçus</summary>
          <DataTable cols={['Boîte témoin', 'SPF', 'DKIM', 'DMARC', 'Désinscription signée']}
            rows={data.placement.seeds.map(seed => [
              seed.address, seed.authentication?.spf ?? '—', seed.authentication?.dkim ?? '—',
              seed.authentication?.dmarc ?? '—', seed.authentication ? (seed.authentication.one_click ? 'Vérifiée' : 'À corriger') : '—',
            ])} />
        </details>}
      </>}
    </DialogContent>
  </Dialog>;
}
