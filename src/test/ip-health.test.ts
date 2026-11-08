import { describe, it, expect } from 'vitest';
import { quarantineDecision } from '../lib/ip-health';
describe('IP quarantine', () => {
  it('quarantines on one major list', () => expect(quarantineDecision(false, ['Spamhaus ZEN'])).toBe('quarantine'));
  it('quarantines on two minor lists', () => expect(quarantineDecision(false, ['PSBL', 'Mailspike'])).toBe('quarantine'));
  it('ignores UCEPROTECT L2 alone or one minor list', () => { expect(quarantineDecision(false, ['UCEPROTECT L2'])).toBe('keep'); expect(quarantineDecision(false, ['PSBL', 'UCEPROTECT L2'])).toBe('keep'); });
  it('releases only when fully clean', () => { expect(quarantineDecision(true, ['PSBL'])).toBe('keep'); expect(quarantineDecision(true, [])).toBe('release'); });
});
