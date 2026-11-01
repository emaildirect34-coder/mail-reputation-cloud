import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import hermes from "@/assets/hermes.jpg.asset.json";
import ship from "@/assets/ship.jpg.asset.json";
import worldMap from "@/assets/world-map.jpg.asset.json";
import {
  ArrowRight, Bot, Package, CheckCircle2, ArrowUp, ArrowDown, Star, Boxes, Mail, Database, Timer,
  FlaskConical, Rocket, Target, ShieldAlert, ScanLine, FileBarChart, Sparkles, ShieldCheck, ChevronDown,
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

/* ---------- small primitives ---------- */
type Tone = "neon" | "green" | "violet" | "amber" | "red";
const toneVar: Record<Tone, string> = {
  neon: "var(--neon)", green: "var(--neon-green)", violet: "var(--neon-violet)", amber: "var(--neon-amber)", red: "var(--neon-red)",
};

function Ring({ value, size = 56, stroke = 5, tone = "neon", children, gradient }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode; gradient?: boolean }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, id = `g${size}${value}${tone}`;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {gradient && <defs><linearGradient id={id}><stop offset="0%" stopColor="var(--neon-green)" /><stop offset="100%" stopColor="var(--neon)" /></linearGradient></defs>}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={gradient ? `url(#${id})` : toneVar[tone]} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} style={{ filter: `drop-shadow(0 0 6px ${toneVar[tone]})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

function Bar({ value, tone = "green" }: { value: number; tone?: Tone }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${value}%`, background: `linear-gradient(90deg, var(--neon), ${toneVar[tone]})`, boxShadow: `0 0 8px ${toneVar[tone]}` }} />
    </div>
  );
}

function Spark({ d = "M0 22 L10 18 L18 20 L26 12 L34 16 L42 10 L50 14 L58 8 L66 12 L74 6 L82 10 L90 4 L100 7", className = "" }) {
  return (
    <svg viewBox="0 0 100 26" preserveAspectRatio="none" className={className}>
      <path d={d} fill="none" stroke="var(--neon-green)" strokeWidth="1.6" style={{ filter: "drop-shadow(0 0 3px var(--neon-green))" }} />
    </svg>
  );
}

function IconBadge({ children, tone = "neon" }: { children: ReactNode; tone?: Tone }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: toneVar[tone], color: toneVar[tone], boxShadow: `0 0 12px ${toneVar[tone]}`, background: `color-mix(in oklab, ${toneVar[tone]} 15%, transparent)` }}>
      {children}
    </div>
  );
}

function Title({ icon, children, right }: { icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-neon">{icon}</span>
      <h2 className="font-display text-[13px] font-semibold uppercase tracking-wide">{children}</h2>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

const dot = (t: Tone) => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: toneVar[t], boxShadow: `0 0 6px ${toneVar[t]}` }} />;

