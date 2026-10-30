import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, Mail, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      {tab === "Testeur 10/10" && <Scorer />}
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
