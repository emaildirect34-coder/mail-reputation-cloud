import { describe, it, expect } from 'vitest';
import { parseDmarcXml, classify, passes } from '@/lib/dmarc';

const xml = `<feedback><report_metadata><org_name>google.com</org_name><report_id>42</report_id><date_range><begin>1700000000</begin><end>1700086400</end></date_range></report_metadata>
<policy_published><domain>Loviyo.com</domain><p>none</p></policy_published>
<record><row><source_ip>187.7.66.53</source_ip><count>120</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>loviyo.com</header_from></identifiers></record>
<record><row><source_ip>45.1.2.3</source_ip><count>7</count><policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row></record></feedback>`;

describe('dmarc', () => {
  it('parses metadata and records', () => {
    const r = parseDmarcXml(xml);
    expect(r.orgName).toBe('google.com');
    expect(r.domain).toBe('loviyo.com');
    expect(r.records).toHaveLength(2);
    expect(r.records[0]!.count).toBe(120);
  });
  it('passes when DKIM or SPF passes', () => {
    const r = parseDmarcXml(xml);
    expect(passes(r.records[0]!)).toBe(true);
    expect(passes(r.records[1]!)).toBe(false);
  });
  it('classifies own IPs and spoofers', () => {
    const r = parseDmarcXml(xml);
    const own = new Set(['187.7.66.53']);
    expect(classify(r.records[0]!, own)).toBe('own');
    expect(classify(r.records[1]!, own)).toBe('spoof');
  });
  it('rejects non-DMARC files', () => {
    expect(() => parseDmarcXml('<html></html>')).toThrow();
  });
});
