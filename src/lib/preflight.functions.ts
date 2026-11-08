import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type Check = { group: string; name: string; tone: 'ok' | 'warn' | 'bad'; detail: string; fix?: string };

async function gate(context: any) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error) throw new Error('Vérification des droits impossible');
  if (role.data) return;
  const t = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
  if (t.error || !(t.data ?? []).some((r: any) => (r.allowed_paths ?? []).includes('/dashboard/preflight'))) throw new Error('Accès non autorisé');
}

async function txt(name: string): Promise<string[] | null> {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: 'application/dns-json' } });
    const j: any = await r.json();
    return (j.Answer ?? []).filter((a: any) => a.type === 16).map((a: any) => String(a.data).replace(/"\s*"/g, '').replace(/"/g, ''));
  } catch { return null; }
}

const SHORTENERS = ['bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 't.co', 'is.gd', 'buff.ly', 'cutt.ly', 'rebrand.ly', 'shorturl.at'];
const SPAM_WORDS = ['gratuit', 'free', '100%', 'urgent', 'gagnez', 'winner', 'cash', 'viagra', 'casino', 'crédit facile', 'act now', 'cliquez ici', 'click here', '$$$', 'garanti', 'sans risque', 'offre exclusive'];

export const listPreflightCampaigns = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context);
  const r = await context.supabase.from('campaigns').select('id,name,status,created_at').order('created_at', { ascending: false }).limit(50);
  if (r.error) throw new Error('Lecture des campagnes impossible');
  return { campaigns: r.data ?? [] };
});

