import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

export const AMP_EMAIL_LIMIT = 200_000;
export const AMP_EMAIL_EXAMPLE = `<!doctype html>
<html amp4email data-css-strict>
<head>
  <meta charset="utf-8">
  <script async src="https://cdn.ampproject.org/v0.js"></script>
  <style amp4email-boilerplate>body{visibility:hidden}</style>
</head>
<body>
  <p>Ajoutez ici le contenu AMP de votre message.</p>
</body>
</html>`;

const runtime = 'https://cdn.ampproject.org/v0.js';
const extensions = new Set([
  'amp-accordion', 'amp-anim', 'amp-bind', 'amp-carousel', 'amp-fit-text', 'amp-form',
  'amp-layout', 'amp-list', 'amp-mustache', 'amp-selector', 'amp-sidebar', 'amp-timeago',
]);
const prohibited = new Set(['base', 'embed', 'frame', 'iframe', 'object', 'noscript']);
const attr = (element: Element, name: string) => element.attrs.find(a => a.name === name)?.value;
const isElement = (node: Node): node is Element => 'tagName' in node;
const children = (node: Node) => 'childNodes' in node ? node.childNodes : [];
const child = (node: Node, tag: string) => children(node).find((item): item is Element => isElement(item) && item.tagName === tag);
const text = (element: Element) => element.childNodes.map(node => 'value' in node ? node.value : '').join('');
const byteLength = (value: string) => new TextEncoder().encode(value).length;

