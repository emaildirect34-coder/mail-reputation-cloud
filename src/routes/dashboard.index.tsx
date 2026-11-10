import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import hero from "@/assets/cockpit-hero.jpg.asset.json";
import worldMap from "@/assets/world-map.jpg.asset.json";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { readCockpitInventory, readCockpitTraffic } from "@/lib/cockpit.functions";
import { Button } from "@/components/ui/button";
import { Ring, Spark, smoothPath } from "@/components/dash/lux";
import { BadgeCheck, Bot, Boxes, CheckCircle2, ChevronRight, CircleDot, Globe, Mail, Radio, Recycle, Send, ShieldCheck, Star, Target, UserRound, Zap } from "lucide-react";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [
    { title: "Tableau de bord — Email Direct" },
    { name: "description", content: "Cockpit Email Direct : performance Gmail, activité Atlas IA, pools VMTA et conformité des envois." },
    { property: "og:title", content: "Tableau de bord — Email Direct" },
    { property: "og:description", content: "Performance des envois, réputation Gmail et supervision de votre infrastructure email." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }), component: Cockpit,
});

function Widget({ title, icon, action, children, className = "" }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`cockpit-widget ${className}`}><div className="cockpit-widget-heading"><span className="cockpit-widget-icon">{icon}</span><h2>{title}</h2><div className="ml-auto">{action}</div></div>{children}</section>;
}
function Detail({ to, children = "Voir le détail" }: { to: string; children?: ReactNode }) {
  return <Button asChild variant="outline" size="sm" className="cockpit-detail"><Link to={to}>{children}<ChevronRight /></Link></Button>;
}
type Period = "24h" | "7j";
type Point = { t: string; d: number | null; c: number | null };
const integer = new Intl.NumberFormat("fr-FR");
const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const fmt = (value: number | null | undefined) => value == null ? "—" : integer.format(value);
const percent = (part: number, total: number) => total > 0 ? 100 * part / total : null;
const pct = (value: number | null) => value == null ? "—" : value.toFixed(2).replace(".", ",") + " %";
const clock = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" });
const types: Record<string, [string, string]> = {
  delivered: ["Acceptation SMTP", "green"], bounce: ["Rebond", "red"],
  deferred: ["Report temporaire", "blue"], complaint: ["Plainte", "violet"],
};

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[10px] text-muted-foreground">{children}</p>;
}

function MeasuredSpark({ values, className, tone }: { values: (number | null)[]; className: string; tone: "blue" | "violet" | "green" }) {
  return values.length > 1 && values.every(value => value !== null)
    ? <Spark values={values as number[]} className={className} tone={tone} />
    : <div className={className} aria-hidden />;
}

