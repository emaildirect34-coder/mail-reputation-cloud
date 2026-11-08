import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShoppingCart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";
import { PROVIDERS, listAccounts, getCatalog, deployServer, listManagedServers } from "@/lib/providers.functions";

export const Route = createFileRoute("/dashboard/marketplace")({
  head: () => ({ meta: [{ title: "Achat de serveurs — Email Direct" }, { name: "description", content: "Achetez et installez des serveurs KumoMTA en direct avec prix réels." }] }),
  component: Marketplace,
});

const SELLERS = PROVIDERS.filter((p) => p.kind === "servers").map((p) => p.id) as string[];
const pname = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

function Marketplace() {
  const qc = useQueryClient();
  const accountsFn = useServerFn(listAccounts);
  const catalogFn = useServerFn(getCatalog);
  const deployFn = useServerFn(deployServer);
  const serversFn = useServerFn(listManagedServers);
  const { data: accounts = [] } = useQuery({ queryKey: ["provider-accounts"], queryFn: () => accountsFn() });
  const { data: servers = [] } = useQuery({ queryKey: ["managed-servers"], queryFn: () => serversFn() });
  const sellers = accounts.filter((a) => SELLERS.includes(a.provider) && a.status === "ok");
  const [acc, setAcc] = useState("");
  const [region, setRegion] = useState("");
  const [plan, setPlan] = useState("");
  const [label, setLabel] = useState("mta-01");
  const [maxPrice, setMaxPrice] = useState("100");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: cat, isFetching, error } = useQuery({ queryKey: ["catalog", acc], queryFn: () => catalogFn({ data: { id: acc } }), enabled: !!acc, staleTime: 600_000 });

  const plans = useMemo(() => (cat?.plans ?? [])
    .filter((p) => p.monthly > 0 && p.monthly <= Number(maxPrice || 1e9))
    .filter((p) => !region || !p.regions || p.regions.includes(region))
    .sort((a, b) => a.monthly - b.monthly), [cat, maxPrice, region]);
  const chosen = plans.find((p) => p.id === plan);
  const account = sellers.find((a) => a.id === acc);
  const monthlyTotal = servers.reduce((s, x: any) => s + Number(x.monthly_price ?? 0), 0);

  async function buy() {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = await deployFn({ data: { accountId: acc, plan: chosen.id, region, label, monthly: chosen.monthly } });
      toast.success(`Serveur commandé${r.ipv4 ? ` · IP ${r.ipv4}` : ""}. KumoMTA et l’agent s’installent seuls (5–10 min), sans terminal.`);
      qc.invalidateQueries({ queryKey: ["managed-servers"] });
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  return (
    <>
      <PageHeader title="Achat de serveurs" desc="Prix réels du fournisseur, commande directe et installation automatique de KumoMTA." />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Comptes vendeurs" value={String(sellers.length)} />
        <Stat label="Offres affichées" value={String(plans.length)} />
        <Stat label="Serveurs commandés" value={String(servers.length)} />
        <Stat label="Coût mensuel" value={`$${monthlyTotal.toFixed(2)}`} />
      </div>

      <Panel title="1. Compte, région et budget">
        {sellers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun compte Linode, Vultr, Hetzner ou DigitalOcean. <Link to="/dashboard/providers" className="text-primary underline">Ajouter un compte</Link></p>
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5"><Label>Compte</Label>
              <Select value={acc} onValueChange={(v) => { setAcc(v); setRegion(""); setPlan(""); }}>
                <SelectTrigger><SelectValue placeholder="Choisir un compte" /></SelectTrigger>
                <SelectContent>{sellers.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} · {pname(a.provider)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Région</Label>
              <Select value={region} onValueChange={(v) => { setRegion(v); setPlan(""); }} disabled={!cat}>
                <SelectTrigger><SelectValue placeholder={isFetching ? "Chargement…" : "Choisir"} /></SelectTrigger>
                <SelectContent>{(cat?.regions ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Budget max ($/mois)</Label><Input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Nom du serveur</Label><Input value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} /></div>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{(error as Error).message}</p>}
      </Panel>

      <Panel title="2. Choisir une offre (prix en direct)">
        {!acc ? <p className="text-sm text-muted-foreground">Choisissez un compte pour voir les prix.</p> : isFetching ? <p className="text-sm text-muted-foreground">Chargement des prix…</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {plans.slice(0, 40).map((p) => (
              <button key={p.id} onClick={() => setPlan(p.id)} className={`rounded-xl border p-3 text-left transition ${plan === p.id ? "border-primary bg-primary/10" : "border-border/60 hover:bg-primary/5"}`}>
                <p className="truncate font-semibold" title={p.label}>{p.label}</p>
                <p className="font-display text-xl font-extrabold text-primary">${p.monthly.toFixed(2)}<span className="text-xs font-normal text-muted-foreground"> /mois</span></p>
                <p className="text-xs text-muted-foreground">{p.vcpus} vCPU · {(p.memoryMb / 1024).toFixed(p.memoryMb < 1024 ? 1 : 0)} Go RAM · {p.diskGb} Go</p>
              </button>
            ))}
            {plans.length === 0 && <p className="text-sm text-muted-foreground">Aucune offre pour ces critères.</p>}
          </div>
        )}
      </Panel>

      <Panel title="3. Récapitulatif et commande">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{chosen ? <>{account?.label} · {region || "région ?"} · <b>{chosen.label}</b> · <b className="text-primary">${chosen.monthly.toFixed(2)}/mois</b> · Ubuntu 22.04 + KumoMTA</> : "Choisissez une région et une offre."}</p>
          <Button disabled={!chosen || !region || busy} onClick={() => setConfirm(true)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />} Commander et installer</Button>
        </div>
      </Panel>

      <Panel title="Serveurs commandés">
        {servers.length === 0 ? <p className="text-sm text-muted-foreground">Aucun serveur commandé pour l'instant.</p> : (
          <DataTable cols={["Nom", "Fournisseur", "Région", "Offre", "IP", "Prix", "Statut"]}
            rows={servers.map((s: any) => [s.label, pname(s.provider), s.region, s.plan, s.ipv4 ?? "en attente", `$${Number(s.monthly_price ?? 0).toFixed(2)}`, <Pill tone="warn">{s.status === "provisioning" ? "Installation" : s.status}</Pill>])} />
        )}
      </Panel>

      <StatusBar>Les commandes sont facturées directement sur votre compte fournisseur</StatusBar>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'achat ?</AlertDialogTitle>
            <AlertDialogDescription>
              Un serveur « {label} » ({chosen?.label}) sera créé sur {account?.label} en {region}. Coût : ${chosen?.monthly.toFixed(2)}/mois, facturé par {account && pname(account.provider)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={buy}>Acheter</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
