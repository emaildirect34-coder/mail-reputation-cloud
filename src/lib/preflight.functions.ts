import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getRequest } from '@tanstack/react-start/server';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type Check = { group: string; name: string; tone: 'ok' | 'warn' | 'bad'; detail: string; fix?: string };

async function gate(context: any) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error) throw new Error('Vérification des droits impossible');
  if (role.data) return;
  const t = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
  if (t.error || !(t.data ?? []).some((r: any) => (r.allowed_paths ?? []).includes('/dashboard/preflight'))) throw new Error('Accès non autorisé');
}

const SHORTENERS = ['bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 't.co', 'is.gd', 'buff.ly', 'cutt.ly', 'rebrand.ly', 'shorturl.at'];

export const listPreflightCampaigns = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context);
  const r = await context.supabase.from('campaigns').select('id,name,status,created_at').order('created_at', { ascending: false }).limit(50);
  if (r.error) throw new Error('Lecture des campagnes impossible');
  return { campaigns: r.data ?? [] };
});

export const runDraftPreflight = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({
    fromEmail: z.string().trim().email(), html: z.string().max(500_000), serverIds: z.array(z.string().uuid()).min(1).max(100),
    listId: z.string().uuid().nullable(), poolId: z.string().uuid().nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
    if (role.error || !role.data) throw new Error('Accès réservé au Superadmin.');
    const { gmailPreflight } = await import('./gmail-preflight.server');
    const checks = await gmailPreflight({
      id: '00000000-0000-4000-8000-000000000001', from_email: data.fromEmail, server_ids: data.serverIds,
      list_id: data.listId, vmta_pool_id: data.poolId,
    }, new URL(getRequest().url).origin);
    const http = (data.html.match(/\bhref\s*=\s*(?:["']\s*)?http:\/\//gi) ?? []).length;
    const { plainEmailText } = await import('./amp-email');
    const text = plainEmailText(data.html);
    checks.push({ group: 'Contenu', name: 'Version texte', tone: text ? 'ok' : 'warn',
      detail: text ? `${text.length} caractères générés à partir du brouillon.` : 'Ajoutez du texte lisible au contenu du brouillon.' });
    checks.push({ group: 'Contenu', name: 'Liens HTTP', tone: http ? 'warn' : 'ok', detail: http ? `${http} lien(s) HTTP détecté(s).` : 'Aucun lien HTTP détecté.' });
    return checks;
  });

export const runPreflight = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await gate(context);
    const c = await context.supabase.from('campaigns').select('id,name,subject,html,from_email,from_name,list_id,status,server_ids,vmta_pool_id').eq('id', data.campaignId).single();
    if (c.error || !c.data) throw new Error('Campagne introuvable');
    const camp = c.data;
    const html: string = camp.html ?? '';
    const subject: string = camp.subject ?? '';
    const { gmailPreflight } = await import('./gmail-preflight.server');
    const out = await gmailPreflight(camp, new URL(getRequest().url).origin);

    // Content
    const kb = Math.round(new TextEncoder().encode(html).length / 1024);
    out.push({ group: 'Contenu', name: 'Poids HTML', tone: kb > 102 ? 'bad' : kb > 80 ? 'warn' : 'ok', detail: `${kb} Ko (Gmail coupe au-delà de 102 Ko)`, ...(kb > 80 ? { fix: 'Alléger le HTML (styles inline, images externes)' } : {}) });
    const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const ratio = html.length ? Math.round((text.length / html.length) * 100) : 0;
    out.push({ group: 'Contenu', name: 'Ratio texte / HTML', tone: ratio < 30 ? 'warn' : 'ok', detail: `${ratio} % de texte visible. Indicateur éditorial.`, ...(ratio < 30 ? { fix: 'Ajouter du texte réel, moins d\'images' } : {}) });
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    const noAlt = imgs.filter(i => !/\salt\s*=\s*["'][^"']+/i.test(i)).length;
    out.push({ group: 'Contenu', name: 'Images', tone: noAlt ? 'warn' : 'ok', detail: `${imgs.length} image(s), ${noAlt} sans texte alternatif`, ...(noAlt ? { fix: 'Ajouter un attribut alt à chaque image' } : {}) });
    const letters = subject.replace(/[^a-zA-ZÀ-ÿ]/g, '');
    const caps = letters.length ? letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length : 0;
    const subjBad = caps > 0.5 || /!{2,}/.test(subject) || subject.length > 90;
    out.push({ group: 'Contenu', name: 'Objet', tone: !subject ? 'bad' : subjBad ? 'warn' : 'ok', detail: `« ${subject} » · ${subject.length} caractères`, ...(subjBad ? { fix: 'Éviter majuscules, « !! » et objets > 90 caractères' } : {}) });

    // Links
    const links = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map(m => m[1]!);
    const short = links.filter(l => SHORTENERS.some(s => l.toLowerCase().includes(`//${s}`)));
    out.push({ group: 'Liens', name: 'Raccourcisseurs', tone: short.length ? 'bad' : 'ok', detail: short.length ? short.slice(0, 3).join(', ') : `${links.length} lien(s), aucun raccourcisseur`, ...(short.length ? { fix: 'Utiliser des liens directs vers votre domaine' } : {}) });
    const http = links.filter(l => /^http:\/\//i.test(l)).length;
    out.push({ group: 'Liens', name: 'HTTPS', tone: http ? 'warn' : 'ok', detail: http ? `${http} lien(s) non sécurisés` : 'Aucun lien HTTP détecté', ...(http ? { fix: 'Passer les liens en https://' } : {}) });

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
