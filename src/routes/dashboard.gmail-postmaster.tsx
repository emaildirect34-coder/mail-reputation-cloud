import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";
import { getPostmasterDomains, getPostmasterStats } from "@/lib/postmaster.functions";
import { RefreshCw, Download } from "lucide-react";

export const Route = createFileRoute("/dashboard/gmail-postmaster")({
  head: () => ({
    meta: [
      { title: "Gmail Postmaster en direct — Email Direct" },
      { name: "description", content: "Réputation, taux de spam, authentification, TLS et erreurs Gmail en temps réel." },
      { property: "og:title", content: "Gmail Postmaster en direct — Email Direct" },
      { property: "og:description", content: "Toutes les métriques Google Postmaster Tools de vos domaines." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GmailPostmaster,
});

type Stats = Awaited<ReturnType<typeof getPostmasterStats>>["stats"];
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)} %`);
const repTone = (r?: string | null) => (r === "HIGH" ? "ok" : r === "MEDIUM" ? "neutral" : r === "LOW" ? "warn" : r === "BAD" ? "bad" : "neutral") as any;
const repFr: Record<string, string> = { HIGH: "Élevée", MEDIUM: "Moyenne", LOW: "Faible", BAD: "Mauvaise", REPUTATION_CATEGORY_UNSPECIFIED: "Inconnue" };
const stFr = (s?: string | null) => (s === "COMPLIANT" ? "Conforme" : s === "NEEDS_WORK" ? "À corriger" : "—");
const stTone = (s?: string | null) => (s === "COMPLIANT" ? "ok" : s === "NEEDS_WORK" ? "bad" : "neutral") as any;
const reqFr: Record<string, string> = { SPF: "SPF", DKIM: "DKIM", SPF_AND_DKIM: "SPF et DKIM", DMARC_POLICY: "Politique DMARC", DMARC_ALIGNMENT: "Alignement DMARC",
  MESSAGE_FORMATTING: "Format des messages (RFC 5322)", DNS_RECORDS: "DNS direct et inverse (PTR)", ENCRYPTION: "Chiffrement TLS", USER_REPORTED_SPAM_RATE: "Taux de spam", ONE_CLICK_UNSUBSCRIBE: "Désabonnement 1 clic", HONOR_UNSUBSCRIBE: "Respect des désinscriptions" };
const reasonFr: Record<string, string> = { MESSAGE_VOLUME_LOW: "Volume trop faible", SMTP_ERRORS_HIGH: "Erreurs SMTP élevées", SENDER_NOT_COMPLIANT: "Expéditeur non conforme", SPAM_RATE_HIGH: "Spam élevé", USER_FEEDBACK_NEGATIVE: "Retours négatifs", USER_FEEDBACK_LOW: "Peu de retours", USER_FEEDBACK_POSITIVE: "Retours positifs" };
const errFr: Record<string, string> = {
  reject: "Rejet", temp_fail: "Échec temporaire", bad_attachment: "Pièce jointe refusée", bad_or_missing_ptr_record: "PTR absent/invalide",
  ip_in_rbls: "IP en blacklist", low_domain_reputation: "Réputation domaine faible", low_ip_reputation: "Réputation IP faible", spammy_content: "Contenu spammy",
  stamp_policy_error: "Erreur politique STAMP", other: "Autre", anomalous_traffic_pattern: "Trafic anormal",
  RATE_LIMIT_EXCEEDED: "Limite de débit dépassée", SUSPECTED_SPAM: "Spam suspecté", CONTENT_SPAMMY: "Contenu spammy",
  BAD_ATTACHMENT: "Pièce jointe refusée", BAD_DMARC_POLICY: "Politique DMARC", LOW_IP_REPUTATION: "Réputation IP faible",
  LOW_DOMAIN_REPUTATION: "Réputation domaine faible", IP_IN_RBL: "IP en blacklist", DOMAIN_IN_RBL: "Domaine en blacklist", BAD_PTR_RECORD: "PTR invalide",
};

function Spark({ values, max }: { values: (number | null)[]; max?: number }) {
  const v = values.map((x) => x ?? 0);
  const m = max ?? Math.max(...v, 0.0001);
  if (!v.length) return <p className="text-xs text-muted-foreground">Aucune donnée</p>;
  return (
    <div className="flex h-16 items-end gap-[2px]">
      {v.map((x, i) => <div key={i} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${Math.max(3, (x / m) * 100)}%` }} title={`${(x * 100).toFixed(2)} %`} />)}
    </div>
  );
}

