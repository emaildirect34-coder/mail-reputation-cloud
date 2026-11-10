import { recipientDomain } from './email-address';
import { renderMessage } from './sending.server';
import { forwardConfirmedIpv4, senderRecords, spfLookupBudget } from './sender-dns.server';
import type { Check } from './preflight.functions';

const exampleId = '00000000-0000-4000-8000-000000000001';
type Sender = { id: string; from_email: string; server_ids: string[]; vmta_pool_id: string | null; list_id: string | null };

export async function gmailPreflight(sender: Sender, origin: string): Promise<Check[]> {
  const domain = recipientDomain(sender.from_email);
  if (!domain) throw new Error('Adresse expéditeur invalide.');
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const signal = AbortSignal.timeout(7500);
  const [spf, dm, sd, ips, pools] = await Promise.all([
    spfLookupBudget(domain, name => senderRecords(name, 'TXT', signal)),
    senderRecords(`_dmarc.${domain}`, 'TXT', signal),
    db.from('sending_domains').select('id,selector_a,selector_b,dkim_pub_a,dkim_pub_b').eq('domain', domain).maybeSingle(),
    db.from('server_ips').select('address,server_id,pool_id').in('server_id', sender.server_ids).eq('active', true).eq('family', 4).is('quarantined_at', null),
    db.from('vmta_pools').select('id').eq('purpose', 'marketing').eq('status', 'active'),
  ]);
  if (sd.error || ips.error || pools.error) throw new Error('Inventaire des serveurs ou des domaines indisponible.');
  const marketingPools = new Set(pools.data.map(pool => pool.id));
  const selected = ips.data.filter(ip => sender.vmta_pool_id
    ? ip.pool_id === sender.vmta_pool_id && marketingPools.has(ip.pool_id)
    : !ip.pool_id || marketingPools.has(ip.pool_id));
  const remaining = new Set(sender.server_ids);
  selected.forEach(ip => remaining.delete(ip.server_id));
  const group = 'Gmail · Authentification';
  const spfDetail = {
    ok: `Au plus ${spf.terms} terme(s) DNS dans les branches inspectées. L’autorisation effective des IP reste à vérifier par un envoi témoin.`,
    over: 'Les branches inspectées dépassent 10 termes DNS. Certaines évaluations peuvent retourner SPF PermError.',
    unknown: 'Calcul incomplet (DNS indisponible ou macro SPF).',
    invalid: 'Enregistrements SPF en conflit, incomplets ou référence récursive.',
    missing: 'Aucun SPF publié sur le domaine d’envoi.',
  }[spf.status];
  const checks: Check[] = [{
    group, name: 'Budget SPF (RFC 7208)', tone: spf.status === 'ok' ? 'ok' : ['unknown', 'over'].includes(spf.status) ? 'warn' : 'bad', detail: spfDetail,
  }];
  const policies = dm?.filter(record => /^v=dmarc1\s*;/i.test(record));
  const validPolicy = policies?.length === 1 && /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i.test(policies[0]!);
  checks.push({
    group, name: 'Politique DMARC du domaine', tone: validPolicy ? 'ok' : 'warn',
    detail: validPolicy ? policies[0]! : 'Politique directe non vérifiée. Une politique du domaine parent peut s’appliquer.',
  });
  const keys = sd.data ? await Promise.all([
    [sd.data.selector_a, sd.data.dkim_pub_a] as const, [sd.data.selector_b, sd.data.dkim_pub_b] as const,
  ].map(async ([selector, expected]) => {
    const records = await senderRecords(`${selector}._domainkey.${domain}`, 'TXT', signal);
    const key = records?.length === 1 ? /(?:^|;)\s*p=([^;]+)/i.exec(records[0]!)?.[1] : null;
    return !!key && key.replace(/\s/g, '') === expected.replace(/\s/g, '');
  })) : [];
  const bindings = sd.data ? await db.from('server_domain_bindings').select('server_id,status')
    .eq('domain_id', sd.data.id).in('server_id', sender.server_ids) : null;
  if (bindings?.error) throw new Error('Impossible de vérifier les installations DKIM.');
  const installed = new Set(bindings?.data.filter(row => row.status === 'installed').map(row => row.server_id));
  const keyCount = keys.filter(Boolean).length;
  const aligned = keyCount === 2 && installed.size === new Set(sender.server_ids).size;
  checks.push({
    group, name: 'Alignement configuré', tone: aligned ? 'ok' : 'warn',
    detail: `From, Return-Path généré et domaine de signature configuré utilisent ${domain}. ${keyCount}/2 clés correspondent au DNS, ${installed.size} serveur(s) avec installation confirmée. Le résultat SPF/DKIM réel se vérifie sur un message reçu.`,
  });
  const network = 'Gmail · Serveurs';
  if (remaining.size) checks.push({ group: network, name: 'Sources IPv4', tone: 'warn', detail: `${remaining.size} serveur(s) sans source d’envoi éligible dans l’inventaire.` });
  const unique = [...new Set(selected.map(ip => ip.address))];
  if (unique.length > 24) checks.push({ group: network, name: 'Périmètre FCrDNS', tone: 'warn', detail: `24 IP contrôlées sur ${unique.length}.` });
  const rdns = await Promise.all(unique.slice(0, 24).map(async ip => {
    const result = await forwardConfirmedIpv4(ip, signal);
    const detail = result.status === 'ok' ? `${ip} → ${result.hostname} → ${ip}`
      : result.status === 'mismatch' ? `Le ou les PTR (${result.records.map(row => row.name).join(', ')}) ne résolvent pas vers ${ip}.`
        : result.status === 'missing-ptr' ? 'Aucun PTR publié.' : 'Résolution DNS indisponible.';
    return { group: network, name: `FCrDNS ${ip}`, detail, tone: result.status === 'ok' ? 'ok' : result.status === 'unknown' ? 'warn' : 'bad' } satisfies Check;
  }));
  checks.push(...rdns);
  checks.push({
    group: network, name: 'TLS sortant', tone: process.env['KUMO_TLS13_ONLY'] === 'true' || process.env['KUMO_REQUIRE_MODERN_TLS'] === 'true' ? 'ok' : 'warn',
    detail: 'Contrôle de la configuration générée. La négociation effective se vérifie dans les journaux ou Postmaster Tools.',
  });
  const mime = renderMessage({ ...sender, from_name: 'Audit', subject: 'Audit', html: '<p>Audit technique</p>', reply_to: null },
    { id: exampleId, email: 'audit@example.invalid', first_name: null, unsub_token: 'audit-preview' }, origin);
  const headers = mime.split('\r\n\r\n')[0] ?? '';
  const oneClick = /^List-Unsubscribe: <https:\/\/[^\s<>]+>/m.test(headers) &&
    /^List-Unsubscribe-Post: List-Unsubscribe=One-Click\r?$/m.test(headers);
  checks.push({
    group: 'Gmail · En-têtes', name: 'Désinscription RFC 8058', tone: oneClick ? 'ok' : 'bad',
    detail: oneClick ? 'Les deux en-têtes sont générés avec un lien HTTPS. Leur signature et le traitement du POST restent à vérifier sur un message reçu.' : 'Lien HTTPS ou en-tête One-Click absent du message généré.',
  }, {
    group: 'Gmail · En-têtes', name: 'Feedback-ID', tone: /^Feedback-ID: /m.test(headers) ? 'ok' : 'warn',
    detail: /^Feedback-ID: /m.test(headers) ? 'En-tête généré pour le suivi agrégé des plaintes.' : 'En-tête absent. Configurez GMAIL_FEEDBACK_SENDER_ID pour le suivi par campagne.',
  });
  return checks;
}
