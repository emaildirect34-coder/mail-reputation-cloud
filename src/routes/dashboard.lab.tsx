import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Mail, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { mailTesterNew, mailTesterResult } from "@/lib/ops.functions";
import { autoFixDomain, recheckDomainDns } from "@/lib/domains.functions";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/lab")({
  head: () => ({
    meta: [
      { title: "Mail-Tester & DNS Lab — Email Direct" },
      { name: "description", content: "Score 10/10 en direct, générateurs et testeurs SPF, DKIM, DMARC, BIMI et MTA-STS." },
      { property: "og:title", content: "Mail-Tester & DNS Lab — Email Direct" },
      { property: "og:description", content: "Laboratoire interne de délivrabilité." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Lab,
});

const tabs = ["Testeur 10/10", "SPF", "DKIM", "DMARC", "BIMI / VMC", "MTA-STS", "Contenu & Liens"] as const;
type Tab = (typeof tabs)[number];

function Lab() {
  const [tab, setTab] = useState<Tab>("Testeur 10/10");
  return (
    <>
      <PageHeader title="Mail-Tester & DNS Lab" desc="Votre clone interne de mail-tester : score en direct, générateurs et vérificateurs DNS." />
      <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap rounded-t-md px-3 py-2 text-sm transition ${tab === t ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Testeur 10/10" && <VpsTester />}
      {tab === "SPF" && <Spf />}
      {tab === "DKIM" && <Dkim />}
      {tab === "DMARC" && <Dmarc />}
      {tab === "BIMI / VMC" && <Bimi />}
      {tab === "MTA-STS" && <MtaSts />}
      {tab === "Contenu & Liens" && <Content />}
    </>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>
      <Button size="icon" variant="ghost" className="absolute right-1 top-1 h-7 w-7" onClick={() => navigator.clipboard?.writeText(children)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function Scorer() {
  const checks = [
    ["SPF", "pass — ip4:203.0.113.10 autorisée", "ok", "0"],
    ["DKIM (RSA-2048 + Ed25519)", "2 signatures valides, over-signing actif", "ok", "0"],
    ["DMARC", "p=reject, alignement strict", "ok", "0"],
    ["ARC", "Chaîne i=1 valide", "ok", "0"],
    ["RFC 8058 List-Unsubscribe-Post", "Présent", "ok", "0"],
    ["Rspamd", "Score 1.2 (HTML_SHORT_LINK_IMG_1)", "warn", "-0.3"],
    ["Spamhaus DQS (IP + DBL)", "Non listé", "ok", "0"],
    ["Ratio texte / HTML", "Version texte présente (parité 92 %)", "ok", "0"],
    ["Liens", "1 lien raccourci détecté (bit.ly)", "bad", "-0.5"],
  ] as const;
  return (
    <>
      <Panel title="Adresse de test éphémère">
        <p className="mb-3 text-sm text-muted-foreground">Envoyez votre email à cette adresse puis cliquez sur « Voir mon score ».</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input readOnly value="test-89k4z@lab.emaildirect.io" className="font-mono" />
          <Button variant="outline"><RefreshCw className="h-4 w-4" /> Nouvelle</Button>
          <Button><Mail className="h-4 w-4" /> Voir mon score</Button>
        </div>
      </Panel>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Score global" value="9.2 / 10" sub="Très bon — 2 points à corriger" />
        <Stat label="Authentification" value="5 / 5" sub="SPF, DKIM, DMARC, ARC, BIMI" />
        <Stat label="Blacklists" value="0 / 24" sub="Aucune liste noire" />
      </div>
      <Panel title="Détail du score">
        <DataTable
          cols={["Contrôle", "Résultat", "Statut", "Pénalité"]}
          rows={checks.map(([n, r, t, p]) => [<span className="font-medium">{n}</span>, <span className="text-xs">{r}</span>, <Pill tone={t}>{t === "ok" ? "OK" : t === "warn" ? "Attention" : "Échec"}</Pill>, <code className="text-xs">{p}</code>])}
        />
      </Panel>
    </>
  );
}

function Spf() {
  const [ips, setIps] = useState("203.0.113.10, 203.0.113.11");
  const [inc, setInc] = useState("_spf.google.com");
  const rec = `v=spf1 ${ips.split(",").map((s) => s.trim()).filter(Boolean).map((i) => `ip4:${i}`).join(" ")} ${inc.split(",").map((s) => s.trim()).filter(Boolean).map((i) => `include:${i}`).join(" ")} -all`.replace(/\s+/g, " ");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Générateur SPF">
        <div className="space-y-3">
          <div><label className="text-xs text-muted-foreground">IPs d'envoi (séparées par virgule)</label><Input value={ips} onChange={(e) => setIps(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Includes</label><Input value={inc} onChange={(e) => setInc(e.target.value)} /></div>
          <Code>{rec}</Code>
        </div>
      </Panel>
      <Panel title="Vérificateur SPF">
        <div className="mb-3 flex gap-2"><Input defaultValue="emaildirect.io" /><Button>Vérifier</Button></div>
        <div className="mb-1 flex justify-between text-xs"><span>Lookups DNS (limite RFC 7208)</span><span>7 / 10</span></div>
        <Bar value={70} />
        <ul className="mt-3 space-y-1 text-sm">
          <li className="flex justify-between">Syntaxe <Pill tone="ok">Valide</Pill></li>
          <li className="flex justify-between">Politique finale <Pill tone="ok">-all</Pill></li>
          <li className="flex justify-between">Enregistrements multiples <Pill tone="ok">Aucun</Pill></li>
        </ul>
      </Panel>
    </div>
  );
}

function Dkim() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Générateur DKIM">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-muted-foreground">Sélecteur RSA</label><Input defaultValue="ed2026a" /></div>
            <div><label className="text-xs text-muted-foreground">Sélecteur Ed25519</label><Input defaultValue="ed2026b" /></div>
          </div>
          <Button><Wand2 className="h-4 w-4" /> Générer la paire double (RSA-2048 + Ed25519)</Button>
          <Code>{"ed2026a._domainkey  TXT  \"v=DKIM1; k=rsa; p=MIIBIjANBgkqh...IDAQAB\""}</Code>
          <Code>{"ed2026b._domainkey  TXT  \"v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=\""}</Code>
        </div>
      </Panel>
      <Panel title="Vérificateur DKIM">
        <div className="mb-3 flex gap-2"><Input defaultValue="ed2026a" className="w-28" /><Input defaultValue="emaildirect.io" /><Button>Vérifier</Button></div>
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between">Clé publiée <Pill tone="ok">Oui</Pill></li>
          <li className="flex justify-between">Taille de clé <Pill tone="ok">2048 bits</Pill></li>
          <li className="flex justify-between">Over-signing (From, Subject, To) <Pill tone="ok">Actif</Pill></li>
          <li className="flex justify-between">Rotation <Pill tone="warn">Il y a 182 jours</Pill></li>
        </ul>
      </Panel>
    </div>
  );
}

function Dmarc() {
  const [p, setP] = useState("quarantine");
  const [pct, setPct] = useState(100);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Générateur DMARC">
        <div className="space-y-3">
          <div className="flex gap-2">
            {["none", "quarantine", "reject"].map((v) => (
              <Button key={v} size="sm" variant={p === v ? "default" : "outline"} onClick={() => setP(v)}>p={v}</Button>
            ))}
          </div>
          <div><label className="text-xs text-muted-foreground">Pourcentage appliqué : {pct}%</label><input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(+e.target.value)} className="w-full accent-primary" /></div>
          <Code>{`_dmarc  TXT  "v=DMARC1; p=${p}; pct=${pct}; adkim=s; aspf=s; rua=mailto:rua@reports.emaildirect.io; ruf=mailto:ruf@reports.emaildirect.io; fo=1"`}</Code>
        </div>
      </Panel>
      <Panel title="Vérificateur DMARC & simulation p=reject">
        <div className="mb-3 flex gap-2"><Input defaultValue="emaildirect.io" /><Button>Vérifier</Button></div>
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between">Politique actuelle <Pill tone="ok">reject</Pill></li>
          <li className="flex justify-between">Alignement DKIM / SPF <Pill tone="ok">strict / strict</Pill></li>
          <li className="flex justify-between">Prêt pour BIMI <Pill tone="ok">Oui</Pill></li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Simulation sur 30 jours de rapports RUA : 99,6 % des messages légitimes passeraient en p=reject.</p>
      </Panel>
    </div>
  );
}

function Bimi() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Vérificateur BIMI / VMC">
        <div className="mb-3 flex gap-2"><Input defaultValue="emaildirect.io" /><Button>Vérifier</Button></div>
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between">Enregistrement default._bimi <Pill tone="ok">Trouvé</Pill></li>
          <li className="flex justify-between">Logo SVG Tiny P/S <Pill tone="ok">Conforme</Pill></li>
          <li className="flex justify-between">Certificat VMC / CMC <Pill tone="warn">Manquant (Gmail)</Pill></li>
          <li className="flex justify-between">DMARC p=quarantine/reject <Pill tone="ok">OK</Pill></li>
        </ul>
        <Code>{"default._bimi  TXT  \"v=BIMI1; l=https://emaildirect.io/bimi.svg; a=\""}</Code>
      </Panel>
      <Panel title="Aperçu dans la boîte">
        <div className="space-y-2">
          {["Gmail", "Apple Mail", "Yahoo"].map((c) => (
            <div key={c} className="flex items-center gap-3 rounded-md border border-border p-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">ED</div>
              <div className="flex-1"><p className="text-sm font-medium">Email Direct</p><p className="text-xs text-muted-foreground">Votre rapport mensuel est prêt</p></div>
              <span className="text-xs text-muted-foreground">{c}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function MtaSts() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Générateur MTA-STS & TLS-RPT">
        <div className="space-y-3">
          <Code>{"_mta-sts      TXT  \"v=STSv1; id=20261030\"\n_smtp._tls    TXT  \"v=TLSRPTv1; rua=mailto:tls@reports.emaildirect.io\""}</Code>
          <p className="text-xs text-muted-foreground">Fichier https://mta-sts.emaildirect.io/.well-known/mta-sts.txt</p>
          <Code>{"version: STSv1\nmode: enforce\nmx: mx1.emaildirect.io\nmx: mx2.emaildirect.io\nmax_age: 604800"}</Code>
        </div>
      </Panel>
      <Panel title="Vérificateur MTA-STS & DANE">
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between">Politique MTA-STS <Pill tone="ok">enforce</Pill></li>
          <li className="flex justify-between">Certificat HTTPS <Pill tone="ok">Valide</Pill></li>
          <li className="flex justify-between">DNSSEC <Pill tone="ok">Signé</Pill></li>
          <li className="flex justify-between">TLSA (DANE 3 1 1) <Pill tone="warn">mx2 absent</Pill></li>
          <li className="flex justify-between">Rapports TLS-RPT reçus (7 j) <Pill>142</Pill></li>
        </ul>
      </Panel>
    </div>
  );
}

function Content() {
  const words = [["GRATUIT", "Élevé"], ["100% garanti", "Élevé"], ["Cliquez ici", "Moyen"], ["Offre limitée", "Moyen"]];
  const links = [
    ["https://emaildirect.io/offre", "Direct", "ok", "Propre"],
    ["https://bit.ly/3xK9", "3 redirections", "bad", "Raccourcisseur"],
    ["https://track.client.com/c/88", "1 redirection", "ok", "Domaine dédié"],
  ] as const;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Scanner de mots à risque">
        <textarea className="mb-3 h-28 w-full rounded-md border border-input bg-background p-2 text-sm" defaultValue="Profitez de notre offre GRATUIT 100% garanti — Cliquez ici !" />
        <div className="flex flex-wrap gap-2">
          {words.map(([w, r]) => <Pill key={w} tone={r === "Élevé" ? "bad" : "warn"}>{w} · {r}</Pill>)}
        </div>
      </Panel>
      <Panel title="Inspecteur de liens & URIBL">
        <DataTable cols={["URL", "Chaîne", "Statut"]} rows={links.map(([u, c, t, s]) => [<code className="text-xs">{u}</code>, <span className="text-xs">{c}</span>, <Pill tone={t}>{s}</Pill>])} />
      </Panel>
    </div>
  );
}

const INFO: Record<string, { name: string; why: string }> = {
  spf: { name: "SPF — serveur autorisé", why: "Dit aux boîtes mail que votre serveur a le droit d'envoyer pour ce domaine. Sans lui, l'email paraît suspect." },
  dkim: { name: "DKIM — signature du domaine", why: "Prouve que l'email vient bien de vous et n'a pas été modifié en route." },
  dmarc: { name: "DMARC — protection anti-usurpation", why: "Indique quoi faire des emails qui échouent SPF/DKIM. Exigé par Gmail et Yahoo." },
  dmarc_alignment: { name: "Alignement DMARC", why: "Le domaine signé doit correspondre au domaine affiché dans « De : »." },
  arc: { name: "ARC — chaîne de confiance", why: "Utile surtout pour les relais et listes de diffusion. Faible impact pour un envoi direct." },
  rspamd: { name: "Filtre anti-spam Rspamd", why: "Le filtre utilisé par de nombreux hébergeurs analyse le contenu et les en-têtes." },
  spamassassin: { name: "Filtre anti-spam SpamAssassin", why: "Le filtre historique. Un score sous 5 signifie que l'email passe." },
  rdns: { name: "Reverse DNS de l'IP", why: "L'adresse IP doit pointer vers un nom de serveur réel." },
  mime: { name: "Structure du message", why: "Le format technique (texte, HTML, pièces jointes) est bien construit." },
  links: { name: "Liens du message", why: "Vérifie les liens raccourcis, redirigés ou cassés." },
  rfc8058: { name: "Désinscription en 1 clic", why: "Obligatoire pour Gmail et Yahoo depuis 2024 pour les envois en masse." },
  list_unsubscribe: { name: "Lien de désinscription", why: "Permet au destinataire de se désinscrire au lieu de cliquer « Spam »." },
  gmail_yahoo_2024: { name: "Règles Gmail & Yahoo 2024", why: "Résumé des exigences des deux plus grosses messageries." },
  fr_isp: { name: "Orange, SFR, Free", why: "Exigences propres aux fournisseurs français (nom du serveur, EHLO)." },
  rbl: { name: "Listes noires", why: "Votre IP ne doit figurer sur aucune liste noire anti-spam." },
  subnet24: { name: "Réputation des IP voisines", why: "Les IP de votre bloc /24 peuvent nuire à votre réputation." },
  mta_sts: { name: "MTA-STS", why: "Force le chiffrement des emails reçus sur votre domaine. Bonus de confiance." },
  dane_tlsa: { name: "DANE / TLSA", why: "Sécurité avancée du chiffrement. Bonus, non bloquant." },
  bimi_vmc: { name: "BIMI — logo dans la boîte", why: "Affiche votre logo à côté de vos emails dans Gmail et Yahoo. Bonus." },
};
const GROUPS: { title: string; desc: string; keys: string[] }[] = [
  { title: "Authentification", desc: "Prouver que vous êtes bien l'expéditeur", keys: ["spf", "dkim", "dmarc", "dmarc_alignment", "arc"] },
  { title: "Filtres anti-spam & contenu", desc: "Comment les filtres jugent votre message", keys: ["rspamd", "spamassassin", "mime", "links"] },
  { title: "Règles des messageries", desc: "Exigences Gmail, Yahoo et fournisseurs français", keys: ["rfc8058", "list_unsubscribe", "gmail_yahoo_2024", "fr_isp"] },
  { title: "Réputation du serveur", desc: "Image de votre IP sur Internet", keys: ["rdns", "rbl", "subnet24"] },
  { title: "Bonus avancés", desc: "Pour aller au-delà du 10/10", keys: ["mta_sts", "dane_tlsa", "bimi_vmc"] },
];

function CheckCard({ k, v, pts }: { k: string; v: any; pts?: number | undefined }) {
  const [open, setOpen] = useState(!v.pass);
  const [copied, setCopied] = useState(false);
  const info = INFO[k] ?? { name: k.toUpperCase(), why: "" };
  return (
    <div className={`rounded-lg border p-3 ${v.pass ? "border-border" : "border-destructive/40 bg-destructive/5"}`}>
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
        <div>
          <p className="text-sm font-medium">{info.name}</p>
          <p className="text-xs text-muted-foreground">{info.why}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pts ? <Pill tone="bad">{pts} pt</Pill> : null}
          <Pill tone={v.pass ? "ok" : "bad"}>{v.pass ? "OK" : "À corriger"}</Pill>
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {v.detail && <p className="break-words text-xs text-muted-foreground"><span className="font-medium text-foreground">Constaté : </span>{v.detail}</p>}
          {v.fix && (
            <div className="rounded-md bg-muted p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium">Solution</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => { navigator.clipboard?.writeText(v.fix); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  <Copy className="mr-1 h-3 w-3" />{copied ? "Copié" : "Copier la solution"}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-words text-xs">{v.fix}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Report({ res, checks }: { res: any; checks: [string, any][] }) {
  const score = Number(res.score);
  const map = Object.fromEntries(checks);
  const pen = new Map<string, number>((res.penalties ?? []).map((p: any) => [String(p.rule).toLowerCase(), Number(p.points)]));
  const failed = checks.filter(([, v]) => !v.pass).length;
  const gain = (res.penalties ?? []).reduce((s: number, p: any) => s - Number(p.points), 0);
  const verdict = score >= 9 ? ["Excellent", "Votre email arrivera en boîte de réception.", "ok"] : score >= 7 ? ["Correct", "Quelques réglages pour éviter les spams.", "warn"] : ["Risque de spam", "Gmail et Yahoo risquent de classer cet email en spam.", "bad"];
  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const others = checks.filter(([k]) => !known.has(k)).map(([k]) => k);
  const groups = others.length ? [...GROUPS, { title: "Autres contrôles", desc: "", keys: others }] : GROUPS;
  return (
    <div className="mt-4 space-y-3">
      <AutoFix res={res} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-border p-4 lg:col-span-1">
          <p className="text-xs text-muted-foreground">Score global</p>
          <p className="text-4xl font-bold text-primary">{score.toFixed(1)}<span className="text-lg text-muted-foreground"> / 10</span></p>
          <div className="my-2"><Bar value={score * 10} /></div>
          <Pill tone={verdict[2] as any}>{verdict[0]}</Pill>
          <p className="mt-2 text-sm text-muted-foreground">{verdict[1]}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          {groups.slice(0, 4).map((g) => {
            const items = g.keys.filter((k) => map[k]);
            const ok = items.filter((k) => map[k].pass).length;
            return <Stat key={g.title} label={g.title} value={`${ok} / ${items.length}`} sub={ok === items.length ? "Tout est bon" : `${items.length - ok} à corriger`} />;
          })}
        </div>
      </div>
      {failed > 0 && (
        <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <span className="font-medium">{failed} point(s) à corriger.</span> {gain > 0 && <>Les corrections ci-dessous peuvent vous faire gagner <b>+{gain.toFixed(1)} pt</b>. </>}Cliquez sur « Copier la solution » puis appliquez-la dans vos DNS ou votre serveur.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groups.map((g) => {
          const items = g.keys.filter((k) => map[k]).sort((a, b) => Number(map[a].pass) - Number(map[b].pass));
          if (!items.length) return null;
          return (
            <Panel key={g.title} title={g.title} action={<span className="text-xs text-muted-foreground">{g.desc}</span>}>
              <div className="space-y-2">{items.map((k) => <CheckCard key={k} k={k} v={map[k]} pts={pen.get(k)} />)}</div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function senderDomain(res: any): string {
  const h = res?.headers;
  const raw = String(res?.from ?? res?.sender ?? res?.mail_from ?? (Array.isArray(h) ? (h.find((x: any) => /^from$/i.test(x?.name ?? x?.[0] ?? ""))?.value ?? "") : (h?.From ?? h?.from ?? (typeof h === "string" ? (h.match(/^From:.*$/im)?.[0] ?? "") : ""))));
  return (raw.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] ?? "").toLowerCase();
}

const STATE: Record<string, [string, "ok" | "warn" | "bad" | "neutral"]> = {
  done: ["Déjà en place — en attente de validation par Gmail/Yahoo/Outlook", "warn"],
  fixed: ["Corrigé automatiquement", "ok"],
  pending: ["Publié — propagation DNS en cours", "warn"],
  manual: ["À corriger manuellement", "bad"],
  verified: ["Vérifié ✓ — visible sur Internet", "ok"],
};

function AutoFix({ res }: { res: any }) {
  const run = useServerFn(autoFixDomain);
  const [domain, setDomain] = useState(senderDomain(res));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Awaited<ReturnType<typeof autoFixDomain>> | null>(null);
  const [err, setErr] = useState("");
  const recheck = useServerFn(recheckDomainDns);
  const [live, setLive] = useState<Record<string, boolean>>({});
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const waiting = !!out?.items.some((i) => i.state !== "manual" && i.state !== "fixed" && !live[i.key]);
  useEffect(() => {
    if (!out?.ok || !waiting) return;
    let stop = false;
    const tick = async () => {
      try { const r = await recheck({ data: { domain: out.domain } }); if (!stop) { setLive(r.checks); setLastCheck(new Date()); } } catch { /* retry next tick */ }
    };
    tick();
    const t = setInterval(tick, 20000);
    return () => { stop = true; clearInterval(t); };
  }, [out, waiting]);
  const go = async () => {
    setLive({});
    setBusy(true); setErr(""); setOut(null);
    try { setOut(await run({ data: { domain } })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-success/40 bg-success/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={go} disabled={busy || !domain} className="bg-success text-primary-foreground hover:bg-success/90">
          <Wand2 className="mr-1 h-4 w-4" />{busy ? "Vérification et correction…" : "Automatiser les corrections"}
        </Button>
        <Input value={domain} onChange={(e) => setDomain(e.target.value.trim())} placeholder="domaine expéditeur" className="max-w-xs" />
        <span className="text-xs text-muted-foreground">Vérifie d'abord ce qui est déjà fait, puis publie seulement ce qui manque.</span>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {out && (
        <div className="mt-3 space-y-2">
          {out.message && <p className="text-sm text-muted-foreground">{out.message}</p>}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {out.items.map((i) => (
              <div key={i.key} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                <span className="font-medium">{i.label}</span>{(() => { const st = live[i.key] || i.state === "fixed" ? "verified" : i.state; return <Pill tone={STATE[st]?.[1] ?? "neutral"}>{STATE[st]?.[0]}</Pill>; })()}
              </div>
            ))}
          </div>
          {out.ok && <p className="text-xs text-muted-foreground">{waiting ? <>Vérification automatique toutes les 20 s{lastCheck && <> — dernière : {lastCheck.toLocaleTimeString()}</>}. Chaque ligne passe au vert dès qu'elle est visible.</> : "Tout est vérifié et visible sur Internet."}</p>}
          {false && <p className="text-xs text-muted-foreground">Les éléments « déjà en place » sont bien publiés : les fournisseurs peuvent mettre jusqu'à 48 h pour les prendre en compte. Refaites un test plus tard.</p>}
        </div>
      )}
    </div>
  );
}

function VpsTester() {
  const create = useServerFn(mailTesterNew);
  const fetchResult = useServerFn(mailTesterResult);
  const [test, setTest] = useState<{ test_id: string; email: string } | null>(null);
  const [res, setRes] = useState<any>(null);
  const [state, setState] = useState<"idle" | "busy" | "off" | "error">("idle");
  const [err, setErr] = useState("");
  const start = async () => {
    setState("busy"); setRes(null);
    try { const r = await create(); if (!r.configured) { setState("off"); return; } setTest(r.test); setState("idle"); }
    catch (e) { setErr((e as Error).message); setState("error"); }
  };
  const check = async () => {
    if (!test) return; setState("busy");
    try { const r = await fetchResult({ data: { id: test.test_id } }); setRes(r.result); setState("idle"); }
    catch (e) { setErr((e as Error).message); setState("error"); }
  };
  const checks: [string, any][] = res ? Object.entries(res.checks ?? {}) : [];
  return (
    <Panel title="Testeur 10/10 — serveur Mail-Tester" action={<Pill tone={state === "off" ? "warn" : "neutral"}>{state === "off" ? "Serveur non connecté" : "VPS"}</Pill>}>
      {state === "off" && <p className="mb-3 text-sm text-muted-foreground">Le serveur Mail-Tester n'est pas encore relié. Dès que son adresse et sa clé seront enregistrées, les tests fonctionneront ici.</p>}
      {state === "error" && <p className="mb-3 text-sm text-destructive">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={start} disabled={state === "busy"}><Mail className="mr-1 h-3.5 w-3.5" />Nouvelle adresse de test</Button>
        {test && <><Input readOnly value={test.email} className="max-w-xs" /><Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(test.email)}><Copy className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" onClick={check} disabled={state === "busy"}><RefreshCw className="mr-1 h-3.5 w-3.5" />Voir le résultat</Button></>}
      </div>
      {test && !res && <p className="mt-3 text-sm text-muted-foreground">Envoyez votre email à cette adresse, puis cliquez sur « Voir le résultat ».</p>}
      {res && res.status !== "done" && <p className="mt-3 text-sm text-muted-foreground">En attente de réception de l'email…</p>}
      {res?.status === "done" && (
        <Report res={res} checks={checks} />
      )}
    </Panel>
  );
}
