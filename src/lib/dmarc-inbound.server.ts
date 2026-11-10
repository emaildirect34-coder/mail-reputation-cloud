import PostalMime from 'postal-mime';
import { Gunzip, Unzip, UnzipInflate } from 'fflate';
import { parseDmarcXml, passes } from './dmarc';

const limit = 5_000_000;
const maxReports = 20;

export async function boundedBytes(stream: ReadableStream<Uint8Array>, maximum = limit) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new Error('Rapport trop volumineux.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function inboundReports(raw: Uint8Array<ArrayBuffer>) {
  const email = await PostalMime.parse(raw);
  const reports: string[] = [];
  let extracted = 0;
  function append(xml: string) {
    extracted += xml.length;
    if (extracted > limit || reports.length >= maxReports) throw new Error('Limite de rapports dépassée.');
    reports.push(xml);
  }
  for (const file of email.attachments) {
    const name = file.filename?.toLowerCase() ?? '';
    if (!/\.(xml|gz|zip)$/.test(name)) continue;
    const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : new Uint8Array(file.content);
    if (name.endsWith('.xml')) {
      append(new TextDecoder().decode(bytes));
    } else if (name.endsWith('.gz')) {
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let size = extracted;
      const gunzip = new Gunzip((chunk, done) => {
        size += chunk.length;
        if (size > limit) throw new Error('Archive trop volumineuse.');
        chunks.push(decoder.decode(chunk, { stream: !done }));
      });
      for (let i = 0; i < bytes.length; i += 1024) gunzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
      append(chunks.join(''));
    } else {
      let size = extracted;
      let files = 0;
      const unzip = new Unzip(entry => {
        if (++files > 100) throw new Error('Archive trop volumineuse.');
        if (!entry.name.toLowerCase().endsWith('.xml')) return;
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        entry.ondata = (error, chunk, done) => {
          if (error) throw error;
          size += chunk.length;
          if (size > limit) throw new Error('Archive trop volumineuse.');
          chunks.push(decoder.decode(chunk, { stream: !done }));
          if (done) append(chunks.join(''));
        };
        entry.start();
      });
      unzip.register(UnzipInflate);
      for (let i = 0; i < bytes.length; i += 1024) unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
    }
  }
  if (!reports.length) throw new Error('Aucune pièce jointe DMARC.');
  return reports.map(xml => {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML non autorisé.');
    if (!/<report_id>\s*[^<\s][^<]*<\/report_id>/i.test(xml)) throw new Error('Identifiant de rapport absent.');
    const report = parseDmarcXml(xml);
    return {
      org_name: report.orgName, report_id: report.reportId, domain: report.domain, policy: report.policy,
      date_begin: report.dateBegin ? new Date(report.dateBegin * 1000).toISOString() : null,
      date_end: report.dateEnd ? new Date(report.dateEnd * 1000).toISOString() : null,
      total: report.records.reduce((sum, record) => sum + record.count, 0),
      passed: report.records.filter(passes).reduce((sum, record) => sum + record.count, 0),
      records: report.records,
    };
  });
}
