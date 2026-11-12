import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { campaignTopicLabels, isCampaignTopic } from '@/lib/campaign-topics';
import { eraseContactPrivacyData, exportContactPrivacyData, readContactHistory, readContactListInsights, readUnsubscribeReasons } from '@/lib/contact-insights.functions';
import { unsubscribeReasons } from '@/lib/unsubscribe-reasons';
import { DataTable, Panel } from './kit';
import { ContactSegments } from './contact-segments';

const labels = {
  list: 'Ajout à une liste', consent: 'Inscription confirmée', suppression: 'Suppression',
  send: 'Injection KumoMTA', purchase: 'Achat confirmé', purchase_consent: 'Consentement après achat',
};
const details: Record<string, string> = {
  active: 'Actif', unsubscribed: 'Désinscrit', bounced: 'Rebond', delivered: 'Accepté en SMTP',
  deferred: 'Report temporaire', complained: 'Plainte reçue', pending: 'Retour SMTP en attente',
};

export function ContactInsights() {
  const [email, setEmail] = useState(''), [eraseOpen, setEraseOpen] = useState(false), [confirmation, setConfirmation] = useState('');
  const read = useServerFn(readContactHistory);
  const exportPrivacy = useServerFn(exportContactPrivacyData), erasePrivacy = useServerFn(eraseContactPrivacyData);
  const readReasons = useServerFn(readUnsubscribeReasons);
  const lookup = useMutation({ mutationFn: (address: string) => read({ data: { email: address } }) });
  const privacyExport = useMutation({
    mutationFn: () => exportPrivacy({ data: { email } }),
    onSuccess: data => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'export-donnees-contact.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: error => toast.error(error.message),
  });
  const privacyErase = useMutation({
    mutationFn: () => erasePrivacy({ data: { email, confirmation } }),
    onSuccess: result => {
      toast.success('Données effacées et messages historiques anonymisés.', { description: `${result.contacts_removed} contact(s) retiré(s) · ${result.messages_anonymized} message(s) anonymisé(s).` });
      lookup.reset(); setEmail(''); setConfirmation(''); setEraseOpen(false);
    },
    onError: error => toast.error(error.message),
  });
  const reasons = useQuery({ queryKey: ['unsubscribe-reasons'], queryFn: () => readReasons() });
  return <>
    <Panel title="Fiche contact">
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); lookup.mutate(email); }}>
        <label className="grid gap-1 text-sm">Adresse exacte<Input type="email" required maxLength={254} value={email}
          onChange={event => { setEmail(event.target.value); if (!lookup.isPending) lookup.reset(); }} disabled={lookup.isPending} /></label>
        <Button size="sm" disabled={!email || lookup.isPending}>Consulter</Button>
      </form>
      {lookup.isPending && <p role="status">Recherche…</p>}
      {lookup.error && <p role="alert" className="text-destructive">{lookup.error.message}</p>}
      {lookup.data === null && <p>Appliquez la migration 0073 pour afficher les fiches.</p>}
      {lookup.data && <div className="mt-3 space-y-2 text-sm">
        <p><b>Catégories enregistrées</b> {lookup.data.topics?.filter(isCampaignTopic).map(topic => campaignTopicLabels[topic]).join(', ') || 'Aucune sélection enregistrée'}</p>
        <p><b>Rythme</b> {lookup.data.digest ? 'Récapitulatif hebdomadaire' : lookup.data.weekly ? 'Au maximum une fois par semaine' : 'Aucune fréquence spécifique enregistrée'}</p>
        {lookup.data.events.length ? <DataTable cols={['Date', 'Événement', 'Origine', 'État']}
          rows={lookup.data.events.map(event => [
            new Date(event.at).toLocaleString('fr-FR'), labels[event.kind], event.label, event.detail ? details[event.detail] ?? event.detail : '—',
          ])} /> : <p>Aucun événement trouvé pour cette adresse.</p>}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button size="sm" variant="outline" disabled={privacyExport.isPending} onClick={() => privacyExport.mutate()}>Exporter les données JSON</Button>
          <Button size="sm" variant="destructive" onClick={() => { setEraseOpen(value => !value); setConfirmation(''); }}>Effacer et anonymiser</Button>
        </div>
        {eraseOpen && <form className="grid gap-2 rounded-md border border-destructive/40 p-3" onSubmit={event => { event.preventDefault(); privacyErase.mutate(); }}>
          <p className="text-xs text-muted-foreground">Cette opération retire les contacts et préférences, anonymise les destinataires des anciens messages et invalide leurs jetons. Le hash de suppression est conservé pour empêcher une réimportation; les écritures financières sont préservées.</p>
          <label className="grid max-w-md gap-1 text-sm">Recopier l’adresse exacte pour confirmer
            <Input type="email" required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          </label>
          {privacyErase.error && <p role="alert" className="text-destructive">{privacyErase.error.message}</p>}
          <div className="flex gap-2"><Button size="sm" variant="destructive" disabled={privacyErase.isPending || confirmation.trim().toLowerCase() !== email.trim().toLowerCase()}>{privacyErase.isPending ? 'Effacement…' : 'Confirmer l’effacement'}</Button>
            <Button size="sm" type="button" variant="outline" disabled={privacyErase.isPending} onClick={() => { setEraseOpen(false); setConfirmation(''); }}>Annuler</Button></div>
        </form>}
      </div>}
    </Panel>
    <Panel title="Motifs de désinscription · 30 jours">
      {reasons.isPending && <p role="status">Chargement…</p>}
      {reasons.error && <p role="alert" className="text-destructive">{reasons.error.message}</p>}
      {reasons.data === null && <p>Appliquez la migration 0073 pour afficher les réponses.</p>}
      {reasons.data && (reasons.data.length ? <DataTable cols={['Motif facultatif', 'Réponses']}
        rows={reasons.data.map(reason => [unsubscribeReasons[reason.reason as keyof typeof unsubscribeReasons] ?? reason.reason, reason.total])} />
        : <p>Aucun motif renseigné sur cette période.</p>)}
    </Panel>
  </>;
}

