import { Constructed, IA5String, ObjectIdentifier, OctetString, Sequence, fromBER } from 'asn1js';
import { AltName, BasicConstraints, Certificate, CertificateChainValidationEngine, CryptoEngine, ExtKeyUsage } from 'pkijs';

const brandUsage = '1.3.6.1.5.5.7.3.31';
const maxPemBytes = 256_000;
const maxSvgBytes = 256_000;
const hashAlgorithms = new Map([
  ['2.16.840.1.101.3.4.2.1', 'SHA-256'],
  ['2.16.840.1.101.3.4.2.2', 'SHA-384'],
  ['2.16.840.1.101.3.4.2.3', 'SHA-512'],
]);

function certificates(pem: string) {
  const blocks = [...pem.matchAll(/-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/g)];
  if (!blocks.length || blocks.length > 12 || pem.length > maxPemBytes) throw new Error('Fichier PEM invalide ou trop volumineux.');
  return blocks.map(block => Certificate.fromBER(Uint8Array.from(atob(block[1]!.replace(/\s/g, '')), char => char.charCodeAt(0))));
}

function extension(cert: Certificate, oid: string) {
  return cert.extensions?.find(item => item.extnID === oid);
}

function isCa(cert: Certificate) {
  const constraints = extension(cert, '2.5.29.19')?.parsedValue;
  return constraints instanceof BasicConstraints && constraints.cA;
}

function allowsBrandMark(cert: Certificate) {
  const usage = extension(cert, '2.5.29.37')?.parsedValue;
  return usage instanceof ExtKeyUsage && usage.keyPurposes.includes(brandUsage);
}

function canonicalSvg(bytes: Uint8Array) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return new TextEncoder().encode(text.replace(/\r\n?/g, '\n'));
}

async function embeddedSvg(uri: string) {
  const encoded = /^data:image\/svg\+xml(?:\+gzip|-compressed)?;base64,([A-Za-z0-9+/=]+)$/i.exec(uri)?.[1];
  if (!encoded) return;
  const compressed = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (compressed[0] !== 0x1f || compressed[1] !== 0x8b) return;
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const bounded = new Uint8Array(maxSvgBytes);
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > bounded.length) {
        await reader.cancel();
        throw new Error('Le logo intégré au certificat est trop volumineux.');
      }
      bounded.set(value, offset);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  return canonicalSvg(bounded.subarray(0, offset));
}

function subjectImages(cert: Certificate) {
  const value = extension(cert, '1.3.6.1.5.5.7.1.12')?.extnValue.valueBlock.valueHexView;
  if (!value) throw new Error('Le certificat ne contient pas d’extension de logo BIMI.');
  const parsed = fromBER(value);
  if (parsed.offset !== value.length || !(parsed.result instanceof Sequence)) return [];
  // RFC 9399: subjectLogo [2] EXPLICIT wraps direct [0] IMPLICIT LogotypeData.
  const subject = parsed.result.valueBlock.value.find(item => item instanceof Constructed && item.idBlock.tagClass === 3 && item.idBlock.tagNumber === 2);
  const direct = subject instanceof Constructed ? subject.valueBlock.value[0] : undefined;
  if (!(direct instanceof Constructed) || direct.idBlock.tagClass !== 3 || direct.idBlock.tagNumber !== 0) return [];
  const images = direct.valueBlock.value[0];
  return images instanceof Sequence ? images.valueBlock.value : [];
}

function equal(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

async function verifyLogo(cert: Certificate, file: Uint8Array) {
  const svg = canonicalSvg(file);
  for (const image of subjectImages(cert)) {
    const details = image instanceof Sequence ? image.valueBlock.value[0] : undefined;
    if (!(details instanceof Sequence)) continue;
    const [media, hashes, locations] = details.valueBlock.value;
    if (!(media instanceof IA5String) || !/^image\/svg\+xml(?:\+gzip|-compressed)?$/i.test(media.getValue())) continue;
    if (!(hashes instanceof Sequence) || !(locations instanceof Sequence)) continue;
    for (const location of locations.valueBlock.value) {
      if (!(location instanceof IA5String)) continue;
      const signedSvg = await embeddedSvg(location.getValue());
      if (!signedSvg || !equal(svg, signedSvg)) continue;
      for (const hash of hashes.valueBlock.value) {
        if (!(hash instanceof Sequence)) continue;
        const [algorithm, digest] = hash.valueBlock.value;
        const oid = algorithm instanceof Sequence ? algorithm.valueBlock.value[0] : undefined;
        const name = oid instanceof ObjectIdentifier ? hashAlgorithms.get(oid.getValue()) : undefined;
        if (!name || !(digest instanceof OctetString)) continue;
        const computed = new Uint8Array(await crypto.subtle.digest(name, signedSvg));
        if (equal(computed, digest.valueBlock.valueHexView)) return;
      }
    }
  }
  throw new Error('Le logo SVG fourni ne correspond pas au logo intégré et à son empreinte signée.');
}

export async function inspectBimiCertificate(domain: string, svg: File, chainFile: File, rootsFile: File) {
  if (svg.size > maxSvgBytes || chainFile.size > maxPemBytes || rootsFile.size > maxPemBytes) throw new Error('Un fichier dépasse la taille autorisée.');
  const [svgBytes, pem, rootPem] = await Promise.all([svg.arrayBuffer(), chainFile.text(), rootsFile.text()]);
  const [leaf, ...issuers] = certificates(pem);
  const roots = certificates(rootPem);
  if (!leaf || isCa(leaf) || !allowsBrandMark(leaf)) throw new Error('Placez le certificat de marque en premier dans le fichier PEM.');
  if (roots.some(root => !isCa(root) || !root.subject.isEqual(root.issuer))) throw new Error('Le fichier de confiance doit contenir uniquement des certificats racines d’autorité.');
  const sans = extension(leaf, '2.5.29.17')?.parsedValue;
  const names = [domain, `default._bimi.${domain}`];
  if (!(sans instanceof AltName) || !sans.altNames.some(name => name.type === 2 && typeof name.value === 'string' && names.includes(name.value.toLowerCase()))) {
    throw new Error('Le certificat ne couvre pas ce domaine BIMI.');
  }

  const engine = new CertificateChainValidationEngine({ certs: [...issuers, leaf], trustedCerts: roots });
  const validation = await engine.verify({}, new CryptoEngine({ name: 'bimi', crypto }));
  if (!validation.result || !validation.certificatePath) throw new Error('Chaîne invalide, expirée ou incomplète pour les racines fournies.');
  const issuingCa = validation.certificatePath[1];
  if (!issuingCa || !allowsBrandMark(issuingCa)) throw new Error('L’autorité émettrice ne déclare pas l’usage BIMI.');
  await verifyLogo(leaf, new Uint8Array(svgBytes));
  return { expires: leaf.notAfter.value };
}
