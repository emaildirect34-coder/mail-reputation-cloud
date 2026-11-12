import { describe, expect, it } from 'vitest';
import { changedText } from '../lib/campaign-version';
import { describeCampaignVersion, recoverCampaignDigest } from '../lib/campaign-version.server';
import { renderWeeklyDigest } from '../lib/weekly-digest';

describe('campaign version comparison and recovery', () => {
  it('reports decoded link destinations and duplicate links without executing HTML', () => {
    const version = describeCampaignVersion('<script>hidden()</script><a href="https://example.org/?x=1&amp;y=2">Voir</a><a href="https://example.org/?x=1&amp;y=2">Offre</a>');
    expect(version.links).toEqual([{ href: 'https://example.org/?x=1&y=2', count: 2 }]);
    expect(version.text).toContain('Voir');
    expect(version.text).not.toContain('hidden()');
  });

  it('recovers editable sections from an existing weekly digest only when they reproduce the archived HTML', () => {
    const source = 'Été & sorties\nRésumé avec {accolades}\nDeuxième ligne\nhttps://example.org/?x=1&y=2\n\nActualités\nAutre résumé';
    const html = renderWeeklyDigest(source);
    expect(recoverCampaignDigest(html)).toBe(source);
    expect(recoverCampaignDigest(html.replace('<h1>', '<h1 class="changed">'))).toBeNull();
  });

  it('retains context around an insertion and a complete removal', () => {
    expect(changedText('Bonjour !', 'Bonjour Marie !')).toEqual({ leading: 'Bonjour ', before: '', after: 'Marie ', trailing: '!' });
    expect(changedText('Ancien texte', '')).toEqual({ leading: '', before: 'Ancien texte', after: '', trailing: '' });
  });
});
