import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBundle } from '../lib/kumo.server';

const dataByTable = new Map<string, unknown>([
  ['managed_servers', { label: 'smtp.example.org' }],
]);
let observations: unknown[] = [];

function bundle() {
  return buildBundle({
    rpc: async () => ({ data: observations, error: null }),
    from(table: string) {
      const result = { data: dataByTable.get(table) ?? [], error: null };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        is: () => query,
        gte: () => query,
        single: async () => result,
        limit: async () => result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    },
  }, 'fixture', false);
}

afterEach(() => { vi.unstubAllEnvs(); dataByTable.delete('server_ips'); dataByTable.delete('delivery_provider_holds'); observations = []; });

describe('Kumo SMTP transport policy', () => {
  it('requires authenticated modern TLS only when the operator enables the strict profile', async () => {
    vi.stubEnv('KUMO_REQUIRE_MODERN_TLS', 'false');
    vi.stubEnv('KUMO_TLS13_ONLY', 'false');
    vi.stubEnv('KUMO_SMTP_CLIENT_CERT', 'false');
    expect((await bundle()).lua).not.toContain('path.openssl_options');
    vi.stubEnv('KUMO_REQUIRE_MODERN_TLS', 'true');
    const { lua } = await bundle();
    expect(lua).toContain("path.enable_tls = 'Required'; path.tls_prefer_openssl = true");
    expect(lua).toContain('NO_TLSV1|NO_TLSV1_1');
    expect(lua).toContain('ECDHE-RSA-AES128-GCM-SHA256');
    expect(lua).toContain('TLS_CHACHA20_POLY1305_SHA256');
    expect(lua).not.toContain('NO_TLSV1_2');
    expect(lua).not.toContain('path.tls_private_key');
    vi.stubEnv('KUMO_REQUIRE_MODERN_TLS', 'false');
    vi.stubEnv('KUMO_TLS13_ONLY', 'true');
    vi.stubEnv('KUMO_SMTP_CLIENT_CERT', 'true');
    const strict = (await bundle()).lua;
    expect(strict).toContain("path.enable_tls = 'Required'");
    expect(strict).toContain('NO_TLSV1_2');
    expect(strict).toContain("path.tls_certificate = '/opt/kumomta/etc/tls/smtp-client-chain.pem'");
    expect(strict).toContain("path.tls_private_key = '/opt/kumomta/etc/tls/smtp-client-key.pem'");
  });
  it('weights only existing marketing sources for the observed ISP', async () => {
    vi.stubEnv('KUMO_ISP_SOURCE_ROUTING', 'true');
    dataByTable.set('server_ips', [
      { id: 'one', family: 4, address: '192.0.2.1' }, { id: 'two', family: 4, address: '192.0.2.2' },
    ]);
    observations = [
      { server_id: 'fixture', source_ipv4: '192.0.2.1', domain: 'gmail.com', delivered: 100, sample: 100 },
      { server_id: 'fixture', source_ipv4: '192.0.2.2', domain: 'gmail.com', delivered: 91, sample: 100 },
      { server_id: 'fixture', source_ipv4: '192.0.2.3', domain: 'gmail.com', delivered: 100, sample: 100 },
    ];
    const { lua } = await bundle();
    expect(lua).toContain('["default-isp-0"] = { { name = "ip-192_0_2_1", weight = 2 }, { name = "ip-192_0_2_2", weight = 1 } }');
    expect(lua).toContain('["default@gmail.com"] = "default-isp-0"');
    expect(lua).not.toContain('default@outlook.com');
    expect(lua).not.toContain('ip-192_0_2_3');
    observations.pop(); observations.pop();
    expect((await bundle()).lua).not.toContain('default-isp-0');
  });
  it('keeps retry timing in the scheduled queue and emits exact lockstep site names', async () => {
    vi.stubEnv('KUMO_SMTP_LOCKSTEP_SITES', '(alt1|alt2)?.mx.example.org, mx.example.net, mx.example.net');

    const { lua } = await bundle();

    expect(lua).toContain(`kumo.make_queue_config { egress_pool = pool, retry_interval = '20 minutes' }`);
    expect(lua).toContain(`local SMTP_LOCKSTEP_SITES = { ["(alt1|alt2)?.mx.example.org"] = true, ["mx.example.net"] = true }`);
    expect(lua).toContain('path.enable_pipelining = not telco and not SMTP_LOCKSTEP_SITES[site]');
    expect(lua).toContain('if telco then path.max_recipients_per_batch = 1 end');
    expect(lua).toContain('["wanadoo.es"] = "orange"');
    expect(lua).toContain('["cegetel.net"] = "sfr"');
    expect(lua).toContain('["aliceadsl.fr"] = "free"');
    expect(lua).toContain('["hotmail.fr"] = "microsoft"');
    expect(lua).toContain("shared_connections[provider .. '-' .. source] = cap");
    expect(lua).toContain("shared_connections['google-' .. source] = 10");
    expect(lua).toContain("path.max_connection_rate = '30/min,max_burst=3'; path.max_deliveries_per_connection = 20");
  });

  it('rejects malformed site identifiers instead of emitting invalid Lua', async () => {
    vi.stubEnv('KUMO_SMTP_LOCKSTEP_SITES', 'mx.\u0001example.org');

    await expect(bundle()).rejects.toThrow('KUMO_SMTP_LOCKSTEP_SITES');
  });

  it('caps Orange and shares a single Gmail connection during recovery', async () => {
    dataByTable.set('delivery_provider_holds', [{ until_at: new Date().toISOString() }]);
    const { lua } = await bundle();
    expect(lua).toContain("provider == 'orange' and 2");
    expect(lua).toContain("provider == 'orange' then path.max_deliveries_per_connection = 100");
    expect(lua).toContain("shared_connections['google-recovery'] = 1");
    expect(lua).toContain("path.max_connection_rate = '1/min,max_burst=1'");
  });
});
