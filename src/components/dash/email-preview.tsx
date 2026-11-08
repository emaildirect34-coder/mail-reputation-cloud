import { useState } from "react";
import { Monitor, Smartphone, Moon, Sun, Maximize2, X } from "lucide-react";

// Macros actually replaced at send time (see renderMessage).
export const MACROS = [
  { tag: "{first_name}", label: "Prénom", sample: "Marie" },
  { tag: "{to}", label: "Email destinataire", sample: "marie@exemple.fr" },
  { tag: "{from_name}", label: "Nom expéditeur", sample: "Votre marque" },
  { tag: "{from_email}", label: "Email expéditeur", sample: "news@votre-domaine.fr" },
  { tag: "{unsubscribe_url}", label: "Lien désinscription", sample: "#desinscription" },
];

export function fillSample(html: string) {
  return MACROS.reduce((s, m) => s.replaceAll(m.tag, m.sample), html);
}

// Approximates mail-app dark mode (Gmail/Apple Mail invert light backgrounds).
const DARK = `<style>html{filter:invert(1) hue-rotate(180deg);background:#fff}img,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}</style>`;

function stats(html: string) {
  const kb = new Blob([html]).size / 1024;
  const imgs = (html.match(/<img\b/gi) ?? []).length;
  const noAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) ?? []).length;
  const links = (html.match(/href=/gi) ?? []).length;
  return { kb, imgs, noAlt, links, unsub: html.includes("{unsubscribe_url}") };
}

export function EmailPreview({ html, subject, fromName }: { html: string; subject: string; fromName: string }) {
  const [mobile, setMobile] = useState(false), [dark, setDark] = useState(false), [full, setFull] = useState(false);
  const doc = fillSample(html) + (dark ? DARK : "");
  const s = stats(html);
  const btn = (on: boolean) => `grid size-7 place-items-center rounded-md border border-border ${on ? "bg-primary text-primary-foreground" : "bg-card"}`;
  const frame = (h: string) => (
    <div className={`mx-auto overflow-hidden rounded-xl border border-border/60 bg-card transition-all ${mobile ? "max-w-[375px]" : "w-full"}`}>
      <div className="border-b border-border/60 px-3 py-2 text-[12px]">
        <p className="font-bold text-foreground">{fromName || "Expéditeur"}</p>
        <p className="truncate text-muted-foreground">{fillSample(subject) || "(sans objet)"}</p>
      </div>
      <iframe title="Aperçu de l'email" sandbox="" srcDoc={doc} className={`block w-full border-0 bg-background ${h}`} />
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-label="Ordinateur" className={btn(!mobile)} onClick={() => setMobile(false)}><Monitor className="size-3.5" /></button>
        <button type="button" aria-label="Mobile" className={btn(mobile)} onClick={() => setMobile(true)}><Smartphone className="size-3.5" /></button>
        <button type="button" aria-label="Mode sombre" className={btn(dark)} onClick={() => setDark(v => !v)}>{dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}</button>
        <button type="button" aria-label="Plein écran" className={btn(false)} onClick={() => setFull(true)}><Maximize2 className="size-3.5" /></button>
        <span className="ml-auto text-[11px] text-muted-foreground">{mobile ? "Mobile 375 px" : "Ordinateur"}{dark ? " · sombre" : ""}</span>
      </div>
      {frame("h-56")}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className={`rounded px-1.5 py-0.5 ${s.kb > 102 ? "bg-destructive/15 text-destructive" : "bg-muted"}`}>{s.kb.toFixed(1)} Ko{s.kb > 102 ? " — coupé par Gmail" : ""}</span>
        <span className="rounded bg-muted px-1.5 py-0.5">{s.links} lien(s)</span>
        <span className={`rounded px-1.5 py-0.5 ${s.noAlt ? "bg-destructive/15 text-destructive" : "bg-muted"}`}>{s.imgs} image(s){s.noAlt ? ` · ${s.noAlt} sans texte alt` : ""}</span>
        <span className={`rounded px-1.5 py-0.5 ${s.unsub ? "bg-muted" : "bg-destructive/15 text-destructive"}`}>{s.unsub ? "Lien désinscription présent" : "Désinscription ajoutée automatiquement en bas"}</span>
      </div>
      {full && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 overflow-auto bg-background/95 p-4">
          <div className="mx-auto max-w-4xl space-y-2">
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Ordinateur" className={btn(!mobile)} onClick={() => setMobile(false)}><Monitor className="size-3.5" /></button>
              <button type="button" aria-label="Mobile" className={btn(mobile)} onClick={() => setMobile(true)}><Smartphone className="size-3.5" /></button>
              <button type="button" aria-label="Mode sombre" className={btn(dark)} onClick={() => setDark(v => !v)}>{dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}</button>
              <button type="button" aria-label="Fermer" className={`${btn(false)} ml-auto`} onClick={() => setFull(false)}><X className="size-3.5" /></button>
            </div>
            {frame("h-[80vh]")}
          </div>
        </div>
      )}
    </div>
  );
}
