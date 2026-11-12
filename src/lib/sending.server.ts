// Server-only: builds the final RFC 5322 message for one recipient.
import { AMP_EMAIL_LIMIT, plainEmailText } from './amp-email';
import { expand } from './spintax';
import { trackableHref } from './tracking-request';
function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}
function encodeHeader(value: string, phrase = false) {
  const safe = value.replace(/[\x00-\x1f\x7f]+/g, ' ');
  if (safe.length <= 66 && /^[\x20-\x7e]*$/.test(safe) && !safe.includes('=?')) {
    return phrase && !/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/i.test(safe) ? `"${safe.replace(/["\\]/g, '\\$&')}"` : safe;
  }
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = '', size = 0;
  for (const character of safe) {
    const length = encoder.encode(character).length;
    if (size + length > 42) {
      words.push(`=?UTF-8?B?${base64(chunk)}?=`);
      chunk = '';
      size = 0;
    }
    chunk += character;
    size += length;
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(chunk)}?=`);
  return words.join('\r\n ');
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mimeBase64 = (value: string) => base64(value).match(/.{1,76}/g)?.join('\r\n') ?? '';

export function pickCampaignVariant<T extends { subject: string; from_name: string; ab_variants: unknown; ab_winner: number | null }>(campaign: T, variant: number | null) {
  const option: unknown = Array.isArray(campaign.ab_variants) ? campaign.ab_variants[variant ?? campaign.ab_winner ?? 0] : undefined;
  if (!option || typeof option !== 'object') return campaign;
  const { subject, fromName } = option as { subject?: unknown; fromName?: unknown };
  return {
    ...campaign,
    subject: typeof subject === 'string' && subject ? subject : campaign.subject,
    from_name: typeof fromName === 'string' && fromName ? fromName : campaign.from_name,
  };
}

export function expandCampaignHtml(
  campaign: { html: string; from_name: string; from_email: string },
  message: { id: string; email: string; first_name: string | null },
) {
  return expand(campaign.html, {
    first_name: esc(message.first_name ?? ''), to: message.email,
    from_name: campaign.from_name, from_email: campaign.from_email,
  }, message.id + ':b');
}

function mailingListHeaders(listId: string | null | undefined, origin: string) {
  if (!listId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(listId)) return [];
  const namespace = (process.env['LIST_ID_DOMAIN'] ?? URL.parse(origin)?.hostname ?? '').toLowerCase();
  if (namespace.length > 210 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace)) return [];
  const headers = [`List-Id: <${listId.toLowerCase()}.${namespace}>`];
  for (const [header, value] of [['List-Help', process.env['LIST_HELP_URL']], ['List-Archive', process.env['LIST_ARCHIVE_URL']]]) {
    const url = URL.parse(value ?? '');
    if (url?.protocol === 'https:' && !url.username && !url.password && url.href.length <= 500 && !/[<>]/.test(url.href)) {
      headers.push(`${header}: <${url.href}>`);
    }
  }
  const owner = process.env['LIST_OWNER_EMAIL'] ?? '';
  if (owner.length <= 254 && /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(owner)) headers.push(`List-Owner: <mailto:${owner}>`);
  return headers;
}

export function renderMessage(c: { id?: string; from_name: string; from_email: string; reply_to: string | null; subject: string; html: string; amp_html?: string | null; list_id?: string | null; purchase_thank_you?: boolean; placement_probe_token?: string | null; sender_verification?: boolean }, m: { id: string; email: string; first_name: string | null; unsub_token: string }, origin: string, trackOrigin = origin) {
  const unsub = `${origin}/api/public/unsub/${m.unsub_token}`;
  const preferenceOrigin = process.env['BRANDED_PREFERENCES_ENABLED'] === 'true' ? trackOrigin : origin;
  const preferences = `${preferenceOrigin}/preferences/${m.unsub_token}`;
  const fill = (s: string, html: boolean) => s
    .replaceAll('{first_name}', html ? esc(m.first_name ?? '') : (m.first_name ?? ''))
    .replaceAll('{to}', m.email).replaceAll('{unsubscribe_url}', unsub).replaceAll('{preferences_url}', preferences)
    .replaceAll('{from_name}', c.from_name).replaceAll('{from_email}', c.from_email);
  const vars = { first_name: m.first_name ?? '', to: m.email, from_name: c.from_name, from_email: c.from_email };
  c = { ...c, html: expandCampaignHtml(c, m), subject: expand(c.subject, vars, m.id + ':s') };
  const domain = c.from_email.split('@')[1] ?? 'localhost';
  // Click tracking only rewrites links written literally in the template, so the redirect endpoint can verify them.
  const track = `${trackOrigin}/api/public/c/${m.unsub_token}?u=`;
  const automatic = c.purchase_thank_you || c.sender_verification;
  let body = fill(automatic ? c.html : c.html.replace(trackableHref, (_, u: string) => `href="${track}${encodeURIComponent(u.replaceAll('&amp;', '&'))}"`), true);
  if (!c.sender_verification && !c.html.includes('{unsubscribe_url}')) body += `\n<p style="font-size:11px;color:#888">Pour ne plus recevoir nos emails : <a href="${unsub}">se désinscrire</a>.</p>`;
  if (!automatic && !c.html.includes('{preferences_url}')) body += `\n<p style="font-size:11px;color:#555"><a href="${preferences}">Gérer mes préférences e-mail</a></p>`;
  if (!automatic) body += `\n<img src="${trackOrigin}/api/public/t/${m.unsub_token}" width="1" height="1" alt="" style="display:none">`;
  const senderName = `From: ${encodeHeader(c.from_name, true)}`;
  const sender = `<${c.from_email}>`;
  const separator = (senderName.split('\r\n').at(-1)?.length ?? 0) + sender.length + 1 > 76 ? '\r\n ' : ' ';
  const feedbackSender = process.env['GMAIL_FEEDBACK_SENDER_ID']?.trim() ?? '';
  const feedbackId = c.list_id && c.id && /^[a-f0-9-]{36}$/i.test(c.id) && /^[a-z0-9]{5,15}$/i.test(feedbackSender)
    ? `Feedback-ID: ${c.id.toLowerCase()}:marketing:${feedbackSender}`
    : null;
  const h = [
    `${senderName}${separator}${sender}`, `To: <${m.email}>`, `Subject: ${encodeHeader(fill(c.subject, false))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${m.id}@${domain}>`,
    ...(c.reply_to ? [`Reply-To: <${c.reply_to}>`] : []),
    ...(automatic ? ['Auto-Submitted: auto-generated'] : []),
    ...(c.placement_probe_token && /^ED-[A-Z0-9]{5,32}$/.test(c.placement_probe_token) ? [`X-Email-Direct-Placement: ${c.placement_probe_token}`] : []),
    ...(c.sender_verification ? [] : [`List-Unsubscribe: <${unsub}>, <mailto:unsubscribe@${domain}?subject=${m.unsub_token}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click']),
    ...mailingListHeaders(c.list_id, origin),
    ...(c.list_id ? ['Precedence: bulk', 'X-Auto-Response-Suppress: OOF, AutoReply'] : []),
    ...(feedbackId ? [feedbackId] : []),
    'MIME-Version: 1.0',
  ];
  const part = (type: string, value: string) => [
    `Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', mimeBase64(value),
  ].join('\r\n');
  // Substitute only footer links in AMP. Leave AMP mustache and bindings intact.
  const amp = c.amp_html?.replace(/(?<!\{)\{(unsubscribe_url|preferences_url)\}(?!\})/g, (_, key: string) =>
    esc(key === 'unsubscribe_url' ? unsub : preferences));
  const plain = plainEmailText(fill(c.html, true));
  const fallback = [
    plain || 'Consultez la version HTML pour voir le contenu de ce message.',
    ...(!c.sender_verification && !plain.includes(unsub) ? [`Se désinscrire ${unsub}`] : []),
    ...(!automatic && !plain.includes(preferences) ? [`Gérer mes préférences ${preferences}`] : []),
  ].join('\n\n');
  const boundary = `ed-${crypto.randomUUID()}`;
  return [
    ...h, `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, part('text/plain', fallback),
    ...(amp && new TextEncoder().encode(amp).length <= AMP_EMAIL_LIMIT ? [`--${boundary}`, part('text/x-amp-html', amp)] : []),
    `--${boundary}`, part('text/html', body), `--${boundary}--`, '',
  ].join('\r\n');
}
