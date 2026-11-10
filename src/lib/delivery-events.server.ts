import { validBounceAddress } from './bounce-token.server';
import type { DeliveryEvent } from './delivery.schemas';

export async function acceptedDeliveryEvents(
  events: DeliveryEvent[],
  secret: string | undefined,
  findRecipients: (messageIds: string[]) => Promise<ReadonlyMap<string, string>>,
) {
  const key = secret && secret.length >= 32 ? secret : undefined;
  const checks = await Promise.all(events.map(async event => {
    if (event.type === 'dsn') {
      if (!event.dsn?.status.startsWith('5.') || !event.smtpCode || event.smtpCode < 500) return false;
    } else {
      if (event.dsn) return false;
      if (event.type !== 'complaint' || !key) return true;
    }
    return !!key && !!event.returnPath && validBounceAddress(event.returnPath, event.messageId, key);
  }));

  const verified = events.filter((_, index) => checks[index]);
  const dsnIds = [...new Set(verified.filter(event => event.type === 'dsn').map(event => event.messageId.toLowerCase()))];
  const recipients = dsnIds.length ? await findRecipients(dsnIds) : new Map<string, string>();
  return verified.flatMap(({ returnPath: _returnPath, dsn, ...event }) => {
    if (event.type !== 'dsn') return [{ ...event, type: event.type }];
    const id = event.messageId.toLowerCase();
    const expected = recipients.get(id)?.trim().toLowerCase();
    if (!dsn || expected !== dsn.recipient.trim().toLowerCase()) return [];
    // One permanent DSN per message, even if a remote MTA resends it with new trace headers.
    return [{ ...event, eventKey: `dsn:${id}`, type: 'bounce' as const, detail: `DSN ${dsn.status}` }];
  });
}
