import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { canUseAi } from './ai.schemas';

const input = z.object({ subject: z.string().max(500), body: z.string().max(200_000), offer: z.string().max(200).optional() });

export const suggestSubjects = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => input.parse(i)).handler(async ({ data, context }) => {
    const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
    if (role.error) throw new Error('Vérification des droits impossible');
    const tasks = role.data ? null : await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
    if (tasks?.error || !canUseAi({ role: role.data ? 'superadmin' : 'worker', paths: (tasks?.data ?? []).flatMap(t => t.allowed_paths) }, 'subject')) throw new Error('Cette fonction ne fait pas partie de vos tâches.');
    const { generateSubjects } = await import('./subjects.server');
    const text = data.body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
    return generateSubjects(data.subject, text, data.offer ?? '');
  });
