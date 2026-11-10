import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { inspectBloomSnapshot } from '@/lib/suppression-snapshot.server';

const now = 1_800_000_000_000;
const key = 'ab'.repeat(32);

function snapshot(issued = now) {
  const bytes = new Uint8Array(64);
  bytes.set(new TextEncoder().encode('EDB1'));
  const header = new DataView(bytes.buffer);
  header.setBigUint64(4, BigInt(issued / 1000));
  header.setBigUint64(12, 10n);
  const tag = createHmac('sha256', Buffer.from(key, 'hex')).update('snapshot\0').update(bytes.subarray(0, 32)).digest();
  bytes.set(tag, 32);
  return bytes;
}

it('verifies the agent snapshot format, signature and freshness', async () => {
  await expect(inspectBloomSnapshot(snapshot(), key, now)).resolves.toEqual({ issued: now, expires: now + 86_400_000 });
  const modified = snapshot();
  modified[21] = 1;
  await expect(inspectBloomSnapshot(modified, key, now)).rejects.toThrow('Signature');
  await expect(inspectBloomSnapshot(snapshot(now - 86_401_000), key, now)).rejects.toThrow('expiré');
  await expect(inspectBloomSnapshot(snapshot(), 'cd'.repeat(32), now)).rejects.toThrow('Signature');
});
