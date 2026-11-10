const atom = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]|[^\x00-\x7f])+$/i;
const quoted = /^"(?:[\x21\x23-\x5b\x5d-\x7e]|\\[\x21-\x7e]|[^\x00-\x7f])*"$/;
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const probableTypos = new Map(Object.entries({
  'gmial.com':'gmail.com', 'gamil.com':'gmail.com', 'gmal.com':'gmail.com', 'gmai.com':'gmail.com', 'gnail.com':'gmail.com', 'gmail.fr':'gmail.com',
  'hotmial.com':'hotmail.com', 'hotmal.com':'hotmail.com', 'yaho.com':'yahoo.com', 'yahooo.com':'yahoo.com',
  'yaho.fr':'yahoo.fr', 'outlok.com':'outlook.com', 'orage.fr':'orange.fr', 'wanado.fr':'wanadoo.fr', 'fre.fr':'free.fr',
}));

export const probableMailDomainTypo = (domain: string) => probableTypos.get(domain);

const campaignRoleMailboxes = new Set(['postmaster', 'abuse', 'admin', 'webmaster', 'hostmaster', 'noc', 'security', 'root']);

export function isCampaignRoleMailbox(email: string) {
  const [local = ''] = email.toLowerCase().split('@');
  const [alias = ''] = local.replace(/^"(.*)"$/, '$1').split('+');
  return campaignRoleMailboxes.has(alias);
}

/** Public recipient addresses supported by the campaign importer and SMTP queue. */
export function recipientDomain(email: string) {
  if (/\s/u.test(email)) return null;
  const parts = email.split('@');
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || !domain || !/^[\p{L}\p{N}\p{M}.-]+$/u.test(domain)) return null;
  if (new TextEncoder().encode(local).length > 64 || (!quoted.test(local) && !local.split('.').every(part => atom.test(part)))) return null;
  try {
    const host = new URL(`https://${domain}`).hostname.toLowerCase();
    const labels = host.split('.');
    if (labels.length < 2 || !labels.every(part => label.test(part)) || /^\d+$/.test(labels.at(-1)!)) return null;
    return new TextEncoder().encode(`${local}@${host}`).length <= 254 ? host : null;
  } catch {
    return null;
  }
}
