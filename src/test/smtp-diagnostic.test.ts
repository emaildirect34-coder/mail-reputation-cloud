import { expect, it } from 'vitest';
import { smtpDiagnostic } from '@/lib/smtp-diagnostic';

it('preserves enhanced SMTP evidence and avoids inferring a cause from generic rejection codes', () => {
  expect(smtpDiagnostic(421, '4.7.28 Temporary rejection', 'Gmail')?.label).toBe('Limitation de débit');
  expect(smtpDiagnostic(421, '4.7.28 Temporary rejection', 'Other')?.label).toBe('Cause indéterminée');
  expect(smtpDiagnostic(550, '5.7.1 Mail rejected')?.label).toBe('Cause indéterminée');
  expect(smtpDiagnostic(550, '5.7.1 IP reputation and domain reputation')?.label).toBe('Cause indéterminée');
  expect(smtpDiagnostic(550, 'DSN 5.1.1')?.label).toBe('Boîte inexistante');
  expect(smtpDiagnostic(452, '4.2.2 Mailbox full')?.label).toBe('Boîte pleine');
  expect(smtpDiagnostic(450, '4.4.3 DNS failure')?.label).toBe('Réseau ou DNS temporaire');
  expect(smtpDiagnostic(250, '2.0.0 OK')).toBeNull();
});
