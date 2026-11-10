export const messageToken = /^[0-9a-f]{36}$/;
export const trackableHref = /href="(https?:\/\/(?:[^"{}]|\{click_id\})+)"/g;

export function isTemplateLink(html: string, destination: string) {
  for (const [, link] of html.matchAll(trackableHref)) {
    if (link?.replaceAll('&amp;', '&') === destination) return true;
  }
  return false;
}

export function isSpeculativeRequest(headers: Headers) {
  const purpose = [headers.get('sec-purpose'), headers.get('purpose')].filter(Boolean).join(' ');
  return /\b(?:prefetch|prerender|preview)\b/i.test(purpose);
}

export function activatedNavigation(headers: Headers) {
  return !isSpeculativeRequest(headers) && headers.get('sec-fetch-user') === '?1' &&
    headers.get('sec-fetch-mode') === 'navigate' && headers.get('sec-fetch-dest') === 'document';
}

export function localForm(headers: Headers) {
  const site = headers.get('sec-fetch-site');
  return !isSpeculativeRequest(headers) && (!site || site === 'same-origin');
}

export async function readTrackingBody(request: Request) {
  const limit = 8192;
  if (Number(request.headers.get('content-length')) > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const body = new Uint8Array(limit);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > limit) {
        await reader.cancel();
        return null;
      }
      body.set(value, size);
      size += value.length;
    }
    return body.subarray(0, size);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function readTrackingForm(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  const kind = contentType.split(';')[0]?.trim().toLowerCase();
  if (kind !== 'application/x-www-form-urlencoded' && kind !== 'multipart/form-data') return null;
  const body = await readTrackingBody(request);
  if (!body) return null;
  try {
    return await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    return null;
  }
}

export function singleFormValue(form: FormData | null, name: string, value: string) {
  const entries = form?.getAll(name);
  return entries?.length === 1 && entries[0] === value;
}

export const trackingPageHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
