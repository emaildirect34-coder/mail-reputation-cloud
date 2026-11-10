import { describe, expect, it } from 'vitest';
import { parseTopicPreferences } from '@/lib/campaign-topics';

describe('recipient topic preferences', () => {
  it('distinguishes all topics from an explicit selection', () => {
    expect(parseTopicPreferences(new URLSearchParams('mode=all&topic=news'))).toBeNull();
    expect(parseTopicPreferences(new URLSearchParams('mode=selected&topic=news&topic=events'))).toEqual(['news', 'events']);
  });

  it('rejects empty, unknown or ambiguous selections', () => {
    for (const invalid of ['mode=selected', 'mode=selected&topic=unknown', 'mode=selected&topic=news&topic=news', 'mode=all&mode=selected']) {
      expect(parseTopicPreferences(new URLSearchParams(invalid))).toBeUndefined();
    }
  });
});
