import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, RefreshCw, Trash2, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";
import { PROVIDERS, listAccounts, addAccount, recheckAccount, deleteAccount, listZones, deployMailDns } from "@/lib/providers.functions";

export const Route = createFileRoute("/dashboard/providers")({
  head: () => ({ meta: [{ title: "Fournisseurs & comptes — Email Direct" }, { name: "description", content: "Comptes multiples Linode, Cloudflare, Vultr, Hetzner, DigitalOcean et Postmaster." }] }),
  component: Providers,
});

const HELP: Record<string, string> = {
  linode: "Cloud Manager → Profil → API Tokens (Linodes, IPs : lecture/écriture).",
  vultr: "Account → API → Enable API. Autorisez l'IP ou choisissez « Allow all ».",
  hetzner: "Console → Projet → Sécurité → API tokens (lecture & écriture).",
  digitalocean: "API → Tokens → Generate New Token (lecture & écriture).",
  cloudflare: "Jeton API (DNS : Modifier) ou clé API globale + email du compte.",
  google_postmaster: "Collez un jeton d'accès Google. La lecture automatique demande une app Google OAuth.",
};
const pname = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

function Providers() {
  const qc = useQueryClient();
  const list = useServerFn(listAccounts);
  const add = useServerFn(addAccount);
  const recheck = useServerFn(recheckAccount);
  const del = useServerFn(deleteAccount);
  const { data: accounts = [], isLoading, error } = useQuery({ queryKey: ["provider-accounts"], queryFn: () => list() });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ provider: "linode", label: "", authType: "token", secret: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; label: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["provider-accounts"] });

  async function submit() {
    setBusy(true);
    try {
      await add({ data: form });
      toast.success("Compte connecté et vérifié");
      setOpen(false);
      setForm({ ...form, label: "", secret: "", email: "" });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  const cfAccounts = accounts.filter((a) => a.provider === "cloudflare" && a.status === "ok");

  return (
    <>
      <PageHeader
        title="Fournisseurs & comptes"
        desc="Ajoutez autant de comptes que vous voulez pour chaque fournisseur. Chaque clé est testée avant d'être enregistrée."
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Ajouter un compte</Button>}
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Comptes" value={String(accounts.length)} />
        <Stat label="Fonctionnels" value={String(accounts.filter((a) => a.status === "ok").length)} />
        <Stat label="En erreur" value={String(accounts.filter((a) => a.status === "error").length)} />
        <Stat label="Fournisseurs utilisés" value={String(new Set(accounts.map((a) => a.provider)).size)} />
      </div>

      <Panel title="Comptes connectés">
        {error ? <p className="text-sm text-destructive">{(error as Error).message}</p>
          : isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p>
          : accounts.length === 0 ? <p className="text-sm text-muted-foreground">Aucun compte. Cliquez sur « Ajouter un compte ».</p>
          : (
          <DataTable
            cols={["Nom", "Fournisseur", "Type", "Détails", "Statut", "Actions"]}
            rows={accounts.map((a) => [
              <span className="font-medium">{a.label}</span>,
              pname(a.provider),
              <Pill>{a.auth_type === "global" ? "Clé globale" : "Jeton"}</Pill>,
              <span className="text-muted-foreground">{Object.entries(a.info).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 70) || "—"}</span>,
              a.status === "ok" ? <Pill tone="ok">OK</Pill> : a.status === "error" ? <Pill tone="bad">Erreur</Pill> : <Pill tone="warn">En attente</Pill>,
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label="Retester" onClick={async () => { const r = await recheck({ data: { id: a.id } }); toast(r.status === "ok" ? "Compte OK" : "La clé ne fonctionne plus"); refresh(); }}><RefreshCw className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="Supprimer" onClick={() => setToDelete({ id: a.id, label: a.label })}><Trash2 className="h-4 w-4" /></Button>
              </div>,
            ])}
          />
        )}
      </Panel>

      <CloudflareDns accounts={cfAccounts} />

      <Panel title="Fournisseurs disponibles">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button key={p.id} className="rounded-xl border border-border/60 p-3 text-left transition hover:bg-primary/5" onClick={() => { setForm({ ...form, provider: p.id, authType: "token" }); setOpen(true); }}>
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs text-muted-foreground">{accounts.filter((a) => a.provider === p.id).length} compte(s) · {HELP[p.id]}</p>
            </button>
          ))}
        </div>
      </Panel>

      <StatusBar>{accounts.length} comptes · les clés ne sont jamais réaffichées après enregistrement</StatusBar>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajouter un compte</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Fournisseur</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v, authType: "token" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{HELP[form.provider]}</p>
            </div>
            <div className="space-y-1.5"><Label>Nom du compte</Label><Input value={form.label} placeholder="Ex : Linode principal" onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
            {form.provider === "cloudflare" && (
              <div className="space-y-1.5"><Label>Type de clé</Label>
                <Select value={form.authType} onValueChange={(v) => setForm({ ...form, authType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="token">Jeton API</SelectItem><SelectItem value="global">Clé API globale</SelectItem></SelectContent>
                </Select>
              </div>
            )}
            {form.authType === "global" && <div className="space-y-1.5"><Label>Email du compte Cloudflare</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>}
            <div className="space-y-1.5"><Label>Clé API</Label><Input type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Tester et enregistrer</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {toDelete?.label} » ?</AlertDialogTitle>
            <AlertDialogDescription>La clé est retirée d'ici uniquement. Vos serveurs et DNS chez le fournisseur ne sont pas touchés.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (toDelete) { await del({ data: { id: toDelete.id } }); toast("Compte supprimé"); refresh(); } }}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CloudflareDns({ accounts }: { accounts: { id: string; label: string }[] }) {
  const zonesFn = useServerFn(listZones);
  const dnsFn = useServerFn(deployMailDns);
  const [acc, setAcc] = useState("");
  const [zone, setZone] = useState("");
  const [ip, setIp] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { data: zones = [], isFetching } = useQuery({ queryKey: ["cf-zones", acc], queryFn: () => zonesFn({ data: { id: acc } }), enabled: !!acc });
  const z = zones.find((x) => x.id === zone);

  return (
    <Panel title="Cloudflare — DNS email en un clic">
      {accounts.length === 0 ? <p className="text-sm text-muted-foreground">Ajoutez un compte Cloudflare pour voir vos domaines.</p> : (
        <div className="grid gap-3 md:grid-cols-4">
          <Select value={acc} onValueChange={(v) => { setAcc(v); setZone(""); }}>
            <SelectTrigger><SelectValue placeholder="Compte Cloudflare" /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={zone} onValueChange={setZone} disabled={!acc}>
            <SelectTrigger><SelectValue placeholder={isFetching ? "Chargement…" : `Domaine (${zones.length})`} /></SelectTrigger>
            <SelectContent>{zones.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="IP du serveur d'envoi" value={ip} onChange={(e) => setIp(e.target.value)} />
          <Button disabled={!z || !ip} onClick={() => setConfirm(true)}><Globe className="h-4 w-4" /> Créer les DNS</Button>
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Créer les DNS email sur {z?.name} ?</AlertDialogTitle>
            <AlertDialogDescription>4 enregistrements seront ajoutés : A mail.{z?.name} → {ip}, MX, SPF (ip4:{ip}) et DMARC p=reject. Les enregistrements existants ne sont pas supprimés.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              try {
                const r = await dnsFn({ data: { accountId: acc, zoneId: zone, domain: z!.name, ip } });
                r.forEach((x) => x.ok ? toast.success(`${x.type} ${x.name} créé`) : toast.error(`${x.type} ${x.name} : ${x.error}`));
              } catch (e) { toast.error((e as Error).message); }
            }}>Créer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
