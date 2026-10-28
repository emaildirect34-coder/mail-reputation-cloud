import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, ShieldCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/dns")({
  head: () => ({ meta: [{ title: "DNS & Automatisation — Email Direct" }] }),
  component: DnsAutomation,
});

const records = [
  { type: "SPF", host: "@", value: "v=spf1 include:emaildirect.io ~all", status: "ok" },
  { type: "DKIM", host: "ed1._domainkey", value: "v=DKIM1; k=rsa; p=MIIBIjANBg…", status: "ok" },
  { type: "DMARC", host: "_dmarc", value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@…", status: "warn" },
  { type: "MX", host: "@", value: "10 mail.emaildirect.io", status: "ok" },
  { type: "PTR", host: "203.0.113.10", value: "mail1.emaildirect.io", status: "bad" },
] as const;

const providers = [
  { name: "Cloudflare", desc: "Création automatique SPF, DKIM, DMARC, MX", connected: true },
  { name: "Linode DNS", desc: "Zone DNS + rDNS/PTR sur les IPs", connected: true },
  { name: "Route 53 (AWS)", desc: "Synchronisation des enregistrements", connected: false },
] as const;

function DnsAutomation() {
  return (
    <>
      <PageHeader
        title="DNS & Automatisation"
        desc="Générez et synchronisez automatiquement SPF, DKIM, DMARC, MX et PTR via les API de vos fournisseurs DNS."
        action={<Button><RefreshCw className="h-4 w-4" /> Synchroniser tout</Button>}
      />

      <Panel title="Générateur DKIM">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground">Sélecteur</label>
            <Input defaultValue="ed1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Algorithme</label>
            <Input defaultValue="RSA 2048" />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full"><KeyRound className="h-4 w-4" /> Générer une paire</Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          La clé privée est injectée directement dans la configuration KumoMTA du serveur ; seule la clé publique est publiée en DNS.
        </p>
      </Panel>

      <Panel title="Enregistrements — emaildirect.io">
        <DataTable
          cols={["Type", "Hôte", "Valeur", "Statut"]}
          rows={records.map((r) => [
            <Pill>{r.type}</Pill>,
            <code>{r.host}</code>,
            <span className="block max-w-xs truncate text-muted-foreground">{r.value}</span>,
            r.status === "ok" ? <Pill tone="ok">Synchronisé</Pill> : r.status === "warn" ? <Pill tone="warn">À vérifier</Pill> : <Pill tone="bad">Manquant</Pill>,
          ])}
        />
      </Panel>

      <Panel title="Fournisseurs DNS connectés">
        <div className="grid gap-3 sm:grid-cols-3">
          {providers.map((p) => (
            <div key={p.name} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{p.name}</p>
                {p.connected ? <Pill tone="ok">Connecté</Pill> : <Pill>Non connecté</Pill>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.desc}</p>
              <Button size="sm" variant="outline" className="mt-3 w-full">
                <ShieldCheck className="h-4 w-4" /> {p.connected ? "Re-vérifier" : "Connecter"}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
