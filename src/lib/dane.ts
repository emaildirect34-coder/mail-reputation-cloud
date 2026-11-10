export async function tlsaFingerprint(pem: string) {
  if (pem.length > 128_000 || /PRIVATE KEY/.test(pem)) throw new Error('Choisissez uniquement le certificat public SMTP au format PEM.');
  const block = /-----BEGIN CERTIFICATE-----([\s\w+/=]+)-----END CERTIFICATE-----/.exec(pem)?.[1];
  if (!block) throw new Error('Certificat public PEM introuvable.');
  try {
    const { Certificate } = await import('pkijs');
    const bytes = Uint8Array.from(atob(block.replace(/\s/g, '')), char => char.charCodeAt(0));
    const leaf = Certificate.fromBER(bytes);
    const spki = leaf.subjectPublicKeyInfo.toSchema().toBER(false);
    const digest = await crypto.subtle.digest('SHA-256', spki);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    throw new Error('Le certificat public SMTP est illisible.');
  }
}

/** DNS JSON resolvers may return presentation format or RFC 3597 generic hex. */
export function tlsa311(value: string) {
  const generic = /^\\#\s+35\s+([a-f0-9\s]+)$/i.exec(value.trim())?.[1]?.replace(/\s/g, '');
  const candidate = generic
    ? /^030101([a-f0-9]{64})$/i.exec(generic)?.[1]
    : /^3\s+1\s+1\s+([a-f0-9\s]+)$/i.exec(value.replace(/[()]/g, '').trim())?.[1]?.replace(/\s/g, '');
  return candidate?.length === 64 ? candidate.toLowerCase() : null;
}
