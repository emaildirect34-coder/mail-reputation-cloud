import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Ban, BadgeCheck, Braces, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp, Code2, FileCode2, FlaskConical, Folder, Gauge, Globe2, Pointer, Image, Link2, Mail, MapPin, Network, Palette, Play, RefreshCw, Reply, Rocket, Save, Search, Send, Server, ShieldCheck, Tag, Target, Trash2, TrendingUp, Upload, Users, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Kpi } from "@/components/dash/lux";
import { CampaignTabs } from "@/components/dash/campaign-tabs";
import { BuilderDelivery } from "@/components/dash/builder-delivery";
import { LaunchPanel } from "@/components/dash/launch-panel";
import { CampaignInboxTest } from "@/components/dash/campaign-inbox-test";
import { AiDiagnostic } from '@/components/dash/ai-diagnostic';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { campaignOffers } from '@/lib/finance.functions';
import { EmailPreview, MACROS } from '@/components/dash/email-preview';
import { VisualEmailEditor } from '@/components/dash/visual-email-editor';
import { SubjectOptimizer } from '@/components/dash/subject-optimizer';
import { renderWeeklyDigest } from '@/lib/weekly-digest';
import { inboxTestServers, readCampaignVersion } from '@/lib/sending.functions';
import { readSenderProfiles } from '@/lib/sender-profiles.functions';
import { campaignVersionKey } from '@/lib/campaign-version';
import { isCampaignTopic } from '@/lib/campaign-topics';

