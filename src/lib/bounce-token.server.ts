const maxAge = 30 * 86400;

async function signature(secret: string, value: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))).slice(0, 9);
}

export async function bounceAddress(id: string, domain: string, secret?: string, now = Math.floor(Date.now() / 1000)) {
  if (!secret || secret.length < 32) return `bounce+${id}@${domain}`;
  const value = `${id.replaceAll('-', '').toLowerCase()}-${now}`;
  const mac = await signature(secret, `${value}@${domain.toLowerCase()}`);
  // Base64url keeps the SMTP local part under 64 octets.
  return `bounce+${value}-${btoa(String.fromCharCode(...mac)).replaceAll('+', '-').replaceAll('/', '_')}@${domain}`;
}

export async function validBounceAddress(address: string, id: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const match = /^bounce\+([a-f0-9]{32})-(\d{10})-([A-Za-z0-9_-]{12})@([a-z0-9.-]+)$/i.exec(address);
  if (!match || match[1]?.toLowerCase() !== id.replaceAll('-', '').toLowerCase()) return false;
  const [, messageId, timestamp, mac, domain] = match;
  const age = now - Number(timestamp);
  if (age < -300 || age > maxAge) return false;
  const expected = await signature(secret, `${messageId!.toLowerCase()}-${timestamp}@${domain!.toLowerCase()}`);
  const actual = atob(mac!.replaceAll('-', '+').replaceAll('_', '/'));
  let diff = 0;
  expected.forEach((byte, index) => { diff |= byte ^ actual.charCodeAt(index); });
  return diff === 0;
}
