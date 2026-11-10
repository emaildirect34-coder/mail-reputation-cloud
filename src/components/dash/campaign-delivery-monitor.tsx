import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { readCampaignDeliveryMonitor, setCampaignStatus } from '@/lib/sending.functions';
import { DataTable } from './kit';

export function CampaignDeliveryMonitor({ id, close }: { id: string | null; close: () => void }) {
  const read = useServerFn(readCampaignDeliveryMonitor);
  const pause = useServerFn(setCampaignStatus);
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
      return placementActive || smtpActive ? 20_000 : false;
    },
  });
  const data = query.data;
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
        {data.groups.filter(row => row.placement.spam > 0).map(row => <p key={row.provider} role="alert" className="text-sm font-medium text-destructive">
          {row.provider} · {row.placement.spam} boîte(s) témoin en indésirables{row.accepted > 0 ? ` malgré ${row.accepted} acceptation(s) SMTP sur la campagne` : ''}.
        </p>)}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser</Button>
          {data.campaign.status === 'queued' && data.groups.some(row => row.placement.spam > 0) &&
            <Button size="sm" variant="outline" onClick={() => void suspend()}>Mettre la campagne en pause</Button>}
          {!data.placement && <span>Aucun test témoin rattaché.</span>}
          {data.placement?.unavailable && <span>Mail-Tester indisponible. Dernier résultat conservé.</span>}
          {data.placement?.observedAt && <span>Placement vérifié à {new Date(data.placement.observedAt).toLocaleString('fr-FR')}.</span>}
        </div>
        <DataTable cols={['Fournisseur', 'En file / pris', 'Plus ancien dû', 'Injectés / échecs', 'SMTP acceptés / différés / rebonds / plaintes', 'Boîtes témoins', 'Dernière réception témoin']}
          rows={data.groups.map(row => [
            row.provider, `${row.queued} / ${row.claimed}`,
            row.oldestDueAt ? new Date(row.oldestDueAt).toLocaleString('fr-FR') : '—',
            `${row.injected} / ${row.injectionFailed}`,
            `${row.accepted} / ${row.deferred} / ${row.bounced} / ${row.complained}`,
            Object.values(row.placement).some(Boolean)
              ? `${row.placement.inbox} réception · ${row.placement.promotions} promotions · ${row.placement.spam} spam · ${row.placement.pending} attente · ${row.placement.missing} non reçu` : '—',
            row.lastReceivedAt ? new Date(row.lastReceivedAt).toLocaleString('fr-FR') : '—',
          ])} />
      </>}
    </DialogContent>
  </Dialog>;
}
