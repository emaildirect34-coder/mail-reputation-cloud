const separators = [',', ';', '\t'] as const;

function parseRows(input: string, separator: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') { quoted = false; closed = true; }
      else cell += character;
    } else if (character === separator || character === '\r' || character === '\n') {
      row.push(cell.trim());
      cell = '';
      closed = false;
      if (character !== separator) {
        if (character === '\r' && input[index + 1] === '\n') index++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (closed) {
      if (character !== ' ') throw new Error('Une cellule CSV contient un guillemet mal placé.');
    } else if (character === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('Une cellule CSV entre guillemets est incomplète.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function readSponsorCsv(input: string) {
  if (input.length > 2_000_000) throw new Error('Choisis un export de moins de 2 Mo.');
  const normalized = input.replace(/^\uFEFF/, '');
  const candidates = separators.flatMap(separator => {
    try {
      const [header, ...rows] = parseRows(normalized, separator);
      return header && header.every(Boolean) && new Set(header).size === header.length
        && rows.every(row => row.length === header.length) ? [{ header, rows }] : [];
    } catch { return []; }
  }).sort((a, b) => b.header.length - a.header.length);
  const result = candidates[0];
  if (!result) throw new Error('Le fichier doit contenir une ligne d’en-têtes et des colonnes régulières.');
  return result;
}

export function sponsorCsvTransactions(rows: string[][], column: number, statusColumn: number, confirmedStatus: string) {
  const matched = statusColumn < 0 ? rows : rows.filter(row => row[statusColumn]?.toLowerCase() === confirmedStatus.trim().toLowerCase());
  const ids = [...new Set(matched.map(row => row[column] ?? ''))];
  if (ids.some(id => !/^[^{}#\x00-\x1f\x7f]{1,120}$/.test(id))) throw new Error('Certaines transactions ont un identifiant invalide.');
  if (ids.length > 5000) throw new Error('Réduis la période pour obtenir au maximum 5 000 transactions.');
  return ids;
}
