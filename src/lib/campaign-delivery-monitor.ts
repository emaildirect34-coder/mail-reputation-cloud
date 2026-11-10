import { ispOf } from './infrastructure.schemas';

type Delivery = {
  domain: string; queued: number; claimed: number; injected: number; injection_failed: number;
  accepted: number; deferred: number; bounced: number; complained: number; oldest_due_at: string | null;
};
type Seed = { address: string; placement: 'inbox' | 'promotions' | 'spam' | 'pending' | 'missing'; received_at?: string | null | undefined };

function provider(domain: string) {
  if (domain === 'free.fr') return 'Free';
  if (domain === 'sfr.fr' || domain === 'neuf.fr') return 'SFR';
  return ispOf('@' + domain) ?? domain;
}

export function campaignDeliveryGroups(delivery: Delivery[], seeds: Seed[]) {
  const groups = new Map<string, {
    provider: string; queued: number; claimed: number; injected: number; injectionFailed: number;
    accepted: number; deferred: number; bounced: number; complained: number; oldestDueAt: string | null;
    placement: Record<Seed['placement'], number>; lastReceivedAt: string | null;
  }>();
  function group(domain: string) {
    const key = provider(domain);
    const existing = groups.get(key);
    if (existing) return existing;
    const row = {
      provider: key, queued: 0, claimed: 0, injected: 0, injectionFailed: 0, accepted: 0,
      deferred: 0, bounced: 0, complained: 0, oldestDueAt: null, lastReceivedAt: null,
      placement: { inbox: 0, promotions: 0, spam: 0, pending: 0, missing: 0 },
    };
    groups.set(key, row);
    return groups.get(key)!;
  }
  for (const entry of delivery) {
    const row = group(entry.domain);
    row.queued += entry.queued;
    row.claimed += entry.claimed;
    row.injected += entry.injected;
    row.injectionFailed += entry.injection_failed;
    row.accepted += entry.accepted;
    row.deferred += entry.deferred;
    row.bounced += entry.bounced;
    row.complained += entry.complained;
    if (entry.oldest_due_at && (!row.oldestDueAt || Date.parse(entry.oldest_due_at) < Date.parse(row.oldestDueAt))) {
      row.oldestDueAt = entry.oldest_due_at;
    }
  }
  for (const seed of seeds) {
    const row = group(seed.address.toLowerCase().split('@').at(-1)!);
    row.placement[seed.placement]++;
    if (seed.received_at && Number.isFinite(Date.parse(seed.received_at)) &&
        (!row.lastReceivedAt || Date.parse(seed.received_at) > Date.parse(row.lastReceivedAt))) {
      row.lastReceivedAt = seed.received_at;
    }
  }
  return [...groups.values()].sort((a, b) =>
    b.placement.spam - a.placement.spam || b.queued - a.queued || a.provider.localeCompare(b.provider));
}