/* ---------- data ---------- */
const actions: [string, string, Tone][] = [
  ["14:28", "IP 178.62.x.x promue dans le Pool Gold", "neon"],
  ["14:20", "Adaptation du pacing Orange (1 connexion)", "neon"],
  ["14:05", "142 adresses inactives mises en sunset", "violet"],
  ["13:47", "Double DKIM Ed25519 validé sur 4 domaines", "green"],
  ["12:32", "Alerte résolue : greylisting (Google)", "green"],
];
const events: [string, string, string, Tone][] = [
  ["14:28", "IP 178.62.x.x promue dans le Pool Gold", "Infrastructure", "neon"],
  ["14:20", "Adaptation du pacing Orange (1 connexion)", "Deliverability", "neon"],
  ["14:05", "142 adresses inactives mises en sunset", "Hygiène", "violet"],
  ["13:47", "Double DKIM Ed25519 validé sur 4 domaines", "Sécurité", "neon"],
  ["12:32", "Alerte résolue : greylisting (Google)", "Deliverability", "amber"],
  ["11:58", "Rapport DMARC traité (RUA)", "Conformité", "green"],
];
const isps = [
  { n: "Google / Gmail", v: 99.8, s: "Boîte principale", logo: "G", c: "neon" as Tone, dot: "green" as Tone },
  { n: "Microsoft 365 / Outlook", v: 98.6, s: "SNDS Vert", logo: "M", c: "amber" as Tone, dot: "green" as Tone },
  { n: "Yahoo / AOL", v: 99.2, s: "Auth 100%", logo: "Y", c: "violet" as Tone, dot: "green" as Tone },
  { n: "Orange / SFR / Free", v: 97.4, s: "Pacing actif", logo: "O", c: "red" as Tone, dot: "amber" as Tone },
];
const domains: [string, number][] = [["transac.com", 99.8], ["news.com", 99.2], ["promo.com", 98.7], ["notif.com", 99.6]];
const compliance = ["SPF (10 lookup max)", "DKIM (RSA-2048 + Ed25519)", "DMARC (p=none)", "ARC (RFC 8617)", "MTA-STS (RFC 8461)", "TLS-RPT (RFC 8460)", "DANE / TLSA (RFC 6698)", "BIMI & VMC"];
const tools = [
  { t: "Testeur Inbox", d: "Scorer 10/10", to: "/dashboard/inbox-tester", icon: FlaskConical, c: "violet" as Tone },
  { t: "Mail-Tester", d: "Analyse complète", to: "/dashboard/lab", icon: Rocket, c: "neon" as Tone },
  { t: "DNS Lab", d: "Vérifier vos domaines", to: "/dashboard/lab", icon: Target, c: "neon" as Tone },
  { t: "Bouclier & Urgence", d: "Tout geler", to: "/dashboard/shield", icon: ShieldAlert, c: "red" as Tone },
  { t: "Scanner de liens", d: "Sponsors / Phishing", to: "/dashboard/preflight", icon: ScanLine, c: "neon" as Tone },
  { t: "Rapports DMARC", d: "RUA / RUF", to: "/dashboard/postmaster", icon: FileBarChart, c: "neon" as Tone },
] as const;

