export const bloomBucket = 'agent-suppression-snapshots';
export const bloomObject = 'current.bloom';
export const maxBloomBytes = 12_000_052;

export async function inspectBloomSnapshot(bytes: Uint8Array<ArrayBuffer>, secret: string | undefined, now = Date.now()) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Clé de signature Bloom absente.');
  if (bytes.length <= 52 || bytes.length > maxBloomBytes || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'EDB1') {
    throw new Error('Format de l’instantané invalide.');
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, 20);
  const issued = Number(header.getBigUint64(4)) * 1000;
  const capacity = Number(header.getBigUint64(12));
  if (issued > now + 300_000 || issued < now - 86_400_000 || capacity < 1 || capacity > 10_000_000 || bytes.length !== 52 + Math.ceil(capacity * 1.2)) {
    throw new Error('Instantané expiré ou taille invalide.');
  }
  const key = Uint8Array.from(secret.match(/../g)!, part => parseInt(part, 16));
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const prefix = new TextEncoder().encode('snapshot\0');
  const data = new Uint8Array(prefix.length + bytes.length - 32);
  data.set(prefix);
  data.set(bytes.subarray(0, bytes.length - 32), prefix.length);
  if (!await crypto.subtle.verify('HMAC', cryptoKey, bytes.subarray(bytes.length - 32), data)) throw new Error('Signature de l’instantané invalide.');
  return { issued, expires: issued + 86_400_000 };
}
