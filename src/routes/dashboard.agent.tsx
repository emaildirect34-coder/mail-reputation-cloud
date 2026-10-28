import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Send, ShieldCheck, Zap, Eye, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/dashboard/agent")({
  head: () => ({
    meta: [
      { title: "Agent Hermes — Email Direct" },
      { name: "description", content: "Agent IA autonome qui pilote serveurs, IPs, DNS, warmup et réputation." },
      { property: "og:title", content: "Agent Hermes — Email Direct" },
      { property: "og:description", content: "Pilotage autonome de votre infrastructure email." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Agent,
});

const levels = [
  { id: 1, icon: Eye, name: "Conseiller", desc: "Hermes propose, vous approuvez chaque action." },
  { id: 2, icon: ShieldCheck, name: "Semi-autonome", desc: "Agit seul sur la délivrabilité, demande pour les achats." },
  { id: 3, icon: Zap, name: "Autonomie totale", desc: "Pilotage 100 % automatique sous plafond de budget." },
];

const chat = [
  { r: "user", t: "Prépare 3 IPs en Allemagne pour 300k emails/jour vers Orange, Free et Gmail, avec warmup conservateur." },
  { r: "agent", t: "Plan en 6 étapes prêt. Coût estimé : 36 €/mois. 2 étapes nécessitent votre approbation." },
];

const steps = [
  { t: "Créer VPS Linode eu-central (4 Go)", tool: "provision_vps", st: "done" },
  { t: "Attacher 3 IPv4 dédiées", tool: "attach_ips", st: "done" },
  { t: "Configurer rDNS mail1-3.mondomaine.com", tool: "set_rdns_ptr", st: "run" },
  { t: "Créer SPF / DKIM / DMARC via Cloudflare", tool: "add_dns_records", st: "wait" },
  { t: "Générer config Lua KumoMTA + reload", tool: "generate_lua_config", st: "wait" },
  { t: "Lancer warmup conservateur 45 jours", tool: "adjust_warmup_curve", st: "approve" },
];

const log = [
  ["03:12", "isolate_bad_ip", "IP 45.13.38.26 retirée du pool Marketing", "Listée sur Spamhaus SBL", "ok"],
  ["02:47", "set_traffic_shaping", "orange.fr : 10 → 4 connexions", "421 Too many connections ×38", "ok"],
  ["01:30", "quarantine_hard_bounces", "1 284 adresses supprimées", "Taux de rebond 6,1 % > 5 %", "ok"],
  ["00:05", "provision_vps", "Nouveau serveur SRV021 demandé", "Achat > plafond auto", "warn"],
] as const;

const tools = ["provision_vps", "attach_ips", "set_rdns_ptr", "generate_lua_config", "reload_mta", "set_traffic_shaping", "flush_queue", "add_dns_records", "generate_dkim_keys", "scan_blacklist", "isolate_bad_ip", "submit_delist_request", "adjust_warmup_curve", "rotate_vmta", "pause_queue", "run_md5_suppression", "validate_batch_emails"];

function StepIcon({ st }: { st: string }) {
  if (st === "done") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (st === "run") return <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />;
  if (st === "approve") return <AlertTriangle className="h-4 w-4 text-primary" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function Agent() {
  const [level, setLevel] = useState(2);
  const [msg, setMsg] = useState("");
  return (
    <>
      <PageHeader
        title="Agent Hermes"
        desc="Votre opérateur de délivrabilité autonome, actif 24/7."
        action={<Pill tone="ok">● En ligne — surveillance active</Pill>}
      />
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat label="Actions aujourd'hui" value="47" sub="12 automatiques" />
        <Stat label="Incidents évités" value="6" sub="dernières 24 h" />
        <Stat label="En attente d'approbation" value="2" />
        <Stat label="Budget utilisé" value="36 € / 150 €" sub="plafond mensuel" />
      </div>

      <Panel title="Niveau d'autonomie">
        <div className="grid gap-3 md:grid-cols-3">
          {levels.map((l) => (
            <button
              key={l.id}
              onClick={() => setLevel(l.id)}
              className={`rounded-lg border p-4 text-left transition ${level === l.id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
            >
              <l.icon className={`h-5 w-5 ${level === l.id ? "text-primary" : "text-muted-foreground"}`} />
              <p className="mt-2 font-semibold">Niveau {l.id} — {l.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{l.desc}</p>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Console Hermes">
          <div className="space-y-3">
            {chat.map((c, i) => (
              <div key={i} className={`flex gap-2 ${c.r === "user" ? "justify-end" : ""}`}>
                {c.r === "agent" && <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />}
                <p className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${c.r === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{c.t}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Donnez une consigne à Hermes…" className="min-h-[44px]" />
            <Button size="icon" aria-label="Envoyer"><Send className="h-4 w-4" /></Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {["Scanner toutes mes IPs", "Optimiser Outlook", "Rapport de délivrabilité"].map((s) => (
              <button key={s} onClick={() => setMsg(s)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{s}</button>
            ))}
          </div>
        </Panel>

        <Panel title="Plan d'exécution en direct">
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <StepIcon st={s.st} />
                <div className="flex-1">
                  <p className="text-sm">{s.t}</p>
                  <code className="font-mono text-xs text-muted-foreground">{s.tool}()</code>
                </div>
                {s.st === "approve" && <Button size="sm">Approuver</Button>}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel title="Journal des décisions">
        <DataTable
          cols={["Heure", "Outil", "Action", "Raison", "Statut"]}
          rows={log.map(([h, t, a, r, s]) => [
            h,
            <code className="font-mono text-xs">{t}</code>,
            a,
            <span className="text-muted-foreground">{r}</span>,
            <Pill tone={s}>{s === "ok" ? "Exécuté" : "En attente"}</Pill>,
          ])}
        />
      </Panel>

      <Panel title="Outils disponibles pour Hermes">
        <div className="flex flex-wrap gap-2">
          {tools.map((t) => <span key={t} className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">{t}</span>)}
        </div>
      </Panel>
    </>
  );
}
