import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ShieldCheck, TrendingUp } from "lucide-react";

export type Tone = "blue" | "green" | "amber" | "red" | "violet";
export const toneVar: Record<Tone, string> = {
  blue: "var(--neon-2)", green: "var(--neon-green)", amber: "var(--neon-amber)", red: "var(--neon-red)", violet: "var(--neon-violet)",
};

/** Page header: breadcrumb, icon, title, subtitle + dark status banner on the right */
export function LuxHeader({ crumb, icon, title, desc, status, sub }: { crumb: string; icon: ReactNode; title: string; desc: string; status: string; sub: string }) {
  return (
    <section className="card-lux lux-hero relative overflow-hidden">
      <div className="flex flex-wrap items-stretch">
        <div className="flex flex-1 items-center gap-5 px-5 py-3">
          <div className="text-primary [&_svg]:h-14 [&_svg]:w-14" style={{ filter: "drop-shadow(0 6px 12px color-mix(in oklab, var(--primary) 45%, transparent))" }}>{icon}</div>
          <div>
            <p className="flex items-center gap-1 text-[12px] text-muted-foreground"><ChevronLeft className="h-3 w-3" /><Link to="/dashboard" className="hover:text-primary">Dashboard</Link><ChevronRight className="h-3 w-3" /><span className="font-semibold text-primary">{crumb}</span></p>
            <h1 className="font-display text-[28px] font-extrabold leading-tight text-primary">{title}</h1>
            <p className="text-[13px] font-semibold">{desc}</p>
          </div>
        </div>
        <div className="lux-banner flex min-w-[340px] items-center gap-4 rounded-l-[2.5rem] px-7 py-4">
          <ShieldCheck className="h-12 w-12 shrink-0 text-neon-green" style={{ filter: "drop-shadow(0 0 10px var(--neon-green))" }} />
          <div className="flex-1"><p className="text-[15px] font-bold">{status}</p><p className="text-[12.5px] font-semibold text-neon-green">{sub}</p></div>
          <TrendingUp className="h-9 w-9 text-neon-green" />
        </div>
      </div>
    </section>
  );
}

export function LuxTabs({ tabs, active }: { tabs: { label: string; icon: typeof ShieldCheck; to?: string }[]; active: number }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t, i) => {
        const cls = `flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition ${i === active ? "bg-primary text-primary-foreground shadow-[0_6px_18px_-6px_var(--primary)]" : "card-lux text-foreground hover:text-primary"}`;
        const inner = <><t.icon className={`h-4 w-4 ${i === active ? "" : "text-primary"}`} />{t.label}</>;
        return t.to ? <Link key={t.label} to={t.to} className={cls}>{inner}</Link> : <span key={t.label} className={cls}>{inner}</span>;
      })}
    </div>
  );
}

export function Kpi({ icon, label, value, sub, tone = "blue", spark }: { icon: ReactNode; label: string; value: string; sub: string; tone?: Tone; spark?: boolean }) {
  return (
    <div className="card-lux relative flex items-center gap-4 overflow-hidden p-4" style={{ background: `linear-gradient(120deg, var(--card) 40%, color-mix(in oklab, ${toneVar[tone]} 12%, var(--card)))` }}>
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full [&_svg]:h-8 [&_svg]:w-8" style={{ color: toneVar[tone], background: `radial-gradient(circle, var(--card) 55%, color-mix(in oklab, ${toneVar[tone]} 20%, var(--card)))`, boxShadow: `0 6px 18px -6px ${toneVar[tone]}` }}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{label}</p>
        <p className="font-display text-[26px] font-extrabold leading-tight text-primary">{value}</p>
        <p className="text-[12px] font-semibold" style={{ color: tone === "red" || tone === "amber" ? toneVar[tone] : "var(--neon-green)" }}>{sub}</p>
      </div>
      {spark && <Spark tone={tone} className="absolute bottom-3 right-3 h-8 w-24" />}
    </div>
  );
}

