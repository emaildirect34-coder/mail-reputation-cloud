const escape = (text: string) => text.replace(/[&<>"{}]/g, character => character === '&' ? '&amp;' : `&#${character.charCodeAt(0)};`);

export function renderWeeklyDigest(source: string) {
  if (source.length > 20_000) throw new Error('Le récapitulatif est limité à 20 000 caractères.');
  const items = source.trim().split(/\r?\n[\t ]*\r?\n/).map(block => block.split(/\r?\n/).map(line => line.trim()).filter(Boolean)).filter(item => item.length);
  if (items.length < 2 || items.length > 12 || items.some(item => item.length < 2 || item[0]!.length > 120)) {
    throw new Error('Ajoutez entre 2 et 12 rubriques, chacune avec un titre de 120 caractères maximum et un résumé.');
  }
  const sections = items.map(([title, ...lines]) => {
    const last = lines.at(-1)!;
    const link = lines.length > 1 && /^https:\/\//i.test(last) ? URL.parse(last) : null;
    if (link && !link.username && !link.password) lines.pop();
    const action = link && !link.username && !link.password ? `<p><a href="${escape(link.href)}">En savoir plus</a></p>` : '';
    return `<h2>${escape(title!)}</h2><p>${lines.map(escape).join('<br>')}</p>${action}`;
  });
  return `<div style="font-family:Arial,sans-serif"><h1>Votre récapitulatif hebdomadaire</h1>${sections.join('<hr>')}</div>`;
}
