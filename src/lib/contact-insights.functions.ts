import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { segmentPreferences, segmentProviders } from './contact-segment';

async function requireAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error || !role.data) throw new Error('Accès réservé au superadmin.');
  return (await import('@/integrations/supabase/client.server')).supabaseAdmin;
}

const history = z.object({
  events: z.array(z.object({
    at: z.string(), kind: z.enum(['list', 'consent', 'suppression', 'send', 'purchase', 'purchase_consent']),
    label: z.string(), detail: z.string().nullable(),
  })),
  topics: z.array(z.string()).nullable(), weekly: z.boolean(), digest: z.boolean(),
});

export const readContactHistory = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireAdmin(context);
    const result = await db.rpc('read_contact_history', { _email: data.email });
    if (result.error?.code === 'PGRST202') return null;
    if (result.error) throw new Error('Fiche contact indisponible.');
    return history.parse(result.data);
  });

export const exportContactPrivacyData = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireAdmin(context);
    const { createHash } = await import('node:crypto');
    const email = data.email.trim().toLowerCase();
    const emailMd5 = createHash('md5').update(email).digest('hex');
    const [contacts, suppression, history] = await Promise.all([
      db.from('contacts').select('id,list_id,email,first_name,status,created_at').eq('email_md5', emailMd5),
      db.from('suppressions').select('reason,source,created_at').eq('email_md5', emailMd5).maybeSingle(),
      db.rpc('read_contact_history', { _email: email }),
    ]);
    for (const result of [contacts, suppression, history]) if (result.error) throw new Error('Export des données du contact indisponible.');
    const listIds = [...new Set((contacts.data ?? []).map(contact => contact.list_id))];
    const [lists, preferences, confirmations] = await Promise.all([
      listIds.length ? db.from('contact_lists').select('id,name').in('id', listIds) : Promise.resolve({ data: [], error: null }),
      Promise.all([
        db.from('recipient_topic_preferences').select('*').eq('email_md5', emailMd5).maybeSingle(),
        db.from('recipient_weekly_preferences').select('*').eq('email_md5', emailMd5).maybeSingle(),
        db.from('recipient_digest_preferences').select('*').eq('email_md5', emailMd5).maybeSingle(),
        db.from('recipient_snoozes').select('*').eq('email_md5', emailMd5).maybeSingle(),
        db.from('recipient_sponsor_blocks').select('brand_id,blocked_at').eq('recipient_md5', emailMd5),
      ]),
      Promise.all(listIds.map(listId => db.rpc('read_contact_subscription_proofs', { _list: listId, _email: email }))),
    ]);
    if (lists.error || preferences.some(result => result.error) || confirmations.some(result => result.error)) throw new Error('Export des préférences et preuves d’inscription indisponible.');
    return {
      exported_at: new Date().toISOString(), email, contacts: contacts.data ?? [], lists: lists.data ?? [],
      suppression: suppression.data, history: history.data,
      preferences: preferences.map(result => result.data),
      confirmations: confirmations.flatMap(result => result.data ?? []),
    };
  });

export const eraseContactPrivacyData = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ email: z.string().trim().toLowerCase().email().max(254), confirmation: z.string().trim().max(254) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireAdmin(context);
    const email = data.email.trim().toLowerCase();
    if (data.confirmation.trim().toLowerCase() !== email) throw new Error('Recopie exactement l’adresse du contact pour confirmer.');
    const { createHash } = await import('node:crypto');
    const result = await db.rpc('erase_contact_data', { _email_md5: createHash('md5').update(email).digest('hex') });
    if (result.error?.code === 'PGRST202') throw new Error('Applique la migration 0081 avant d’effacer des données.');
    if (result.error) throw new Error('Effacement des données du contact indisponible.');
    return z.object({ messages_anonymized: z.number(), contacts_removed: z.number(), suppression_hash_retained: z.boolean() }).parse(result.data);
  });

export const readUnsubscribeReasons = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireAdmin(context);
    const result = await db.rpc('read_campaign_unsubscribe_reasons');
    if (result.error?.code === 'PGRST202') return null;
    if (result.error) throw new Error('Motifs de désinscription indisponibles.');
    return result.data;
  });

const listInsights = z.object({
  preferences: z.object({ active: z.number(), no_topics: z.number(), no_weekly_preference: z.number() }),
  quality: z.array(z.object({
    source: z.enum(['confirmation', 'after_purchase', 'unknown']),
    accepted: z.number(), bounced: z.number(), complained: z.number(), purchases: z.number(),
  })),
  saturation: z.array(z.object({
    topic: z.string(), recipients: z.number(), sent: z.number(), peak: z.number(), median: z.number(),
  })),
});

export const readContactListInsights = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ listId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireAdmin(context);
    const result = await db.rpc('read_contact_list_insights', { _list: data.listId });
    if (result.error?.code === 'PGRST202') return null;
    if (result.error) throw new Error('Mesures de la liste indisponibles.');
    return listInsights.parse(result.data);
  });

const segmentInput = z.object({
  listId: z.string().uuid(), segmentId: z.string().uuid().nullable(),
  provider: z.enum(segmentProviders).nullable(),
  preference: z.enum(segmentPreferences),
});

export const readContactSegments = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ listId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireAdmin(context);
    const result = await db.from('contact_segments').select('id,name,provider,preference').eq('list_id', data.listId).order('name').order('id');
    if (result.error && ['PGRST205', '42P01'].includes(result.error.code)) return null;
    if (result.error) throw new Error('Segments indisponibles.');
    return result.data;
  });

export const previewContactSegment = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => segmentInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireAdmin(context);
    const result = await db.rpc('preview_contact_segment', {
      _list: data.listId, _segment: data.segmentId, _provider: data.provider, _preference: data.preference,
    }).single();
    if (result.error || (data.segmentId && !result.data.revision)) throw new Error('Aperçu du segment indisponible.');
    return result.data;
  });

export const saveContactSegment = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => segmentInput.extend({ name: z.string().trim().min(1).max(100), revision: z.string().uuid().nullable() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await requireAdmin(context);
    const fields = { name: data.name, provider: data.provider, preference: data.preference };
    if (data.segmentId && !data.revision) throw new Error('Recalcule l’aperçu avant de modifier ce segment.');
    const result = data.segmentId && data.revision
      ? await db.from('contact_segments').update({ ...fields, revision: crypto.randomUUID() }).eq('id', data.segmentId)
        .eq('list_id', data.listId).eq('revision', data.revision).select('id').maybeSingle()
      : await db.from('contact_segments').insert({ list_id: data.listId, ...fields }).select('id').maybeSingle();
    if (result.error?.code === '23505') throw new Error('Ce nom de segment est déjà utilisé pour la liste.');
    if (result.error || !result.data) throw new Error('Le segment a changé. Actualise la liste et recalcule l’aperçu.');
    return result.data.id;
  });