const acquisitionLabels = { confirmation: 'Lien d’inscription confirmé', after_purchase: 'Consentement après achat', unknown: 'Origine non documentée' };

export function ContactListInsights({ lists }: { lists: { id: string; name: string }[] }) {
  const [id, setId] = useState('');
  const read = useServerFn(readContactListInsights);
  const query = useQuery({
    queryKey: ['contact-list-insights', id], queryFn: () => read({ data: { listId: id } }),
    enabled: lists.some(list => list.id === id),
  });
  if (!lists.length) return null;
  return <Panel title="Qualité et pression par liste">
    <div className="space-y-3">
      <label className="grid w-fit gap-1 text-sm">Liste à analyser
        <select value={id} onChange={event => setId(event.target.value)} className="h-9 rounded-md border bg-background px-2">
          <option value="">Choisir une liste</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
      </label>
      {id && query.isPending && <p role="status">Calcul des mesures…</p>}
      {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
      {lists.some(list => list.id === id) && <ContactSegments key={id} listId={id} />}
      {query.data && <>
        <p className="text-sm">{query.data.preferences.active} contacts actifs et non supprimés · {query.data.preferences.no_topics} sans catégorie enregistrée · {query.data.preferences.no_weekly_preference} sans limite hebdomadaire enregistrée</p>
        <h3 className="font-medium">Résultats par origine documentée · 30 jours</h3>
        {query.data.quality.length ? <DataTable cols={['Origine', 'SMTP acceptés', 'Rebonds', 'Plaintes', 'Achats confirmés']}
          rows={query.data.quality.map(row => [acquisitionLabels[row.source], row.accepted, row.bounced, row.complained, row.purchases])} />
          : <p>Aucune injection sur la période.</p>}
        <h3 className="font-medium">Pression par catégorie · 30 jours</h3>
        {query.data.saturation.length ? <DataTable cols={['Catégorie', 'Adresses', 'Injections', 'Médiane par adresse', 'Maximum par adresse']}
          rows={query.data.saturation.map(row => [
            isCampaignTopic(row.topic) ? campaignTopicLabels[row.topic] : row.topic, row.recipients, row.sent, row.median, row.peak,
          ])} /> : <p>Aucune injection avec une catégorie renseignée.</p>}
      </>}
    </div>
  </Panel>;
}
