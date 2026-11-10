import { z } from 'zod';
import { recipientDomain } from './email-address';

const ttl = 48 * 60 * 60 * 1000;
const context = new TextEncoder().encode('Email Direct subscription confirmation v1');
const payload = z.object({ email: z.string().max(254), list: z.string().uuid(), listName: z.string().min(1).max(120), expires: z.number().int() });
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function key() {
  const secret = process.env['SUBSCRIPTION_CONFIRMATION_KEY'] ?? '';
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('La clé de confirmation des inscriptions doit être configurée.');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g)!, pair => parseInt(pair, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function issueSubscriptionToken(email: string, list: string, listName: string, now = Date.now()) {
  if (!recipientDomain(email)) throw new Error('Adresse e-mail invalide.');
  const expires = now + ttl;
  const data = payload.parse({ email, list, listName, expires });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, await key(), new TextEncoder().encode(JSON.stringify(data))));
  const result = new Uint8Array(iv.length + encrypted.length);
  result.set(iv);
  result.set(encrypted, iv.length);
  return { token: base64url(result), expires };
}

export async function readSubscriptionToken(token: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{40,1500}$/.test(token)) return null;
  try {
    const bytes = Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
    if (base64url(bytes) !== token) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: context }, await key(), bytes.subarray(12));
    const data = payload.parse(JSON.parse(new TextDecoder().decode(plain)));
    if (data.expires <= now || data.expires > now + ttl || !recipientDomain(data.email)) return null;
    return data;
  } catch { return null; }
}
