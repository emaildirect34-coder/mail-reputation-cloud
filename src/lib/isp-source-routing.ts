import { ISP_DOMAINS } from './infrastructure.schemas';

export const routingProviders = Object.entries(ISP_DOMAINS).filter(([isp]) => isp !== 'Free / SFR');
routingProviders.push(['Free', ['free.fr']], ['SFR', ['sfr.fr', 'neuf.fr']]);
const providerByDomain = new Map(routingProviders.flatMap(([isp, domains]) => domains.map(domain => [domain, isp] as const)));
export const routingDomains = [...providerByDomain.keys()];

type Observation = { server_id: string; source_ipv4: string; domain: string; delivered: number; sample: number };

export function sourceReputation(rows: Observation[]) {
  const totals = new Map<string, { serverId: string; ip: string; isp: string; delivered: number; sample: number }>();
  for (const row of rows) {
    const isp = providerByDomain.get(row.domain);
    if (!isp) continue;
    const key = `${row.server_id}/${row.source_ipv4}/${isp}`;
    const entry = totals.get(key) ?? { serverId: row.server_id, ip: row.source_ipv4, isp, delivered: 0, sample: 0 };
    entry.delivered += row.delivered;
    entry.sample += row.sample;
    totals.set(key, entry);
  }
  return [...totals.values()];
}

export function reputationWeights(addresses: string[], observations: ReturnType<typeof sourceReputation>, isp: string) {
  if (addresses.length < 2) return null;
  const byIp = new Map(observations.filter(row => row.isp === isp).map(row => [row.ip, row]));
  const ratios = addresses.map(address => {
    const row = byIp.get(address);
    return row && row.sample >= 100 ? row.delivered / row.sample : null;
  });
  if (ratios.some(ratio => ratio === null)) return null;
  const rates = ratios as number[];
  const best = Math.max(...rates);
  const weights = rates.map(rate => Math.round((best - rate) * 10000) >= 200 ? 1 : 2);
  return weights.includes(1) ? weights : null;
}
