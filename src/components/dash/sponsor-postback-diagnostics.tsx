import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, Panel, Pill } from './kit';
import { createSponsorPostbackDiagnostic, readSponsorPostbackDiagnostics } from '@/lib/finance.functions';

const labels: Record<string, string> = {
  body: 'Requête trop volumineuse', click: 'Format du clic invalide', amount: 'Format du montant invalide',
  payout: 'Montant hors limite', unknown_click: 'Clic inconnu', unknown_campaign: 'Campagne inconnue',
  other_account: 'Campagne d’un autre compte', no_offer: 'Campagne sans offre',
  transaction_conflict: 'Transaction déjà attribuée ailleurs', service: 'Service temporairement indisponible',
};
const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function AccountDiagnostics({ accountId }: { accountId: string }) {
  const [event, setEvent] = useState('purchase');
  const [url, setUrl] = useState('');
  const [search, setSearch] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const read = useServerFn(readSponsorPostbackDiagnostics);
  const create = useServerFn(createSponsorPostbackDiagnostic);
  const query = useQuery({
    queryKey: ['postback-diagnostics', accountId, transactionId], queryFn: () => read({ data: { accountId, transactionId } }),
    refetchInterval: 5000,
  });
  const make = useMutation({
    mutationFn: () => create({ data: { accountId, event } }),
    onSuccess: result => {
      const callback = new URL('/api/public/postback/' + result.token, window.location.origin);
      callback.search = new URLSearchParams({
        click_id: result.clickId, txid: 'test-' + result.clickId.slice(0, 12), event: result.event, status: 'approved',
      }).toString();
      setUrl(callback.href);
      void query.refetch();
    },
    onError: error => toast.error(error.message),
  });
  if (query.isPending) return <p role="status">Chargement du diagnostic…</p>;
  if (query.error) return <p role="alert" className="text-destructive">{query.error.message}</p>;
  if (!query.data) return <p>Appliquez la migration 0070 pour activer le diagnostic des postbacks.</p>;
  const last = query.data.diagnostic;
  const expired = last && Date.parse(last.expires_at) <= Date.now();
  return <div className="space-y-4">
    <div className="space-y-2">
      <h3 className="font-medium">Tester un retour du sponsor</h3>
      <p className="text-sm text-muted-foreground">Fais appeler l’URL de test par ton réseau dans son outil de test. Le lien expire après 20 minutes et le résultat apparaît ici.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); make.mutate(); }}>
        <label className="space-y-1 text-sm">Code de l’événement d’achat<Input value={event} onChange={e => setEvent(e.target.value)} required maxLength={100} /></label>
        <Button size="sm" disabled={make.isPending}>Créer un lien de test</Button>
      </form>
      {url && !expired && <div className="flex flex-wrap gap-2"><Input className="max-w-2xl" aria-label="URL du postback de test" readOnly value={url} />
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success('URL copiée.')).catch(() => toast.error('Copie indisponible.'))}>Copier</Button></div>}
      {last && <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={last.succeeded ? 'ok' : last.checked_at ? 'bad' : 'warn'}>
          {last.succeeded ? 'Test réussi' : expired ? 'Test expiré' : last.checked_at ? 'À corriger' : 'En attente du réseau'}
        </Pill>
        <span>{last.detail}{last.checked_at && ` · ${date.format(new Date(last.checked_at))}`}</span>
      </div>}
    </div>
    <div className="space-y-2">
      <h3 className="font-medium">Postbacks refusés sur 30 jours</h3>
      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); setTransactionId(search.trim()); }}>
        <label className="space-y-1 text-sm">Filtrer par référence exacte<Input value={search} onChange={e => setSearch(e.target.value)} maxLength={120} /></label>
        <Button size="sm" variant="outline">Rechercher</Button>
        {transactionId && <Button type="button" size="sm" variant="ghost" onClick={() => { setSearch(''); setTransactionId(''); }}>Effacer</Button>}
      </form>
      {query.data.rejections.length ? <DataTable cols={['Motif', 'Tentatives', 'Dernier refus']}
        rows={query.data.rejections.map(row => [labels[row.reason] ?? row.reason, row.attempts, date.format(new Date(row.last_seen))])} />
        : <p className="text-sm text-muted-foreground">Aucun refus enregistré pour cette recherche.</p>}
    </div>
  </div>;
}

export function SponsorPostbackDiagnostics({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [id, setId] = useState('');
  if (!accounts.length) return null;
  const active = accounts.find(account => account.id === id) ?? accounts[0]!;
  return <Panel title="Diagnostic des postbacks sponsor">
    <label className="mb-3 block max-w-sm space-y-1 text-sm">Compte sponsor
      <select className="h-9 w-full rounded-md border bg-background px-2" value={active.id} onChange={e => setId(e.target.value)}>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
    </label>
    <AccountDiagnostics key={active.id} accountId={active.id} />
  </Panel>;
}