/* ---------- page ---------- */
function Cockpit() {
  return (
    <>
      {/* HERO */}
      <section className="glass relative overflow-hidden p-0">
        <div className="grid items-stretch gap-0 xl:grid-cols-[1fr_360px_300px]">
          <div className="flex items-center gap-5 p-4">
            <img src={hermes.url} alt="Hermes AI" className="h-[170px] w-[170px] shrink-0 rounded-xl object-cover [mask-image:radial-gradient(circle,black_60%,transparent_75%)]" />
            <div>
              <div className="flex items-center gap-3">
                <h2 className="neon-text font-display text-2xl font-bold text-neon">HERMES AI</h2>
                <span className="rounded-md bg-neon-violet/25 px-2 py-0.5 text-[10px] font-semibold ring-1 ring-neon-violet">ACTIF • 24/7</span>
              </div>
              <p className="mt-2 text-[15px] font-medium">Votre agent SRE & Postmaster intelligent</p>
              <p className="mt-3 text-sm text-foreground/85">Analyse <span className="mx-1.5 text-neon">•</span> Surveille <span className="mx-1.5 text-neon">•</span> Protège <span className="mx-1.5 text-neon">•</span> Optimise</p>
              <Link to="/dashboard/agent" className="mt-5 inline-flex items-center gap-2 rounded-full border border-neon/60 px-4 py-1.5 text-xs font-medium hover:bg-neon/10">
                Voir l'activité <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div className="m-3 rounded-lg border border-glass-border bg-background/40 p-4">
            <p className="mb-2 text-[13px] font-semibold">Dernières actions</p>
            <ul className="divide-y divide-glass-border">
              {actions.map(([t, l, c]) => (
                <li key={t} className="flex items-center gap-3 py-[7px] text-[12px]">
                  <span className="w-10 text-muted-foreground">{t}</span>{dot(c)}<span className="truncate">{l}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative hidden min-h-[180px] xl:block">
            <img src={ship.url} alt="Vaisseau Email Direct" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute bottom-4 right-4 text-right">
              <p className="neon-text font-display text-lg font-bold">Email Direct</p>
              <p className="text-[11px] text-foreground/85">Plus loin. Plus vite. Plus sûr.</p>
            </div>
          </div>
        </div>
      </section>

      {/* METRICS */}
      <section className="glass p-4">
        <Title icon={<Sparkles className="h-4 w-4" />}>
          <span className="flex items-center gap-3">MÉTRIQUES CLÉS TEMPS RÉEL
            <span className="flex items-center gap-1.5 rounded-full bg-neon-green/15 px-2 py-0.5 text-[10px] normal-case text-neon-green ring-1 ring-neon-green/50">{dot("green")} Live</span>
          </span>
        </Title>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div className="glass p-3">
            <div className="flex gap-3"><IconBadge><Bot className="h-5 w-5" /></IconBadge>
              <div><p className="text-xs text-foreground/80">Débit d'injection</p><p className="font-display text-xl">48 732 <span className="text-base text-neon">msg/s</span></p>
                <p className="flex items-center gap-1 text-xs text-neon-green"><ArrowUp className="h-3 w-3" />+12%</p></div></div>
            <Spark className="mt-1 h-7 w-full" />
          </div>
          <div className="glass p-3">
            <div className="flex gap-3"><IconBadge tone="green"><Package className="h-5 w-5" /></IconBadge>
              <div><p className="text-xs text-foreground/80">Volume 24h</p><p className="font-display text-xl">4 216 893</p><p className="text-[11px] text-muted-foreground">/ 5 000 000 quota</p></div></div>
            <div className="mt-4 flex items-center gap-2"><Bar value={84} /><span className="text-[11px]">84%</span></div>
          </div>
          <div className="glass flex gap-3 p-3">
            <Ring value={99.42} size={50} tone="green" gradient />
            <div><p className="text-xs text-foreground/80">Taux de livraison global</p><p className="font-display text-xl">99.42%</p>
              <p className="flex items-center gap-1 text-xs text-neon-green"><ArrowUp className="h-3 w-3" />+0.28%</p></div>
          </div>
          <div className="glass flex gap-3 p-3">
            <IconBadge tone="violet"><Target className="h-5 w-5" /></IconBadge>
            <div className="flex-1"><p className="text-xs text-foreground/80">Taux de plaintes (Gmail)</p><p className="font-display text-xl">0.04%</p>
              <p className="flex items-center gap-1 text-xs text-neon-green"><ArrowDown className="h-3 w-3" />-0.02%</p>
              <p className="text-[11px] text-muted-foreground">(objectif &lt; 0.10%)</p></div>
            <Ring value={40} size={36} stroke={3} />
          </div>
          <div className="glass flex gap-3 p-3">
            <IconBadge><CheckCircle2 className="h-5 w-5" /></IconBadge>
            <div className="flex-1"><p className="text-xs text-foreground/80">Taux de bounces</p><p className="font-display text-xl">0.18%</p>
              <p className="flex items-center gap-1 text-xs text-neon-green"><ArrowDown className="h-3 w-3" />-0.07%</p>
              <p className="text-[11px] text-muted-foreground">Hard 0.08% | Soft 0.10%</p></div>
            <Ring value={30} size={36} stroke={3} />
          </div>
          <div className="glass flex gap-3 p-3">
            <Ring value={100} size={50} tone="green"><Star className="h-5 w-5 fill-neon-green text-neon-green" /></Ring>
            <div><p className="text-xs text-foreground/80">Score Mail-Tester</p><p className="font-display text-2xl">10/10</p><p className="text-xs font-semibold text-neon-green">Excellent</p></div>
          </div>
        </div>
      </section>

      {/* MIDDLE */}
      <div className="grid gap-4 2xl:grid-cols-[1fr_470px]">
        <section className="glass grid gap-4 p-4 lg:grid-cols-[1fr_200px_1fr]">
          <div>
            <Title icon={<Target className="h-4 w-4" />} right={<span className="flex items-center gap-1 rounded-md border border-glass-border px-2 py-0.5 text-[11px]">Global <ChevronDown className="h-3 w-3" /></span>}>RÉPUTATION FAI</Title>
            <ul className="space-y-1">
              {isps.map((i) => (
                <li key={i.n} className="flex items-center gap-3 border-b border-glass-border py-2.5 last:border-0">
                  <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground/95 font-display text-sm font-black" style={{ color: toneVar[i.c] }}>{i.logo}</span>
                  <div className="flex-1"><p className="text-[12.5px]">{i.n}</p><div className="mt-1.5"><Bar value={i.v - 20} /></div></div>
                  <div className="w-20"><p className="text-[13px] font-semibold">{i.v}%</p><p className="text-[10px] text-neon-green">{i.s}</p></div>
                  {dot(i.dot)}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col items-center justify-center rounded-lg border border-glass-border bg-background/30 p-3">
            <p className="mb-3 text-[13px] font-semibold">Délivrabilité globale</p>
            <Ring value={88} size={160} stroke={10} gradient>
              <div className="text-center"><p className="font-display text-3xl font-semibold">99.4%</p><p className="text-sm text-neon-green">Excellent</p></div>
            </Ring>
            <Spark className="mt-3 h-8 w-full" d="M0 20 L8 18 L14 22 L20 14 L28 18 L34 10 L40 16 L48 8 L54 14 L62 6 L70 12 L78 4 L86 10 L94 3 L100 6" />
          </div>
          <div className="rounded-lg border border-glass-border bg-background/30 p-3">
            <p className="mb-3 text-[13px] font-semibold">Performance par domaine</p>
            <ul className="space-y-4">
              {domains.map(([d, v]) => (
                <li key={d}>
                  <div className="flex items-center gap-2 text-[11.5px]"><Mail className="h-3.5 w-3.5 text-foreground/70" />{d}<span className="ml-auto">{v}%</span></div>
                  <div className="mt-1.5 pl-5"><Bar value={(v - 90) * 9} tone="neon" /></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="space-y-4">
          <section className="glass p-4">
            <Title icon={<Boxes className="h-4 w-4" />} right={<span className="text-[11px] text-muted-foreground">Total : 16 IPs</span>}>Pools VMTA & Santé IP</Title>
            <div className="grid grid-cols-3 gap-2">
              {[
                { t: "Pool Gold", a: "8 IPs actives", b: "Score > 95", v: 100, c: "green" as Tone },
                { t: "Pool Silver", a: "4 IPs en palier", b: "Warmup", v: 75, c: "neon" as Tone },
                { t: "Pool Quarantine", a: "0 IP", b: "Sain", v: 0, c: "violet" as Tone },
              ].map((p) => (
                <div key={p.t} className="glass p-3">
                  <div className="flex items-start gap-2">{dot(p.c)}<div><p className="text-[12px] font-semibold">{p.t}</p><p className="text-[10.5px] text-muted-foreground">{p.a}</p><p className="text-[10.5px]" style={{ color: toneVar[p.c] }}>{p.b}</p></div></div>
                  <div className="mt-3 flex justify-center"><Ring value={p.v} size={60} tone={p.c}><span className="text-xs">{p.v}%</span></Ring></div>
                </div>
              ))}
            </div>
          </section>
          <section className="glass p-4">
            <Title icon={<Database className="h-4 w-4" />}>Files KumoMTA & Réseau</Title>
            <div className="grid grid-cols-3 gap-2">
              {[[Mail, "421", "Messages en attente"], [Database, "64 / 256", "Connexions SMTP"], [Timer, "12.4 ms", "Pacing TCP BBR"]].map(([I, v, l]) => {
                const Icon = I as typeof Mail;
                return (
                  <div key={l as string} className="glass flex items-center gap-2.5 p-3">
                    <Icon className="h-5 w-5 text-neon" />
                    <div><p className="text-[13px] font-semibold">{v as string}</p><p className="text-[9.5px] text-muted-foreground">{l as string}</p></div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* GMAIL + ATLAS + MAP */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.2fr]">
        <section className="glass p-4">
          <Title icon={<Mail className="h-4 w-4" />} right={<span className="text-[11px] text-neon-green">Postmaster Tools</span>}>PERFORMANCE GMAIL</Title>
          <div className="grid grid-cols-2 gap-2">
            {[["Réputation IP", "Haute", "green"], ["Réputation domaine", "Haute", "green"], ["Auth SPF/DKIM/DMARC", "100%", "green"], ["Chiffrement TLS", "100%", "neon"], ["Feedback-ID", "Actif", "neon"], ["Plaintes (spam rate)", "0.04%", "violet"]].map(([l, v, c]) => (
              <div key={l} className="glass p-2.5">
                <p className="text-[10.5px] text-muted-foreground">{l}</p>
                <p className="flex items-center gap-2 font-display text-[15px]">{dot(c as Tone)}{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Placement : Principale 92% • Promotions 7.6% • Spam 0.4%</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
            <div style={{ width: "92%", background: "var(--neon-green)" }} /><div style={{ width: "7.6%", background: "var(--neon-amber)" }} /><div style={{ width: "0.4%", background: "var(--neon-red)" }} />
          </div>
        </section>

        <section className="glass p-4">
          <Title icon={<Bot className="h-4 w-4" />} right={<span className="flex items-center gap-1.5 text-[10px] text-neon-green">{dot("green")} En ligne</span>}>ACTIVITÉ ATLAS IA</Title>
          <ul className="space-y-2.5">
            {[["Postmaster SRE", "Surveille 4 FAI • 0 anomalie", 96, "green"], ["Infra & DNS", "Rotation DKIM planifiée J-3", 82, "neon"], ["Seed & Placement", "Test 48 boîtes en cours", 64, "violet"], ["Yield & Sponsors", "3 offres recommandées", 71, "amber"]].map(([n, d, v, c]) => (
              <li key={n as string}>
                <div className="flex items-center gap-2 text-[12px]">{dot(c as Tone)}<span className="font-semibold">{n}</span><span className="ml-auto text-[11px]">{v}%</span></div>
                <p className="mb-1 pl-4 text-[10.5px] text-muted-foreground">{d}</p>
                <div className="pl-4"><Bar value={v as number} tone={c as Tone} /></div>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass relative overflow-hidden p-4">
          <Title icon={<Target className="h-4 w-4" />}>LIVRAISON PAR PAYS</Title>
          <div className="relative h-[190px] rounded-lg bg-cover bg-center opacity-90" style={{ backgroundImage: `url(${worldMap.url})` }}>
            {[["22%", "38%", "USA 41%"], ["48%", "30%", "France 28%"], ["52%", "24%", "Allemagne 12%"], ["78%", "45%", "Asie 9%"]].map(([x, y, l]) => (
              <span key={l} className="absolute flex items-center gap-1 rounded bg-background/70 px-1.5 py-0.5 text-[10px]" style={{ left: x, top: y }}>{dot("neon")}{l}</span>
            ))}
          </div>
        </section>
      </div>

      {/* BOTTOM */}
      <div className="grid gap-4 xl:grid-cols-[1fr_280px_470px]">
        <section className="glass p-4">
          <Title icon={<Bot className="h-4 w-4" />} right={<Link to="/dashboard/logs" className="text-[11px] text-muted-foreground hover:text-neon">Voir tout ›</Link>}>
            ÉVÉNEMENTS RÉCENTS <span className="font-normal normal-case text-muted-foreground">— HERMES AI</span>
          </Title>
          <ul className="relative ml-1 border-l border-glass-border">
            {events.map(([t, l, cat, c]) => (
              <li key={t} className="flex items-center gap-3 border-b border-glass-border py-[7px] pl-3 text-[12px] last:border-0">
                <span className="w-10 text-muted-foreground">{t}</span>{dot(c)}<span className="flex-1 truncate">{l}</span>
                <span className="w-24 text-[10.5px] text-muted-foreground">{cat}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass p-4">
          <div className="mb-3 flex items-center gap-3">
            <ShieldCheck className="h-10 w-10 text-neon-green" style={{ filter: "drop-shadow(0 0 8px var(--neon-green))" }} />
            <div><p className="text-[11px] font-semibold uppercase text-neon">Conformité cryptographique</p><p className="font-display text-xl text-neon-green">100%</p><p className="text-[10.5px] text-muted-foreground">Alignement global</p></div>
          </div>
          <ul className="space-y-1">
            {compliance.map((c) => (
              <li key={c} className="flex items-center gap-2 text-[11px]">
                <CheckCircle2 className="h-3.5 w-3.5 text-neon-green" />{c}
                <span className="ml-auto rounded border border-neon-green/60 bg-neon-green/10 px-1.5 text-[9.5px] text-neon-green">Validé</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass p-4">
          <Title icon={<Sparkles className="h-4 w-4" />}>Outils rapides</Title>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tools.map((t) => (
              <Link key={t.t} to={t.to} className="glass flex items-center gap-2.5 p-3 transition hover:border-neon">
                <t.icon className="h-6 w-6 shrink-0" style={{ color: toneVar[t.c], filter: `drop-shadow(0 0 6px ${toneVar[t.c]})` }} />
                <div><p className="text-[12px] font-semibold">{t.t}</p><p className="text-[10px] text-muted-foreground">{t.d}</p></div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
