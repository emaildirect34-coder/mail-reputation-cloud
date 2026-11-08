import { describe, it, expect } from 'vitest';
import { effectiveDay } from '@/lib/infrastructure.schemas';
const base = { current_day: 3, daily_limits: [1,2,3,4,5,6], created_at: new Date(0).toISOString() };
describe('warmup day', () => {
  it('advances one day per 24h when active', () => expect(effectiveDay({ ...base, status: 'active' }, 2 * 86_400_000 + 5)).toBe(5));
  it('stays put when paused', () => expect(effectiveDay({ ...base, status: 'paused' }, 9 * 86_400_000)).toBe(3));
  it('caps at the last day', () => expect(effectiveDay({ ...base, status: 'active' }, 30 * 86_400_000)).toBe(6));
});
