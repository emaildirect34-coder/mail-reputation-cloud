import { describe, expect, it } from 'vitest';
import { gzipSync, strToU8, zipSync } from 'fflate';
import { inboundReports } from '@/lib/dmarc-inbound.server';

const xml = '<feedback><report_metadata><org_name>Example</org_name><report_id>one</report_id></report_metadata><policy_published><domain>example.com</domain><p>reject</p></policy_published><record><row><source_ip>192.0.2.1</source_ip><count>2</count><policy_evaluated><dkim>pass</dkim></policy_evaluated></row></record></feedback>';
function mail(name: string, bytes: Uint8Array) {
  return new TextEncoder().encode([
    'From: sender@example.com', 'To: dmarc@example.com', 'MIME-Version: 1.0',
    `Content-Type: application/octet-stream; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    'Content-Transfer-Encoding: base64', '', Buffer.from(bytes).toString('base64'), '',
  ].join('\r\n'));
}
describe('DMARC mail ingestion', () => {
  it.each([
    ['report.xml', strToU8(xml)],
    ['report.xml.gz', gzipSync(strToU8(xml))],
    ['report.zip', zipSync({ 'report.xml': strToU8(xml) })],
  ])('parses %s attached to a raw message', async (name, bytes) => {
    await expect(inboundReports(mail(name, bytes))).resolves.toMatchObject([{ domain: 'example.com', total: 2, passed: 2 }]);
  });
  it('rejects a ZIP whose expanded report exceeds the bound', async () => {
    await expect(inboundReports(mail('report.zip', zipSync({ 'report.xml': strToU8('x'.repeat(5_000_001)) })))).rejects.toThrow();
  });
});
