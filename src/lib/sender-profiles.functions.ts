import { createServerFn } from '@tanstack/react-start';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/integrations/supabase/types';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

async function admin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error || !role.data) throw new Error('Accès réservé au Superadmin.');
  return (await import('@/integrations/supabase/client.server')).supabaseAdmin;
}

const id = z.string().uuid();
const target = z.enum(['from', 'reply']);
const email = z.string().trim().toLowerCase().max(254).email();
const label = z.string().trim().min(1).max(120).refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Saisissez un nom sur une seule ligne.');

export const readSenderProfiles = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const result = await db.from('sender_profiles').select('id,label,from_name,from_email,reply_to,enabled,from_verified_at,reply_verified_at').order('label').order('id');
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    if (result.error) throw new Error('Lecture des profils expéditeur indisponible.');
    return result.data.map(profile => ({ ...profile, verified: !!profile.from_verified_at && (!profile.reply_to || !!profile.reply_verified_at) }));
  });

export const saveSenderProfile = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: id.optional(), label, fromName: label, fromEmail: email, replyTo: email.or(z.literal('')), enabled: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const fields = { label: data.label, from_name: data.fromName, from_email: data.fromEmail, reply_to: data.replyTo || null, enabled: data.enabled };
    const query = data.id ? db.from('sender_profiles').update(fields).eq('id', data.id) : db.from('sender_profiles').insert(fields);
    const result = await query.select('id').maybeSingle();
    if (result.error || !result.data) throw new Error('Impossible d’enregistrer ce profil expéditeur.');
  });

async function verificationEmail(db: Awaited<ReturnType<typeof admin>>, profileId: string, field: z.infer<typeof target>) {
  const result = await db.from('sender_profiles').select('from_email,reply_to').eq('id', profileId).eq('enabled', true).maybeSingle();
  if (result.error || !result.data) throw new Error('Profil expéditeur indisponible.');
  const address = field === 'from' ? result.data.from_email : result.data.reply_to;
  if (!address) throw new Error('Ajoutez une adresse de réponse avant de la vérifier.');
  return address;
}

export const issueSenderProfileCode = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id, serverId: id, target }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const address = await verificationEmail(db, data.id, data.target);
    const { newSenderVerificationCode, senderVerificationHash } = await import('./sender-profiles.server');
    const code = newSenderVerificationCode();
    const result = await db.rpc('issue_sender_profile_code', {
      _profile: data.id, _server: data.serverId, _email: address, _code: code,
      _hash: senderVerificationHash(data.id, address, code), _actor: context.userId,
    });
    if (result.data === 'binding') throw new Error('Choisissez un serveur prêt à envoyer avec le domaine DKIM de ce profil installé.');
    if (result.data === 'throttled') throw new Error('Attendez une minute avant de demander un nouveau code.');
    if (result.data === 'suppressed') throw new Error('Cette adresse figure dans la liste de suppression.');
    if (result.error || result.data !== 'queued') throw new Error('Le code de vérification n’a pas pu être mis en file.');
  });

export const confirmSenderProfileCode = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id, target, code: z.string().trim().regex(/^\d{8}$/) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const address = await verificationEmail(db, data.id, data.target);
    const { senderVerificationHash } = await import('./sender-profiles.server');
    const result = await db.rpc('confirm_sender_profile_code', {
      _profile: data.id, _email: address, _hash: senderVerificationHash(data.id, address, data.code), _actor: context.userId,
    });
    if (result.data === 'expired') throw new Error('Ce code a expiré ou le nombre d’essais est épuisé. Demandez un nouveau code.');
    if (result.data === 'invalid') throw new Error('Code de vérification incorrect.');
    if (result.error || result.data !== 'verified') throw new Error('La vérification du profil est indisponible.');
  });

export const createSenderReplyChannel = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const profile = await db.from('sender_profiles').select('id,enabled,from_verified_at').eq('id', data.id).maybeSingle();
    if (profile.error || !profile.data?.enabled || !profile.data.from_verified_at) throw new Error('Vérifie et active ce profil avant de créer le canal de réponses.');
    const { randomBytes, createHash } = await import('node:crypto');
    const token = `rp_${randomBytes(24).toString('hex')}`;
    const saved = await db.from('sender_reply_channels').upsert({ profile_id: data.id, token_hash: createHash('sha256').update(token).digest('hex') });
    if (saved.error) throw new Error('Impossible de créer le canal de réponses.');
    return { token, endpoint: '/api/public/sender-replies' };
  });

export const senderReplyChannelEnabled = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('sender_reply_channels').select('profile_id').eq('profile_id', data.id).maybeSingle();
    if (result.error) throw new Error('État du canal de réponses indisponible.');
    return !!result.data;
  });

export const revokeSenderReplyChannel = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('sender_reply_channels').delete().eq('profile_id', data.id);
    if (result.error) throw new Error('Impossible de révoquer le canal de réponses.');
  });

export const readSenderProfileReplies = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('sender_profile_replies').select('id,message_id,received_at,handled_at')
      .eq('profile_id', data.id).order('received_at', { ascending: false }).limit(100);
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    if (result.error) throw new Error('Lecture des réponses indisponible.');
    const ids = [...new Set(result.data.map(reply => reply.message_id))];
    if (!ids.length) return [];
    const messages = await db.from('campaign_messages').select('id,email,campaign_id').in('id', ids);
    if (messages.error) throw new Error('Lecture des messages concernés indisponible.');
    const campaignIds = [...new Set(messages.data.map(message => message.campaign_id))];
    const campaigns = campaignIds.length ? await db.from('campaigns').select('id,name').in('id', campaignIds) : { data: [], error: null };
    if (campaigns.error) throw new Error('Lecture des campagnes concernées indisponible.');
    const messageById = new Map(messages.data.map(message => [message.id, message]));
    const campaignById = new Map(campaigns.data.map(campaign => [campaign.id, campaign.name]));
    return result.data.map(reply => {
      const message = messageById.get(reply.message_id);
      return { ...reply, email: message?.email ?? '', campaign: message ? campaignById.get(message.campaign_id) ?? 'Campagne supprimée' : 'Message supprimé' };
    });
  });

export const markSenderProfileReplyHandled = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id, replyId: id, handled: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('sender_profile_replies').update({ handled_at: data.handled ? new Date().toISOString() : null })
      .eq('id', data.replyId).eq('profile_id', data.id);
    if (result.error) throw new Error('Impossible de mettre à jour cette réponse.');
  });
