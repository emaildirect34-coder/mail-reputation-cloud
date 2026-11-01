import { createFileRoute, Link } from "@tanstack/react-router";
import bot from "@/assets/hermes-bot.png";
import netMap from "@/assets/net-map.jpg";
import { LuxHeader, LuxTabs, Kpi, Card, Ring, Pill, GhostBtn, Spark, toneVar, type Tone } from "@/components/dash/lux";
import {
  LayoutGrid, Activity, Bot, Server, Globe, FlaskConical, Rocket, Send, Gauge, CheckCircle2, ShieldCheck, Zap,
  Mail, Flame, ShieldAlert, ArrowRight, Boxes, Radio, Target, ScanLine, FileBarChart, KeyRound, Star,
} from "lucide-react";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Vue d'ensemble — Cockpit Email Direct" },
      { name: "description", content: "Métriques temps réel, réputation FAI, pools VMTA et activité Hermes AI." },
      { property: "og:title", content: "Vue d'ensemble — Cockpit Email Direct" },
      { property: "og:description", content: "Le tableau de bord temps réel de votre infrastructure d'envoi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Cockpit,
});

const tabs = [
  { label: "Vue d'ensemble", icon: LayoutGrid },
  { label: "Activité en direct", icon: Activity, to: "/dashboard/logs" },
  { label: "Infrastructure", icon: Server, to: "/dashboard/servers" },
  { label: "Domaines", icon: Globe, to: "/dashboard/domains" },
  { label: "Deliverability Lab", icon: FlaskConical, to: "/dashboard/lab" },
  { label: "Agent Hermes", icon: Bot, to: "/dashboard/agent" },
];

const isps: [string, number, string, Tone][] = [
  ["Gmail", 98.9, "M", "red"], ["Yahoo", 98.2, "Y!", "violet"], ["Microsoft", 97.6, "⊞", "blue"], ["Orange", 96.9, "o", "amber"], ["Free", 95.4, "f", "red"],
];
const pools: [string, string, number, Tone, typeof Zap][] = [
  ["Transactionnel", "2 VPS • 25 IPs", 98.7, "blue", Zap], ["Marketing Élite", "2 VPS • 32 IPs", 97.9, "violet", Mail],
  ["Warmup", "2 VPS • 20 IPs", 99.1, "green", Rocket], ["Quarantaine", "1 VPS • 8 IPs", 95.3, "amber", ShieldAlert],
];
const live: [string, string, Tone][] = [
  ["14:32:16", "IP 185.199.110.24 – +0.12% réputation", "green"],
  ["14:32:14", "Warmup : 12.5k emails envoyés", "blue"],
  ["14:32:12", "Gmail : +0.3% (98.7%)", "blue"],
  ["14:32:10", "Rotation IP sur Pool Marketing Élite", "blue"],
  ["14:32:08", "Délai de réessai Orange : 10 min", "amber"],
];
const compliance = ["SPF aligné (9 lookups)", "DKIM double (RSA + Ed25519)", "DMARC p=reject", "ARC (RFC 8617)", "MTA-STS enforce", "BIMI & VMC actifs"];
const quick: [string, string, typeof Zap][] = [
  ["Nouvelle campagne", "/dashboard/campaigns", Send], ["Testeur Inbox", "/dashboard/inbox-tester", FlaskConical],
  ["Mail-Tester", "/dashboard/lab", Star], ["Scanner liens", "/dashboard/preflight", ScanLine],
  ["Rapports DMARC", "/dashboard/postmaster", FileBarChart], ["Arrêt d'urgence", "/dashboard/shield", ShieldAlert],
];

const W = 520, H = 170;
const pts = (a: number[]) => a.map((v, i) => `${(i / (a.length - 1)) * W},${H - (v / 100) * H}`).join(" ");
const gmail = [88, 90, 89, 91, 92, 94, 98.9], global = [84, 85, 84, 87, 88, 90, 98.7];
const days = ["18/04", "19/04", "20/04", "21/04", "22/04", "23/04", "24/04"];

