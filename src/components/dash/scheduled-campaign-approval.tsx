import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { approveScheduledCampaign, type readCampaignDeliveryMonitor } from '@/lib/sending.functions';

type Review = NonNullable<Awaited<ReturnType<typeof readCampaignDeliveryMonitor>>['approval']>;
const changeLabels: Record<string, string> = {
  initial: 'Première validation de l’envoi programmé',
  subject: 'Objet',
  html: 'Contenu HTML et liens intégrés',
  amp: 'Contenu AMP',
  sender: 'Expéditeur ou adresse de réponse',
  sponsor: 'Offre ou marque sponsor',
  sponsor_link: 'URL de suivi de l’offre sponsor',
  list: 'Liste de contacts',
  audience: 'Destinataires de la campagne',
  server: 'Serveur ou pool d’envoi',
  schedule: 'Date ou plage horaire',
  deadline: 'Date limite d’envoi',
  variants: 'Variantes ou indicateur du test A/B',
  rules: 'Thème ou protections de l’envoi',
};

export function ScheduledCampaignApproval({ id, review, status, refresh }: {
  id: string; review: Review; status: string; refresh: () => Promise<unknown>;
}) {
  const approve = useServerFn(approveScheduledCampaign);
  const mutation = useMutation({
    mutationFn: (revision: string) => approve({ data: { id, revision } }),
    onSuccess: async () => { await refresh(); toast.success('Version programmée validée.'); },
    onError: async error => { toast.error(error.message); await refresh(); },
  });
  if (!['queued', 'paused'].includes(status)) return null;

  return <section className="space-y-2 rounded-md border p-3 text-sm" aria-label="Validation de la version programmée">
    <h3 className="font-medium">{review.pending ? 'Validation requise avant l’envoi' : 'Version programmée validée'}</h3>
    {review.pending ? <>
      <p role="status">Les nouveaux envois attendent la validation de cette version.</p>
      <ul className="list-disc pl-5">{review.changes.map(change => <li key={change}>{changeLabels[change] ?? change}</li>)}</ul>
      <details key={review.revision} className="space-y-2">
        <summary className="cursor-pointer font-medium">Examiner la version actuelle</summary>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Objet</dt><dd>{review.subject}</dd></div>
          <div><dt className="text-muted-foreground">Expéditeur</dt><dd>{review.from_name} &lt;{review.from_email}&gt;</dd></div>
          {review.reply_to && <div><dt className="text-muted-foreground">Adresse de réponse</dt><dd>{review.reply_to}</dd></div>}
          <div><dt className="text-muted-foreground">Audience</dt><dd>{review.list_name ? review.list_name + ' · ' : ''}{review.recipient_count.toLocaleString('fr-FR')} destinataire(s) dans la sélection</dd></div>
          <div><dt className="text-muted-foreground">Serveur et pool</dt><dd>{review.servers.join(', ') || 'Aucun serveur'}{review.pool ? ' · ' + review.pool : ''}</dd></div>
          <div><dt className="text-muted-foreground">Début programmé</dt><dd>{review.scheduled_at ? new Date(review.scheduled_at).toLocaleString('fr-FR') : 'Dès autorisation'}</dd></div>
          {review.sponsor_url && <div className="min-w-0"><dt className="text-muted-foreground">Lien sponsor</dt><dd className="break-all">{review.sponsor_url}</dd></div>}
        </dl>
        {review.html && <details><summary className="cursor-pointer">Contenu HTML</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{review.html}</pre></details>}
        {review.amp_html && <details><summary className="cursor-pointer">Contenu AMP</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{review.amp_html}</pre></details>}
        {review.variants && <details><summary className="cursor-pointer">Variantes A/B</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(review.variants, null, 2)}</pre></details>}
      </details>
      {review.routing_mismatch && <p role="alert" className="text-destructive">La file contient des destinataires affectés à un autre serveur. Corrigez cette affectation avant de valider.</p>}
      <Button size="sm" disabled={mutation.isPending || review.routing_mismatch} onClick={() => mutation.mutate(review.revision)}>Valider cette version</Button>
    </> : review.approved_at && <p className="text-muted-foreground">Validée le {new Date(review.approved_at).toLocaleString('fr-FR')}.</p>}
    {!!review.outdated_agents.length && <p role="status" className="text-muted-foreground">Mise à jour de l’agent d’envoi attendue sur {review.outdated_agents.join(', ')}.</p>}
  </section>;
}
