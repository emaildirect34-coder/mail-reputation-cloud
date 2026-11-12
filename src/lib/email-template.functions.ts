import { createServerFn } from '@tanstack/react-start';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

async function admin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error || !role.data) throw new Error('Accès réservé au Superadmin.');
  return (await import('@/integrations/supabase/client.server')).supabaseAdmin;
}
const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const subject = z.string().max(300);
const html = z.string().max(500_000);

export const readEmailTemplateLibrary = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const db = await admin(context);
  const [templates, blocks] = await Promise.all([
    db.from('email_templates').select('id,name,subject,html,version,created_at,updated_at').order('updated_at', { ascending: false }),
    db.from('email_content_blocks').select('id,name,html,created_at,updated_at').order('name'),
  ]);
  for (const result of [templates, blocks]) {
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    if (result.error) throw new Error('Bibliothèque de modèles indisponible.');
  }
  return { templates: templates.data ?? [], blocks: blocks.data ?? [] };
});

export const saveEmailTemplate = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: uuid.nullable(), name, subject, html }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('save_email_template', { _id: data.id, _name: data.name, _subject: data.subject, _html: data.html });
    if (result.error?.code === 'PGRST202') throw new Error('Applique la migration 0077 pour activer les modèles enregistrés.');
    if (result.error || !result.data?.[0]) throw new Error('Impossible d’enregistrer ce modèle.');
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: data.id ? 'template.updated' : 'template.created', entityType: 'email_template', entityId: result.data[0].id });
    return result.data[0];
  });

export const readEmailTemplateVersions = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: uuid }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('email_template_versions').select('version,created_at,snapshot').eq('template_id', data.id).order('version', { ascending: false }).limit(50);
    if (result.error) throw new Error('Historique du modèle indisponible.');
    return result.data;
  });

export const restoreEmailTemplateVersion = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: uuid, version: z.number().int().positive() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.rpc('restore_email_template_version', { _id: data.id, _version: data.version });
    if (result.error || !result.data?.[0]) throw new Error('Impossible de restaurer cette version.');
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: 'template.version_restored', entityType: 'email_template', entityId: data.id, summary: { version: data.version } });
    return result.data[0];
  });

export const saveEmailContentBlock = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: uuid.nullable(), name, html: z.string().trim().min(1).max(100_000) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = data.id
      ? await db.from('email_content_blocks').update({ name: data.name, html: data.html, updated_at: new Date().toISOString() }).eq('id', data.id).select('id').maybeSingle()
      : await db.from('email_content_blocks').insert({ name: data.name, html: data.html }).select('id').maybeSingle();
    if (result.error || !result.data) throw new Error('Impossible d’enregistrer ce bloc.');
    return result.data.id;
  });

export const deleteEmailContentBlock = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id: uuid }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const result = await db.from('email_content_blocks').delete().eq('id', data.id);
    if (result.error) throw new Error('Impossible de supprimer ce bloc.');
  });
