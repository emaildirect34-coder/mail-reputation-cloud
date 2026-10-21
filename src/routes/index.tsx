import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Send, Server, ShieldAlert, MailCheck, BarChart3, Webhook, Check } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Email Direct — API d'envoi d'emails & IPs dédiées" },
      { name: "description", content: "Envoyez, suivez et validez vos emails. IPs dédiées, alertes de réputation et validation d'adresses via une API simple." },
      { property: "og:title", content: "Email Direct — API d'envoi d'emails" },
      { property: "og:description", content: "Infrastructure email avec IPs dédiées, alertes de réputation et validation d'adresses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: Send, title: "API & SMTP d'envoi", desc: "Envoyez des millions d'emails transactionnels et marketing via REST ou SMTP." },
  { icon: Server, title: "IPs dédiées ou partagées", desc: "Choisissez le nombre et le type d'IPs. Infrastructure provisionnée automatiquement." },
  { icon: ShieldAlert, title: "Alertes de réputation", desc: "Surveillance des blacklists pour vos IPs et domaines, alertes en temps réel par API." },
  { icon: MailCheck, title: "Validation d'emails", desc: "Vérifiez syntaxe, MX, adresses jetables et risques avant d'envoyer." },
  { icon: BarChart3, title: "Analytics détaillées", desc: "Délivrés, ouverts, cliqués, rebonds, plaintes — par domaine et par campagne." },
  { icon: Webhook, title: "Webhooks", desc: "Recevez chaque événement en temps réel dans votre application." },
];

const plans = [
  { name: "Starter", price: "19€", vol: "50 000 emails / mois", ips: "IP partagée", items: ["API & SMTP", "1 domaine", "Analytics 7 jours"] },
  { name: "Pro", price: "89€", vol: "250 000 emails / mois", ips: "1 IP dédiée", items: ["5 domaines", "Alertes réputation", "1 000 validations"], featured: true },
  { name: "Scale", price: "349€", vol: "1 000 000 emails / mois", ips: "Jusqu'à 10 IPs dédiées", items: ["Domaines illimités", "Warm-up d'IP", "Support prioritaire"] },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Logo inverted />
          <nav className="hidden gap-8 text-sm text-ink-foreground/70 md:flex">
            <a href="#features" className="hover:text-ink-foreground">Fonctionnalités</a>
            <a href="#pricing" className="hover:text-ink-foreground">Tarifs</a>
            <a href="#api" className="hover:text-ink-foreground">API</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/auth" className="text-sm text-ink-foreground/80 hover:text-ink-foreground">Connexion</Link>
            <Button asChild size="sm"><Link to="/auth" search={{ mode: "signup" }}>Essai gratuit</Link></Button>
          </div>
        </div>

        <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-16 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="inline-block rounded-full border border-primary/40 px-3 py-1 text-xs font-medium text-primary">
              Infrastructure email pour développeurs
            </span>
            <h1 className="mt-6 text-5xl font-bold leading-tight text-ink-foreground md:text-6xl">
              Vos emails arrivent. <span className="text-primary">En boîte de réception.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg text-ink-foreground/70">
              Envoi, IPs dédiées, surveillance de réputation et validation d'adresses — une seule API, mise en place en quelques minutes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link to="/auth" search={{ mode: "signup" }}>Commencer gratuitement</Link></Button>
              <Button asChild size="lg" variant="outline" className="border-ink-foreground/20 bg-transparent text-ink-foreground hover:bg-ink-foreground/10 hover:text-ink-foreground">
                <a href="#api">Voir l'API</a>
              </Button>
            </div>
          </div>
          <pre id="api" className="overflow-x-auto rounded-lg border border-ink-foreground/10 bg-ink-foreground/5 p-6 font-mono text-sm leading-relaxed text-ink-foreground/90">
{`curl -s --user 'api:YOUR_API_KEY' \\
  https://api.emaildirect.io/v1/messages \\
  -F from='Vous <hello@votredomaine.com>' \\
  -F to='client@exemple.com' \\
  -F subject='Bienvenue !' \\
  -F text='Merci pour votre inscription.'

{ "id": "msg_8f2a…", "status": "queued" }`}
          </pre>
        </section>
      </header>

      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-3xl font-bold md:text-4xl">Tout ce qu'il faut pour délivrer</h2>
        <p className="mt-3 max-w-xl text-muted-foreground">Une plateforme complète, sans gérer de serveurs.</p>
        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="bg-card p-8">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="bg-secondary py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-bold md:text-4xl">Tarifs simples</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {plans.map((p) => (
              <div key={p.name} className={`rounded-lg border bg-card p-8 ${p.featured ? "border-primary shadow-lg" : ""}`}>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-4 font-display text-4xl font-bold">{p.price}<span className="text-base font-normal text-muted-foreground"> /mois</span></p>
                <p className="mt-2 text-sm text-muted-foreground">{p.vol}</p>
                <p className="text-sm font-medium text-accent-foreground">{p.ips}</p>
                <ul className="mt-6 space-y-2 text-sm">
                  {p.items.map((i) => <li key={i} className="flex gap-2"><Check className="h-4 w-4 text-success" />{i}</li>)}
                </ul>
                <Button asChild className="mt-8 w-full" variant={p.featured ? "default" : "outline"}>
                  <Link to="/auth" search={{ mode: "signup" }}>Choisir {p.name}</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t py-10 text-center text-sm text-muted-foreground">
        © 2026 Email Direct. Tous droits réservés.
      </footer>
    </div>
  );
}
