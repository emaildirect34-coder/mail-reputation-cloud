import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { readServerMaintenance, setServerMaintenance } from '@/lib/infrastructure.functions';
import { Panel, Pill } from './kit';

export function ServerMaintenance({ serverId, admin, absent }: { serverId: string; admin: boolean; absent: boolean }) {
  const read = useServerFn(readServerMaintenance);
  const set = useServerFn(setServerMaintenance);
  const client = useQueryClient();
  const queryKey = ['server-maintenance', serverId];
  const status = useQuery({
    queryKey,
    queryFn: () => read({ data: { id: serverId } }),
    refetchInterval: query => query.state.data?.maintenance_since ? 10_000 : 30_000,
  });
  const update = useMutation({
    mutationFn: (enabled: boolean) => set({ data: { id: serverId, enabled } }),
    onSuccess: async (_, enabled) => {
      await client.invalidateQueries({ queryKey });
      toast.success(enabled ? 'Nouveaux envois mis en attente.' : 'Serveur rouvert aux envois.');
    },
    onError: error => toast.error(error.message),
  });

  const data = status.data;
  const active = !!data?.maintenance_since;
  const ready = active && data?.ready && !status.isError;
  if (data === null) return null;

  return <Panel title="Maintenance du serveur" action={admin && data ? <Button
    size="sm" variant="outline" disabled={update.isPending || status.isError || (!active && absent)}
    onClick={() => update.mutate(!active)}
  >{active ? 'Rouvrir les envois' : 'Mettre en maintenance'}</Button> : undefined}>
    {status.isPending && <p className="text-sm text-muted-foreground">Vérification de l’état du serveur…</p>}
    {status.isError && <p role="alert" className="text-sm text-destructive">État de maintenance indisponible.</p>}
    {data && !status.isError && <div className="space-y-2 text-sm" role="status">
      <Pill tone={ready ? 'ok' : active ? 'warn' : 'neutral'}>{ready ? 'Prêt pour le redémarrage' : active ? 'Maintenance en cours' : 'Ouvert aux envois'}</Pill>
      {active ? <>
        <dl className="flex flex-wrap gap-x-5 gap-y-2">
          <div><dt className="text-muted-foreground">En attente dans Email Direct</dt><dd>{data.queued.toLocaleString('fr-FR')}</dd></div>
          <div><dt className="text-muted-foreground">En cours de remise à KumoMTA</dt><dd>{data.claimed.toLocaleString('fr-FR')}</dd></div>
          <div><dt className="text-muted-foreground">Messages présents dans KumoMTA</dt><dd>{data.kumo_messages?.toLocaleString('fr-FR') ?? 'Mesure en attente'}</dd></div>
        </dl>
        <p className="text-muted-foreground">{ready ? 'Tu peux redémarrer le serveur, puis rouvrir les envois ici.' : 'Le serveur termine les envois déjà pris en charge. Attends la confirmation avant de le redémarrer.'}</p>
      </> : <p className="text-muted-foreground">Le mode maintenance met en attente les nouveaux messages de campagne destinés à ce serveur.</p>}
    </div>}
  </Panel>;
}
