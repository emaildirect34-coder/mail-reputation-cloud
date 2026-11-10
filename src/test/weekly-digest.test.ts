import { expect, it } from 'vitest';
import { renderWeeklyDigest } from '@/lib/weekly-digest';

it('renders distinct editorial blocks in one message and preserves tracked HTTPS query parameters', () => {
  const html = renderWeeklyDigest('Une rubrique\nRésumé <b>{abc}</b>\nhttps://example.org/page?a=1&b=2\n\nAutre rubrique\nUn autre contenu');
  expect(html).toContain('<h2>Une rubrique</h2>');
  expect(html).toContain('<h2>Autre rubrique</h2>');
  expect(html).toContain('https://example.org/page?a=1&amp;b=2');
  expect(html).not.toContain('<b>');
  expect(html).not.toContain('{abc}');
  expect(() => renderWeeklyDigest('Titre unique\nUn contenu')).toThrow();
});
