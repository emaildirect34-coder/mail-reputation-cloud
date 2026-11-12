import { describe, expect, it } from 'vitest';
import { auditEmailAccessibility } from '@/lib/email-accessibility';
import { checkPostbackDiagnostic, postbackReferenceFingerprint } from '@/lib/postback';
import { readSponsorCsv, sponsorCsvTransactions } from '@/lib/sponsor-report-import';

describe('diagnostic sponsor', () => {
  it('requires the exact test click, explicit transaction, event and approval', () => {
    const click = 'a'.repeat(36);
    const payload = new URLSearchParams({ click_id: click, txid: 'demo-1', event: 'purchase', status: 'approved' });
    expect(checkPostbackDiagnostic(payload, click, 'purchase')).toBeNull();
    expect(checkPostbackDiagnostic(payload, 'b'.repeat(36), 'purchase')).toMatch(/clic de test/);
    expect(checkPostbackDiagnostic(payload, click, 'lead')).toMatch(/événement/);
    payload.delete('txid');
    expect(checkPostbackDiagnostic(payload, click, 'purchase')).not.toBeNull();
  });
  it('keeps transaction references distinct by account', async () => {
    const one = await postbackReferenceFingerprint('account-1', 'order-1');
    expect(one).toMatch(/^[a-f0-9]{64}$/);
    expect(one).not.toBe(await postbackReferenceFingerprint('account-2', 'order-1'));
    expect(await postbackReferenceFingerprint('account-1', '')).toBe('');
  });
});

it('maps delimited reports with quoted cells and filters and deduplicates exact transaction IDs', () => {
  const { header, rows } = readSponsorCsv('\uFEFF"Transaction ID";Status;Name\r\n"a;7";Approved;"One ""quoted"" name"\r\na-8;Pending;B\r\n"a;7";approved;C');
  expect(header).toEqual(['Transaction ID', 'Status', 'Name']);
  expect(rows[0]?.[2]).toBe('One "quoted" name');
  expect(sponsorCsvTransactions(rows, 0, 1, 'approved')).toEqual(['a;7']);
  expect(() => readSponsorCsv('id,status\n"broken')).toThrow();
});

it('flags missing alternative text, ambiguous links, narrow buttons and low inline contrast', () => {
  const sample = '<img src="https://example.org/p.png"><img alt=""><p style="color:#aaa;background:#fff">Text</p>'
    + '<a href="#" role="button" style="height:14px">Cliquez ici</a>';
  const issues = auditEmailAccessibility(sample);
  expect(issues).toHaveLength(4);
  expect(issues[0]).toMatch(/^1 image/);
  expect(issues.join(' ')).toMatch(/contraste/);
});
