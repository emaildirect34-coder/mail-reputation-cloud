import { describe, expect, it, vi } from 'vitest';
import { bounceAddress } from '@/lib/bounce-token.server';
import { acceptedDeliveryEvents } from '@/lib/delivery-events.server';
import { deliveryBatch, type DeliveryEvent } from '@/lib/delivery.schemas';

const id = 'c30d9512-234c-4f27-baf5-8f0935a949d5';
const secret = 'a'.repeat(32);
const queued = new Map([[id, 'target@example.org']]);

async function report(overrides?: Partial<DeliveryEvent>): Promise<DeliveryEvent> {
  return deliveryBatch.parse({ events: [{
    eventKey: 'from-kumo-log', messageId: id, type: 'dsn', occurredAt: new Date().toISOString(), smtpCode: 550,
    detail: 'untrusted text', dsn: { recipient: 'target@example.org', status: '5.1.1' },
    returnPath: await bounceAddress(id, 'sender.example.org', secret), ...overrides,
  }] }).events[0]!;
}

describe('authenticated asynchronous delivery reports', () => {
  it('converts a signed permanent report for the queued recipient to a canonical bounce', async () => {
    const event = await report();
    const result = await acceptedDeliveryEvents([event], secret, async () => queued);
    expect(result).toEqual([{
      eventKey: `dsn:${id}`, messageId: id, type: 'bounce', occurredAt: event.occurredAt, smtpCode: 550, detail: 'DSN 5.1.1',
    }]);
    const retry = await acceptedDeliveryEvents([{ ...event, eventKey: 'different-remote-log' }], secret, async () => queued);
    expect(retry).toEqual(result);
  });

  it('rejects missing, forged and non-permanent reports before accessing recipients', async () => {
    const find = vi.fn(async () => queued);
    const permanent = await report();
    const invalid = await Promise.all([
      report({ returnPath: undefined }),
      report({ returnPath: `bounce+${id}@sender.example.org` }),
      report({ returnPath: permanent.returnPath?.replace('sender.example.org', 'different.example.org') }),
      report({ smtpCode: 450 }),
      report({ dsn: { recipient: 'target@example.org', status: '4.1.1' } }),
      report({ type: 'bounce' }),
    ]);
    await expect(acceptedDeliveryEvents(invalid, secret, find)).resolves.toEqual([]);
    await expect(acceptedDeliveryEvents([permanent], undefined, find)).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('requires the recipient match and leaves synchronous SMTP failures supported', async () => {
    const redirected = await report({ dsn: { recipient: 'other@example.org', status: '5.1.1' } });
    const direct = await report({ type: 'bounce', dsn: undefined, returnPath: undefined });
    await expect(acceptedDeliveryEvents([redirected, direct], secret, async () => queued)).resolves.toEqual([{
      eventKey: direct.eventKey, messageId: id, type: 'bounce', occurredAt: direct.occurredAt, smtpCode: 550, detail: direct.detail,
    }]);
    await expect(acceptedDeliveryEvents([await report()], secret, async () => new Map())).resolves.toEqual([]);
  });
});