function https(value: string | undefined) {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

/** Structural precheck for AMP4EMAIL. Providers still run the complete AMP validator. */
export function prepareAmpEmail(input: string) {
  const source = input.trim();
  if (byteLength(source) > AMP_EMAIL_LIMIT) throw new Error('Le document AMP dépasse 200 ko.');
  if (!/^<!doctype html\s*>/i.test(source)) throw new Error('Le document AMP doit commencer par <!doctype html>.');
  let invalidMarkup = false;
  const doc = parse(source, { sourceCodeLocationInfo: true, onParseError: () => { invalidMarkup = true; } });
  if (invalidMarkup) throw new Error('Corrigez la syntaxe HTML du document AMP.');
  const html = child(doc, 'html');
  const head = html && child(html, 'head');
  const body = html && child(html, 'body');
  const end = body?.sourceCodeLocation?.endTag?.startOffset;
  if (!html || (attr(html, 'amp4email') === undefined && attr(html, '⚡4email') === undefined) ||
      !head?.sourceCodeLocation?.startTag || !head.sourceCodeLocation.endTag || !body?.sourceCodeLocation?.startTag || end === undefined) {
    throw new Error('Utilisez <html amp4email> avec des balises <head> et <body> explicites.');
  }
  const first = head.childNodes.find(isElement);
  if (first?.tagName !== 'meta' || attr(first, 'charset')?.toLowerCase() !== 'utf-8') {
    throw new Error('Placez <meta charset="utf-8"> en premier dans <head>.');
  }
  const boilerplate = head.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'style' && attr(node, 'amp4email-boilerplate') !== undefined);
  if (!boilerplate || text(boilerplate).replace(/\s/g, '') !== 'body{visibility:hidden}') {
    throw new Error('Ajoutez le style amp4email-boilerplate dans <head>.');
  }

  let runtimeCount = 0;
  const nodes: Node[] = [html];
  while (nodes.length) {
    const node = nodes.pop()!;
    for (const entry of children(node)) nodes.push(entry);
    if (!isElement(node)) continue;
    if ('content' in node) {
      for (const entry of children((node as DefaultTreeAdapterTypes.Template).content)) nodes.push(entry);
    }
    if (prohibited.has(node.tagName) || node.attrs.some(({ name, value }) =>
      /^on[a-z]+$/i.test(name) || ['[src]', '[href]', 'data-amp-bind-src', 'data-amp-bind-href'].includes(name) ||
      (['src', 'href'].includes(name) && /^\s*(?:javascript|vbscript|data):/i.test(value.replace(/[\t\r\n]/g, ''))) ||
      (name === 'on' && /\bAMP\.(?:print|navigateTo|goBack)\s*\(/.test(value))
    )) {
      throw new Error('Le document contient une balise ou un attribut interdit dans un e-mail AMP.');
    }
    if (node.tagName === 'form' && (attr(node, 'action') !== undefined || !https(attr(node, 'action-xhr')))) {
      throw new Error('Utilisez une URL HTTPS dans action-xhr pour chaque formulaire AMP.');
    }
    if (node.tagName === 'amp-list' && (!https(attr(node, 'src')) || attr(node, 'credentials') === 'include')) {
      throw new Error('Chaque amp-list nécessite une URL HTTPS et doit fonctionner sans cookies tiers.');
    }
    if (node.tagName === 'amp-state' && attr(node, 'src') !== undefined) {
      throw new Error('Placez les données amp-state dans le message au format JSON.');
    }
    if (node.tagName !== 'script') continue;
    const src = attr(node, 'src');
    if (src === undefined && attr(node, 'type') === 'application/json' &&
        node.parentNode && isElement(node.parentNode) && node.parentNode.tagName === 'amp-state') {
      try { JSON.parse(text(node)); } catch { throw new Error('Le contenu d’amp-state doit être du JSON valide.'); }
      continue;
    }
    if (node.parentNode !== head || attr(node, 'async') === undefined || text(node).trim()) {
      throw new Error('Seuls les scripts AMP asynchrones dans <head> et les données amp-state sont acceptés.');
    }
    if (src === runtime) { runtimeCount++; continue; }
    const custom = attr(node, 'custom-element') ?? attr(node, 'custom-template');
    const match = /^https:\/\/cdn\.ampproject\.org\/v0\/(amp-[a-z-]+)-\d+\.\d+\.js$/.exec(src ?? '');
    if (!custom || match?.[1] !== custom || !extensions.has(custom)) {
      throw new Error('Chargez uniquement des extensions AMP pour e-mail depuis cdn.ampproject.org.');
    }
  }
  if (runtimeCount !== 1) throw new Error('Chargez le script AMP officiel une seule fois dans <head>.');

  // The footer is inserted into <body>, not after </html> or inside an authored template.
  const prepared = source.slice(0, end) +
    '<p><a href="{unsubscribe_url}">Se désinscrire</a> · <a href="{preferences_url}">Gérer mes préférences</a></p>\n' +
    source.slice(end);
  // The final checks in the renderer account for expansion of the recipient URL.
  if (byteLength(prepared) > AMP_EMAIL_LIMIT) throw new Error('Le document AMP et son pied de page dépassent 200 ko.');
  return prepared;
}

/** Conservative readable fallback. Remove executable/head content and keep paragraph breaks. */
export function plainEmailText(html: string) {
  const doc = parseFragment(html);
  const nodes: (Node | string)[] = [...doc.childNodes].reverse();
  const out: string[] = [];
  const ignored = new Set(['head', 'script', 'style', 'template', 'title']);
  const blocks = new Set(['address', 'blockquote', 'br', 'div', 'h1', 'h2', 'h3', 'hr', 'li', 'p', 'section', 'tr']);
  while (nodes.length) {
    const node = nodes.pop()!;
    if (typeof node === 'string') { out.push(node); continue; }
    if ('value' in node) { out.push(node.value.replace(/\s+/g, ' ')); continue; }
    if (isElement(node) && ignored.has(node.tagName)) continue;
    if (isElement(node) && blocks.has(node.tagName)) { out.push('\n'); nodes.push('\n'); }
    if (isElement(node) && node.tagName === 'a') {
      const href = attr(node, 'href');
      if (href && /^https?:\/\/[^\s]+$/i.test(href)) nodes.push(' ' + href);
    }
    const contents = children(node);
    for (let index = contents.length - 1; index >= 0; index--) nodes.push(contents[index]!);
  }
  return out.join('').replace(/[\t ]*\n[\t ]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
