import { describe, it, expect } from 'vitest';
import { ispHealth } from '@/lib/infrastructure.schemas';
const ev = (n: number, type: string, to = 'a@gmail.com') => Array.from({ length: n }, () => ({ recipient: to, event_type: type }));
describe('régulation dynamique par FAI', () => {
  it('ralentit ×0.25 au-delà de 0.3 % de plaintes', () => expect(ispHealth([...ev(995, 'delivered'), ...ev(5, 'complaint')]).Gmail.factor).toBe(0.25));
  it('ralentit ×0.5 si plus de 20 % de reports', () => expect(ispHealth([...ev(70, 'delivered'), ...ev(30, 'deferred')]).Gmail.factor).toBe(0.5));
  it('ne touche à rien sous 20 événements', () => expect(ispHealth(ev(10, 'bounce')).Gmail.factor).toBe(1));
  it('classe hotmail.fr chez Microsoft', () => expect(ispHealth(ev(30, 'bounce', 'x@hotmail.fr')).Microsoft.factor).toBe(0.5));
});
