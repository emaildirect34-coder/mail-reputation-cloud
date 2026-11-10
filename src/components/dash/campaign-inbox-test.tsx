import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { inboxTestServers, sendCampaignInboxTest } from '@/lib/sending.functions';
import { placementResult } from '@/lib/ops.functions';

type Draft = { fromName: string; fromEmail: string; replyTo: string; subject: string; body: string; ampHtml?: string };
type Server = { id: string; label: string };
const labels = {
  pending: 'En attente', inbox: 'Réception', promotions: 'Promotions', spam: 'Spam', missing: 'Non reçu',
};

export function CampaignInboxTest({ draft }: { draft: Draft }) {
  const list = useServerFn(inboxTestServers);
  const send = useServerFn(sendCampaignInboxTest);
  const status = useServerFn(placementResult);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState('');
  const [test, setTest] = useState<Awaited<ReturnType<typeof sendCampaignInboxTest>> | null>(null);
  const result = useQuery({
    queryKey: ['campaign-inbox-placement', test?.id],
    enabled: open && !!test,
    queryFn: async () => {
      if (!test) throw new Error('Test introuvable.');
      const response = await status({ data: { id: test.id } });
      if (!response.result) throw new Error(response.error ?? 'Résultat indisponible.');
      return response.result;
    },
    refetchInterval: query => query.state.data?.status === 'done' ? false : 20_000,
    retry: false,
  });

  async function start(selected?: string) {
    if (locked.current) return;
    locked.current = true;
    setOpen(true);
    setBusy(true);
    setError('');
    try {
      if (!draft.fromName.trim() || !draft.fromEmail.trim() || !draft.subject.trim() || draft.body.trim().length < 20) {
        throw new Error('Renseignez l’expéditeur, l’objet et le contenu du brouillon avant le test.');
      }
      let target = selected;
      if (!target) {
        setServers([]);
        setServerId('');
        const available = await list();
        if (!available.length) throw new Error('Aucun serveur avec un agent KumoMTA installé.');
        if (available.length > 1) {
          setServers(available);
          return;
        }
        target = available[0]!.id;
      }
      const response = await send({ data: {
        serverId: target, fromName: draft.fromName, fromEmail: draft.fromEmail,
        replyTo: draft.replyTo, subject: draft.subject, html: draft.body, ampHtml: draft.ampHtml || undefined,
      } });
      setTest(response);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Impossible de lancer le test.';
      setError(message.startsWith('Mail-Tester 409:') ? 'Ajoutez une boîte témoin dans Paramètres → Boîtes témoins Gmail.' : message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const seeds = result.data?.seeds ?? test?.seeds ?? [];
  const spamCount = seeds.filter(seed => seed.placement === 'spam').length;
  return <>
    <Button variant="outline" onClick={() => test ? setOpen(true) : void start()} disabled={busy}>
      <FlaskConical className="size-4" /> Test Inbox
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle>Test Inbox</DialogTitle>
        <DialogDescription>Le brouillon est envoyé via KumoMTA aux boîtes témoins enregistrées. Un code est ajouté à l’objet pour retrouver le message.</DialogDescription>
        {busy && <p role="status">Préparation du test…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!test && servers.length > 1 && <div className="space-y-3">
          <label className="grid gap-1 text-sm">Serveur KumoMTA
            <select className="rounded border bg-card p-2" value={serverId} disabled={busy} onChange={e => setServerId(e.target.value)}>
              <option value="">Choisir un serveur</option>
              {servers.map(server => <option key={server.id} value={server.id}>{server.label}</option>)}
            </select>
          </label>
          <Button disabled={!serverId || busy} onClick={() => void start(serverId)}>Envoyer le test</Button>
        </div>}
        {test && <>
          <p role="status" className="text-sm">{result.data?.status === 'done' ? 'Test terminé.' : 'Envoi mis en file. Vérification automatique toutes les 20 secondes.'} Code {test.token}</p>
          {result.error && <p role="alert" className="text-sm text-destructive">{result.error.message}</p>}
          {spamCount > 0 && <p role="alert" className="text-sm text-destructive">
            Message trouvé en indésirables sur {spamCount} boîte(s) témoin sur {seeds.length}. Ce résultat porte sur le test du brouillon.
          </p>}
          <ul className="divide-y">
            {seeds.map(seed => <li key={seed.address} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span className="break-all">{seed.address}</span>
              <strong>{labels[seed.placement]}</strong>
            </li>)}
          </ul>
          <Button variant="outline" disabled={busy} onClick={() => { setTest(null); void start(); }}>Nouveau test</Button>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