function Chart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 380, TOP = 12, BOT = 128, VX = -36, VW = 454;
  const step = W / Math.max(1, data.length - 1);
  const delivery = data.flatMap(point => point.d === null ? [] : [point.d]);
  const complaints = data.flatMap(point => point.c === null ? [] : [point.c]);
  const lo = delivery.length ? Math.max(0, Math.floor((Math.min(...delivery) - 0.05) / 5) * 5) : 0;
  const right = Math.max(0.12, ...complaints.map(value => value * 1.12));
  const y = (value: number) => BOT - (value - lo) / (100 - lo) * (BOT - TOP);
  const yc = (value: number) => BOT - value / right * (BOT - TOP);
  function segments(key: "d" | "c", axis: (value: number) => number) {
    const result: [number, number][][] = [];
    let run: [number, number][] = [];
    data.forEach((point, index) => {
      const value = point[key];
      if (value !== null) run.push([index * step, axis(value)]);
      else if (run.length) { result.push(run); run = []; }
    });
    if (run.length) result.push(run);
    return result;
  }
  const a = hover ?? data.reduce((last, point, index) => point.d !== null || point.c !== null ? index : last, -1);
  const cur = data[a];
  const x = a * step;
  return <svg className="cockpit-chart" viewBox={VX + " 0 " + VW + " 150"} role="img" aria-label="Acceptations SMTP et plaintes observées chez Gmail"
    onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      setHover(Math.max(0, Math.min(data.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * VW + VX) / step))));
    }} onPointerLeave={() => setHover(null)}>
    <defs><linearGradient id="gmailFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--neon-green)" stopOpacity=".24" /><stop offset="100%" stopColor="var(--neon-green)" stopOpacity="0" /></linearGradient></defs>
    {[lo, (lo + 100) / 2, 100].map(value => <g key={value}><line x1="0" x2={W} y1={y(value)} y2={y(value)} stroke="var(--border)" strokeDasharray="2 4" /><text x="-6" y={y(value) + 3} fontSize="8" textAnchor="end" fill="var(--muted-foreground)">{value} %</text></g>)}
    {[0, right / 2, right].map(value => <text key={value} x={W + 6} y={yc(value) + 3} fontSize="7.5" fill="var(--neon-violet)">{pct(value)}</text>)}
    <line x1="0" x2={W} y1={yc(0.1)} y2={yc(0.1)} stroke="var(--neon-red)" strokeOpacity=".55" strokeDasharray="5 4" />
    <text x="4" y={yc(0.1) - 3} fontSize="7" fill="var(--neon-red)">Repère 0,10 %</text>
    {segments("d", y).map(points => points.length > 1
      ? <g key={points[0]![0]}><path d={smoothPath(points) + " L" + points.at(-1)![0] + " " + BOT + " L" + points[0]![0] + " " + BOT + " Z"} fill="url(#gmailFill)" /><path d={smoothPath(points)} fill="none" stroke="var(--neon-green)" strokeWidth="2.2" /></g>
      : <circle key={points[0]![0]} cx={points[0]![0]} cy={points[0]![1]} r="3" fill="var(--neon-green)" />)}
    {segments("c", yc).map(points => points.length > 1
      ? <path key={points[0]![0]} d={smoothPath(points)} fill="none" stroke="var(--neon-violet)" strokeWidth="1.5" strokeDasharray="4 3" />
      : <circle key={points[0]![0]} cx={points[0]![0]} cy={points[0]![1]} r="2" fill="var(--neon-violet)" />)}
    {data.map((point, index) => <text key={index} x={index * step} y="144" fontSize="8" textAnchor="middle" fill={index === a ? "var(--primary)" : "var(--muted-foreground)"}>{point.t}</text>)}
    {cur && <g pointerEvents="none">
      <line x1={x} x2={x} y1={TOP} y2={BOT} stroke="var(--primary)" strokeOpacity=".35" strokeDasharray="2 3" />
      {cur.d !== null && <circle cx={x} cy={y(cur.d)} r="4" fill="var(--card)" stroke="var(--neon-green)" strokeWidth="2.2" />}
      {cur.c !== null && <circle cx={x} cy={yc(cur.c)} r="3" fill="var(--card)" stroke="var(--neon-violet)" strokeWidth="1.6" />}
      <g transform={"translate(" + Math.min(Math.max(x - 52, 0), W - 117) + " 47)"}>
        <rect width="117" height="38" rx="6" fill="var(--primary)" />
        <text x="8" y="12" fontSize="7.5" fill="var(--primary-foreground)">{cur.t} UTC</text>
        <text x="8" y="23" fontSize="8.5" fill="var(--primary-foreground)">Acceptés {pct(cur.d)}</text>
        <text x="8" y="33" fontSize="8" fill="var(--primary-foreground)">Plaintes {pct(cur.c)}</text>
      </g>
    </g>}
    {a < 0 && <text x={W / 2} y="72" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">Aucun résultat SMTP Gmail sur cette période</text>}
  </svg>;
}

