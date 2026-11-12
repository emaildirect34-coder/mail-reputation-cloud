import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Monitor, Smartphone, Moon, Sun, Maximize2, X, Shuffle, ImageOff } from "lucide-react";
import { expand, countVariants } from "@/lib/spintax";
import { auditEmailAccessibility, auditEmailClientCompatibility } from "@/lib/email-accessibility";
import { preflightCampaignLinks } from "@/lib/campaign-preflight.functions";

// Macros actually replaced at send time (see renderMessage).
export const MACROS = [
  { tag: "{first_name}", label: "Prénom", sample: "Marie" },
  { tag: "{to}", label: "Email destinataire", sample: "marie@exemple.fr" },
  { tag: "{from_name}", label: "Nom expéditeur", sample: "Votre marque" },
  { tag: "{from_email}", label: "Email expéditeur", sample: "news@votre-domaine.fr" },
  { tag: "{unsubscribe_url}", label: "Lien désinscription", sample: "#desinscription" },
];

export function fillSample(html: string, seed = "preview") {
  const vars = Object.fromEntries(MACROS.map(m => [m.tag.slice(1, -1), m.sample]));
  return MACROS.reduce((s, m) => s.replaceAll(m.tag, m.sample), expand(html, vars, seed));
}

// Approximates mail-app dark mode (Gmail/Apple Mail invert light backgrounds).
const DARK = `<style>html{filter:invert(1) hue-rotate(180deg);background:#fff}img,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}</style>`;
const NO_IMAGES = `<meta http-equiv="Content-Security-Policy" content="img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'">`;
type LinkCheck = { checked: number; truncated: boolean; summary: { ok: number; issue: number; manual: number }; results: { type: 'link'|'image'; url: string; status: 'ok'|'issue'|'manual'; detail: string; code?: number }[] };

function stats(html: string) {
  const kb = new Blob([html]).size / 1024;
  const imgs = (html.match(/<img\b/gi) ?? []).length;
  const noAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) ?? []).length;
  const links = (html.match(/href=/gi) ?? []).length;
  return { kb, imgs, noAlt, links, unsub: html.includes("{unsubscribe_url}") };
}

