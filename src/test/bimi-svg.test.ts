import { describe, expect, it } from 'vitest';
import { prepareBimiSvg } from '@/lib/bimi-svg';

describe('BIMI logo preparation', () => {
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" x="0">${body}</svg>`;
  it('normalizes a simple shape without altering its geometry', () => {
    const output = prepareBimiSvg(svg('<circle cx="10" cy="10" r="8" fill="#123456"/>'), 'A & B');
    expect(output).toContain('baseProfile="tiny-ps"');
    expect(output).toContain('<title>A &amp; B</title>');
    expect(output).toContain('<circle cx="10" cy="10" r="8" fill="#123456"');
  });
  it('rejects active content and external resources', () => {
    expect(() => prepareBimiSvg(svg('<script>alert(1)</script>'), 'Test')).toThrow();
    expect(() => prepareBimiSvg(svg('<circle fill="url(https://example.org/fill)"/>'), 'Test')).toThrow();
  });
});