function Cockpit() {
  return (
    <>
      <LuxHeader crumb="Vue d'ensemble" icon={<Gauge />} title="Cockpit Email Direct" desc="Pilotez vos envois, votre infrastructure et votre réputation en temps réel." status="Tous les systèmes sont opérationnels" sub="Hermes AI surveille 24/7" />
      <LuxTabs tabs={tabs} active={0} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<Send />} label="Débit d'injection" value="48 732/s" sub="↑ +12%" tone="blue" spark />
        <Kpi icon={<Boxes />} label="Volume 24h" value="4.2M" sub="84% du quota" tone="violet" />
        <Kpi icon={<CheckCircle2 />} label="Délivrabilité" value="99.4%" sub="✓ Excellent" tone="green" spark />
        <Kpi icon={<Flame />} label="Plaintes Gmail" value="0.04%" sub="Objectif < 0.10%" tone="amber" />
        <Kpi icon={<ShieldCheck />} label="Score Mail-Tester" value="10/10" sub="✓ Parfait" tone="green" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1.35fr]">
        <Card title="Score de Réputation Global" icon={<ShieldCheck />}>
          <div className="flex items-center gap-4">
            <Ring value={98.7} size={160} stroke={13}>
              <div><p className="font-display text-[34px] font-extrabold text-primary">98.7%</p><p className="text-[14px] font-bold">Excellent</p></div>
            </Ring>
            <ul className="flex-1 space-y-3 text-[13px] font-semibold">
              {isps.slice(0, 4).map(([n, v, , t]) => (
                <li key={n} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" style={{ color: toneVar[t === "amber" ? "amber" : "green"] }} />{n}<span className="ml-auto">{v}%</span></li>
              ))}
            </ul>
          </div>
          <div className="mt-3 flex items-center justify-between"><span className="text-[14px] font-bold text-neon-green">↑ +0.3%</span><GhostBtn to="/dashboard/reputation">Voir le détail <ArrowRight className="h-3.5 w-3.5" /></GhostBtn></div>
        </Card>

        <Card title="Réputation par FAI" icon={<Target />}>
          <ul className="space-y-4">
            {isps.map(([n, v, l, t]) => (
              <li key={n} className="flex items-center gap-3 text-[13px] font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-md font-display text-[14px] font-black" style={{ color: toneVar[t], background: `color-mix(in oklab, ${toneVar[t]} 12%, var(--card))` }}>{l}</span>
                <span className="w-20">{n}</span>
                <div className="h-2.5 flex-1 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(v - 80) * 5}%`, background: "linear-gradient(90deg, var(--neon-green), color-mix(in oklab, var(--neon-green) 70%, var(--neon)))" }} /></div>
                <span className="w-12 text-right font-display text-[15px] font-bold text-primary">{v}%</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Évolution de la Réputation" icon={<Activity />} right={<div className="flex gap-1 text-[11px] font-semibold">{["24h", "7j", "30j", "90j"].map((p) => <span key={p} className={`rounded-lg px-2.5 py-1 ${p === "7j" ? "bg-primary text-primary-foreground" : "card-lux"}`}>{p}</span>)}</div>}>
          <div className="mb-1 flex gap-4 text-[12px] font-semibold"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-neon-2" />Global</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-neon-green" />Gmail</span></div>
          <svg viewBox={`-30 -10 ${W + 40} ${H + 30}`} className="h-[200px] w-full">
            {[0, 25, 50, 75, 100].map((y) => <g key={y}><line x1={0} x2={W} y1={H - (y / 100) * H} y2={H - (y / 100) * H} stroke="var(--border)" /><text x={-6} y={H - (y / 100) * H + 4} fontSize="10" textAnchor="end" fill="var(--foreground)">{y}%</text></g>)}
            {days.map((d, i) => <text key={d} x={(i / 6) * W} y={H + 16} fontSize="10" textAnchor="middle" fill="var(--foreground)">{d}</text>)}
            <polygon points={`0,${H} ${pts(global)} ${W},${H}`} fill="color-mix(in oklab, var(--neon-2) 12%, transparent)" />
            <polyline points={pts(global)} fill="none" stroke="var(--neon-2)" strokeWidth="2.5" />
            <polyline points={pts(gmail)} fill="none" stroke="var(--neon-green)" strokeWidth="2.5" strokeDasharray="6 4" />
            {global.map((v, i) => <circle key={i} cx={(i / 6) * W} cy={H - (v / 100) * H} r="3.5" fill="var(--card)" stroke="var(--neon-2)" strokeWidth="2" />)}
          </svg>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.25fr_1fr_1fr]">
        <Card title="Pools VMTA" icon={<Boxes />} right={<GhostBtn to="/dashboard/pools">Gérer <ArrowRight className="h-3.5 w-3.5" /></GhostBtn>}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {pools.map(([n, d, v, t, I]) => (
              <div key={n} className="rounded-xl p-3 text-center" style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${toneVar[t]} 14%, var(--card)), var(--card))`, border: `1px solid color-mix(in oklab, ${toneVar[t]} 30%, transparent)` }}>
                <I className="mx-auto h-8 w-8" style={{ color: toneVar[t] }} />
                <p className="mt-2 text-[13px] font-bold">{n}</p>
                <p className="mt-2 text-[11.5px] font-semibold">{d}</p>
                <p className="mt-3 flex items-center justify-center gap-1.5 font-display text-[18px] font-extrabold text-primary"><i className="h-2.5 w-2.5 rounded-full bg-neon-green" />{v}%</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Activité en Temps Réel" icon={<Radio />} right={<Pill>● LIVE</Pill>}>
          <ul className="divide-y divide-border">
            {live.map(([t, l, c]) => (
              <li key={t} className="flex items-center gap-3 py-2 text-[12.5px] font-medium">
                <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: toneVar[c] }} /><span className="w-16 text-muted-foreground">{t}</span><span className="truncate">{l}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-center"><GhostBtn to="/dashboard/logs">Voir tous les événements <ArrowRight className="h-3.5 w-3.5" /></GhostBtn></div>
        </Card>

        <Card title="Hermes SRE & Postmaster" icon={<Bot />} right={<Pill>✓ En ligne</Pill>}>
          <div className="flex items-center gap-3">
            <img src={bot} alt="Hermes AI" width={816} height={816} className="h-28 w-28 shrink-0 drop-shadow-[0_10px_20px_var(--neon-2)]" />
            <ul className="space-y-2 text-[12.5px] font-semibold">
              {["Surveillance SMTP : OK", "Adaptation automatique : OK", "Optimisation des débits : OK", "Protection anti-bounce : OK"].map((s) => (
                <li key={s} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-neon-green" />{s}</li>
              ))}
            </ul>
          </div>
          <div className="mt-3 text-center"><GhostBtn to="/dashboard/agent">Voir les actions IA <ArrowRight className="h-3.5 w-3.5" /></GhostBtn></div>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_1.3fr_1fr]">
        <Card title="Conformité Cryptographique" icon={<KeyRound />} right={<Pill>100%</Pill>}>
          <ul className="space-y-2">
            {compliance.map((c) => (
              <li key={c} className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-[12.5px] font-semibold"><CheckCircle2 className="h-4 w-4 text-neon-green" />{c}<span className="ml-auto"><Pill>Validé</Pill></span></li>
            ))}
          </ul>
        </Card>

        <Card title="Carte Réseau des Envois" icon={<Globe />} right={<Pill tone="blue">Vue temps réel</Pill>}>
          <div className="relative overflow-hidden rounded-xl">
            <img src={netMap} alt="Carte réseau mondiale" width={1280} height={640} loading="lazy" className="h-[220px] w-full object-cover" />
            <div className="lux-banner absolute right-3 top-3 rounded-xl px-4 py-3 text-[12px] font-semibold">
              <p className="mb-1 font-bold">Paris (FR)</p>
              <p>Gmail : <span className="text-neon-green">99.1%</span></p>
              <p>Débit : 12.4k msg/s</p>
              <p className="mt-2"><Pill>● En ligne</Pill></p>
            </div>
          </div>
        </Card>

        <Card title="Actions Rapides" icon={<Rocket />}>
          <div className="grid grid-cols-3 gap-2">
            {quick.map(([l, to, I]) => (
              <Link key={l} to={to} className="card-lux flex flex-col items-center gap-2 px-2 py-3 text-center text-[11.5px] font-bold text-primary transition hover:-translate-y-0.5">
                <I className="h-7 w-7" />{l}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="lux-banner flex items-center justify-center gap-3 rounded-2xl px-5 py-3 text-[13px] font-semibold">
        <ShieldCheck className="h-6 w-6 text-neon-green" />
        Votre infrastructure est parfaitement sécurisée et conforme aux exigences de Gmail et Yahoo.
        <Spark className="ml-2 hidden h-6 w-20 md:block" />
      </div>
    </>
  );
}
