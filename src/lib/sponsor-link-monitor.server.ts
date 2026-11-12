import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/integrations/supabase/types';
import { hasClickId, sha256Hex } from './postback';
import { checkSponsorDestination } from './sponsor-destination.server';
import { trackableHref } from './tracking-request';

const maxLinks = 10;

export async function inspectSponsorLinks(
  campaign: { html: string; tracking_url: string; offer_status: string; baseline: Json },
  probe = checkSponsorDestination,
) {
  const baseline: Record<string, string> = {};
  if (campaign.baseline && typeof campaign.baseline === 'object' && !Array.isArray(campaign.baseline)) {
    for (const [key, host] of Object.entries(campaign.baseline)) {
      if (/^[0-9a-f]{64}$/.test(key) && typeof host === 'string') baseline[key] = host;
    }
  }
  const links = [...new Set(Array.from(campaign.html.matchAll(trackableHref), match => match[1]!.replaceAll('&amp;', '&'))
    .filter(url => hasClickId(url) || url === campaign.tracking_url))];
  const notes: string[] = [];
  let status: 'ok' | 'review' | 'alert' = 'ok';
  if (campaign.offer_status !== 'active') {
    status = 'alert';
    notes.push('L’offre n’est plus active dans le catalogue.');
  }
  if (!links.length || links.length > maxLinks) {
    if (status === 'ok') status = 'review';
    notes.push(links.length ? 'Seuls les dix premiers liens sont contrôlés.' : 'Aucun lien sponsor identifiable dans le message.');
  }
  const checks = await Promise.all(links.slice(0, maxLinks).map(async url => ({
    key: await sha256Hex(url), outcome: await probe(url),
  })));
  const nextBaseline: Record<string, string> = {};
  for (const { key, outcome } of checks) {
    const expected = baseline[key];
    const host = outcome.hosts.at(-1);
    if (expected) nextBaseline[key] = expected;
    if (outcome.status !== 'ok') {
      status = 'alert';
      notes.push(host ? `${host} · ${outcome.detail}` : outcome.detail);
    } else if (host && expected && expected !== host) {
      status = 'alert';
      notes.push(`Destination finale modifiée de ${expected} vers ${host}.`);
    } else if (host) {
      nextBaseline[key] = host;
    }
  }
  return {
    result: { status, notes: [...new Set(notes)] },
    baseline: nextBaseline,
  };
}

export async function monitorSponsorLinks(db: SupabaseClient<Database>) {
  if (!process.env['SPONSOR_AUDIT_HOSTS']?.trim()) return 0;
  const claimed = await db.rpc('claim_sponsor_link_checks');
  if (claimed.error?.code === 'PGRST202') return 0;
  if (claimed.error) throw new Error('File de vérification des liens sponsor indisponible.');
  let completed = 0;
  for (const campaign of claimed.data) {
    const check = await inspectSponsorLinks(campaign);
    const saved = await db.rpc('finish_sponsor_link_check', {
      _campaign: campaign.campaign_id, _lease: campaign.lease_id, _result: check.result,
      _baseline: check.baseline, _alert: check.result.status === 'alert',
    });
    if (saved.error) throw new Error('Résultat du contrôle sponsor indisponible.');
    if (saved.data) completed++;
  }
  return completed;
}
