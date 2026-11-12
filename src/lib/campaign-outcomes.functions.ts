import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

async function admin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error || !role.data) throw new Error('Accès réservé au Superadmin.');
  return (await import('@/integrations/supabase/client.server')).supabaseAdmin;
}
const id = z.string().uuid();

export const compareCampaignOutcomes = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ left: id, right: id }).refine(value => value.left !== value.right).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('read_campaign_outcome_comparison', { _left: data.left, _right: data.right });
    if (result.error?.code === 'PGRST202') return null;
    if (result.error) throw new Error('Comparaison des campagnes indisponible.');
    return z.array(z.object({
      id, name: z.string(), status: z.string(), created_at: z.string(), audience: z.number(), suppressed: z.number(),
      attempted: z.number(), smtp_accepted: z.number(), bounced: z.number(), opens: z.number(), clicks: z.number(),
      complaints: z.number(), unsubscribes: z.number(), approved_purchases: z.number(), purchase_amount_cents: z.number(),
      acceptance_rate: z.number().nullable(), open_rate_observed: z.number().nullable(), click_rate_observed: z.number().nullable(), complaint_rate: z.number().nullable(),
    })).parse(result.data);
  });

export const readCampaignFollowupTasks = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ campaignId: id }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('campaign_followup_tasks').select('id,campaign_id,task_key,title,status,note,created_at,completed_at')
      .eq('campaign_id', data.campaignId).order('created_at');
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    if (result.error) throw new Error('Tâches de fin de campagne indisponibles.');
    return result.data;
  });

export const updateCampaignFollowupTask = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ campaignId: id, taskId: id, done: z.boolean(), note: z.string().trim().max(2000) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('campaign_followup_tasks').update({
      status: data.done ? 'done' : 'open', completed_at: data.done ? new Date().toISOString() : null, note: data.note,
    }).eq('campaign_id', data.campaignId).eq('id', data.taskId).select('id').maybeSingle();
    if (result.error) throw new Error('Impossible d’enregistrer cette tâche.');
    if (!result.data) throw new Error('Cette tâche n’existe plus.');
  });
