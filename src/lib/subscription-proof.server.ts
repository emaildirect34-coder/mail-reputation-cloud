import { sha256 } from './kumo.server';

const encode = (value: string) => new TextEncoder().encode(value);
const hexBytes = (value: string) => Uint8Array.from(value.match(/../g)!, pair => parseInt(pair, 16));

async function proofKey() {
  const secret = process.env['SUBSCRIPTION_PROOF_KEY'];
  if (!secret) return null;
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Clé de signature des confirmations invalide.');
  return crypto.subtle.importKey('raw', hexBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export const subscriptionStatement = (listName: string) =>
  `Confirmez si vous souhaitez recevoir les e-mails de la liste ${listName}.`;

export async function sealSubscriptionProof(token: { email: string; list: string; listName: string }, tokenHash: string, url: string) {
  const key = await proofKey();
  if (!key) return {};
  const payload = JSON.stringify({
    version: 1,
    tokenHash,
    listId: token.list,
    emailSha256: await sha256(token.email),
    confirmedAt: new Date().toISOString(),
    form: new URL('/confirm-subscription', url).href,
    statement: subscriptionStatement(token.listName),
    action: 'Confirmer mon inscription',
  });
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encode(payload)));
  const signature = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { _proof_payload: payload, _proof_signature: signature };
}

export async function verifySubscriptionProof(payload: string, signature: string, tokenHash: string, listId: string, email: string) {
  const key = await proofKey();
  if (!key || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (!await crypto.subtle.verify('HMAC', key, hexBytes(signature), encode(payload))) return false;
  const proof = JSON.parse(payload);
  return proof.version === 1 && proof.tokenHash === tokenHash && proof.listId === listId && proof.emailSha256 === await sha256(email);
}
