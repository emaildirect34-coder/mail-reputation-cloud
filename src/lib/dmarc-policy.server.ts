import { dmarcPolicy, dmarcTags, dmarcTree, effectiveDmarcRecord } from './dmarc-policy';
import { lookup } from './mail-dns.server';
import { recipientDomain } from './email-address';

export async function readDmarcAuthorization(domain: string, destination: string) {
  const name = `${domain}._report._dmarc.${destination}`;
  if (name.length > 253) throw new Error('Nom DNS d’autorisation trop long.');
  try {
    const response = await lookup(name, 'TXT', AbortSignal.timeout(6000));
    if (response.TC || (response.Status !== 0 && response.Status !== 3)) return { name, status: 'unknown' } as const;
    const authorized = (response.Answer ?? []).some(answer => {
      if (answer.type !== 16) return false;
      const tags = dmarcTags(answer.data.replace(/"\s*"/g, '').replace(/^"|"$/g, '').trim());
      if (!tags) return false;
      const override = tags.get('rua');
      return override === undefined || override.split(',').every(uri => {
        const address = /^mailto:([^!]+)(?:!\d+[kmgt]?)?$/i.exec(uri.trim())?.[1];
        return !!address && recipientDomain(address) === destination;
      });
    });
    return { name, status: authorized ? 'authorized' : 'missing' } as const;
  } catch { return { name, status: 'unknown' } as const; }
}

export async function readDmarcPolicy(author: string) {
  const signal = AbortSignal.timeout(6000);
  const found: Parameters<typeof effectiveDmarcRecord>[1] = [];
  const conflicts: string[] = [];
  let uncertain = false;

  for (const domain of dmarcTree(author)) {
    const name = '_dmarc.' + domain;
    try {
      const reply = await lookup(name, 'TXT', signal);
      if (reply.TC || (reply.Status !== 0 && reply.Status !== 3)) {
        uncertain = true;
        break;
      }
      const candidates = (reply.Answer ?? []).filter(answer => answer.type === 16)
        .map(answer => answer.data.replace(/"\s*"/g, '').replace(/^"|"$/g, '').trim())
        .filter(value => /^[vV]\s*=\s*DMARC1(?:\s*;|\s*$)/.test(value));
      if (!candidates.length) continue;
      const tags = candidates.length === 1 ? dmarcTags(candidates[0]!) : null;
      if (!tags) {
        conflicts.push(name);
        if (candidates.length === 1) {
          uncertain = true;
          break;
        }
        continue;
      }
      found.push({ domain, text: candidates[0]!, tags });
      const psd = tags.get('psd')?.toLowerCase();
      if (domain === author || psd === 'y' || psd === 'n') break;
    } catch {
      uncertain = true;
      break;
    }
  }

  const record = uncertain ? undefined : effectiveDmarcRecord(author, found);
  let exists: boolean | null = null;
  if (record && record.domain !== author && record.tags.has('np')) {
    try {
      const reply = await lookup(author, 'A', signal);
      if (!reply.TC && reply.Status === 0) exists = true;
      if (!reply.TC && reply.Status === 3) exists = !!reply.Answer?.some(answer => answer.type === 5);
    } catch { /* The policy is reported as unknown when existence would change it. */ }
  }
  return {
    author, uncertain, conflicts, policy: record ? dmarcPolicy(author, record, exists) : null,
    record: record ? {
      domain: record.domain, text: record.text, testing: record.tags.get('t')?.toLowerCase() === 'y', legacyPct: record.tags.get('pct') ?? null,
    } : null,
  };
}
