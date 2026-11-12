import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { sha256Hex } from '@/lib/postback';
import { readTrackingBody } from '@/lib/tracking-request';

const input = z.object({
  inReplyTo: z.string().trim().max(300),
  sourceId: z.string().trim().min(1).max(300),
  receivedAt: z.string().datetime({ offset: true }),
});
const noStore = { 'Cache-Control': 'no-store' };

export const Route = createFileRoute('/api/public/sender-replies')({
  server: { handlers: {
    POST: async ({ request }) => {
      const token = request.headers.get('Authorization')?.match(/^Bearer (rp_[a-f0-9]{48})$/i)?.[1];
      if (!token) return new Response('Unauthorized', { status: 401, headers: noStore });
      const bytes = await readTrackingBody(request);
      if (!bytes) return new Response('Payload too large', { status: 413, headers: noStore });
      let raw: unknown;
      try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return new Response('Bad request', { status: 400, headers: noStore }); }
      const parsed = input.safeParse(raw);
      if (!parsed.success) return new Response('Bad request', { status: 400, headers: noStore });
      const id = parsed.data.inReplyTo.match(/^<([a-f0-9-]{36})@([a-z0-9.-]+)>$/i);
      if (!id || !z.string().uuid().safeParse(id[1]).success) return new Response('Invalid In-Reply-To', { status: 400, headers: noStore });
      const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
      const result = await db.rpc('record_sender_profile_reply', {
        _token_hash: await sha256Hex(token), _message: id[1]!, _domain: id[2]!.toLowerCase(),
        _source_hash: await sha256Hex(parsed.data.sourceId), _received_at: parsed.data.receivedAt,
      });
      if (result.error) return new Response('Unavailable', { status: 503, headers: noStore });
      if (result.data === 'unauthorized') return new Response('Unauthorized', { status: 401, headers: noStore });
      return Response.json({ stored: result.data === 'stored' }, { headers: noStore });
    },
  } },
});
