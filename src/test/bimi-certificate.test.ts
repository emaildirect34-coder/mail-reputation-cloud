// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { Constructed, IA5String, Integer, ObjectIdentifier, OctetString, Sequence, Utf8String } from 'asn1js';
import { AltName, AttributeTypeAndValue, BasicConstraints, Certificate, CryptoEngine, Extension, ExtKeyUsage, GeneralName, RelativeDistinguishedNames } from 'pkijs';
import { expect, it } from 'vitest';
import { inspectBimiCertificate } from '@/lib/bimi-certificate';

it('verifies the BIMI chain and signed logo and rejects mismatched inputs', async () => {
  const engine = new CryptoEngine({ name: 'test', crypto });
  const markUsage = new ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.31'] });
  const usageExtension = new Extension({ extnID: '2.5.29.37', extnValue: markUsage.toSchema().toBER() });

  async function issue(commonName: string, serial: number, issuer: { cert: Certificate; key: CryptoKey } | null, extensions: Extension[], expired = false) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const cert = new Certificate({
      version: 2,
      serialNumber: new Integer({ value: serial }),
      subject: new RelativeDistinguishedNames({ typesAndValues: [new AttributeTypeAndValue({
        type: '2.5.4.3', value: new Utf8String({ value: commonName }),
      })] }),
      extensions,
    });
    cert.issuer = issuer?.cert.subject ?? cert.subject;
    cert.notBefore.value = new Date(Date.now() - 86_400_000);
    cert.notAfter.value = new Date(Date.now() + (expired ? -3600_000 : 86_400_000));
    await cert.subjectPublicKeyInfo.importKey(keys.publicKey, engine);
    await cert.sign(issuer?.key ?? keys.privateKey, 'SHA-256', engine);
    return { cert, key: keys.privateKey };
  }
  const ca = new Extension({ extnID: '2.5.29.19', critical: true, extnValue: new BasicConstraints({ cA: true }).toSchema().toBER() });
  const root = await issue('Test root', 1, null, [ca]);
  const intermediate = await issue('Test issuing CA', 2, root, [ca, usageExtension]);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps">\n<title>Test</title>\n</svg>';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svg));
  const direct = new Constructed({ idBlock: { tagClass: 3, tagNumber: 0 }, value: [
    new Sequence({ value: [new Sequence({ value: [new Sequence({ value: [
      new IA5String({ value: 'image/svg+xml+gzip' }),
      new Sequence({ value: [new Sequence({ value: [
        new Sequence({ value: [new ObjectIdentifier({ value: '2.16.840.1.101.3.4.2.1' })] }),
        new OctetString({ valueHex: digest }),
      ] })] }),
      new Sequence({ value: [new IA5String({ value: `data:image/svg+xml+gzip;base64,${gzipSync(svg).toString('base64')}` })] }),
    ] })] })] }),
  ] });
  const logo = new Sequence({ value: [new Constructed({ idBlock: { tagClass: 3, tagNumber: 2 }, value: [direct] })] });
  const sans = new AltName({ altNames: [new GeneralName({ type: 2, value: 'default._bimi.example.org' })] });
  const leafExtensions = [
    usageExtension,
    new Extension({ extnID: '2.5.29.17', extnValue: sans.toSchema().toBER() }),
    new Extension({ extnID: '1.3.6.1.5.5.7.1.12', extnValue: logo.toBER() }),
  ];
  const leaf = await issue('Test VMC', 3, intermediate, leafExtensions);
  const expired = await issue('Expired VMC', 4, intermediate, leafExtensions, true);
  const otherRoot = await issue('Other root', 5, null, [ca]);
  const pem = (cert: Certificate) => `-----BEGIN CERTIFICATE-----\n${Buffer.from(cert.toSchema().toBER()).toString('base64')}\n-----END CERTIFICATE-----\n`;
  const bundle = (cert: Certificate) => new File([pem(cert), pem(intermediate.cert)], 'vmc.pem');
  const roots = new File([pem(root.cert)], 'roots.pem');
  const logoFile = new File([svg.replaceAll('\n', '\r\n')], 'logo.svg');
  await expect(inspectBimiCertificate('example.org', logoFile, bundle(leaf.cert), roots)).resolves.toHaveProperty('expires');
  await expect(inspectBimiCertificate('other.org', logoFile, bundle(leaf.cert), roots)).rejects.toThrow(/domaine/);
  await expect(inspectBimiCertificate('example.org', new File([svg.replace('Test', 'Fake')], 'logo.svg'), bundle(leaf.cert), roots)).rejects.toThrow(/logo/);
  await expect(inspectBimiCertificate('example.org', logoFile, bundle(leaf.cert), new File([pem(otherRoot.cert)], 'roots.pem'))).rejects.toThrow(/Chaîne/);
  await expect(inspectBimiCertificate('example.org', logoFile, bundle(expired.cert), roots)).rejects.toThrow(/Chaîne/);
});
