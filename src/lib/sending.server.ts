// Server-only: builds the final RFC 5322 message for one recipient.
const enc = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function renderMessage(c: { from_name: string; from_email: string; reply_to: string | null; subject: string; html: string }, m: { id: string; email: string; first_name: string | null; unsub_token: string }, origin: string, trackOrigin = origin) {
  const unsub = `${origin}/api/public/unsub/${m.unsub_token}`;
  const fill = (s: string, html: boolean) => s
    .replaceAll('{first_name}', html ? esc(m.first_name ?? '') : (m.first_name ?? ''))
    .replaceAll('{to}', m.email).replaceAll('{unsubscribe_url}', unsub)
    .replaceAll('{from_name}', c.from_name).replaceAll('{from_email}', c.from_email);
  const domain = c.from_email.split('@')[1] ?? 'localhost';
  // Click tracking only rewrites links written literally in the template, so the redirect endpoint can verify them.
  const track = `${trackOrigin}/api/public/c/${m.unsub_token}?u=`;
  let body = fill(c.html.replace(/href="(https?:\/\/[^"{}]+)"/g, (_, u: string) => `href="${track}${encodeURIComponent(u.replaceAll('&amp;', '&'))}"`), true);
  if (!c.html.includes('{unsubscribe_url}')) body += `\n<p style="font-size:11px;color:#888">Pour ne plus recevoir nos emails : <a href="${unsub}">se désinscrire</a>.</p>`;
  body += `\n<img src="${trackOrigin}/api/public/t/${m.unsub_token}" width="1" height="1" alt="" style="display:none">`;
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(body))).replace(/.{76}/g, '$&\r\n');
  const h = [
    `From: ${enc(c.from_name)} <${c.from_email}>`, `To: <${m.email}>`, `Subject: ${enc(fill(c.subject, false))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${m.id}@${domain}>`,
    ...(c.reply_to ? [`Reply-To: <${c.reply_to}>`] : []),
    `List-Unsubscribe: <${unsub}>, <mailto:unsubscribe@${domain}?subject=${m.unsub_token}>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64',
  ];
  return h.join('\r\n') + '\r\n\r\n' + b64 + '\r\n';
}