/** Smooth Catmull-Rom path through points */
export function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const defaultSpark = [8, 11, 9, 14, 13, 17, 16, 20, 19, 23, 22, 26];
/** Sparkline from real data values (higher value = higher on screen), auto-scaled. */
export function Spark({ tone = "green", className = "", values = defaultSpark }: { tone?: Tone; className?: string; values?: number[]; d?: string }) {
  const id = useId().replace(/:/g, "");
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const step = 100 / (values.length - 1);
  const pts = values.map((v, i) => [+(i * step).toFixed(2), +(27 - ((v - min) / span) * 23).toFixed(2)] as [number, number]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const positioned = /\b(absolute|fixed)\b/.test(className) || className.includes("cockpit-metric-spark");
  return (
    <div className={`${positioned ? "" : "relative"} ${className}`} aria-hidden>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`sp${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={toneVar[tone]} stopOpacity="0.28" />
            <stop offset="100%" stopColor={toneVar[tone]} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L100 30 L0 30 Z`} fill={`url(#sp${id})`} />
        <path d={line} fill="none" stroke={toneVar[tone]} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] bg-card" style={{ left: `${last[0]}%`, top: `${(last[1] / 30) * 100}%`, borderColor: toneVar[tone], boxShadow: `0 0 0 3px color-mix(in oklab, ${toneVar[tone]} 18%, transparent)` }} />
    </div>
  );
}

export function Card({ title, icon, right, children, className = "" }: { title: string; icon: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card-lux p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
        <h2 className="font-display text-[16px] font-bold text-primary">{title}</h2>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** Gauge: 270° arc with gradient, tick marks and end marker */
export function Ring({ value, size = 150, stroke = 12, tone = "green", children }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const s = Math.max(4, stroke * 0.75);
  const r = (size - s) / 2 - 6, c = 2 * Math.PI * r, sweep = 0.75;
  const pct = Math.min(100, Math.max(0, value)) / 100;
  const cx = size / 2, cy = size / 2;
  const endA = (135 + 270 * pct) * Math.PI / 180;
  const ticks = Array.from({ length: 28 }, (_, i) => (135 + (270 * i) / 27) * Math.PI / 180);
  const second = tone === "green" ? "var(--neon-2)" : tone === "blue" ? "var(--neon-violet)" : toneVar[tone];
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={`rg${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={second} />
            <stop offset="100%" stopColor={toneVar[tone]} />
          </linearGradient>
        </defs>
        {ticks.map((a, i) => {
          const r1 = r + s / 2 + 2, r2 = r1 + 3;
          const on = i / 27 <= pct;
          return <line key={i} x1={cx + r1 * Math.cos(a)} y1={cy + r1 * Math.sin(a)} x2={cx + r2 * Math.cos(a)} y2={cy + r2 * Math.sin(a)} stroke={on ? toneVar[tone] : "var(--border)"} strokeOpacity={on ? 0.55 : 1} strokeWidth="1" />;
        })}
        <g transform={`rotate(135 ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth={s} strokeLinecap="round" strokeDasharray={`${c * sweep} ${c}`} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#rg${id})`} strokeWidth={s} strokeLinecap="round" strokeDasharray={`${c * sweep * pct} ${c}`} style={{ filter: `drop-shadow(0 2px 3px color-mix(in oklab, ${toneVar[tone]} 35%, transparent))` }} />
        </g>
        {pct > 0 && <circle cx={cx + r * Math.cos(endA)} cy={cy + r * Math.sin(endA)} r={s / 2 + 1.5} fill="var(--card)" stroke={toneVar[tone]} strokeWidth="2" />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function Pill({ tone = "green", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: toneVar[tone], background: `color-mix(in oklab, ${toneVar[tone]} 15%, transparent)`, border: `1px solid color-mix(in oklab, ${toneVar[tone]} 40%, transparent)` }}>{children}</span>;
}

export function GhostBtn({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-card px-4 py-1.5 text-[12px] font-semibold text-primary shadow-sm hover:bg-primary/10">{children}</Link>;
}
