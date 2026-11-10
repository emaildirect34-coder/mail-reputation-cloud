import { describe, expect, it } from 'vitest';
import { bounceAddress, validBounceAddress } from '@/lib/bounce-token.server';

describe('signed SMTP Return-Path', () => {
  it('binds the message, domain and timestamp within the SMTP local-part limit', async () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const key = 'a'.repeat(32);
    const now = 1_800_000_000;
    const address = await bounceAddress(id, 'example.org', key, now);
    expect(address.split('@')[0]?.length).toBeLessThanOrEqual(64);
    await expect(validBounceAddress(address, id, key, now)).resolves.toBe(true);
    await expect(validBounceAddress(address.replace('example.org', 'other.org'), id, key, now)).resolves.toBe(false);
    await expect(validBounceAddress(address, id, key, now + 31 * 86400)).resolves.toBe(false);
    await expect(validBounceAddress(address, id, 'b'.repeat(32), now)).resolves.toBe(false);
    await expect(bounceAddress(id, 'example.org')).resolves.toBe(`bounce+${id}@example.org`);
  });
});
