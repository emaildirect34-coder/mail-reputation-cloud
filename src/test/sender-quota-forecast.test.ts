import { describe, expect, it } from 'vitest';
import { projectSenderQuota, quotaForecastThrough } from '../lib/sender-quota-forecast';

const asOf = '2027-01-01T14:00:00Z';

describe('sender domain quota forecast', () => {
  it('uses the existing queue across days and counts each deferred draft message once', () => {
    const result = projectSenderQuota({
      asOf, limit: 100, used: 70, deadline: null,
      existing: [{ day: '2027-01-01', last_day: null, volume: 40 }, { day: '2027-01-02', last_day: null, volume: 50 }],
      draft: [{ day: '2027-01-01', eligible: true, volume: 100 }, { day: '2027-01-02', eligible: true, volume: 20 }],
    });
    expect(result.days.map(day => [day.existingReady, day.existingAuthorized, day.draftAuthorized, day.draftWaiting]))
      .toEqual([[40, 30, 0, 100], [60, 60, 40, 80], [0, 0, 80, 0]]);
    expect(result.deferred).toBe(120);
  });

  it('applies intervening UTC capacity and expires older cohorts before a future draft', () => {
    const input = {
      asOf, limit: 100, used: 90, deadline: null,
      draft: [{ day: '2027-01-05', eligible: true, volume: 20 }],
    };
    const active = projectSenderQuota({ ...input, existing: [{ day: '2027-01-01', last_day: null, volume: 400 }] });
    expect(active.days[0]).toMatchObject({ existingReady: 90, draftAuthorized: 10, draftWaiting: 10 });
    const expired = projectSenderQuota({ ...input, existing: [{ day: '2027-01-01', last_day: '2027-01-02', volume: 400 }] });
    expect(expired.days[0]).toMatchObject({ existingReady: 0, draftAuthorized: 20 });
  });

  it('treats a midnight deadline as belonging to the preceding day', () => {
    const result = projectSenderQuota({
      asOf, limit: 10, used: 0, deadline: '2027-01-02T00:00:00Z', existing: [],
      draft: [{ day: '2027-01-01', eligible: true, volume: 20 }, { day: '2027-01-02', eligible: false, volume: 5 }],
    });
    expect(result.deferred).toBe(0);
    expect(result.expired).toBe(15);
    expect(result.days.map(day => day.draftExpired)).toEqual([10, 5]);
  });

  it('reports backlog beyond the seven days following the last planned day', () => {
    const draft = [{ day: '2027-01-01', eligible: true, volume: 20 }];
    expect(quotaForecastThrough(draft)).toBe('2027-01-08');
    const result = projectSenderQuota({ asOf, limit: 1, used: 0, deadline: null, existing: [], draft });
    expect(result.days).toHaveLength(8);
    expect(result.waitingAfterHorizon).toBe(12);
    expect(result.deferred).toBe(19);
  });
});
