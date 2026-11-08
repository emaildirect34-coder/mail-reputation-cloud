import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { listWebhooks, saveWebhook, toggleWebhook, testWebhook } from "@/lib/webhooks.functions";

export const Route = createFileRoute("/dashboard/webhooks")({
  head: () => ({
    meta: [
      { title: "Webhooks & alertes — Email Direct" },
      { name: "description", content: "Recevez en temps réel les livraisons, rebonds, plaintes et désinscriptions sur vos outils." },
      { property: "og:title", content: "Webhooks & alertes — Email Direct" },
      { property: "og:description", content: "Événements d'envoi signés envoyés vers vos endpoints." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Webhooks,
});

const EV_LABEL: Record<string, string> = { delivered: "Livrés", bounce: "Rebonds", deferred: "Différés", complaint: "Plaintes spam", unsubscribe: "Désinscriptions" };

function Webhooks() {
  const qc = useQueryClient();
  const fList = useServerFn(listWebhooks), fSave = useServerFn(saveWebhook), fToggle = useServerFn(toggleWebhook), fTest = useServerFn(testWebhook);
  const q = useQuery({ queryKey: ["webhooks"], queryFn: () => fList() });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["bounce", "complaint", "unsubscribe"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await qc.invalidateQueries({ queryKey: ["webhooks"] }); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  const hooks = q.data?.hooks ?? [];

  return (
    <>
      <PageHeader title="Webhooks & alertes" desc="Recevez les événements d'envoi en temps réel sur Slack, Make, Zapier, votre CRM ou votre API." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Webhooks" value={String(hooks.length)} />
        <Stat label="Actifs" value={String(hooks.filter((h) => h.active).length)} />
        <Stat label="En échec" value={String(hooks.filter((h) => h.fail_count > 0).length)} />
        <Stat label="Envois totaux" value={hooks.reduce((n, h) => n + h.sent_count, 0).toLocaleString("fr-FR")} />
      </div>
      {q.error && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}

      <Panel title="Ajouter un webhook">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await fSave({ data: { url, events: events as any } }); setSecret(r.secret); setUrl(""); toast.success("Webhook ajouté"); }); }}>
          <Input aria-label="URL du webhook" required type="url" placeholder="https://hooks.slack.com/... ou https://votre-api.fr/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            {(q.data?.events ?? Object.keys(EV_LABEL)).map((ev) => (
              <label key={ev} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} />
                {EV_LABEL[ev] ?? ev}
              </label>
            ))}
          </div>
          <Button disabled={busy || !events.length}><Plus className="h-4 w-4" /> Ajouter</Button>
        </form>
        {secret && (
          <div className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
            <p className="font-medium">Clé de signature (affichée une seule fois)</p>
            <div className="mt-1 flex items-center gap-2"><code className="break-all text-xs">{secret}</code><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(secret); toast.success("Copié"); }}><Copy className="h-3 w-3" /></Button></div>
            <p className="mt-1 text-xs text-muted-foreground">Chaque envoi contient l'en-tête X-ED-Signature = sha256=HMAC(clé, horodatage + "." + contenu) pour vérifier qu'il vient bien de nous.</p>
          </div>
        )}
      </Panel>

      <Panel title="Endpoints configurés">
        {q.isPending ? <p className="text-sm text-muted-foreground">Chargement…</p> : !hooks.length ? <p className="text-sm text-muted-foreground">Aucun webhook pour l'instant.</p> : (
          <DataTable
            cols={["URL", "Événements", "Statut", "Dernier envoi", ""]}
            rows={hooks.map((h) => [
              <code className="break-all text-xs">{h.url}</code>,
              <span className="text-muted-foreground">{h.events.map((e) => EV_LABEL[e] ?? e).join(", ")}</span>,
              !h.active ? <Pill tone="warn">Désactivé</Pill> : h.fail_count ? <Pill tone="bad">{h.fail_count} échec(s)</Pill> : <Pill tone="ok">Actif</Pill>,
              <span className="text-xs">{h.last_sent_at ? `${new Date(h.last_sent_at).toLocaleString("fr-FR")} · ${h.last_error ?? h.last_status}` : "Jamais"}</span>,
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const r = await fTest({ data: { id: h.id } }); r.ok ? toast.success(`Test reçu (HTTP ${r.status})`) : toast.error(`Échec : ${r.error}`); })}>Tester</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => fToggle({ data: { id: h.id, active: !h.active } }))}>{h.active ? "Désactiver" : "Activer"}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (confirm("Supprimer ce webhook ?")) void run(() => fToggle({ data: { id: h.id, remove: true } })); }}>Supprimer</Button>
              </div>,
            ])}
          />
        )}
        <p className="mt-2 text-xs text-muted-foreground">Un webhook en échec 20 fois de suite est désactivé automatiquement.</p>
      </Panel>
    </>
  );
}
