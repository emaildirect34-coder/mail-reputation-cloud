import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/integrations/supabase/types';

export async function recordAuditEvent(db: SupabaseClient<Database>, event: {
  actorId: string; action: string; entityType: string; entityId?: string | null; summary?: Json;
}) {
  const { error } = await db.from('audit_log').insert({
    actor_id: event.actorId, action: event.action, entity_type: event.entityType,
    entity_id: event.entityId ?? null, summary: event.summary ?? {},
  });
  if (error?.code === 'PGRST205' || error?.code === '42P01') return false;
  if (error) console.error('Audit event could not be recorded', { action: event.action, code: error.code });
  return !error;
}
