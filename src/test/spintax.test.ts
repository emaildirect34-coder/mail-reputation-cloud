import { describe, it, expect } from 'vitest';
import { expand, countVariants, spin } from '@/lib/spintax';

describe('spintax', () => {
  it('picks one option per group', () => { expect(['Bonjour', 'Salut']).toContain(spin('{Bonjour|Salut}', 'x')); });
  it('handles nesting', () => { expect(['A c', 'A d', 'B']).toContain(spin('{A {c|d}|B}', 'y')); });
  it('is deterministic per seed', () => { const s = '{a|b|c|d|e|f} {g|h|i}'; expect(spin(s, 'm1')).toBe(spin(s, 'm1')); });
  it('uses fallback when variable is empty', () => { expect(expand('{first_name|Cher client}', { first_name: '' }, 's')).toBe('Cher client'); expect(expand('{first_name|Cher client}', { first_name: 'Marie' }, 's')).toBe('Marie'); });
  it('keeps plain macros', () => { expect(spin('{unsubscribe_url}', 's')).toBe('{unsubscribe_url}'); });
  it('counts variants including nesting', () => { expect(countVariants('{a|b} {c|{d|e}}')).toBe(6); });
});
