import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { Copy, Mail, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { inspectDmarcAuthorization, inspectDmarcPolicy, inspectSenderDns, mailTesterNew, mailTesterResult } from "@/lib/ops.functions";
import { dmarcPolicies, dmarcRecord } from "@/lib/dmarc-policy";
import { autoFixDomain, publishExternalDmarcAuthorization, recheckDomainDns } from "@/lib/domains.functions";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";
import { DanePanel } from "@/components/dash/dane-panel";
import { prepareBimiSvg } from "@/lib/bimi-svg";

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
      {tab === "SPF" && <SenderLookup kind="SPF" />}
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

function SenderLookup({ kind }: { kind: "SPF" | "DKIM" }) {
  const inspect = useServerFn(inspectSenderDns);
  const [domain, setDomain] = useState("");
  const [selector, setSelector] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof inspectSenderDns>> | null>(null);
  const labels: Record<string, string> = {
    ok: "Budget SPF dans la limite", over: "Plus de 10 termes DNS dans les branches inspectées",
    missing: "Enregistrement absent", invalid: "Enregistrements incompatibles ou invalides",
    unknown: "Résolution ou analyse incomplète", revoked: "Clé révoquée", published: "Clé publique publiée",
  };

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    setError("");
    try {
      setResult(await inspect({ data: { domain, ...(kind === "DKIM" ? { selector } : {}) } }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Vérification DNS impossible.");
    } finally {
      setBusy(false);
    }
  }

  return <Panel title={`Vérificateur ${kind}`}>
    <form className="flex flex-wrap gap-2" onSubmit={verify}>
      {kind === "DKIM" && <Input aria-label="Sélecteur DKIM" className="max-w-44" value={selector} onChange={event => setSelector(event.target.value)} required />}
      <Input aria-label="Domaine à vérifier" className="max-w-sm" placeholder="exemple.fr" value={domain} onChange={event => setDomain(event.target.value)} required />
      <Button disabled={busy}>Vérifier</Button>
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {result && <div className="mt-3 space-y-2">
      <p className="text-sm">{result.name} · {labels[result.status] ?? result.status}{result.terms === null ? "" : ` · ${result.terms} terme(s) DNS`}</p>
      {result.records?.map(record => <Code key={record}>{record}</Code>)}
    </div>}
  </Panel>;
}

function Dkim() {
  return <div className="grid gap-4">
    <SenderLookup kind="DKIM" />
    <Panel title="Gérer les clés d’envoi"><Button variant="outline" asChild><Link to="/dashboard/domains">Ouvrir les domaines</Link></Button></Panel>
  </div>;
}

function Dmarc() {
  type Policy = typeof dmarcPolicies[number];
  const [domain, setDomain] = useState("");
  const [aggregate, setAggregate] = useState("");
  const [policy, setPolicy] = useState<Policy>("none");
  const [children, setChildren] = useState<Policy | "">("");
  const [organizational, setOrganizational] = useState(false);
  const [strict, setStrict] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof inspectDmarcPolicy>> | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const inspect = useServerFn(inspectDmarcPolicy);
  const inspectAuthorization = useServerFn(inspectDmarcAuthorization);
  const publishAuthorization = useServerFn(publishExternalDmarcAuthorization);
  const [authorization, setAuthorization] = useState<Awaited<ReturnType<typeof inspectDmarcAuthorization>> | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedName, setPublishedName] = useState('');
  const record = dmarcRecord({ domain, policy, children, aggregate, organizational, strict });

  async function check() {
    setChecking(true);
    setError("");
    setResult(null);
    setAuthorization(null);
    setPublishedName('');
    try {
      const [policyResult, authorizationResult] = await Promise.all([
        inspect({ data: domain }),
        record?.authorization ? inspectAuthorization({ data: { domain, aggregate } }) : null,
      ]);
      setResult(policyResult);
      setAuthorization(authorizationResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vérification DNS indisponible.");
    } finally {
      setChecking(false);
    }
  }

  async function publish() {
    if (!record?.authorization || authorization?.name !== record.authorization || !authorization.canPublish) return;
    setPublishing(true);
    setError('');
    try {
      await publishAuthorization({ data: { domain, aggregate } });
      setPublishedName(record.authorization);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publication Cloudflare impossible.');
    } finally { setPublishing(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Politique DMARC du domaine expéditeur">
        <div className="space-y-3">
          <label className="block text-sm">Domaine utilisé dans l’adresse « De »
            <Input value={domain} disabled={publishing} onChange={event => { setDomain(event.target.value); setAuthorization(null); setPublishedName(''); }} placeholder="marketing.example.com" maxLength={253} />
          </label>
          <label className="block text-sm">Boîte dédiée aux rapports agrégés (facultatif)
            <Input type="email" value={aggregate} disabled={publishing} onChange={event => { setAggregate(event.target.value); setAuthorization(null); setPublishedName(''); }} placeholder="rapports-marketing@example.com" maxLength={254} />
          </label>
          <label className="block text-sm">Politique de ce domaine (p)
            <select className="block w-full rounded-md border border-border bg-background px-2 py-1" value={policy} onChange={event => setPolicy(event.target.value as Policy)}>
              {dmarcPolicies.map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="block text-sm">Politique des sous-domaines héritiers (sp)
            <select className="block w-full rounded-md border border-border bg-background px-2 py-1" value={children} onChange={event => setChildren(event.target.value as Policy | "")}>
              <option value="">Hériter de p</option>
              {dmarcPolicies.map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={organizational} onChange={event => setOrganizational(event.target.checked)} />Déclarer cette branche comme domaine organisationnel (psd=n)</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={strict} onChange={event => setStrict(event.target.checked)} />Exiger l’alignement exact du domaine SPF ou DKIM</label>
          {record ? <Code>{`${record.name}  TXT  ${record.value.match(/.{1,255}/g)!.map(chunk => `"${chunk}"`).join(" ")}`}</Code> : <p className="text-xs text-muted-foreground">Renseignez le domaine et corrigez, si nécessaire, l’adresse de rapports pour générer le TXT.</p>}
          {record?.authorization && <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Si la boîte relève d’une autre organisation, le destinataire des rapports doit autoriser cet envoi dans son DNS.</p>
            <Code>{`${record.authorization}  TXT  "v=DMARC1"`}</Code>
            {publishedName === record.authorization ? <p className="text-sm" role="status">Autorisation présente dans Cloudflare. Vérifiez sa propagation dans le DNS public.</p> : authorization?.name === record.authorization && <>
              <p className="text-sm" role="status">{authorization.status === 'authorized' ? 'Autorisation trouvée dans le DNS.' : authorization.status === 'missing' ? 'Aucune autorisation valide trouvée dans le DNS.' : 'Autorisation indéterminée. Réessayez le contrôle DNS.'}</p>
              {authorization.canPublish && authorization.status === 'missing' && <Button type="button" variant="outline" disabled={publishing || checking} onClick={() => void publish()}>{publishing ? 'Publication…' : 'Publier l’autorisation sur Cloudflare'}</Button>}
            </>}
          </div>}
          <p className="text-xs text-muted-foreground">Le tag <code>sp</code> ne s’applique aux descendants que si ce domaine est retenu pour leur politique héritée. L’option <code>psd=n</code> modifie aussi le périmètre d’alignement relâché chez les récepteurs qui la prennent en charge.</p>
          <p className="text-xs text-muted-foreground">Publiez un seul TXT DMARC par nom. Vérifiez l’alignement de vos flux légitimes avant de choisir quarantine ou reject.</p>
        </div>
      </Panel>
      <Panel title="Vérification DNS de la politique publiée">
        <Button disabled={checking || publishing || !domain.trim()} onClick={() => void check()}>{checking ? "Vérification…" : "Vérifier le domaine"}</Button>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {result && <div className="mt-3 space-y-2 text-sm" aria-live="polite">
          <p><strong>{result.author}</strong></p>
          {result.record && <>
            <p>Politique {result.record.domain === result.author ? "directe" : "héritée"} depuis <code>_dmarc.{result.record.domain}</code></p>
            <Code>{result.record.text}</Code>
            <p>Traitement demandé en cas d’échec selon RFC 9989. <Pill tone={result.policy === "reject" ? "ok" : "warn"}>{result.policy ?? "Indéterminé"}</Pill></p>
            {result.record.testing && <p>Le mode de test <code>t=y</code> réduit la sévérité d’un niveau selon RFC 9989.</p>}
            {result.record.legacyPct && <p>Des récepteurs utilisant RFC 7489 peuvent encore tenir compte de <code>pct={result.record.legacyPct}</code>.</p>}
          </>}
          {!result.record && <p>{result.uncertain ? "Politique indéterminée. Vérifiez les enregistrements signalés ou relancez le contrôle DNS." : "Aucun enregistrement DMARC exploitable trouvé."}</p>}
          {result.conflicts.length > 0 && <p>Enregistrements multiples ou mal formés à vérifier. {result.conflicts.join(", ")}</p>}
        </div>}
        <p className="mt-3 text-xs text-muted-foreground">Le contrôle remonte les parents selon RFC 9989. Un ancien récepteur peut suivre une autre règle d’héritage. Un TXT explicite sur chaque domaine utilisé dans « De » rend la politique plus prévisible. DMARC règle le traitement des échecs d’authentification. La réputation est évaluée séparément par chaque récepteur.</p>
      </Panel>
    </div>
  );
}

function Bimi() {
  const [domain, setDomain] = useState("");
  const [logo, setLogo] = useState("");
  const [certificate, setCertificate] = useState("");
  const [svgFile, setSvgFile] = useState<File | null>(null);
  const [chainFile, setChainFile] = useState<File | null>(null);
  const [rootsFile, setRootsFile] = useState<File | null>(null);
  const [certificateCheck, setCertificateCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [checkingCertificate, setCheckingCertificate] = useState(false);
  const [review, setReview] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [brand, setBrand] = useState('');
  const [conversionError, setConversionError] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const inspectPolicy = useServerFn(inspectDmarcPolicy);
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  const domainValid = host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+$/.test(host);
  function https(value: string) {
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" && !url.username && !url.password && !/[;"]/.test(url.href) ? url.href : "";
    } catch { return ""; }
  }
  const logoUrl = https(logo);
  const certificateUrl = https(certificate);
  const record = domainValid && logoUrl && (!certificate.trim() || certificateUrl)
    ? `default._bimi.${host}. IN TXT "v=BIMI1; l=${logoUrl}; a=${certificateUrl}"`
    : "";

  async function verifyCertificate() {
    if (!domainValid || !svgFile || !chainFile || !rootsFile || checkingCertificate) return;
    setCheckingCertificate(true);
    setCertificateCheck(null);
    try {
      const { inspectBimiCertificate } = await import("@/lib/bimi-certificate");
      const result = await inspectBimiCertificate(host, svgFile, chainFile, rootsFile);
      const expires = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(result.expires);
      setCertificateCheck({ ok: true, message: `Chaîne, domaine et logo vérifiés. Le certificat expire le ${expires}.` });
    } catch (error) {
      setCertificateCheck({ ok: false, message: error instanceof Error ? error.message : "Le certificat est illisible." });
    } finally {
      setCheckingCertificate(false);
    }
  }

  async function convertLogo() {
    if (!svgFile || svgFile.size > 256_000) return;
    setConversionError('');
    try {
      const output = prepareBimiSvg(await svgFile.text(), brand);
      const url = URL.createObjectURL(new Blob([output], { type: 'image/svg+xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'logo-bimi.svg';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setConversionError(error instanceof Error ? error.message : 'Conversion impossible.');
    }
  }

  async function checkEligibility() {
    setCheckingEligibility(true);
    setEligibility('');
    try {
      const result = await inspectPolicy({ data: host });
      const policy = result.record;
      if (result.uncertain) setEligibility('La politique publiée est indéterminée.');
      else if (!policy || result.policy === null || result.policy === 'none' || policy.testing || (policy.legacyPct !== null && policy.legacyPct !== '100')) {
        setEligibility('La politique DMARC publiée ne satisfait pas le niveau requis pour BIMI.');
      } else setEligibility('La politique DMARC effective du domaine satisfait le niveau requis. Vérifiez l’alignement SPF et DKIM sur un message réellement envoyé.');
    } catch { setEligibility('Le contrôle DNS est indisponible.'); }
    finally { setCheckingEligibility(false); }
  }

  async function inspect(file: File) {
    if (file.size > 256_000) {
      setReview({ errors: ["Fichier trop volumineux pour le contrôle."], warnings: [] });
      return;
    }
    try {
      const source = await file.text();
      if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("Le fichier contient une déclaration XML interdite.");
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      const root = doc.documentElement;
      if (root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg" || doc.querySelector("parsererror")) throw new Error("Le fichier SVG est invalide.");
      const errors: string[] = [];
      const warnings: string[] = [];
      if (root.getAttribute("baseProfile") !== "tiny-ps" || root.getAttribute("version") !== "1.2") errors.push("Définissez baseProfile=\"tiny-ps\" et version=\"1.2\" sur la racine.");
      if (!Array.from(root.children).some(child => child.localName === "title" && child.textContent?.trim())) errors.push("Ajoutez un élément <title> contenant le nom de la marque.");
      if (root.hasAttribute("x") || root.hasAttribute("y")) errors.push("Retirez les attributs x et y de la racine.");
      if (doc.querySelector("script, animate, animateTransform, animateMotion, set, foreignObject, image, style, a")) errors.push("Retirez les scripts, animations, images intégrées, styles externes et éléments interactifs.");
      const hasReferences = Array.from(doc.querySelectorAll("*")).some(element => Array.from(element.attributes).some(attribute =>
        /^on/i.test(attribute.name) || (attribute.localName === "href" && !attribute.value.trim().startsWith("#")) ||
        /url\(\s*['"]?(?!#)[^)'"]+/i.test(attribute.value)));
      if (hasReferences) errors.push("Retirez les références externes et les gestionnaires d’événements.");
      const dimensions = root.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
      if (!dimensions || dimensions.length !== 4 || !dimensions.every(Number.isFinite) || dimensions[2]! <= 0 || dimensions[2] !== dimensions[3]) warnings.push("Utilisez un viewBox carré.");
      if (file.size > 32_768) warnings.push("Réduisez le fichier à 32 Kio ou moins.");
      setReview({ errors, warnings });
    } catch (error) {
      setReview({ errors: [error instanceof Error ? error.message : "Fichier illisible."], warnings: [] });
    }
  }

  return <div className="grid gap-4 lg:grid-cols-2">
    <Panel title="Inspecteur de logo SVG Tiny P/S">
      <label className="grid gap-2 text-sm">Fichier SVG<Input type="file" accept=".svg,image/svg+xml" disabled={checkingCertificate} onChange={e => {
        const file = e.target.files?.[0] ?? null;
        setSvgFile(file);
        setCertificateCheck(null);
        if (file) void inspect(file);
        else setReview(null);
      }} /></label>
      {review && <div className="mt-3 space-y-2 text-sm" role="status">
        {review.errors.length === 0 && <Pill tone="ok">Contrôles de base réussis</Pill>}
        <ul className="list-disc space-y-1 pl-5">{[...review.errors, ...review.warnings].map(issue => <li key={issue}>{issue}</li>)}</ul>
      </div>}
      <label className="mt-3 grid gap-1 text-sm">Nom de la marque<Input value={brand} maxLength={100} onChange={event => setBrand(event.target.value)} /></label>
      <Button className="mt-2" type="button" variant="outline" disabled={!svgFile || svgFile.size > 256_000 || !brand.trim()} onClick={() => void convertLogo()}>Télécharger le SVG Tiny P/S</Button>
      {conversionError && <p role="alert" className="text-sm text-destructive">{conversionError}</p>}
      <p className="mt-3 text-sm text-muted-foreground">Ces contrôles portent sur le fichier local et couvrent les caractéristiques principales du format Tiny P/S.</p>
    </Panel>
    <Panel title="Enregistrement DNS BIMI">
      <div className="space-y-3">
        <label className="grid gap-1 text-sm">Domaine d’envoi<Input placeholder="exemple.fr" value={domain} disabled={checkingCertificate || checkingEligibility} onChange={e => {
          setDomain(e.target.value);
          setCertificateCheck(null);
          setEligibility('');
        }} /></label>
        <label className="grid gap-1 text-sm">URL HTTPS du logo<Input placeholder="https://exemple.fr/logo.svg" value={logo} onChange={e => setLogo(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">URL HTTPS du certificat VMC ou CMC, si disponible<Input placeholder="https://exemple.fr/marque.pem" value={certificate} onChange={e => setCertificate(e.target.value)} /></label>
        {record && <Code>{record}</Code>}
        <Button type="button" variant="outline" disabled={!domainValid || checkingEligibility} onClick={() => void checkEligibility()}>{checkingEligibility ? 'Vérification…' : 'Vérifier la politique publiée'}</Button>
        {eligibility && <p role="status" className="text-sm">{eligibility}</p>}
        <p className="text-sm text-muted-foreground">Publiez le TXT généré après avoir vérifié que DMARC applique quarantine ou reject à 100 %.</p>
      </div>
    </Panel>
    <Panel title="Vérification du certificat BIMI">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Renseignez le domaine d’envoi et sélectionnez le fichier SVG ci-dessus. Les fichiers sont vérifiés dans votre navigateur.</p>
        <label className="grid gap-1 text-sm">Chaîne PEM, certificat de marque en premier<Input type="file" accept=".pem,.crt" disabled={checkingCertificate} onChange={e => {
          setChainFile(e.target.files?.[0] ?? null);
          setCertificateCheck(null);
        }} /></label>
        <label className="grid gap-1 text-sm">Racine PEM de confiance, obtenue auprès de l’autorité BIMI<Input type="file" accept=".pem,.crt" disabled={checkingCertificate} onChange={e => {
          setRootsFile(e.target.files?.[0] ?? null);
          setCertificateCheck(null);
        }} /></label>
        <Button type="button" variant="outline" disabled={!domainValid || !svgFile || !chainFile || !rootsFile || checkingCertificate} onClick={() => void verifyCertificate()}>
          {checkingCertificate ? "Vérification…" : "Vérifier la chaîne et le logo"}
        </Button>
        {certificateCheck && <p role="status" className={certificateCheck.ok ? "text-sm" : "text-sm text-destructive"}>{certificateCheck.message}</p>}
        <p className="text-sm text-muted-foreground">Le contrôle local utilise la racine fournie. La révocation, les journaux Certificate Transparency et les listes de confiance des webmails restent à vérifier séparément.</p>
      </div>
    </Panel>
  </div>;
}

function MtaSts() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Exemple de configuration MTA-STS & TLS-RPT">
        <div className="space-y-3">
          <Code>{"_mta-sts      TXT  \"v=STSv1; id=20261030\"\n_smtp._tls    TXT  \"v=TLSRPTv1; rua=mailto:tls@reports.emaildirect.io\""}</Code>
          <p className="text-xs text-muted-foreground">Fichier https://mta-sts.emaildirect.io/.well-known/mta-sts.txt</p>
          <Code>{"version: STSv1\nmode: enforce\nmx: mx1.emaildirect.io\nmx: mx2.emaildirect.io\nmax_age: 604800"}</Code>
        </div>
      </Panel>
      <DanePanel />
    </div>
  );
}

function Content() {
  const [html, setHtml] = useState("");
  const [links, setLinks] = useState<string[] | null>(null);
  function inspect() {
    const pending: DefaultTreeAdapterTypes.Node[] = [...parseFragment(html).childNodes].reverse();
    const found = new Set<string>();
    while (pending.length) {
      const node = pending.pop()!;
      if ("tagName" in node && node.tagName === "a") {
        const href = node.attrs.find(attr => attr.name === "href")?.value;
        if (href) found.add(href);
      }
      if ("childNodes" in node) {
        for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push(node.childNodes[index]!);
      }
    }
    setLinks([...found]);
  }
  return <Panel title="Liens du message">
    <textarea aria-label="Contenu HTML" className="mb-3 h-28 w-full rounded-md border border-input bg-background p-2 text-sm" value={html} onChange={event => { setHtml(event.target.value); setLinks(null); }} />
    <Button onClick={inspect} disabled={!html.trim()}>Analyser les liens</Button>
    {links && (links.length ? <DataTable cols={["Lien", "Type"]} rows={links.map(url => [
      <code className="break-all">{url}</code>, /^https:\/\//i.test(url) ? "HTTPS" : /^http:\/\//i.test(url) ? "HTTP" : "Autre protocole ou chemin relatif",
    ])} /> : <p className="mt-2 text-sm">Aucun lien trouvé.</p>)}
  </Panel>;
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
          <Pill tone={v.pass ? "ok" : v.status === "warn" ? "warn" : "bad"}>{v.pass ? "OK" : v.status === "warn" ? "À vérifier" : "À corriger"}</Pill>
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
  const verdict = score >= 9 ? ["Excellent", "Le message réussit la plupart des contrôles techniques.", "ok"] : score >= 7 ? ["Correct", "Quelques réglages pour réduire les risques de spam.", "warn"] : ["Risque de spam", "Les contrôles signalent plusieurs risques de délivrabilité.", "bad"];
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
  const checks: [string, any][] = Array.isArray(res?.checks)
    ? res.checks.map((check: { id: string; status: string }) => [check.id, { ...check, pass: check.status === 'pass' }])
    : Object.entries(res?.checks ?? {});
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
