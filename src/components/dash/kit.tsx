import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";

/** Shared page kit — styled to match the lux cockpit design used across the dashboard. */
export function PageHeader({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <section className="card-lux lux-hero relative overflow-hidden">
      <div className="flex flex-wrap items-stretch">
        <div className="flex flex-1 items-center gap-4 px-5 py-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary shadow-[0_6px_18px_-8px_var(--primary)]">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <ChevronLeft className="h-3 w-3" />
              <Link to="/dashboard" className="hover:text-primary">Dashboard</Link>
              <ChevronRight className="h-3 w-3" />
              <span className="font-semibold text-primary">{title}</span>
            </p>
            <h1 className="font-display text-[26px] font-extrabold leading-tight text-primary">{title}</h1>
            <p className="text-[13px] text-muted-foreground">{desc}</p>
          </div>
        </div>
        {action && <div className="flex items-center gap-2 px-5 py-4">{action}</div>}
      </div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-lux relative overflow-hidden p-4" style={{ background: "linear-gradient(120deg, var(--card) 45%, color-mix(in oklab, var(--neon-2) 10%, var(--card)))" }}>
      <p className="text-[12.5px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-[24px] font-extrabold leading-tight text-primary">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] font-semibold text-neon-green">{sub}</p>}
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "neutral";
const toneColor: Record<Tone, string> = {
  ok: "var(--neon-green)", warn: "var(--neon-amber)", bad: "var(--neon-red)", neutral: "var(--muted-foreground)",
};
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const c = toneColor[tone];
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)`, border: `1px solid color-mix(in oklab, ${c} 35%, transparent)` }}>{children}</span>;
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card-lux overflow-hidden">
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-primary">
            <span className="h-4 w-1 rounded-full bg-primary" />{title}
          </h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function DataTable({ cols, rows }: { cols: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-primary/5 text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
            {cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-semibold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/50 transition hover:bg-primary/5">
              {r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-2.5">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Bar({ value }: { value: number }) {
  return <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full" style={{ width: `${value}%`, background: "linear-gradient(90deg, var(--neon-2), var(--primary))" }} /></div>;
}
