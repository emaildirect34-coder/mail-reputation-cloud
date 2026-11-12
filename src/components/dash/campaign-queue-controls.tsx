import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type readCampaignDeliveryMonitor, retryConfirmedCampaignMessages, setCampaignPriority, setCampaignServerCapacity } from '@/lib/sending.functions';

type Monitor = Awaited<ReturnType<typeof readCampaignDeliveryMonitor>>;
type ServerQueue = Monitor['queuePriority'][number];
const waitingReasons: Record<string, string> = {
  capacity: 'En attente du plafond du serveur.',
  priority: 'Une campagne de priorité supérieure est prête à partir avant celle-ci.',
  maintenance: 'En attente de la réouverture du serveur en maintenance.',
};

function ServerCapacity({ server, refresh }: { server: ServerQueue; refresh: () => Promise<unknown> }) {
  const save = useServerFn(setCampaignServerCapacity);
  const [cap, setCap] = useState(server.per_minute?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  return <form className="space-y-1" onSubmit={async event => {
    event.preventDefault();
    setSaving(true);
    try {
      await save({ data: { serverId: server.server_id, perMinute: cap ? Number(cap) : null } });
      await refresh();
      toast.success('Plafond du serveur enregistré.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Plafond indisponible.');
    } finally { setSaving(false); }
  }}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">
        {server.label} · plafond par minute
        <Input className="w-36" type="number" min={1} max={100000} step={1} placeholder="Sans plafond" value={cap} onChange={event => setCap(event.target.value)} />
      </label>
      <Button size="sm" variant="outline" disabled={saving || cap === (server.per_minute?.toString() ?? '')}>Enregistrer</Button>
    </div>
    {server.per_minute != null && <p className="text-xs text-muted-foreground">{server.reserved} / {server.per_minute} places réservées sur la dernière minute, toutes campagnes de ce serveur confondues.</p>}
    {server.waiting_reason && waitingReasons[server.waiting_reason] && <p role="status" className="text-sm">
      {waitingReasons[server.waiting_reason]}
    </p>}
  </form>;
}

export function CampaignQueueControls({ campaign, servers, recovery, refresh, deadlineReached }: {
  campaign: Monitor['campaign']; servers: Monitor['queuePriority']; recovery: Monitor['retryStatus']; refresh: () => Promise<unknown>;
  deadlineReached: boolean;
}) {
  const setPriority = useServerFn(setCampaignPriority);
  const retry = useServerFn(retryConfirmedCampaignMessages);
  const [busy, setBusy] = useState(false);
  const priority = servers[0]?.priority ?? 0;
  const cancelled = campaign.status === 'cancelled';
  return <div className="space-y-4">
    {!!servers.length && <section className="space-y-2">
      <h3 className="font-medium">Ordre d’envoi</h3>
      <label className="grid w-fit gap-1 text-sm">Priorité de cette campagne
        <select className="rounded-md border bg-background px-2 py-1" value={priority} disabled={busy || cancelled} onChange={async event => {
          setBusy(true);
          try {
            await setPriority({ data: { id: campaign.id, priority: Number(event.target.value) } });
            await refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Priorité indisponible.');
          } finally { setBusy(false); }
        }}>
          <option value={1}>Haute</option><option value={0}>Normale</option><option value={-1}>Basse</option>
        </select>
      </label>
      {servers.map(server => <ServerCapacity key={`${server.server_id}:${server.per_minute}`} server={deadlineReached ? { ...server, waiting_reason: null } : server} refresh={refresh} />)}
    </section>}
    {recovery && <section className="space-y-2">
      <h3 className="font-medium">Reprise après panne</h3>
      <p className="text-sm text-muted-foreground">{recovery.confirmed} envoi(s) confirmé(s) comme non parti(s) · {recovery.uncertain} à vérifier</p>
      <Button size="sm" variant="outline" disabled={busy || cancelled || deadlineReached || recovery.confirmed === 0} onClick={async () => {
        setBusy(true);
        try {
          const result = await retry({ data: { id: campaign.id } });
          await refresh();
          toast.success(`${result.requeued} remis en file · ${result.excluded} écartés après vérification · ${result.uncertain} à vérifier`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Reprise indisponible.');
        } finally { setBusy(false); }
      }}>Reprendre les envois confirmés comme non partis</Button>
    </section>}
  </div>;
}
