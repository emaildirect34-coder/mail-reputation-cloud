import { describe, expect, it } from 'vitest';
import { planRecipientSchedule, scheduledInstant } from '@/lib/campaign-schedule';

describe('campaign scheduling', () => {
  it('uses the account time zone instead of the server time zone', () => {
    expect(scheduledInstant('2027-01-12T12:00', 'Europe/Paris')).toBe('2027-01-12T11:00:00.000Z');
    expect(scheduledInstant('2027-07-12T12:00', 'Europe/Paris')).toBe('2027-07-12T10:00:00.000Z');
    expect(scheduledInstant('2027-07-12T12:00', 'Asia/Kathmandu')).toBe('2027-07-12T06:15:00.000Z');
  });

  it('rejects invalid dates and ambiguous or nonexistent times', () => {
    expect(() => scheduledInstant('2027-02-31T12:00', 'Europe/Paris')).toThrow();
    expect(() => scheduledInstant('2027-03-28T02:30', 'Europe/Paris')).toThrow();
    expect(() => scheduledInstant('2027-10-31T02:30', 'Europe/Paris')).toThrow();
  });

  it('uses local time and spreads recipients within each time zone, including the account fallback', () => {
    expect(planRecipientSchedule('2027-07-12T12:00', 'Europe/Paris', [
      'America/New_York', null, 'Asia/Kathmandu', 'Europe/Paris', 'America/New_York',
    ], 2, Date.parse('2027-07-11T00:00:00Z'))).toEqual({
      scheduledAt: '2027-07-12T06:15:00.000Z',
      availableAt: [
        '2027-07-12T16:00:00.000Z',
        '2027-07-12T10:00:00.000Z',
        '2027-07-12T06:15:00.000Z',
        '2027-07-12T11:00:00.000Z',
        '2027-07-12T17:00:00.000Z',
      ],
      fallbackCount: 1,
    });
  });

  it('rejects a local start that is past or ambiguous in a recipient zone', () => {
    expect(() => planRecipientSchedule('2027-07-12T12:00', 'Europe/Paris', ['Asia/Kathmandu'], 0,
      Date.parse('2027-07-12T07:00:00Z'))).toThrow('Asia/Kathmandu');
    expect(() => planRecipientSchedule('2027-11-07T01:30', 'Europe/Paris', ['America/New_York'], 0,
      Date.parse('2027-11-06T00:00:00Z'))).toThrow('America/New_York');
  });
});
