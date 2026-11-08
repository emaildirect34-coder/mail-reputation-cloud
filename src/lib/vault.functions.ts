import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// Contacts Vault VPS connector (built by Codex). Contract: docs/CODEX.md §3.
async function admin(context: any) {
  const r = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (r.error || !r.data) throw new Error('Réservé au super-administrateur');
}
async function vault(path: string, init?: RequestInit) {
  const url = process.env['VAULT_URL'], key = process.env['VAULT_KEY'];
  if (!url || !key) return { configured: false as const, body: null };
  const r = await fetch(url.replace(/\/$/, '') + path, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Serveur de base ${r.status}: ${text.slice(0, 200)}`);
  return { configured: true as const, body: JSON.parse(text) };
}
const filters = z.object({
  isp: z.array(z.string().max(20)).max(10).default([]),
  country: z.array(z.string().length(2)).max(50).default([]),
  active_days: z.number().int().min(0).max(3650).default(0),
  status: z.literal('active').default('active'),
});

export const vaultOverview = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await admin(context);
  const s = await vault('/api/v1/stats');
  if (!s.configured) return { configured: false, stats: null, imports: [] };
  const i = await vault('/api/v1/imports');
  return { configured: true, stats: s.body as any, imports: ((i.body as any)?.imports ?? []) as any[] };
});
export const vaultImport = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ source_url: z.string().min(5).max(500), delimiter: z.enum([',', ';', '\t', '|']) }).parse(i))
  .handler(async ({ data, context }) => {
    await admin(context);
    const r = await vault('/api/v1/imports', { method: 'POST', body: JSON.stringify({ ...data, format: 'csv', mapping: { email: 0, first_name: 1, country: 2 } }) });
    if (!r.configured) throw new Error('Serveur de base non connecté');
    return r.body as { import_id: string };
  });
export const vaultCount = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ filters }).parse(i))
  .handler(async ({ data, context }) => {
    await admin(context);
    const r = await vault('/api/v1/segments/count', { method: 'POST', body: JSON.stringify(data) });
    if (!r.configured) throw new Error('Serveur de base non connecté');
    return r.body as { count: number };
  });
