import { tlsa311 } from './dane';
import { lookup } from './mail-dns.server';

const dnsOwner = (name?: string) => name?.replace(/\.$/, '').toLowerCase();

export async function inspectDaneDns(domain: string, mx: string) {
  const owner = '_25._tcp.' + mx;
  const signal = AbortSignal.timeout(6000);
  const [mxResult, tlsaResult] = await Promise.allSettled([lookup(domain, 'MX', signal, true), lookup(owner, 'TLSA', signal, true)]);
  const answers = (result: typeof mxResult) => result.status === 'fulfilled' && !result.value.TC &&
    (result.value.Status === 0 || result.value.Status === 3) ? result.value : null;
  const mxReply = answers(mxResult);
  const tlsaReply = answers(tlsaResult);
  const listed = mxReply?.Answer?.some(record => record.type === 15 && dnsOwner(record.name) === domain &&
    dnsOwner(record.data.trim().split(/\s+/)[1]) === mx) ?? false;
  const records = tlsaReply?.Answer?.filter(record => record.type === 52 && dnsOwner(record.name) === owner) ?? [];
  return {
    owner, mx: mxReply ? (listed ? (mxReply.AD ? 'secure' : 'unsigned') : 'absent') : 'unknown',
    tlsa: tlsaReply ? (records.length ? (tlsaReply.AD ? 'secure' : 'unsigned') : 'absent') : 'unknown',
    authenticatedAbsence: tlsaReply?.AD === true && !tlsaReply.Answer?.length,
    fingerprints: [...new Set(records.map(record => tlsa311(record.data)).filter(value => value !== null))],
  } as const;
}

export async function matchesSendingIp(mx: string, ip: string) {
  const reply = await lookup(mx, 'A', AbortSignal.timeout(6000), true);
  return reply.Status === 0 && !reply.TC && reply.AD === true &&
    reply.Answer?.some(record => record.type === 1 && dnsOwner(record.name) === mx && record.data.trim() === ip) === true;
}
