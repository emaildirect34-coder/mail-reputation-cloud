import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { parseDmarcXml, passes } from './dmarc';

export const listDmarc = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb: any = context.supabase;
    const [r, ips] = await Promise.all([
      sb.from('dmarc_reports').select('*').order('date_end', { ascending: false }).limit(200),
      sb.from('server_ips').select('address'),
    ]);
    if (r.error) throw new Error('Lecture des rapports impossible');
    return { reports: r.data ?? [], ownIps: (ips.data ?? []).map((i: any) => i.address as string) };
  });

export const importDmarc = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ xml: z.array(z.string().max(5_000_000)).min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb: any = context.supabase;
    let ok = 0; const errors: string[] = [];
    for (const xml of data.xml) {
      try {
        const p = parseDmarcXml(xml);
        const total = p.records.reduce((n, x) => n + x.count, 0);
        const passed = p.records.filter(passes).reduce((n, x) => n + x.count, 0);
        const { error } = await sb.from('dmarc_reports').upsert({
          org_name: p.orgName, report_id: p.reportId, domain: p.domain, policy: p.policy,
          date_begin: p.dateBegin ? new Date(p.dateBegin * 1000).toISOString() : null,
          date_end: p.dateEnd ? new Date(p.dateEnd * 1000).toISOString() : null,
          total, passed, records: p.records,
        }, { onConflict: 'org_name,report_id' });
        if (error) throw new Error(error.code === '42501' ? 'Réservé au superadmin' : 'Enregistrement impossible');
        ok++;
      } catch (e) { errors.push(e instanceof Error ? e.message : 'Fichier illisible'); }
    }
    return { ok, errors };
  });
