const redirectCodes = new Set([301, 302, 303, 307, 308]);
const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i;

export async function checkSponsorDestination(value: string) {
  const trusted = new Set((process.env['SPONSOR_AUDIT_HOSTS'] ?? '').split(',').map(host => host.trim().toLowerCase()).filter(host => dnsName.test(host)));
  const { fillClickId } = await import('./postback');
  let url = URL.parse(fillClickId(value, '0'.repeat(36)));
  const hosts: string[] = [];
  const signal = AbortSignal.timeout(6500);
  for (let hops = 0; hops <= 5; hops++) {
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || !dnsName.test(url.hostname)) {
      return { status: 'failed', hosts, detail: 'Une étape utilise une adresse HTTPS invalide.' } as const;
    }
    hosts.push(url.hostname);
    if (!trusted.has(url.hostname)) return { status: 'manual', hosts, detail: 'Hôte à vérifier manuellement ou à ajouter à la liste des hôtes approuvés.' } as const;
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal });
      if (response.ok) return { status: 'ok', hosts, detail: 'Destination HTTPS accessible. Vérifiez la cohérence de l’offre avec le message.' } as const;
      const location = response.headers.get('Location');
      if (redirectCodes.has(response.status) && location) {
        url = URL.parse(location, url);
        continue;
      }
      if (response.status === 405 || response.status === 403) return { status: 'manual', hosts, detail: 'Le site refuse le contrôle HEAD. Ouvrez la destination manuellement.' } as const;
      return { status: 'failed', hosts, detail: `Destination indisponible (HTTP ${response.status}).` } as const;
    } catch {
      return { status: 'manual', hosts, detail: 'Vérification réseau indisponible. Contrôlez la destination manuellement.' } as const;
    }
  }
  return { status: 'failed', hosts, detail: 'Trop de redirections.' } as const;
}
