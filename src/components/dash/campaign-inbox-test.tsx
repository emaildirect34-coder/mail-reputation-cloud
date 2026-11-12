import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { sendCampaignInboxTest } from '@/lib/sending.functions';
import { placementResult } from '@/lib/ops.functions';

type Draft = { fromName: string; fromEmail: string; replyTo: string; senderProfileId?: string; subject: string; body: string; ampHtml?: string; vmtaPoolId: string };
type Server = { id: string; label: string };
const labels = {
  pending: 'En attente', inbox: 'Réception', promotions: 'Promotions', spam: 'Spam', missing: 'Non reçu',
};

export function CampaignInboxTest({ draft, server }: { draft: Draft; server: Server | undefined }) {
  const send = useServerFn(sendCampaignInboxTest);
  const status = useServerFn(placementResult);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState<{ result: Awaited<ReturnType<typeof sendCampaignInboxTest>>; server: Server; poolId: string } | null>(null);
  const test = run?.result;
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

  async function start() {
    if (locked.current) return;
    locked.current = true;
    setOpen(true);
    setBusy(true);
    setError('');
    setRun(null);
    try {
      if (!server) throw new Error('Choisissez le serveur de cette campagne dans Envoi réel.');
      if (!draft.fromName.trim() || !draft.fromEmail.trim() || !draft.subject.trim() || draft.body.trim().length < 20) {
        throw new Error('Renseignez l’expéditeur, l’objet et le contenu du brouillon avant le test.');
      }
      const response = await send({ data: {
        serverId: server.id, vmtaPoolId: draft.vmtaPoolId || undefined, fromName: draft.fromName, fromEmail: draft.fromEmail,
        replyTo: draft.replyTo, senderProfileId: draft.senderProfileId || undefined, subject: draft.subject, html: draft.body, ampHtml: draft.ampHtml || undefined,
      } });
      setRun({ result: response, server, poolId: draft.vmtaPoolId });
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
    <Button variant="outline" onClick={() => run && run.server.id === server?.id && run.poolId === draft.vmtaPoolId ? setOpen(true) : void start()} disabled={busy}>
      <FlaskConical className="size-4" /> Test Inbox
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle>Test Inbox</DialogTitle>
        <DialogDescription>Le brouillon est envoyé aux boîtes témoins avec le serveur et le pool de la campagne.</DialogDescription>
        {busy && <p role="status">Préparation du test…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {run && test && <>
          <p className="text-sm">Serveur utilisé <strong>{run.server.label}</strong></p>
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
          <Button variant="outline" disabled={busy} onClick={() => void start()}>Nouveau test</Button>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
