import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatAge } from '@/lib/operations-widgets';
import { readSponsorWidgets, saveSponsorDailyTarget } from '@/lib/finance.functions';
import { DataTable, Pill, Stat } from './kit';

const numbers = new Intl.NumberFormat('fr-FR');
const rate = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

function Target({ offerId, limit }: { offerId: string; limit: number | null }) {
  const [value, setValue] = useState(limit?.toString() ?? '');
  const save = useServerFn(saveSponsorDailyTarget);
  const client = useQueryClient();
  const update = useMutation({
    mutationFn: () => save({ data: { offerId, limit: value ? Number(value) : null } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['sponsor-offer-widgets', offerId] });
      toast.success('Objectif enregistré.');
    },
    onError: error => toast.error(error.message),
  });
  return <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); update.mutate(); }}>
    <label className="grid gap-1 text-sm">Objectif d’achats par jour<Input type="number" min={1} max={10_000_000} value={value}
      onChange={event => setValue(event.target.value)} placeholder="Aucun objectif" /></label>
    <Button size="sm" disabled={update.isPending}>Enregistrer</Button>
  </form>;
}

export function SponsorOfferWidgets({ offerId }: { offerId: string }) {
  const read = useServerFn(readSponsorWidgets);
  const query = useQuery({ queryKey: ['sponsor-offer-widgets', offerId], queryFn: () => read({ data: { offerId } }) });
  if (query.isPending) return <p role="status" className="text-sm">Chargement des mesures de l’offre…</p>;
  if (query.error) return <p role="alert" className="text-sm text-destructive">{query.error.message}</p>;
  if (!query.data) return null;
  const { people, timing, followup, today, limit, resetAt, cohorts, reviews } = query.data;
  return <div className="space-y-3 rounded-lg border p-3">
    <h3 className="font-medium">Achats et parcours après achat</h3>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Achats confirmés · 90 j" value={numbers.format(followup.purchases)} />
      <Stat label="Acheteurs ayant racheté · 90 j" value={people.buyers ? rate.format(people.repeat_buyers / people.buyers) : '—'} />
      <Stat label="Délai médian clic → confirmation" value={formatAge(timing.median_click_seconds)} />
      <Stat label="Délai médian entre achats" value={formatAge(people.median_repeat_seconds)} />
    </div>
    <p className="text-sm text-muted-foreground">
      {numbers.format(timing.measured)} délai(s) mesuré(s) entre le premier clic enregistré et la confirmation reçue.
      {timing.p90_click_seconds !== null && ` 90 % des délais mesurés sont inférieurs ou égaux à ${formatAge(timing.p90_click_seconds)}.`}
    </p>
    <p className="text-sm">{followup.thank_yous_created} remerciements créés · {followup.smtp_accepted} acceptés en SMTP · {followup.consent} consentements enregistrés</p>
    {reviews && <p className="text-sm">{reviews.total} avis reçu(s) sur Email Direct
      {reviews.average_rating !== null && ` · ${reviews.average_rating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5`}</p>}
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Pill tone={limit !== null && today >= limit ? 'warn' : 'neutral'}>{today}{limit !== null && ` / ${limit}`} achats confirmés aujourd’hui</Pill>
      <span className="text-muted-foreground">Remise à zéro à 00 h UTC le {resetAt.slice(0, 10)}. Objectif de suivi interne.</span>
    </div>
    <Target key={limit ?? 0} offerId={offerId} limit={limit} />
    {cohorts && <details className="space-y-2">
      <summary className="cursor-pointer font-medium">Résultats par mois d’ajout à la liste</summary>
      <p className="text-xs text-muted-foreground">Pour les messages injectés sur les 90 derniers jours. Le mois d’ajout ne vaut pas preuve de consentement.</p>
      {cohorts.length ? <DataTable cols={['Cohorte', 'SMTP acceptés', 'Achats confirmés', 'Désabonnements attribués']}
        rows={cohorts.map(row => [row.month?.slice(0, 7) ?? 'Inconnu', row.accepted, row.purchases, row.unsubscribed])} /> : <p>Aucun envoi à comparer.</p>}
    </details>}
  </div>;
}
