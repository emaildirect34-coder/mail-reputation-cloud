import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
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

export function Spark({ tone = "green", className = "", d = "M0 24 L12 20 L22 22 L32 14 L44 17 L54 10 L66 12 L76 6 L88 8 L100 2" }: { tone?: Tone; className?: string; d?: string }) {
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={className}>
      <path d={`${d} L100 28 L0 28 Z`} fill={`color-mix(in oklab, ${toneVar[tone]} 18%, transparent)`} />
      <path d={d} fill="none" stroke={toneVar[tone]} strokeWidth="2" />
    </svg>
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

export function Ring({ value, size = 150, stroke = 12, tone = "green", children }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={toneVar[tone]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} style={{ filter: `drop-shadow(0 0 6px ${toneVar[tone]})` }} />
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
