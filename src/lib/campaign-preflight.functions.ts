import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

type Found = { type: 'link' | 'image'; url: string };
type Result = Found & { status: 'ok' | 'issue' | 'manual'; detail: string; code?: number };

async function references(html: string): Promise<{ items: Found[]; truncated: boolean }> {
  const { parseFragment } = await import('parse5');
  const root = parseFragment(html) as any;
  const found: Found[] = [];
  const add = (rawValue: unknown, type: Found['type']) => {
    const raw = String(rawValue ?? '').trim();
    if (raw && !raw.startsWith('#') && !/^(mailto:|tel:|data:|cid:|\{)/i.test(raw)) found.push({ type, url: raw });
  };
  const urlsFromCss = (value: string, type: Found['type']) => { for (const match of value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1], type); };
  const walk = (node: any) => {
    const attrs = node.attrs ?? [];
    if (node.tagName === 'a') add(attrs.find((a: any) => a.name === 'href')?.value, 'link');
    if (node.tagName === 'img' || node.tagName === 'source') {
      add(attrs.find((a: any) => a.name === 'src')?.value, 'image');
      for (const candidate of String(attrs.find((a: any) => a.name === 'srcset')?.value ?? '').split(',')) add(candidate.trim().split(/\s+/)[0], 'image');
    }
    const style = attrs.find((a: any) => a.name === 'style')?.value;
    if (style) urlsFromCss(style, 'image');
    if (node.tagName === '#text' && node.parentNode?.tagName === 'style') urlsFromCss(node.value ?? '', 'image');
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
  const unique = [...new Map(found.map(item => [item.type + ':' + item.url, item])).values()];
  return { items: unique.slice(0, 40), truncated: unique.length > 40 };
}

const publicUrl = (value: string) => {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const safeHost = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
    if (u.protocol !== 'https:' || !safeHost || u.username || u.password || u.port) return null;
    return { u, host };
  } catch { return null; }
};

export const preflightCampaignLinks = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ html: z.string().max(200_000) }).parse(input))
  .handler(async ({ context, data }) => {
    const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
    if (role.error || !role.data) throw new Error('Accès réservé au Superadmin.');
    const allowed = new Set((process.env.CAMPAIGN_AUDIT_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
    const { items: refs, truncated } = await references(data.html);
    const results: Result[] = [];
    for (let offset = 0; offset < refs.length; offset += 4) {
      const batch = await Promise.all(refs.slice(offset, offset + 4).map(async (ref): Promise<Result> => {
      const parsed = publicUrl(ref.url);
      const display = (() => { try { const u = new URL(ref.url); return u.origin + u.pathname.slice(0, 180); } catch { return ref.url.slice(0, 180); } })();
      if (!parsed) return { ...ref, url: display, status: 'issue', detail: 'Adresse non HTTPS ou format non autorisé.' };
      if (!allowed.has(parsed.host)) return { ...ref, url: display, status: 'manual', detail: 'Hôte non vérifié : ajoutez-le à CAMPAIGN_AUDIT_HOSTS après validation.' };
      try {
        const response = await fetch(parsed.u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'EmailDirect-LinkPreflight/1.0' } });
        if (response.status >= 300 && response.status < 400) return { ...ref, url: display, status: 'manual', detail: 'Redirection détectée; destination à vérifier manuellement.', code: response.status };
        if (response.status === 405 || response.status === 403 || response.status === 429) return { ...ref, url: display, status: 'manual', detail: 'Le serveur distant ne permet pas une vérification HEAD fiable.', code: response.status };
        if (response.status >= 400) return { ...ref, url: display, status: 'issue', detail: 'Le serveur a renvoyé une erreur.', code: response.status };
        return { ...ref, url: display, status: 'ok', detail: 'Réponse HTTP accessible.', code: response.status };
      } catch { return { ...ref, url: display, status: 'manual', detail: 'Vérification expirée ou refusée par le serveur distant.' }; }
      }));
      results.push(...batch);
    }
    return { checked: results.length, truncated, results,
      summary: { ok: results.filter(x => x.status === 'ok').length, issue: results.filter(x => x.status === 'issue').length, manual: results.filter(x => x.status === 'manual').length } };
  });