export const Route = createFileRoute("/dashboard/campaigns_/new")({
  validateSearch: (search: Record<string, unknown>): { campaign?: string; version?: number } => {
    const result = campaignVersionKey.safeParse({ id: search['campaign'], version: search['version'] });
    return result.success ? { campaign: result.data.id, version: result.data.version } : {};
  },
  head: () => ({ meta: [
    { title: "Campaign Builder — Email Direct" },
    { name: "description", content: "Créez, testez et pilotez vos campagnes : offre, structure email, corps HTML, délivrabilité et préflight sur une seule page." },
    { property: "og:title", content: "Campaign Builder — Email Direct" },
    { property: "og:description", content: "Constructeur de campagne en 4 colonnes avec aperçu live et préflight." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Builder,
});

const initial = {
  name: "", schedule: "", sendDeadline: "", scheduleMode: "account", serverId: "", vmtaPoolId: "", topic: "", offer: "", sponsorOfferId: "",
  fromName: "Email Direct", fromEmail: "", replyTo: "", senderProfileId: "", subject: "", body: "", ampHtml: "",
  digestMode: "off", digestText: "",
  sendWindowStart: "", sendWindowEnd: "",
  sendPriority: "0",
  listId: "", segmentId: "",
};
type Draft = typeof initial;
const storageKey = "email-direct-campaign-draft";
const inCls = "h-8 w-full min-w-0 rounded-md border border-border bg-card px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring";

function Col({ id, title, icon, children, right }: { id?: string; title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <section id={id} className="card-lux mb-3 break-inside-avoid scroll-mt-24 p-3.5">
    <header className="mb-3 flex items-center gap-2"><span className="text-primary [&_svg]:size-5">{icon}</span><h2 className="font-display text-[16px] font-bold text-primary">{title}</h2>{right && <div className="ml-auto">{right}</div>}</header>
    <div className="space-y-2">{children}</div>
  </section>;
}
function Sub({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <div className="rounded-xl border border-border/60 bg-primary/[0.03] p-3"><div className="mb-2 flex items-center gap-2"><span className="text-primary [&_svg]:size-4">{icon}</span><h3 className="text-[13px] font-bold text-primary">{title}</h3>{right && <div className="ml-auto">{right}</div>}</div><div className="space-y-2">{children}</div></div>;
}
function Row({ label, children, w = "w-28" }: { label: string; children: ReactNode; w?: string }) {
  void w; return <div className="min-w-0 space-y-1"><span className="block text-[11.5px] font-semibold text-muted-foreground">{label}</span><div className="min-w-0">{children}</div></div>;
}
function IconBtn({ children, tone = "card", label, onClick }: { children: ReactNode; tone?: "card" | "primary" | "red"; label: string; onClick?: () => void }) {
  const c = tone === "primary" ? "bg-primary text-primary-foreground" : tone === "red" ? "bg-neon-red text-primary-foreground" : "border border-border bg-card text-foreground";
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`grid size-7 place-items-center rounded-md [&_svg]:size-3.5 ${c}`}>{children}</button>;
}
function Chip({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold hover:border-primary/50 [&_svg]:size-3.5 [&_svg]:text-primary">{children}</button>;
}

function Builder() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const loadVersion = useServerFn(readCampaignVersion);
  const restoring = !!search.campaign && search.version != null;
  const version = useQuery({
    queryKey: ['campaign-version', search.campaign, search.version], enabled: restoring,
    queryFn: () => loadVersion({ data: { id: search.campaign!, version: search.version! } }),
  });
  const readOffers=useServerFn(campaignOffers);
  const sponsorOffers=useQuery({queryKey:['campaign-offers'],queryFn:()=>readOffers()});
  const readServers = useServerFn(inboxTestServers);
  const inventory = useQuery({ queryKey: ['campaign-send-servers'], queryFn: () => readServers() });
  const readProfiles = useServerFn(readSenderProfiles);
  const profileQuery = useQuery({ queryKey: ['sender-profiles'], queryFn: () => readProfiles() });
  const [d, setD] = useState<Draft>(initial);
  const [writingGoal, setWritingGoal] = useState('');
  const [writingAudience, setWritingAudience] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [live, setLive] = useState(true);
  const [preview, setPreview] = useState(initial.body);
  const [lastTest, setLastTest] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [launchPanelKey, setLaunchPanelKey] = useState(0);
  const digestMode = d.digestMode === 'on';
  let content = d.body;
  let digestError = '';
  if (digestMode) {
    try { content = renderWeeklyDigest(d.digestText); }
    catch (error) { content = ''; digestError = (error as Error).message; }
  }
  const sendDraft = digestMode ? { ...d, body: content, ampHtml: '', sponsorOfferId: '' } : { ...d, digestText: '' };
  const selectedServer = inventory.data?.find(server => server.id === d.serverId);
  useEffect(() => { setHasDraft(Boolean(localStorage.getItem(storageKey))); }, []);
  useEffect(() => { if (live) setPreview(content); }, [content, live]);
  const u = (k: keyof Draft, v: string) => setD(p => ({ ...p, [k]: v }));
  const inp = (k: keyof Draft, ph = "", type = "text", locked = false) => <input aria-label={k} type={type} value={d[k]} placeholder={ph} readOnly={locked} onChange={e => u(k, e.target.value)} className={inCls} />;
  const profiles = (profileQuery.data ?? []).filter(profile => profile.enabled && profile.verified);
  const selectedProfile = profiles.find(profile => profile.id === d.senderProfileId);
  const profileChanged = selectedProfile && (selectedProfile.from_name !== d.fromName || selectedProfile.from_email !== d.fromEmail || (selectedProfile.reply_to ?? '') !== d.replyTo);
  const selectProfile = (id: string) => {
    const profile = profiles.find(item => item.id === id);
    setD(previous => ({
      ...previous, senderProfileId: profile?.id ?? '',
      ...(profile ? { fromName: profile.from_name, fromEmail: profile.from_email, replyTo: profile.reply_to ?? '' } : {}),
    }));
  };
  const area = (k: keyof Draft, h: string, ph = "", mono = false) => <textarea aria-label={k} value={d[k]} placeholder={ph} onChange={e => u(k, e.target.value)} className={`w-full resize-y rounded-md border border-border bg-card p-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring ${h} ${mono ? "font-mono leading-5" : ""}`} />;

  const checks = [
    { l: "Structure", ok: Boolean(d.name.trim()) },
    { l: "Contenu", ok: content.trim().length > 20 },
    { l: "En-têtes", ok: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.fromEmail) && Boolean(d.subject) },
    { l: "Serveur d’envoi", ok: !!selectedServer },
  ];
  const passed = checks.filter(c => c.ok).length;
  const ready = passed === checks.length;
  const checklist = digestMode
    ? ['Vérifier les titres, résumés et liens des rubriques.', 'Vérifier que l’audience a choisi le récapitulatif hebdomadaire.', 'Prévisualiser le récapitulatif sur mobile.']
    : d.sponsorOfferId
      ? ['Vérifier l’offre, ses pays autorisés et la date de fin.', 'Vérifier que le lien sponsor contient l’identifiant de clic et que le postback a été testé.', 'Tester les liens du créatif et son placement sur les boîtes témoins.']
      : ['Vérifier l’objet, le nom expéditeur et l’adresse de réponse.', 'Relire l’aperçu sur mobile et avec les images bloquées.', 'Vérifier la liste, les exclusions et le créneau avant l’envoi.'];
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ d, testMode })); setHasDraft(true);
      toast.success("Brouillon enregistré dans ce navigateur.");
    } catch { toast.error("Enregistrement impossible dans ce navigateur."); }
  };
  const restore = () => {
    try {
      const raw = localStorage.getItem(storageKey); if (!raw) return;
      const data = JSON.parse(raw);
      if (data.d && typeof data.d === "object") {
        const draft = { ...initial, ...Object.fromEntries(Object.entries(data.d).filter(([k, v]) => k in initial && typeof v === "string")) };
        if (!('serverId' in data.d) && Array.isArray(data.chosen) && data.chosen.length === 1 && typeof data.chosen[0] === 'string') {
          draft.serverId = data.chosen[0];
        }
        setD(draft);
      }
      setTestMode(data.testMode !== false); toast.success("Configuration restaurée.");
    } catch { toast.error("Configuration illisible."); }
  };
  const closeVersion = () => void navigate({ search: {}, replace: true });
  function restoreArchivedVersion() {
    const selected = version.data;
    if (!selected || version.isFetching || version.isError) return;
    const snapshot = selected.snapshot;
    setD({
      ...initial, name: snapshot.name, subject: snapshot.subject, fromName: snapshot.fromName, fromEmail: snapshot.fromEmail,
      replyTo: snapshot.replyTo ?? '', body: snapshot.html, ampHtml: snapshot.ampHtml ?? '',
      sponsorOfferId: selected.sponsorAvailable ? snapshot.sponsorId ?? '' : '',
      offer: selected.sponsorAvailable ? snapshot.sponsorName ?? '' : '',
      topic: snapshot.topic && isCampaignTopic(snapshot.topic) ? snapshot.topic : '',
      digestMode: selected.digestSource ? 'on' : 'off', digestText: selected.digestSource ?? '',
    });
    setLive(true);
    setTestMode(true);
    setLastTest(null);
    setLaunchPanelKey(key => key + 1);
    closeVersion();
    toast.success(`Version ${selected.version} restaurée dans le brouillon.`);
  }
  const runTests = () => { setLastTest(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })); ready ? toast.success("Contrôles du brouillon réussis.") : toast.error(`${checks.length - passed} contrôle(s) à corriger.`); };

  return <div id="top" className="scroll-mt-24 space-y-3 pb-4">
    {/* Header */}
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_20px_-8px_var(--primary)]"><Mail className="size-8" /></span>
        <div><h1 className="font-display text-[26px] font-extrabold leading-tight text-primary">Campaign Builder</h1><p className="text-[12.5px] font-semibold">Créez, testez et pilotez vos campagnes avec une précision maximale</p></div>
      </div>
      <label className="ml-2 flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-bold">Mode Test :<Switch checked={testMode} onCheckedChange={setTestMode} /></label>
      <div className="lux-banner flex shrink-0 items-center gap-3 rounded-2xl px-5 py-2.5">
        <ShieldCheck className={`size-9 ${ready ? "text-neon-green" : "text-neon-amber"}`} />
        <div className="whitespace-nowrap"><p className="text-[14px] font-bold">{ready ? "Brouillon renseigné" : "Préflight en attente"}</p><p className={`text-[12.5px] font-semibold ${ready ? "text-neon-green" : "text-neon-amber"}`}>{ready ? "Vérifiez le préflight Gmail avant envoi" : `${passed}/${checks.length} contrôles validés`}</p></div>
        <TrendingUp className="size-8 text-neon-green" />
      </div>
      <div className="ml-auto flex flex-wrap justify-end gap-2">
        <CampaignInboxTest draft={sendDraft} server={selectedServer} />
        <button onClick={() => save()} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-[12px] whitespace-nowrap font-semibold text-primary"><Save className="size-4" />Enregistrer</button>
        <button onClick={() => toast("Survolez chaque champ : chaque colonne correspond à une étape de la campagne.")} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-[12px] whitespace-nowrap font-semibold"><CircleHelp className="size-4 text-primary" />Aide</button>
        <button disabled={!hasDraft} onClick={restore} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-[12px] whitespace-nowrap font-semibold disabled:opacity-50"><Folder className="size-4 text-primary" />Configs enregistrées</button>
      </div>
    </div>

    <CampaignTabs active="new" />
    {restoring && <section className="card-lux space-y-2 p-3.5 text-sm" aria-label="Restaurer une version">
      <h2 className="font-semibold">Restaurer la version {search.version}</h2>
      {version.isPending && <p role="status">Chargement de la version…</p>}
      {version.error && <p role="alert" className="text-destructive">{version.error.message}</p>}
      {version.data && <>
        <p><strong>{version.data.snapshot.name}</strong> · {version.data.snapshot.subject}</p>
        <p className="text-muted-foreground">Cette version remplacera le brouillon à l’écran. Le mode test sera activé. Choisis de nouveau la liste, le serveur et la date avant de programmer.</p>
        {version.data.snapshot.sponsorId && !version.data.sponsorAvailable && <p role="status">L’offre sponsor a changé ou est indisponible. Vérifie les liens du message et choisis une offre avant l’envoi.</p>}
        {version.data.snapshot.weeklyDigest && !version.data.digestSource && <p role="status">Cette version ancienne sera chargée en HTML. Vérifie le format de la campagne avant l’envoi.</p>}
      </>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!version.data || version.isFetching || version.isError} onClick={restoreArchivedVersion}>Charger dans le brouillon</Button>
        <Button size="sm" variant="outline" onClick={closeVersion}>Annuler</Button>
      </div>
    </section>}

    {/* KPIs */}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <Kpi icon={<Server />} label="Serveurs avec agent" value={inventory.data ? String(inventory.data.length) : "—"} sub="Inventaire KumoMTA" tone="blue" />
      <Kpi icon={<Network />} label="Serveur de la campagne" value={selectedServer ? "1" : "—"} sub={selectedServer?.label ?? "À choisir dans Envoi réel"} tone="blue" />
      <Kpi icon={<Check />} label="Champs renseignés" value={`${passed} / ${checks.length}`} sub={ready ? "Contrôles du brouillon réussis" : "Préflight en attente"} tone={ready ? "green" : "amber"} />
      <Kpi icon={<BadgeCheck />} label="Tests validés" value={lastTest ? `${passed} / ${checks.length}` : "—"} sub={lastTest ? `Dernier test ${lastTest}` : "Lancer les tests"} tone={lastTest && ready ? "green" : "amber"} />
      <Kpi icon={<ShieldCheck />} label="Mode d’envoi" value={testMode ? "Test" : "Réel"} sub={d.sponsorOfferId ? "Offre sponsor suivie" : "Liens & désinscription protégés"} tone={testMode ? "amber" : "green"} />
    </div>

    {/* 4 columns */}
    <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
      {/* Offre */}
      <div className="flex min-w-0 flex-col">
        <Col id="offre" title="Offre" icon={<Tag />}>
          <Row label="Nom de la campagne" w="w-32">{inp("name")}</Row>
          <Row label="Planifier le" w="w-32"><div className="relative"><CalendarDays className="pointer-events-none absolute left-2 top-1.5 size-4 text-muted-foreground" /><input aria-label="Planifier le" type="datetime-local" value={d.schedule} onChange={e => u("schedule", e.target.value)} className={`${inCls} pl-8`} /></div></Row>
          {d.schedule && <Row label="Fuseau d’envoi" w="w-32">
            <select aria-label="Fuseau d’envoi" value={d.scheduleMode} onChange={e => u("scheduleMode", e.target.value)} className={inCls}>
              <option value="account">Fuseau du compte</option>
              <option value="recipient">Fuseau de chaque destinataire</option>
            </select>
          </Row>}
          <Sub title="Sélectionner l'offre" icon={<Pointer />}>
            <select aria-label="Offre sponsor" className={inCls} value={d.sponsorOfferId} onChange={e=>{const o=sponsorOffers.data?.find(o=>o.id===e.target.value);setD(p=>({...p,sponsorOfferId:o?.id??'',offer:o?.name??'',subject:o?.subject||p.subject,body:o?.html||p.body}));}}><option value="">Sélectionner une offre...</option>{(sponsorOffers.data??[]).map(o=><option key={o.id} value={o.id}>{o.name} · {o.payout} {o.currency}</option>)}</select>
            {sponsorOffers.error&&<p role="alert" className="text-xs text-destructive">{sponsorOffers.error.message}</p>}
          </Sub>
          <p className="text-xs text-muted-foreground">Sélectionnez la liste dans Envoi réel. Pour un contrôle de placement, utilisez Test Inbox avec les boîtes témoins enregistrées.</p>
        </Col>
      </div>

      {/* Structure */}
      <div className="flex min-w-0 flex-col">
        <Col id="structure" title="Structure Email" icon={<Mail />}>
          <Row label="Profil expéditeur">
            <select aria-label="Profil expéditeur" className={inCls} value={d.senderProfileId} onChange={event => selectProfile(event.target.value)}>
              <option value="">Saisie manuelle</option>
              {d.senderProfileId && !selectedProfile && <option value={d.senderProfileId} disabled>Profil indisponible</option>}
              {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · {profile.from_email}</option>)}
            </select>
            <Link to="/dashboard/sender-profiles" className="mt-1 inline-block text-xs text-primary underline">Gérer les profils</Link>
            {profileChanged && <Button className="ml-2" size="sm" variant="outline" onClick={() => selectProfile(d.senderProfileId)}>Réappliquer le profil</Button>}
          </Row>
          <Row label="From Name">{inp("fromName", "", "text", !!d.senderProfileId)}</Row>
          <Row label="From Email">{inp("fromEmail", "", "email", !!d.senderProfileId)}</Row>
          <Row label="Reply To">{inp("replyTo", "", "email", !!d.senderProfileId)}</Row>
          <Row label="Subject"><div className="flex items-center gap-2">{inp("subject")}<AiDiagnostic compact input={{skill:'subject',subject:d.subject,body:d.body}} before={d.subject} onApply={v=>u('subject',v)}/></div></Row>
          <SubjectOptimizer subject={d.subject} body={d.body} offer={d.offer} onApply={(s, p) => setD(prev => {
            const tag = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${p.replace(/[<>&]/g, '')}</div>`;
            const re = /<div style="display:none;max-height:0;overflow:hidden;opacity:0">[\s\S]*?<\/div>/;
            const body = re.test(prev.body) ? prev.body.replace(re, tag) : /<body[^>]*>/i.test(prev.body) ? prev.body.replace(/<body[^>]*>/i, m => `${m}\n    ${tag}`) : tag + prev.body;
            return { ...prev, subject: s, body };
          })} />
          <p className="text-xs text-muted-foreground">Email Direct génère les en-têtes, le Return-Path et les variantes MIME à l’envoi.</p>
        </Col>
      </div>

      {/* Corps */}
      <div className="flex min-w-0 flex-col">
        <Col id="corps" title="Corps de l'Email (HTML)" icon={<Code2 />} right={<AiDiagnostic compact input={{skill:'content',subject:d.subject,body:d.body}} before={d.body} onApply={v=>u('body',v)}/> }>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={digestMode} onChange={event => u('digestMode', event.target.checked ? 'on' : 'off')} />Créer un récapitulatif hebdomadaire</label>
          {digestMode && <div className="space-y-2 text-sm">
            <p>Ajoutez une rubrique par bloc. Commencez par le titre, puis le résumé et éventuellement une URL HTTPS sur la dernière ligne. Séparez les rubriques par une ligne vide.</p>
            <textarea aria-label="Rubriques du récapitulatif" value={d.digestText} maxLength={20_000} onChange={event => u('digestText', event.target.value)} className="min-h-40 w-full rounded-md border border-border bg-card p-2" placeholder={'Actualité de la semaine\nVoici notre nouveauté…\n\nÀ lire\nVoici notre deuxième sujet…'} />
            {digestError && <p role="status" className="text-destructive">{digestError}</p>}
            <p className="text-xs text-muted-foreground">Ce format est envoyé uniquement aux abonnés au récapitulatif. Chaque édition peut être programmée depuis le constructeur.</p>
          </div>}
          <div hidden={digestMode} className={digestMode ? 'hidden' : 'space-y-2'}>
          <VisualEmailEditor onApply={html => { u('body', html); setPreview(html); }} />
          <details className="rounded-md border border-border p-2 text-sm">
            <summary className="cursor-pointer font-semibold">Rédiger avec l’IA</summary>
            <div className="mt-2 space-y-2">
              <label className="block">Objectif<input className={inCls} value={writingGoal} onChange={e => setWritingGoal(e.target.value)} maxLength={500} /></label>
              <label className="block">Audience<textarea className={inCls} value={writingAudience} onChange={e => setWritingAudience(e.target.value)} maxLength={2000} /></label>
              <AiDiagnostic input={{ skill: 'draft', subject: writingGoal, body: writingAudience }} before={d.body} onApply={v => u('body', v)} />
            </div>
          </details>
          <div className="flex justify-center gap-1">
            <label className="grid size-7 cursor-pointer place-items-center rounded-md border border-border bg-card" title="Importer"><Upload className="size-3.5" /><input type="file" accept=".html,.htm" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) { u("body", await f.text()); toast.success("HTML importé."); } }} /></label>
            <IconBtn label="Nouveau" tone="primary" onClick={() => u("body", initial.body)}><span className="text-sm font-bold">+</span></IconBtn>
            <IconBtn label="Vider" tone="red" onClick={() => u("body", "")}><Trash2 /></IconBtn>
          </div>
          <div className="flex flex-wrap gap-1">{MACROS.map(m => <button type="button" key={m.tag} title={`Insérer ${m.tag}`} className="rounded border border-border bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-primary" onClick={() => { const t = document.querySelector<HTMLTextAreaElement>('[aria-label="Contenu HTML"]'); const a = t?.selectionStart ?? d.body.length, b = t?.selectionEnd ?? a; const ins = m.tag === "{unsubscribe_url}" ? '<a href="{unsubscribe_url}">Se désinscrire</a>' : m.tag; u("body", d.body.slice(0, a) + ins + d.body.slice(b)); }}>+ {m.label}</button>)}{[["Salutation", "{Bonjour|Salut|Hello} {first_name|à vous}"], ["Accroche", "{Découvrez|Profitez de|Ne manquez pas} {notre offre|cette opportunité}"], ["Bouton", "{J'en profite|Voir l'offre|Je découvre}"]].map(([l, t]) => <button type="button" key={l} title={`Insérer un spintax ${t}`} className="rounded border border-dashed border-primary/50 bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-primary" onClick={() => { const el = document.querySelector<HTMLTextAreaElement>('[aria-label="Contenu HTML"]'); const a = el?.selectionStart ?? d.body.length, b = el?.selectionEnd ?? a; u("body", d.body.slice(0, a) + t + d.body.slice(b)); }}>✦ {l}</button>)}</div>
          <p className="text-[10.5px] text-muted-foreground">Spintax : <code>{"{Bonjour|Salut}"}</code> (imbricable) · repli : <code>{"{first_name|Cher client}"}</code> — fonctionne aussi dans l'objet.</p>
          <textarea aria-label="Contenu HTML" value={d.body} onChange={e => u("body", e.target.value)} className="h-36 w-full resize-y rounded-md border border-border bg-card p-2 font-mono text-[11.5px] leading-5 text-primary focus:outline-none focus:ring-1 focus:ring-ring" />
          <details className="rounded-md border border-border p-2 text-sm">
            <summary className="cursor-pointer font-semibold">AMP for Email (facultatif){d.ampHtml.trim() && " · Activé"}</summary>
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">Collez un document AMP4EMAIL complet. Le corps HTML ci-dessus sert de version de secours. Laissez le champ vide pour envoyer uniquement la version classique.</p>
              <Row label="Document AMP4EMAIL">{area("ampHtml", "h-36", "<!doctype html>", true)}</Row>
              <div className="flex flex-wrap gap-2">
                {!d.ampHtml.trim() && <Chip onClick={async () => {
                  try {
                    const { AMP_EMAIL_EXAMPLE } = await import('@/lib/amp-email');
                    setD(draft => draft.ampHtml.trim() ? draft : { ...draft, ampHtml: AMP_EMAIL_EXAMPLE });
                  } catch { toast.error('Le modèle AMP est indisponible.'); }
                }}><FileCode2 /> Insérer un exemple</Chip>}
                {d.ampHtml.trim() && <Chip onClick={async () => {
                  try {
                    const { prepareAmpEmail } = await import('@/lib/amp-email');
                    prepareAmpEmail(d.ampHtml);
                    toast.success('Structure AMP vérifiée.');
                  } catch (error) { toast.error(error instanceof Error ? error.message : 'Le document AMP est invalide.'); }
                }}><ShieldCheck /> Pré-vérifier le document</Chip>}
              </div>
              <p className="text-xs text-muted-foreground">L’affichage interactif dépend du client de messagerie et de l’autorisation de l’expéditeur. <a className="underline" href="https://amp.dev/documentation/guides-and-tutorials/email/learn/validation-workflow/validate_emails/" target="_blank" rel="noreferrer">Validation officielle AMP</a></p>
            </div>
          </details>
          <div className="flex flex-wrap gap-1.5">
            <Chip onClick={() => toast(`${(d.body.match(/href=/g) ?? []).length} lien(s) détecté(s).`)}><Link2 />Liens</Chip>
            <Chip onClick={() => document.querySelector<HTMLTextAreaElement>('[aria-label="Contenu HTML"]')?.focus()}><Code2 />Éditeur</Chip>
            <Chip onClick={() => setPreview(d.body)}><Play />Render</Chip>
            <Chip onClick={() => { u("body", d.body.replace(/href="(?!\{)[^"]*"/g, 'href="{offer_url}"')); toast.success("Liens remplacés par {offer_url}."); }}><RefreshCw />Remplacer liens</Chip>
          </div>
          </div>
        </Col>
        <Col title="Aperçu HTML" icon={<Search />}>
          <EmailPreview html={preview} subject={d.subject} fromName={d.fromName} />
          <div className="flex items-center justify-between"><IconBtn label="Rafraîchir" tone="primary" onClick={() => setPreview(content)}><RefreshCw /></IconBtn><label className="flex items-center gap-2 text-[12px] font-semibold"><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} className="size-4 accent-primary" />Activer l'aperçu en temps réel</label></div>
        </Col>
      </div>

      {/* Délivrabilité */}
      <div className="flex min-w-0 flex-col">
        <div id="deliv" className="scroll-mt-24"><BuilderDelivery servers={inventory.data ?? []} serverId={d.serverId} poolId={d.vmtaPoolId} onServer={id => setD(p => ({ ...p, serverId: id, vmtaPoolId: id === p.serverId ? p.vmtaPoolId : "" }))} onPool={id => u("vmtaPoolId", id)} /></div>
        {inventory.error && <p role="alert" className="text-xs text-destructive">{inventory.error.message}</p>}

        <details className="card-lux mb-3 break-inside-avoid p-3.5"><summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-bold text-primary"><Braces className="size-5" />Variables (Placeholders)<span className="ml-auto text-lg">+</span></summary>
          <div className="mt-2 flex flex-wrap gap-1">{["{first_name}", "{to}", "{subject}", "{from_name}", "{from_email}", "{domain}", "{offer_url}", "{unsubscribe_url}", "{smtp_date}", "{n,15}", "{A,3}"].map(v => <button key={v} onClick={() => { navigator.clipboard?.writeText(v); toast.success(`${v} copié.`); }} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">{v}</button>)}</div>
        </details>
      </div>
    </div>

    <LaunchPanel key={launchPanelKey} d={sendDraft} testMode={testMode} onServerChange={id => u("serverId", id)} onPoolChange={id => u("vmtaPoolId", id)} onTopicChange={topic => u("topic", topic)} onPriorityChange={priority => u("sendPriority", priority)} onDeadlineChange={date => u("sendDeadline", date)} onSendWindowChange={(start, end) => setD(previous => ({ ...previous, sendWindowStart: start, sendWindowEnd: end }))}
      onAudienceChange={(listId, segmentId) => setD(previous => ({ ...previous, listId, segmentId }))}
      onDraftContentChange={(subject, body) => setD(previous => ({ ...previous, subject, body }))} />

    {/* Préflight */}
    <section id="preflight" className="card-lux mb-3 break-inside-avoid scroll-mt-24 p-3.5">
      <h2 className="mb-2 flex items-center gap-2 font-display text-[16px] font-bold text-primary"><FlaskConical className="size-5" />Résultats des tests & Préflight</h2>
      <details className="mb-3 rounded-lg border p-2 text-sm">
        <summary className="cursor-pointer font-medium">Checklist {digestMode ? 'du récapitulatif' : d.sponsorOfferId ? 'de l’offre sponsor' : 'de l’envoi standard'}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{checklist.map(item => <li key={item}>{item}</li>)}</ul>
      </details>
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_1.4fr_1fr_auto]">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 p-2.5"><span className={`grid size-9 place-items-center rounded-full ${ready ? "bg-neon-green text-primary-foreground" : "bg-neon-amber/20 text-neon-amber"}`}><Check className="size-5" /></span><div><p className="text-[13px] font-bold">{lastTest ? (ready ? "Contrôles du brouillon réussis" : "Corrections nécessaires") : "Tests en attente..."}</p><p className="text-[11.5px] text-muted-foreground">Préflight : validation des paramètres, serveurs et contenu.</p></div></div>
        <div className="rounded-xl border border-border/60 p-2.5">
          <div className="flex flex-wrap justify-between gap-2">{checks.map(c => <span key={c.l} className="flex items-center gap-1 text-[12px] font-semibold"><span className={`grid size-4 place-items-center rounded-full ${c.ok ? "bg-neon-green" : "bg-neon-red"} text-primary-foreground`}>{c.ok ? <Check className="size-3" /> : <X className="size-3" />}</span>{c.l}</span>)}</div>
          <div className="mt-2 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-neon-green transition-all" style={{ width: `${(passed / checks.length) * 100}%` }} /></div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border/60 p-2.5 text-[12.5px]"><BadgeCheck className="size-5 text-neon-green" />Dernier test : <b>{lastTest ? `Aujourd'hui à ${lastTest}` : "—"}</b>{lastTest && <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${ready ? "bg-neon-green/15 text-neon-green" : "bg-neon-red/15 text-neon-red"}`}>{ready ? "Réussi" : "Échec"}</span>}</div>
        <button onClick={runTests} className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-card px-5 py-2.5 text-[14px] font-bold text-primary shadow-sm hover:bg-primary/10"><Play className="size-4 fill-current" />Lancer les tests</button>
      </div>
    </section>
    <div className={`lux-banner flex items-center justify-center gap-3 rounded-2xl px-4 py-2.5 text-[13px] font-semibold`}>
      {ready ? <ShieldCheck className="size-5 text-neon-green" /> : <Rocket className="size-5 text-neon-amber" />}
      {ready ? "L'infrastructure de campagne est prête, la validation préflight est réussie et la campagne peut être publiée en toute sécurité." : "Complétez les contrôles du préflight pour publier la campagne en toute sécurité."}
    </div>
  </div>;
}
