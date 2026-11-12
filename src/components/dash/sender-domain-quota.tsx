import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readSenderDomainQuota, setSenderDomainQuota } from '@/lib/domains.functions';

type Quota = NonNullable<Awaited<ReturnType<typeof readSenderDomainQuota>>>;
const number = new Intl.NumberFormat('fr-FR');
const utc = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });

export function SenderDomainQuotaUsage({ quota, waiting = false }: { quota: Quota; waiting?: boolean }) {
  return <div className="space-y-1 text-sm">
    <p>
      <strong>{number.format(quota.used)}{quota.daily_limit !== null && ' / ' + number.format(quota.daily_limit)}</strong>
      {' '}autorisation(s) d’envoi aujourd’hui, tous VPS confondus.
    </p>
    {waiting && <p role="status">La campagne attend une place dans le quota du domaine.</p>}
    {!waiting && quota.exhausted && <p role="status">Plafond journalier atteint.</p>}
    <p className="text-xs text-muted-foreground">Remise à zéro le {utc.format(new Date(quota.reset_at))} UTC.</p>
  </div>;
}

function QuotaForm({ quota }: { quota: Quota }) {
  const save = useServerFn(setSenderDomainQuota);
  const cache = useQueryClient();
  const initial = quota.daily_limit?.toString() ?? '';
  const [limit, setLimit] = useState(initial);
  const update = useMutation({
    mutationFn: (value: number | null) => save({ data: { domain: quota.domain, limit: value } }),
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['sender-domain-quota', quota.domain] }),
        cache.invalidateQueries({ queryKey: ['campaign-delivery-monitor'] }),
      ]);
      toast.success('Plafond journalier enregistré.');
    },
    onError: error => toast.error(error.message),
  });
  return <div className="space-y-2">
    <SenderDomainQuotaUsage quota={quota} />
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      update.mutate(limit ? Number(limit) : null);
    }}>
      <label className="grid gap-1 text-sm">
        Autorisations par jour
        <Input className="w-44" type="number" min={1} max={100_000_000} step={1} placeholder="Sans plafond"
          value={limit} onChange={event => setLimit(event.target.value)} />
      </label>
      <Button size="sm" variant="outline" disabled={update.isPending || limit === initial}>Enregistrer le plafond</Button>
    </form>
  </div>;
}

export function SenderDomainQuota({ domain }: { domain: string }) {
  const read = useServerFn(readSenderDomainQuota);
  const query = useQuery({
    queryKey: ['sender-domain-quota', domain], queryFn: () => read({ data: { domain } }), refetchInterval: 30_000,
  });
  return <section className="mt-4 space-y-2 rounded-md border p-3" aria-label="Plafond journalier du domaine">
    <h3 className="font-medium">Plafond journalier du domaine</h3>
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">Chargement du compteur…</p>}
    {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
    {query.data === null && <p className="text-sm text-muted-foreground">Le plafond journalier nécessite la mise à jour 0066.</p>}
    {query.data && <QuotaForm key={`${domain}:${query.data.daily_limit}`} quota={query.data} />}
  </section>;
}