export function EmailPreview({ html, subject, fromName }: { html: string; subject: string; fromName: string }) {
  const [mobile, setMobile] = useState(false), [dark, setDark] = useState(false), [full, setFull] = useState(false), [seed, setSeed] = useState(0);
  const [client, setClient] = useState<'gmail' | 'outlook' | 'apple'>('gmail');
  const [hideImages, setHideImages] = useState(false);
  const preflight = useServerFn(preflightCampaignLinks);
  const [linkCheck, setLinkCheck] = useState<LinkCheck | null>(null);
  const [checking, setChecking] = useState(false), [linkError, setLinkError] = useState('');
  const [audit, setAudit] = useState<{ html: string; issues: string[]; compatibility: string[] }>();
  const sample = fillSample(html, `p${seed}`);
  const frameHtml = hideImages
    ? sample.replace(/^(\s*<!doctype[^>]*>)?/i, doctype => doctype + NO_IMAGES)
    : sample;
  const clientCss = client === 'outlook' ? '<style>body{font-family:Arial,sans-serif}table{border-collapse:collapse}img{display:block;max-width:100%}</style>'
    : client === 'apple' ? '<style>body{font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;-webkit-text-size-adjust:100%}img{max-width:100%;height:auto}</style>'
      : '<style>body{font-family:Arial,sans-serif}img{max-width:100%;height:auto}</style>';
  const doc = clientCss + frameHtml + (dark ? DARK : "");
  const variants = countVariants(subject) * countVariants(html);
  const s = stats(html);
  const btn = (on: boolean) => `grid size-7 place-items-center rounded-md border border-border ${on ? "bg-primary text-primary-foreground" : "bg-card"}`;
  const frame = (h: string) => (
    <div className={`mx-auto overflow-hidden rounded-xl border border-border/60 bg-card transition-all ${mobile ? "max-w-[375px]" : "w-full"}`}>
      <div className="border-b border-border/60 px-3 py-2 text-[12px]">
        <p className="font-bold text-foreground">{fromName || "Expéditeur"}</p>
        <p className="truncate text-muted-foreground">{fillSample(subject, `s${seed}`) || "(sans objet)"}</p>
      </div>
      <iframe title="Aperçu de l'email" sandbox="" srcDoc={doc} className={`block w-full border-0 bg-background ${h}`} />
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <select aria-label="Style d’aperçu client" className="h-7 rounded-md border bg-card px-2 text-xs" value={client} onChange={event => setClient(event.target.value as typeof client)}>
          <option value="gmail">Simulation Gmail</option><option value="outlook">Simulation de styles Outlook</option><option value="apple">Simulation de styles Apple Mail</option>
        </select>
        <button type="button" aria-label="Ordinateur" className={btn(!mobile)} onClick={() => setMobile(false)}><Monitor className="size-3.5" /></button>
        <button type="button" aria-label="Mobile" className={btn(mobile)} onClick={() => setMobile(true)}><Smartphone className="size-3.5" /></button>
        <button type="button" aria-label="Mode sombre" aria-pressed={dark} className={btn(dark)} onClick={() => setDark(v => !v)}>{dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}</button>
        <button type="button" aria-label="Bloquer les images" title="Bloquer les images" aria-pressed={hideImages} className={btn(hideImages)} onClick={() => setHideImages(v => !v)}><ImageOff className="size-3.5" /></button>
        <button type="button" aria-label="Plein écran" className={btn(false)} onClick={() => setFull(true)}><Maximize2 className="size-3.5" /></button>
        <button type="button" aria-label="Autre variation" title="Générer une autre variation" className={btn(false)} onClick={() => setSeed(v => v + 1)}><Shuffle className="size-3.5" /></button>
        <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${variants > 1 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>{variants >= 1e12 ? "1000 Md+" : variants.toLocaleString("fr-FR")} variation{variants > 1 ? "s" : ""}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{mobile ? "Mobile 375 px" : "Ordinateur"}{dark ? " · sombre simulé" : ""}{hideImages ? " · images bloquées" : ""}</span>
      </div>
      <button type="button" className="text-xs font-semibold text-primary underline"
        onClick={() => setAudit({ html: doc, issues: auditEmailAccessibility(doc), compatibility: auditEmailClientCompatibility(doc) })}>Vérifier l’accessibilité et la compatibilité</button>
      <button type="button" disabled={checking || !html.trim()} className="ml-3 text-xs font-semibold text-primary underline disabled:opacity-50"
        onClick={async () => { setChecking(true); setLinkError(''); try { setLinkCheck(await preflight({ data: { html: sample } })); } catch (e) { setLinkError(e instanceof Error ? e.message : 'Vérification impossible.'); } finally { setChecking(false); } }}>
        {checking ? 'Vérification des liens…' : 'Vérifier les liens et images avant envoi'}
      </button>
      {linkError && <p role="alert" className="text-xs text-destructive">{linkError}</p>}
      {linkCheck && <div role="status" className="space-y-1 rounded-md border p-2 text-xs">
        <p className="font-semibold">Contrôle préalable : {linkCheck.summary.ok} accessible(s), {linkCheck.summary.issue} anomalie(s), {linkCheck.summary.manual} à vérifier manuellement.</p>
        {linkCheck.checked === 0 && <p>Aucun lien externe ou image distante à contrôler.</p>}
        <ul className="max-h-40 space-y-1 overflow-auto">{linkCheck.results.map((item, i) => <li key={`${item.type}-${item.url}-${i}`} className="break-all">
          <span className={item.status === 'issue' ? 'font-semibold text-destructive' : item.status === 'ok' ? 'text-emerald-700' : 'text-muted-foreground'}>{item.status === 'ok' ? 'OK' : item.status === 'issue' ? 'À corriger' : 'À vérifier'}</span>
          {' · '}{item.type === 'link' ? 'Lien' : 'Image'} · {item.url}{item.code ? ` · HTTP ${item.code}` : ''} — {item.detail}
        </li>)}</ul>
        {linkCheck.truncated && <p className="text-muted-foreground">Seuls les 40 premiers liens et images ont été contrôlés.</p>}
        <p className="text-muted-foreground">Les redirections et les hôtes hors liste autorisée ne sont pas suivis. Un résultat accessible ne garantit pas le rendu par les fournisseurs de messagerie.</p>
      </div>}
      {audit?.html === doc && <div role="status" className="text-xs text-muted-foreground">
        {audit.issues.length ? <ul className="list-disc pl-4">{audit.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>Aucune anomalie détectée par les contrôles rapides.</p>}
        <p>Les contrastes vérifiés utilisent les couleurs hexadécimales déclarées dans le HTML.</p>
        {!!audit.compatibility.length && <><p className="mt-2 font-semibold">Compatibilité e-mail à vérifier</p><ul className="list-disc pl-4">{audit.compatibility.map(issue => <li key={issue}>{issue}</li>)}</ul></>}
      </div>}
      <p className="text-[10px] text-muted-foreground">Aperçu simulé : ces vues ajustent largeur et styles généraux. Le rendu réel par Gmail, Outlook ou Apple Mail nécessite un service de prévisualisation connecté.</p>
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
              <button type="button" aria-label="Bloquer les images" aria-pressed={hideImages} className={btn(hideImages)} onClick={() => setHideImages(v => !v)}><ImageOff className="size-3.5" /></button>
              <button type="button" aria-label="Fermer" className={`${btn(false)} ml-auto`} onClick={() => setFull(false)}><X className="size-3.5" /></button>
            </div>
            {frame("h-[80vh]")}
          </div>
        </div>
      )}
    </div>
  );
}
