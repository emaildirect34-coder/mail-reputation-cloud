import { recipientDomain } from './email-address';

export const dmarcPolicies = ['none', 'quarantine', 'reject'] as const;
type Policy = typeof dmarcPolicies[number];

export function dmarcDomain(value: string) {
  const domain = value.trim().replace(/\.$/, '');
  return recipientDomain('dmarc@' + domain);
}

export function dmarcRecord(options: {
  domain: string; policy: Policy; children: Policy | ''; aggregate: string; organizational: boolean; strict: boolean;
}) {
  const domain = dmarcDomain(options.domain);
  if (!domain) return null;
  const address = options.aggregate.trim();
  const host = address ? recipientDomain(address) : null;
  const local = address.split('@')[0] ?? '';
  if (address && (!host || !/^[a-z0-9._+-]+$/i.test(local))) return null;

  const tags = ['v=DMARC1', 'p=' + options.policy];
  if (options.children) tags.push('sp=' + options.children);
  if (options.organizational) tags.push('psd=n');
  if (options.strict) tags.push('adkim=s', 'aspf=s');
  if (host) tags.push('rua=mailto:' + local + '@' + host);
  const name = '_dmarc.' + domain;
  const authorization = domain + '._report._dmarc.' + host;
  return name.length <= 253 ? {
    name, value: tags.join('; '),
    authorization: host && host !== domain && authorization.length <= 253 ? authorization : null,
  } : null;
}

export function dmarcTree(domain: string) {
  const labels = domain.split('.');
  const ancestors = Math.min(labels.length - 1, 7);
  return [domain, ...Array.from({ length: ancestors }, (_, index) => labels.slice(index - ancestors).join('.'))];
}

export function dmarcTags(text: string) {
  const tags = new Map<string, string>();
  for (const part of text.trim().replace(/;$/, '').split(';')) {
    const match = /^([a-z]+)\s*=\s*([\x20-\x7e]+)$/i.exec(part.trim());
    if (!match || tags.has(match[1]!.toLowerCase())) return null;
    tags.set(match[1]!.toLowerCase(), match[2]!.trim());
  }
  return tags.entries().next().value?.[0] === 'v' && tags.get('v') === 'DMARC1' ? tags : null;
}

type RecordInfo = { domain: string; text: string; tags: Map<string, string> };

export function effectiveDmarcRecord(author: string, records: RecordInfo[]) {
  const direct = records.find(record => record.domain === author);
  if (direct) return direct;
  const upper = records.at(-1);
  if (upper?.tags.get('psd')?.toLowerCase() === 'y') {
    const organizational = author.split('.').slice(-upper.domain.split('.').length - 1).join('.');
    return records.find(record => record.domain === organizational) ?? upper;
  }
  return upper;
}

export function dmarcPolicy(author: string, record: RecordInfo, exists: boolean | null) {
  const { tags } = record;
  const policy = tags.get('p')?.toLowerCase() ?? 'none';
  const children = tags.get('sp')?.toLowerCase();
  const nonexistent = tags.get('np')?.toLowerCase();
  const invalid = [policy, children, nonexistent].some(value => value !== undefined && !dmarcPolicies.some(allowed => value === allowed));
  if (invalid) return null;
  const inherited = author !== record.domain;
  if (inherited && exists === null && nonexistent && nonexistent !== (children ?? policy)) return null;
  const selected = inherited ? (exists === false ? nonexistent : undefined) ?? children ?? policy : policy;
  if (tags.get('t')?.toLowerCase() === 'y') return selected === 'reject' ? 'quarantine' : 'none';
  return selected;
}