function GmailPostmaster() {
  const fetchDomains = useServerFn(getPostmasterDomains);
  const fetchStats = useServerFn(getPostmasterStats);
  const [info, setInfo] = useState<{ serviceEmail: string; domains: { name: string; permission: string | null; verified: boolean }[]; error: string | null } | null>(null);
  const [domain, setDomain] = useState("");
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats>([]);
  const [comp, setComp] = useState<Awaited<ReturnType<typeof getPostmasterStats>>["compliance"]>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDomains = () => fetchDomains().then((r) => { setInfo(r); if (!domain && r.domains[0]) setDomain(r.domains[0].name); }).catch((e) => setErr(e.message));
  useEffect(() => { loadDomains(); }, []);
  const load = () => {
    if (!domain) return;
    setLoading(true);
    fetchStats({ data: { domain, days } }).then((r) => { setStats(r.stats); setComp(r.compliance); setErr(r.error); }).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [domain, days]);
  useEffect(() => { const t = setInterval(load, 5 * 60_000); return () => clearInterval(t); }, [domain, days]);

  const last = stats[stats.length - 1];
  const avg = (k: "spf" | "dkim" | "dmarc" | "spamRate") => {
    const v = stats.map((s) => s[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const errors = useMemo(() => {
    const m = new Map<string, { cls: string; type: string; sum: number; n: number }>();
    for (const s of stats) for (const e of s.deliveryErrors) {
      const k = `${e.errorClass}/${e.errorType}`; const c = m.get(k) ?? { cls: e.errorClass, type: e.errorType, sum: 0, n: 0 };
      c.sum += e.errorRatio; c.n++; m.set(k, c);
    }
    return [...m.values()].sort((a, b) => b.sum - a.sum);
  }, [stats]);
  const fbl = useMemo(() => stats.flatMap((s) => s.feedbackLoops.map((f) => ({ ...f, date: s.date }))), [stats]);
  const spam = last?.spamRate ?? null;

  const exportCsv = () => {
    const head = "date,spam,domain_rep,spf,dkim,dmarc,tls_in,tls_out";
    const rows = stats.map((s) => [s.date, s.spamRate, s.domainReputation, s.spf, s.dkim, s.dmarc, s.inboundTls, s.outboundTls].join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head, ...rows].join("\n")], { type: "text/csv" }));
    a.download = `postmaster-${domain}.csv`; a.click();
  };

  return (
    <>
      <PageHeader title="Gmail Postmaster en direct" desc="Données officielles Google Postmaster Tools, actualisées toutes les 5 minutes."
        action={<div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!stats.length}><Download className="mr-1 h-4 w-4" />CSV</Button>
          <Button size="sm" onClick={() => { loadDomains(); load(); }} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser</Button>
        </div>} />

      <Panel title="Domaine et période">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={domain} onChange={(e) => setDomain(e.target.value)}>
            {!info?.domains.length && <option value="">Aucun domaine vérifié</option>}
            {info?.domains.map((d) => <option key={d.name} value={d.name}>{d.name} {d.permission ? `(${d.permission})` : ""}</option>)}
          </select>
          <div className="flex gap-1">
            {[7, 14, 30, 90, 120].map((d) => <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>{d} j</Button>)}
          </div>
        </div>
        {info?.domains.some((d) => !d.verified) && <p className="mt-2 text-xs text-muted-foreground">Certains domaines ne sont pas encore vérifiés.</p>}
        {(info?.error || err) && <p className="mt-2 text-sm text-destructive">{info?.error ?? err}</p>}
        {info && !info.domains.length && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ajoutez <b className="text-foreground">{info.serviceEmail}</b> comme utilisateur sur chaque domaine dans postmaster.google.com, et activez « Gmail Postmaster Tools API » dans Google Cloud.
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Taux de spam (dernier jour)" value={pct(spam, 2)} sub={spam == null ? "Aucune donnée publiée" : spam >= 0.003 ? "Seuil de 0,3 % atteint" : spam >= 0.001 ? "Au-dessus de la cible" : "Sous la cible"} />
        <Stat label="Statut de délivrabilité" value={stFr(comp?.deliverability.state)} sub={comp?.deliverability.reason ? reasonFr[comp.deliverability.reason] ?? comp.deliverability.reason : last?.date ?? ""} />
        <Stat label="SPF" value={pct(avg("spf"))} sub="moyenne période" />
        <Stat label="DKIM" value={pct(avg("dkim"))} sub="moyenne période" />
        <Stat label="DMARC" value={pct(avg("dmarc"))} sub="moyenne période" />
        <Stat label="TLS entrant / sortant" value={`${pct(last?.inboundTls, 0)} / ${pct(last?.outboundTls, 0)}`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Taux de spam signalé par les utilisateurs">
          <Spark values={stats.map((s) => s.spamRate)} max={Math.max(0.003, ...stats.map((s) => s.spamRate ?? 0))} />
          <p className="mt-1 text-xs text-muted-foreground">Google recommande de rester sous 0,1 % et demande un taux inférieur à 0,3 %. Intervalle du dernier jour {pct(last?.spamLow, 2)} – {pct(last?.spamHigh, 2)}.</p>
        </Panel>
        <Panel title="Conformité expéditeurs Gmail (exigences 2024+)">
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <Pill tone={stTone(comp?.oneClick.state)}>Désabonnement 1 clic : {stFr(comp?.oneClick.state)}</Pill>
            <Pill tone={stTone(comp?.honorUnsub.state)}>Respect désinscriptions : {stFr(comp?.honorUnsub.state)}</Pill>
          </div>
          <DataTable cols={["Exigence", "Domaine", "Sous-domaines"]}
            rows={(comp?.rows ?? []).map((r) => [reqFr[r.requirement] ?? r.requirement, <Pill tone={stTone(r.status)}>{stFr(r.status)}</Pill>,
              (() => { const x = comp?.subRows.find((y) => y.requirement === r.requirement); return x ? <Pill tone={stTone(x.status)}>{stFr(x.status)}</Pill> : "—"; })()])} />
        </Panel>
      </div>

      <Panel title="Authentification et chiffrement — détail quotidien">
        <DataTable cols={["Date", "Spam", "SPF", "DKIM", "DMARC", "TLS in", "TLS out"]}
          rows={[...stats].reverse().map((s) => [s.date, pct(s.spamRate, 2),
            pct(s.spf), pct(s.dkim), pct(s.dmarc), pct(s.inboundTls, 0), pct(s.outboundTls, 0)])} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Erreurs de distribution Gmail">
          <DataTable cols={["Type", "Classe", "Ratio moyen", ""]}
            rows={errors.map((e) => [errFr[e.type] ?? e.type, errFr[e.cls] ?? e.cls, pct(e.sum / e.n, 2), <Bar value={Math.min(100, (e.sum / e.n) * 100 * 10)} />])} />
        </Panel>
        <Panel title="Boucles de feedback (Feedback-ID) à fort spam">
          <DataTable cols={["Date", "Identifiant", "Taux de spam"]} rows={fbl.map((f) => [f.date, f.id, pct(f.spamRatio, 2)])} />
        </Panel>
      </div>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {spam != null && spam > 0.001 && <Pill tone="bad">Réduire le volume vers Gmail et nettoyer les inactifs</Pill>}
          {(avg("dmarc") ?? 1) < 0.98 && <Pill tone="warn">Vérifier l'alignement DMARC</Pill>}
          {(last?.outboundTls ?? 1) < 1 && <Pill tone="warn">Forcer TLS sortant</Pill>}
          {errors.length > 0 && <Pill tone="warn">Analyser les erreurs de distribution</Pill>}
          {stats.length > 0 && (spam ?? 0) <= 0.001 && <Pill tone="ok">Aucune action urgente</Pill>}
        </div>
      </Panel>
    </>
  );
}
