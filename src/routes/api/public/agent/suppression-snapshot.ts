import { createFileRoute } from '@tanstack/react-router';
import { bloomBucket, bloomObject, inspectBloomSnapshot, maxBloomBytes } from '@/lib/suppression-snapshot.server';

const noStore = { 'Cache-Control': 'no-store' };

export const Route = createFileRoute('/api/public/agent/suppression-snapshot')({
  server: { handlers: {
    GET: async ({ request }) => {
      const { agentFromRequest } = await import('@/lib/kumo.server');
      const agent = await agentFromRequest(request);
      if (!agent) return new Response('Unauthorized', { status: 401, headers: noStore });
      const { data, error } = await agent.db.storage.from(bloomBucket).download(bloomObject);
      if (error || !data) return new Response('Snapshot unavailable', { status: 404, headers: noStore });
      return new Response(data, { headers: { ...noStore, 'Content-Type': 'application/octet-stream' } });
    },
    PUT: async ({ request }) => {
      const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) return new Response('Non autorisé', { status: 401, headers: noStore });
      const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
      const { data: { user }, error: authError } = await db.auth.getUser(token);
      if (authError || !user) return new Response('Non autorisé', { status: 401, headers: noStore });
      const { data: role } = await db.rpc('has_role', { _user_id: user.id, _role: 'superadmin' });
      if (!role) return new Response('Accès réservé au superadmin', { status: 403, headers: noStore });
      if (Number(request.headers.get('content-length')) > maxBloomBytes || !request.body) {
        return new Response('Taille de l’instantané invalide', { status: 413, headers: noStore });
      }
      const reader = request.body.getReader();
      const bytes = new Uint8Array(maxBloomBytes);
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (length + value.length > bytes.length) {
            await reader.cancel();
            return new Response('Instantané trop volumineux', { status: 413, headers: noStore });
          }
          bytes.set(value, length);
          length += value.length;
        }
      } catch { return new Response('Lecture impossible', { status: 400, headers: noStore }); }
      finally { reader.releaseLock(); }
      const snapshot = bytes.subarray(0, length);
      let issued: number, expires: number;
      try { ({ issued, expires } = await inspectBloomSnapshot(snapshot, process.env['SUPPRESSION_BLOOM_KEY'])); }
      catch (error) { return new Response((error as Error).message, { status: 422, headers: noStore }); }
      const bucket = await db.storage.getBucket(bloomBucket);
      if (bucket.error || bucket.data?.public !== false) return new Response('Le stockage privé des instantanés est indisponible.', { status: 503, headers: noStore });
      const result = await db.storage.from(bloomBucket).upload(bloomObject, snapshot, { contentType: 'application/octet-stream', upsert: true });
      if (result.error) return new Response('Enregistrement impossible', { status: 503, headers: noStore });
      return Response.json({ issued, expires }, { headers: noStore });
    },
  } },
});
