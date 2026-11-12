function luminance(hex: string) {
  if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(hex)) return null;
  const raw = hex.slice(1);
  const full = raw.length === 3 ? [...raw].map(digit => digit.repeat(2)).join('') : raw;
  const channels = [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function inlineHex(style: string, property: string) {
  return style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\\s*(?:;|$)`, 'i'))?.[1];
}

export function auditEmailAccessibility(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const issues: string[] = [];
  const images = Array.from(template.content.querySelectorAll('img'));
  const unlabeled = images.filter(image => !image.hasAttribute('alt')).length;
  if (unlabeled) issues.push(`${unlabeled} image(s) sans attribut alt.`);
  const links = Array.from(template.content.querySelectorAll('a[href]'));
  const unclear = links.filter(link => {
    const label = (link.getAttribute('aria-label') || link.textContent || '').trim().toLowerCase()
      || Array.from(link.querySelectorAll('img[alt]'), image => image.getAttribute('alt')).join(' ').trim();
    return !label || /^(cliquez ici|ici|lire la suite|en savoir plus|click here|read more)[.!…]*$/i.test(label);
  }).length;
  if (unclear) issues.push(`${unclear} lien(s) sans libellé explicite.`);
  const smallButtons = links.filter(link => {
    if (!/\b(button|btn)\b/i.test(link.className) && link.getAttribute('role') !== 'button') return false;
    const style = link.getAttribute('style') ?? '';
    const size = style.match(/(?:^|;)\s*(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px/i);
    return !!size && Number(size[1]) < 24;
  }).length;
  if (smallButtons) issues.push(`${smallButtons} bouton(s) ont une hauteur déclarée inférieure à 24 px.`);
  let lowContrast = 0;
  for (const element of template.content.querySelectorAll('[style]')) {
    if (!element.textContent?.trim()) continue;
    const style = element.getAttribute('style') ?? '';
    const color = luminance(inlineHex(style, 'color') ?? '');
    const background = luminance(inlineHex(style, 'background(?:-color)?') ?? '');
    if (color !== null && background !== null
      && (Math.max(color, background) + 0.05) / (Math.min(color, background) + 0.05) < 4.5) lowContrast++;
  }
  if (lowContrast) issues.push(`${lowContrast} bloc(s) de texte ont un contraste déclaré inférieur à 4,5:1.`);
  return issues;
}

export function auditEmailClientCompatibility(html: string) {
  const issues: string[] = [];
  if (/\bdisplay\s*:\s*(?:flex|grid)\b/i.test(html)) issues.push('Flexbox/Grid peut varier selon les versions d’Outlook; privilégier des tableaux pour la mise en page critique.');
  if (/background-image\s*:/i.test(html)) issues.push('Les images de fond CSS ne sont pas rendues de façon uniforme par tous les clients.');
  if (/<(?:form|input|select|textarea)\b/i.test(html)) issues.push('Les formulaires intégrés sont désactivés ou bloqués dans plusieurs boîtes mail.');
  if (/<svg\b/i.test(html)) issues.push('Le SVG intégré peut être supprimé; prévoir une image de remplacement.');
  if (/@media\b/i.test(html)) issues.push('Les media queries sont prises en charge de manière variable; vérifiez le rendu étroit.');
  if (/<style\b/i.test(html) && !/\bstyle\s*=/i.test(html)) issues.push('Le modèle utilise surtout des styles embarqués; une partie des clients peut les retirer.');
  return issues;
}
