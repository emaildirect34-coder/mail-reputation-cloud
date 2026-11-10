import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/dmarc-inbound')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env['DMARC_INBOUND_KEY'];
        if (!secret || secret.length < 32) return new Response('Unavailable', { status: 503 });
        const encode = new TextEncoder();
        const [expected, supplied] = await Promise.all(
          [`Bearer ${secret}`, request.headers.get('authorization') ?? ''].map(value => crypto.subtle.digest('SHA-256', encode.encode(value))),
        );
        const actual = new Uint8Array(supplied!);
        let difference = 0;
        new Uint8Array(expected!).forEach((byte, i) => { difference |= byte ^ actual[i]!; });
        if (difference) return new Response('Unauthorized', { status: 401 });
        if (!request.body || request.headers.get('content-type')?.split(';')[0] !== 'message/rfc822') {
          return new Response('Expected message/rfc822', { status: 415 });
        }
        const { boundedBytes, inboundReports } = await import('@/lib/dmarc-inbound.server');
        let reports;
        try {
          reports = await inboundReports(await boundedBytes(request.body));
        } catch {
          return new Response('Invalid DMARC report', { status: 422 });
        }
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const domains = [...new Set(reports.map(report => report.domain))];
        const known = await supabaseAdmin.from('sending_domains').select('domain').in('domain', domains);
        if (known.error) return new Response('Unavailable', { status: 503 });
        if (known.data.length !== domains.length) return new Response('Unknown report domain', { status: 422 });
        const unique = [...new Map(reports.map(report => [JSON.stringify([report.org_name, report.report_id]), report])).values()];
        const result = await supabaseAdmin.from('dmarc_reports').upsert(unique, { onConflict: 'org_name,report_id' });
        if (result.error) return new Response('Unavailable', { status: 503 });
        return Response.json({ imported: unique.length });
      },
    },
  },
});
