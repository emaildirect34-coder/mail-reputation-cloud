import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const EVENTS = ['delivered', 'bounce', 'deferred', 'complaint', 'unsubscribe', 'daily_report'] as const;

async function admin(context: any) {
  const r = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (r.error || !r.data) throw new Error('Accès réservé au Superadmin');
}

export const listWebhooks = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await admin(context);
  const r = await context.supabase.from('webhook_endpoints').select('*').order('created_at');
  if (r.error) throw new Error('Lecture impossible');
  return { hooks: r.data ?? [], events: EVENTS as unknown as string[] };
});

export const saveWebhook = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ url: z.string().url().startsWith('https://').max(500), events: z.array(z.enum(EVENTS)).min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    await admin(context);
    const secret = 'whsec_' + [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    const r = await context.supabase.from('webhook_endpoints').insert({ url: data.url, events: data.events, secret, created_by: context.userId }).select('id').single();
    if (r.error) throw new Error(r.error.message);
    return { id: r.data.id, secret };
  });

export const toggleWebhook = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ id: z.string().uuid(), active: z.boolean().optional(), remove: z.boolean().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    await admin(context);
    const q = context.supabase.from('webhook_endpoints');
    const r = data.remove ? await q.delete().eq('id', data.id) : await q.update({ active: !!data.active, fail_count: 0 }).eq('id', data.id);
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });

export const testWebhook = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await admin(context);
    const ep = await context.supabase.from('webhook_endpoints').select('id,url,secret,fail_count,sent_count').eq('id', data.id).single();
    if (ep.error) throw new Error('Webhook introuvable');
    const { deliver } = await import('./webhooks.server');
    return deliver(context.supabase, ep.data, 'test', { message: 'Test depuis Email Direct' });
  });

export const sendReportNow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (!role.data) throw new Error('Réservé aux Superadmins');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { sendDailyReport } = await import('./daily-report.server');
  const { reportText } = await import('./daily-report');
  return { text: reportText(await sendDailyReport(supabaseAdmin)) };
});
