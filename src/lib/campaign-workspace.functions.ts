import { createServerFn } from '@tanstack/react-start';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';
import { day } from './finance.schemas';

async function requireCampaignAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error || !role.data) throw new Error('Cette action est réservée au superadmin.');
  return (await import('@/integrations/supabase/client.server')).supabaseAdmin;
}

const campaign = z.object({ campaignId: z.string().uuid() });
const category = z.enum(['hypothesis', 'observation', 'decision']);
const unavailable = (error: { code: string } | null) => error && ['PGRST205', '42P01'].includes(error.code);

export const readCampaignCalendar = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireCampaignAdmin(context);
    const today = new Date().toISOString().slice(0, 10);
    const result = await db.from('campaign_no_send_days').select('day,reason').gte('day', today).order('day').limit(100);
    if (unavailable(result.error)) return null;
    if (result.error) throw new Error('Calendrier indisponible.');
    const scheduled = await db.from('campaigns').select('id,name,subject,status,scheduled_at').not('scheduled_at', 'is', null)
      .in('status', ['queued','paused']).gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(100);
    if (unavailable(scheduled.error) || scheduled.error?.code === '42703') return { today, days: result.data, scheduled: [], editorialCampaigns: [] };
    if (scheduled.error) throw new Error('Lecture du calendrier des campagnes indisponible.');
    const editorial = await db.from('campaigns').select('id,name,subject,status,scheduled_at').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(100);
    return { today, days: result.data, scheduled: scheduled.data ?? [], editorialCampaigns: editorial.error ? scheduled.data ?? [] : editorial.data ?? [] };
  });

export const saveCampaignCalendarDay = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ day, reason: z.string().trim().min(1).max(160).nullable() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireCampaignAdmin(context);
    const result = await db.rpc('set_campaign_no_send_day', { _day: data.day, _reason: data.reason });
    if (result.error || !result.data) throw new Error('Impossible de modifier ce jour. Vérifie la date et le motif.');
    return true;
  });

export const saveCampaignEditorialWorkflow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({
    campaignId: z.string().uuid(), brief: z.string().trim().max(5000), owner: z.string().trim().max(160),
    state: z.enum(['draft','review','approved']), dueOn: z.string().date().nullable(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireCampaignAdmin(context) as any; // migration 0086 table is newer than generated Supabase types
    const result = await db.from('campaign_editorial_workflow').upsert({
      campaign_id: data.campaignId, brief: data.brief, owner: data.owner, state: data.state,
      due_on: data.dueOn, updated_by: context.userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'campaign_id' });
    if (result.error) throw new Error('Impossible d’enregistrer le brief éditorial. Appliquez d’abord la migration 0086.');
    return true;
  });

export const readCampaignEditorialWorkflow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireCampaignAdmin(context) as any; // migration 0086 table is newer than generated Supabase types
    const result = await db.from('campaign_editorial_workflow').select('campaign_id,brief,owner,state,due_on,updated_at')
      .order('due_on', { ascending: true, nullsFirst: false }).limit(200);
    if (unavailable(result.error)) return null;
    if (result.error) throw new Error('Lecture du calendrier éditorial indisponible.');
    return result.data ?? [];
  });

export const readCampaignNotes = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => campaign.extend({ page: z.number().int().min(0).max(10000) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireCampaignAdmin(context);
    const result = await db.from('campaign_notes').select('id,category,note,created_at').eq('campaign_id', data.campaignId)
      .order('created_at', { ascending: false }).order('id').range(data.page * 20, data.page * 20 + 19);
    if (unavailable(result.error)) return null;
    if (result.error) throw new Error('Carnet de campagne indisponible.');
    return result.data;
  });

export const addCampaignNote = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => campaign.extend({ category, note: z.string().trim().min(1).max(2000) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireCampaignAdmin(context);
    const result = await db.from('campaign_notes').insert({
      campaign_id: data.campaignId, category: data.category, note: data.note, created_by: context.userId,
    });
    if (result.error) throw new Error('Impossible d’ajouter cette note.');
    return true;
  });
