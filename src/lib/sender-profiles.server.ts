import { createHash, randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export function senderVerificationHash(profileId: string, email: string, code: string) {
  return createHash('sha256').update(JSON.stringify([profileId, email, code])).digest('hex');
}

export function newSenderVerificationCode() {
  return String(randomInt(100_000_000)).padStart(8, '0');
}

export async function assertSenderProfile(
  db: SupabaseClient<Database>, data: { senderProfileId?: string | undefined; fromName: string; fromEmail: string; replyTo?: string | undefined },
  serverId: string,
) {
  if (!data.senderProfileId) return;
  const result = await db.rpc('sender_profile_usable', {
    _profile: data.senderProfileId, _server: serverId, _from_name: data.fromName, _from_email: data.fromEmail, _reply_to: data.replyTo || null,
  });
  if (result.error?.code === 'PGRST202') throw new Error('Les profils expéditeur nécessitent la migration 0068.');
  if (result.error || !result.data) throw new Error('Vérifiez le profil expéditeur et l’installation de son domaine sur le serveur choisi.');
}
