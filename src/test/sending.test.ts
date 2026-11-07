import { describe, it, expect } from 'vitest';
import { parseContacts, assignServers } from '@/lib/sending.schemas';

describe('sending rules', () => {
  it('drops invalid and duplicate emails, keeps first name', () => {
    expect(parseContacts('Jean@Ex.fr,Jean\nbad\njean@ex.fr,Dup\nm@x.io')).toEqual([{ email: 'jean@ex.fr', first_name: 'Jean' }, { email: 'm@x.io', first_name: null }]);
  });
  it('spreads recipients across servers in turn', () => {
    expect(assignServers([1, 2, 3], ['a', 'b']).map(r => r.server)).toEqual(['a', 'b', 'a']);
  });
});
