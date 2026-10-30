import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { OctagonX, Play, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/shield")({
  head: () => ({
    meta: [
      { title: "Bouclier d'Inboxing & Arrêt d'Urgence — Email Direct" },
      { name: "description", content: "Frein d'urgence 1-clic, télémétrie /24, dialectes FAI européens et auto-sunset." },
      { property: "og:title", content: "Bouclier d'Inboxing — Email Direct" },
      { property: "og:description", content: "Protection automatique de votre réputation d'envoi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Shield,
});

const breakers = [
  ["Taux de rebond", "1.4 %", "2.5 %", 56],
  ["Plaintes (Gmail)", "0.04 %", "0.08 %", 50],
  ["Plaintes (Outlook)", "0.06 %", "0.08 %", 75],
  ["Spam traps touchés (24 h)", "0", "1", 0],
  ["Erreurs 421 4.7.28", "12 / h", "50 / h", 24],
] as const;

const subnet = [
  ["203.0.113.0/24", "AS63949 Linode", "254 / 256 propres", "ok", "Propre"],
  ["198.51.100.0/24", "AS63949 Linode", "3 voisins listés SBL", "warn", "Surveiller"],
  ["192.0.2.0/24", "AS20473 Vultr", "17 voisins listés XBL", "bad", "Éviter"],
] as const;

const dialects = [
  ["Orange / Wanadoo", "2 connexions max", "OK", "ok"],
  ["SFR / Neuf", "1 connexion, 20 msg/session", "OK", "ok"],
  ["Free.fr", "Greylisting 15 min, retry auto", "Greylisté", "warn"],
  ["T-Online / GMX", "HELO strict = FCrDNS", "OK", "ok"],
  ["iCloud", "TLS 1.3 obligatoire", "OK", "ok"],
  ["La Poste / Laposte.net", "5 msg/min", "Ralenti", "warn"],
] as const;

const sunset = [
  ["Actifs (< 30 j)", 412800, "Envoi normal", 100],
  ["Tièdes (30–60 j)", 98400, "Fréquence réduite ÷2", 60],
  ["Froids (60–90 j)", 41200, "Campagne de réactivation", 30],
  ["Coupés (> 90 j)", 23900, "Exclus automatiquement", 0],
] as const;

function Shield() {
  const [frozen, setFrozen] = useState(false);
  return (
    <>
      <PageHeader title="Bouclier d'Inboxing & Arrêt d'Urgence" desc="Protège votre réputation en temps réel et coupe tout en un clic si un FAI se met à bloquer." />

      <Panel title="Frein d'urgence">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{frozen ? "Envois marketing gelés (TTL 72 h)" : "Tous les envois sont actifs"}</p>
            <p className="text-xs text-muted-foreground">La file est conservée. Les emails transactionnels basculent sur le pool de secours.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline"><Snowflake className="h-4 w-4" /> Drainer un pool</Button>
            {frozen ? (
              <Button onClick={() => setFrozen(false)}><Play className="h-4 w-4" /> Reprendre</Button>
            ) : (
              <Button variant="destructive" onClick={() => setFrozen(true)}><OctagonX className="h-4 w-4" /> Tout geler</Button>
            )}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Disjoncteurs" value="0 déclenché" sub="5 surveillés en continu" />
        <Stat label="Sous-réseaux sains" value="1 / 3" sub="1 à éviter pour les nouvelles IPs" />
        <Stat label="Contacts coupés" value="23 900" sub="Auto-sunset > 90 jours" />
      </div>

      <Panel title="Disjoncteurs automatiques">
        <div className="space-y-3">
          {breakers.map(([n, v, max, pct]) => (
            <div key={n}>
              <div className="mb-1 flex justify-between text-xs"><span>{n}</span><span>{v} / seuil {max}</span></div>
              <Bar value={pct} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Télémétrie de voisinage /24 & ASN">
        <DataTable cols={["Sous-réseau", "ASN", "Voisins", "Verdict"]} rows={subnet.map(([s, a, v, t, l]) => [<code className="text-xs">{s}</code>, <span className="text-xs">{a}</span>, <span className="text-xs">{v}</span>, <Pill tone={t}>{l}</Pill>])} />
      </Panel>

      <Panel title="Dialectes des FAI européens">
        <DataTable cols={["FAI", "Règle appliquée", "État"]} rows={dialects.map(([f, r, s, t]) => [<span className="font-medium">{f}</span>, <span className="text-xs">{r}</span>, <Pill tone={t}>{s}</Pill>])} />
      </Panel>

      <Panel title="Auto-sunset des inactifs">
        <div className="space-y-3">
          {sunset.map(([n, c, a, pct]) => (
            <div key={n}>
              <div className="mb-1 flex justify-between text-xs"><span>{n} · {c.toLocaleString("fr-FR")}</span><span className="text-muted-foreground">{a}</span></div>
              <Bar value={pct} />
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