function Cockpit() {
  const [period, setPeriod] = useState<Period>("24h");
  const traffic = useServerFn(readCockpitTraffic);
  const inventory = useServerFn(readCockpitInventory);
  const telemetry = useQuery({ queryKey: ["cockpit-traffic", period], queryFn: () => traffic({ data: period }), refetchInterval: 120_000, retry: false });
  const inventoryQuery = useQuery({ queryKey: ["cockpit-inventory"], queryFn: () => inventory(), refetchInterval: 120_000, retry: false });
  const data = telemetry.data, stock = inventoryQuery.data;
  const buckets = data?.buckets ?? [];
  const total = (key: "accepted" | "bounced" | "gmailAccepted" | "gmailBounced" | "gmailComplaints") => buckets.reduce((sum, row) => sum + row[key], 0);
  const outcomes = total("accepted") + total("bounced"), gmailOutcomes = total("gmailAccepted") + total("gmailBounced");
  const global = percent(total("accepted"), outcomes);
  const gmail = percent(total("gmailAccepted"), gmailOutcomes);
  const gmailComplaint = percent(total("gmailComplaints"), total("gmailAccepted"));
  const series = buckets.map(row => ({ t: (period === "24h" ? clock : day).format(new Date(row.from)),
    d: percent(row.gmailAccepted, row.gmailAccepted + row.gmailBounced), c: percent(row.gmailComplaints, row.gmailAccepted) }));
  const globalSeries = buckets.map(row => percent(row.accepted, row.accepted + row.bounced));
  const revenue = stock?.revenues?.at(-1);
  const placement = { inbox: 0, promotions: 0, spam: 0, missing: 0 };
  const since = Date.now() - (period === "24h" ? 24 : 168) * 3_600_000;
  for (const probe of stock?.placement ?? []) {
    if (!probe.observed_at || Date.parse(probe.observed_at) < since || !Array.isArray(probe.seeds)) continue;
    for (const seed of probe.seeds) {
      if (!seed || typeof seed !== "object" || Array.isArray(seed) || typeof seed["address"] !== "string" || !/@(?:gmail|googlemail)\.com$/i.test(seed["address"])) continue;
      const location = seed["placement"];
      if (location === "inbox" || location === "promotions" || location === "spam" || location === "missing") placement[location]++;
    }
  }
  const seedCount = Object.values(placement).reduce((sum, count) => sum + count, 0);
  const domains = ["spf", "dkim_a", "dkim_b", "dmarc", "mta_sts", "tls_rpt"].map(key => {
    let ok = 0, checked = 0;
    for (const record of stock?.domains ?? []) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const check = record[key];
      if (!check || typeof check !== "object" || Array.isArray(check) || typeof check["ok"] !== "boolean") continue;
      checked++;
      if (check["ok"]) ok++;
    }
    return { key, ok, checked };
  });
  const checked = domains.reduce((sum, domain) => sum + domain.checked, 0);
  const compliance = percent(domains.reduce((sum, domain) => sum + domain.ok, 0), checked);
  const metrics = [
    { title: "Débit d’injection", value: data ? (data.minute / 60).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "—", unit: "msg/s", sub: "Dernière minute", icon: Send, tone: "blue", spark: buckets.map(row => row.injected) },
    { title: "Volume 24h", value: fmt(data?.volume), unit: "", sub: "Messages injectés", icon: Mail, tone: "blue" },
    { title: "Acceptation SMTP globale", value: pct(global), unit: "", sub: period, icon: Target, tone: "violet", spark: globalSeries },
    { title: "Taux de rebond définitif", value: pct(percent(total("bounced"), outcomes)), unit: "", sub: period, icon: Recycle, tone: "green", spark: buckets.map(row => percent(row.bounced, row.accepted + row.bounced)) },
    { title: "Désabonnements", value: fmt(data?.unsubscribed), unit: "", sub: period, icon: UserRound, tone: "blue" },
    { title: "Score Mail-Tester", value: "—", unit: "", sub: "Consulter les tests", icon: Star, tone: "green" },
  ] as const;
  return <div className="cockpit-content">
    {telemetry.error && <p role="alert" className="text-sm text-destructive">{telemetry.error.message}</p>}
    {inventoryQuery.error && <p role="alert" className="text-sm text-destructive">Les données d’inventaire sont indisponibles.</p>}
    <div className="cockpit-hero-grid">
      <section className="cockpit-welcome">
        <img src={hero.url} alt="Vaisseau Email Direct devant une planète illuminée" className="cockpit-hero-image" />
        <div className="cockpit-welcome-copy"><p className="text-xs">👋 Bonjour,</p><h1>Email Direct <BadgeCheck className="inline h-6 w-6 text-neon-amber" /></h1><p className="text-sm">Votre infrastructure d’envoi nouvelle génération</p>
          <div className="mt-5 flex flex-wrap gap-2"><Button asChild size="sm" className="cockpit-hero-secondary"><Link to="/dashboard/logs/smtp"><CircleDot />Voir les rapports</Link></Button><Button asChild size="sm" variant="secondary" className="cockpit-hero-primary"><Link to="/dashboard/campaigns/new"><Boxes />Configurer une campagne</Link></Button></div>
        </div>
      </section>
      <section className="cockpit-summary"><h2>Performance globale</h2><div className="flex items-center gap-2"><Ring value={global ?? 0} size={112} stroke={10}><div><p className="text-xl font-extrabold text-primary">{pct(global)}</p><p className="text-xs">SMTP accepté</p></div></Ring><div className="min-w-0 flex-1"><MeasuredSpark values={globalSeries} className="h-16 w-full" tone="blue" /><p className="text-[9px] text-muted-foreground">{period} · {data ? fmt(outcomes) + " résultats SMTP" : "Chargement des mesures"}</p></div></div></section>
      <section className="cockpit-summary cockpit-revenue"><h2>Revenu aujourd’hui</h2><p className="mt-3 text-2xl font-extrabold text-primary">{revenue === undefined ? "—" : money.format(revenue)}</p><p className="mt-1 text-[10px] text-muted-foreground">Revenus approuvés en EUR · UTC</p><MeasuredSpark values={stock?.revenues ?? []} className="absolute right-4 top-9 h-12 w-24" tone="green" /><div className="mt-4 grid grid-cols-2 divide-x divide-border text-[11px]"><div>Emails injectés · 24h<p className="text-base font-bold text-primary">{fmt(data?.volume)}</p></div><div className="pl-3">Campagnes en cours<p className="text-base font-bold text-primary">{fmt(stock?.campaigns)}</p></div></div></section>
    </div>
    <div className="cockpit-kpis">{metrics.map(m => <section className="cockpit-metric" key={m.title}><span className={"cockpit-metric-icon cockpit-tone-" + m.tone}><m.icon /></span><div className="min-w-0"><h2>{m.title}</h2><p className="cockpit-metric-value">{m.value} <span className="text-[10px]">{m.unit}</span></p><p className="text-[10px] text-muted-foreground">{m.sub}</p></div>{"spark" in m && <MeasuredSpark values={m.spark} tone={m.tone} className="cockpit-metric-spark" />}</section>)}</div>
    <div className="cockpit-primary-grid">
      <Widget title="Performance Gmail" icon={<Mail />} action={<span className="cockpit-chip">Gmail</span>} className="cockpit-gmail">
        <div className="cockpit-gmail-inner"><div className="text-center"><Ring value={gmail ?? 0} size={136} stroke={11}><div><p className="text-2xl font-extrabold text-primary">{pct(gmail)}</p><p className="text-[10px]">SMTP accepté</p></div></Ring><span className="cockpit-chip">{fmt(data ? gmailOutcomes : null)} résultats SMTP</span></div>
          <div className="cockpit-gmail-stats">{[["Acceptation SMTP", pct(gmail)], ["Plaintes observées", pct(gmailComplaint)], ["Rebonds définitifs", pct(percent(total("gmailBounced"), gmailOutcomes))]].map(([label, value]) => <div key={label} className="flex gap-2"><ShieldCheck className="h-7 w-7 shrink-0 rounded-lg bg-primary/5 p-1.5 text-primary" /><div><p className="text-[10px] text-muted-foreground">{label}</p><b className="text-xs text-primary">{value}</b></div></div>)}<Detail to="/dashboard/gmail-postmaster" /></div>
          <div className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-2 text-[10px]"><b>Tendance SMTP (Gmail)</b><div className="flex gap-2"><span className="text-neon-green">● Acceptés</span><span className="text-neon-violet">● Plaintes</span></div></div><Chart key={period} data={series} /><div className="flex justify-end gap-1">{(["24h", "7j"] as const).map(p => <Button key={p} variant={period === p ? "secondary" : "ghost"} size="sm" className="h-5 px-2 text-[9px]" onClick={() => setPeriod(p)} aria-pressed={period === p}>{p}</Button>)}</div></div>
        </div>
      </Widget>
      <Widget title="Activité Atlas IA" icon={<Bot />}><Empty>Historique des actions indisponible.</Empty><Detail to="/dashboard/agent">Ouvrir Atlas IA</Detail></Widget>
    </div>
    <div className="cockpit-secondary-grid">
      <Widget title="Répartition des ouvertures par pays" icon={<Globe />} action={<span className="cockpit-chip">● {period}</span>}><div className="cockpit-geography"><img src={worldMap.url} alt="Carte mondiale" /><ul><li><Empty>Pays non mesurés.</Empty></li></ul></div><div className="flex items-end justify-between gap-2"><div className="text-[10px] text-muted-foreground">Messages avec ouverture enregistrée<p className="text-sm font-bold text-primary">{fmt(data?.opened)}</p></div><Detail to="/dashboard/postmaster" /></div></Widget>
      <Widget title="État des services Gmail" icon={<Mail />}><div className="flex items-center gap-3"><ul className="flex-1 space-y-3 text-[10px]">{[["Acceptations SMTP", fmt(data ? total("gmailAccepted") : null)], ["Plaintes enregistrées", fmt(data ? total("gmailComplaints") : null)], ["Rebonds définitifs", fmt(data ? total("gmailBounced") : null)]].map(([label, value]) => <li key={label} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" /><span>{label}</span><b className="ml-auto">{value}</b></li>)}</ul><div className="w-28 shrink-0 text-center"><Ring value={gmail ?? 0} size={105} stroke={9} tone="blue"><div><b className="text-lg text-primary">{pct(gmail)}</b><p className="text-[9px]">SMTP accepté</p></div></Ring><MeasuredSpark values={series.map(point => point.d)} className="mt-3 h-8 w-full" tone="green" /></div></div></Widget>
      <Widget title="Pools VMTA & IPs" icon={<Boxes />} action={<span className="cockpit-chip">{fmt(stock?.ipCount)} IP actives</span>}><div className="cockpit-pools">{stock?.pools?.map((pool, index) => <div key={pool.name} className={"cockpit-pool cockpit-tone-" + (["green", "blue", "violet"][index] ?? "blue")}><p className="flex items-center gap-1 font-bold"><ShieldCheck className="h-3 w-3" />{pool.name}</p><p className="mt-1 text-[9px] text-muted-foreground">{pool.usable}/{pool.assigned} IP hors quarantaine</p><Ring value={percent(pool.usable, pool.assigned) ?? 0} size={78} stroke={7} tone={index === 0 ? "green" : "blue"}><b className="text-primary">{pct(percent(pool.usable, pool.assigned))}</b></Ring></div>)}</div>{!stock?.pools?.length && <Empty>{stock?.pools ? "Aucun pool actif." : "Inventaire indisponible."}</Empty>}<Detail to="/dashboard/pools">Gestion des IPs</Detail></Widget>
    </div>
    <div className="cockpit-bottom-grid">
      <Widget title="Placement des boîtes témoins Gmail" icon={<Target />} action={<span className="cockpit-chip">{period}</span>}><div className="flex items-center gap-4"><Ring value={percent(placement.inbox, seedCount) ?? 0} size={92} stroke={9} tone="blue"><div><b className="text-base text-primary">{pct(percent(placement.inbox, seedCount))}</b><p className="text-[9px]">Réception</p></div></Ring><ul className="flex-1 space-y-2 text-[10px]">{[["Réception", placement.inbox], ["Promotions", placement.promotions], ["Spam", placement.spam], ["Non reçu", placement.missing]].map(([label, value]) => <li key={label} className="flex items-center gap-2"><CircleDot className="h-3 w-3 text-primary" /><span>{label}</span><b className="ml-auto">{seedCount ? value : "—"}</b></li>)}</ul></div><Empty>{seedCount ? seedCount + " résultats témoins parmi les 30 derniers tests suivis." : "Aucun résultat témoin Gmail sur cette période."}</Empty></Widget>
      <Widget title="Flux d’événements récents" icon={<Radio />} action={<Detail to="/dashboard/logs">Voir tout</Detail>}><ul className="cockpit-flow">{data?.recent.map(event => { const [label, tone] = types[event.event_type] ?? [event.event_type, "blue"]; return <li key={event.id}><time dateTime={event.occurred_at}>{clock.format(new Date(event.occurred_at))}</time><span className={"cockpit-flow-dot cockpit-tone-" + tone}><Zap className="h-2.5 w-2.5" /></span><span className="min-w-0 flex-1 truncate">{label}{event.smtp_code ? " · " + event.smtp_code : ""}</span><span className="cockpit-chip">{event.isp}</span></li>; })}</ul>{!data?.recent.length && <Empty>Aucun événement chargé.</Empty>}</Widget>
      <Widget title="Conformité & Sécurité" icon={<ShieldCheck />}><div className="flex items-center gap-3"><Ring value={compliance ?? 0} size={92} stroke={9}><div><b className="text-lg text-primary">{pct(compliance)}</b><p className="text-[9px]">Contrôles DNS</p></div></Ring><ul className="flex-1 space-y-1 text-[9px]">{domains.map(({ key, ok, checked: count }, index) => <li className="flex items-center gap-1" key={key}><CircleDot className="h-2.5 w-2.5 text-primary" /><span>{["SPF", "DKIM A", "DKIM B", "DMARC", "MTA-STS", "TLS-RPT"][index]}</span><span className="ml-auto text-primary">{count ? ok + "/" + count : "—"}</span></li>)}</ul></div><Detail to="/dashboard/domains" /></Widget>
      <Widget title="Actions rapides" icon={<Zap />}><div className="flex flex-wrap gap-2"><Detail to="/dashboard/campaigns/new">Configurer une campagne</Detail><Detail to="/dashboard/logs/smtp">Voir les rapports</Detail><Detail to="/dashboard/preflight">Lancer un préflight</Detail><Detail to="/dashboard/agent">Ouvrir Atlas IA</Detail></div></Widget>
    </div>
  </div>;
}
