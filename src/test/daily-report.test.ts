import { describe, it, expect } from 'vitest';
import { reportAlerts } from '../lib/daily-report';
const base = { date: 'x', isps: [], revenueCents: {}, quarantined: [], offlineServers: [], unsubscribes: 0 };
describe('daily report alerts', () => {
  it('alerts above 0.3 % complaints', () => expect(reportAlerts({ ...base, totals: { delivered: 1000, bounce: 0, deferred: 0, complaint: 4 } })).toHaveLength(1));
  it('alerts above 5 % bounces', () => expect(reportAlerts({ ...base, totals: { delivered: 90, bounce: 10, deferred: 0, complaint: 0 } })[0]).toMatch(/Rebonds/));
  it('stays quiet when healthy', () => expect(reportAlerts({ ...base, totals: { delivered: 1000, bounce: 10, deferred: 5, complaint: 1 } })).toEqual([]));
});
