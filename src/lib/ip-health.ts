// Quarantine rule: a major list (Spamhaus, Barracuda, SpamCop) or two other lists remove the IP from sending.
// UCEPROTECT L2 alone (neighbourhood listing) never quarantines. Release only once every list is clean.
const MAJOR = ['Spamhaus ZEN', 'Barracuda', 'SpamCop'];
export function quarantineDecision(quarantined: boolean, listed: string[]): 'quarantine' | 'release' | 'keep' {
  const own = listed.filter(l => l !== 'UCEPROTECT L2');
  const hit = own.some(l => MAJOR.includes(l)) || own.length >= 2;
  if (!quarantined && hit) return 'quarantine';
  if (quarantined && listed.length === 0) return 'release';
  return 'keep';
}