export const runPreflight = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await gate(context);
    const c = await context.supabase.from('campaigns').select('id,name,subject,html,from_email,from_name,list_id,status').eq('id', data.campaignId).single();
    if (c.error || !c.data) throw new Error('Campagne introuvable');
    const camp = c.data as any;
    const html: string = camp.html ?? '';
    const subject: string = camp.subject ?? '';
    const domain = String(camp.from_email).split('@')[1]?.toLowerCase() ?? '';
    const out: Check[] = [];

    // Authentication (live DNS)
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const sd = await supabaseAdmin.from('sending_domains').select('selector_a,selector_b').eq('domain', domain).maybeSingle();
    const [spf, dmarc] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]);
    const spfRec = spf?.find(s => s.toLowerCase().startsWith('v=spf1'));
    out.push(spfRec ? { group: 'Authentification', name: 'SPF', tone: 'ok', detail: spfRec } : { group: 'Authentification', name: 'SPF', tone: 'bad', detail: `Aucun SPF publié pour ${domain}`, fix: 'Publier le domaine sur Cloudflare (page Domaines)' });
    const dm = dmarc?.find(s => s.toLowerCase().startsWith('v=dmarc1'));
    out.push(dm ? { group: 'Authentification', name: 'DMARC', tone: /p=(quarantine|reject)/i.test(dm) ? 'ok' : 'warn', detail: dm, ...(/p=none/i.test(dm) ? { fix: 'Passer la politique à quarantine ou reject' } : {}) } : { group: 'Authentification', name: 'DMARC', tone: 'bad', detail: 'Aucun DMARC publié', fix: 'Publier le domaine sur Cloudflare' });
    if (!sd.data) out.push({ group: 'Authentification', name: 'DKIM', tone: 'bad', detail: `${domain} n'est pas enregistré comme domaine d'envoi`, fix: 'Ajouter le domaine dans la page Domaines' });
    else {
      const keys = await Promise.all([sd.data.selector_a, sd.data.selector_b].map(s => txt(`${s}._domainkey.${domain}`)));
      const ok = keys.filter(k => k?.some(v => v.includes('p='))).length;
      out.push({ group: 'Authentification', name: 'DKIM (2 sélecteurs)', tone: ok === 2 ? 'ok' : ok === 1 ? 'warn' : 'bad', detail: `${ok}/2 clés visibles sur Internet`, ...(ok < 2 ? { fix: 'Automatiser les corrections dans le Lab' } : {}) });
    }

    // Content
    const kb = Math.round(new TextEncoder().encode(html).length / 1024);
    out.push({ group: 'Contenu', name: 'Poids HTML', tone: kb > 102 ? 'bad' : kb > 80 ? 'warn' : 'ok', detail: `${kb} Ko (Gmail coupe au-delà de 102 Ko)`, ...(kb > 80 ? { fix: 'Alléger le HTML (styles inline, images externes)' } : {}) });
    const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const ratio = html.length ? Math.round((text.length / html.length) * 100) : 0;
    out.push({ group: 'Contenu', name: 'Ratio texte / HTML', tone: ratio < 15 ? 'bad' : ratio < 30 ? 'warn' : 'ok', detail: `${ratio} % de texte (recommandé > 30 %)`, ...(ratio < 30 ? { fix: 'Ajouter du texte réel, moins d\'images' } : {}) });
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    const noAlt = imgs.filter(i => !/\salt\s*=\s*["'][^"']+/i.test(i)).length;
    out.push({ group: 'Contenu', name: 'Images', tone: noAlt ? 'warn' : 'ok', detail: `${imgs.length} image(s), ${noAlt} sans texte alternatif`, ...(noAlt ? { fix: 'Ajouter un attribut alt à chaque image' } : {}) });
    const words = SPAM_WORDS.filter(w => (subject + ' ' + text).toLowerCase().includes(w));
    out.push({ group: 'Contenu', name: 'Mots à risque', tone: words.length > 2 ? 'bad' : words.length ? 'warn' : 'ok', detail: words.length ? words.join(', ') : 'Aucun mot déclencheur', ...(words.length ? { fix: 'Reformuler ces mots' } : {}) });
    const letters = subject.replace(/[^a-zA-ZÀ-ÿ]/g, '');
    const caps = letters.length ? letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length : 0;
    const subjBad = caps > 0.5 || /!{2,}/.test(subject) || subject.length > 90;
    out.push({ group: 'Contenu', name: 'Objet', tone: !subject ? 'bad' : subjBad ? 'warn' : 'ok', detail: `« ${subject} » · ${subject.length} caractères`, ...(subjBad ? { fix: 'Éviter majuscules, « !! » et objets > 90 caractères' } : {}) });

    // Links
    const links = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map(m => m[1]!);
    const short = links.filter(l => SHORTENERS.some(s => l.toLowerCase().includes(`//${s}`)));
    out.push({ group: 'Liens', name: 'Raccourcisseurs', tone: short.length ? 'bad' : 'ok', detail: short.length ? short.slice(0, 3).join(', ') : `${links.length} lien(s), aucun raccourcisseur`, ...(short.length ? { fix: 'Utiliser des liens directs vers votre domaine' } : {}) });
    const http = links.filter(l => l.startsWith('http://')).length;
    out.push({ group: 'Liens', name: 'HTTPS', tone: http ? 'warn' : 'ok', detail: http ? `${http} lien(s) non sécurisés` : 'Tous les liens sont en HTTPS', ...(http ? { fix: 'Passer les liens en https://' } : {}) });
    out.push({ group: 'Conformité', name: 'Désinscription 1 clic (RFC 8058)', tone: 'ok', detail: 'En-têtes List-Unsubscribe et List-Unsubscribe-Post ajoutés automatiquement à l\'envoi' });

    // List
    if (!camp.list_id) out.push({ group: 'Liste', name: 'Liste de contacts', tone: 'bad', detail: 'Aucune liste associée', fix: 'Choisir une liste dans la campagne' });
    else {
      const [all, inv] = await Promise.all([
        context.supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('list_id', camp.list_id),
        context.supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('list_id', camp.list_id).neq('status', 'active'),
      ]);
      const total = all.count ?? 0, bad = inv.count ?? 0;
      out.push({ group: 'Liste', name: 'Qualité de la liste', tone: !total ? 'bad' : 'ok', detail: total ? `${total - bad} contacts actifs · ${bad} déjà exclus` : 'Liste vide', ...(total ? { fix: 'Nettoyer la liste dans Validation d\'emails' } : {}) });
    }

    const blockers = out.filter(c => c.tone === 'bad').length, warns = out.filter(c => c.tone === 'warn').length;
    const score = Math.max(0, 100 - blockers * 20 - warns * 7);
    return { campaign: { id: camp.id, name: camp.name, status: camp.status }, checks: out, score, blockers, warns };
  });
