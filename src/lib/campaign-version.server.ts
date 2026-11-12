import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { plainEmailText } from './amp-email';
import { renderWeeklyDigest } from './weekly-digest';

type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
const element = (node: Node): node is Element => 'tagName' in node;

export function describeCampaignVersion(html: string) {
  const links = new Map<string, number>();
  const nodes = [...parseFragment(html).childNodes].reverse();
  while (nodes.length) {
    const node = nodes.pop()!;
    if (!element(node)) continue;
    const href = node.tagName === 'a' && node.attrs.find(attr => attr.name === 'href')?.value.trim();
    if (href) links.set(href, (links.get(href) ?? 0) + 1);
    for (let index = node.childNodes.length - 1; index >= 0; index--) nodes.push(node.childNodes[index]!);
  }
  return { text: plainEmailText(html), links: [...links].map(([href, count]) => ({ href, count })) };
}

export function recoverCampaignDigest(html: string) {
  const [root] = parseFragment(html).childNodes.filter(element);
  if (root?.tagName !== 'div') return null;
  const [header, ...elements] = root.childNodes.filter(element);
  if (header?.tagName !== 'h1') return null;
  const sections: Element[][] = [[]];
  for (const node of elements) {
    if (node.tagName === 'hr') sections.push([]);
    else sections.at(-1)!.push(node);
  }
  const text = (node: Element) => node.childNodes.map(child => 'value' in child ? child.value : '\n').join('');
  const items: string[] = [];
  for (const [title, summary, action, extra] of sections) {
    if (title?.tagName !== 'h2' || summary?.tagName !== 'p' || extra) return null;
    const anchor = action?.childNodes.find(element);
    const url = anchor?.tagName === 'a' ? anchor.attrs.find(attr => attr.name === 'href')?.value : null;
    items.push([text(title), text(summary), ...(url ? [url] : [])].join('\n'));
  }
  const source = items.join('\n\n');
  try { return renderWeeklyDigest(source) === html ? source : null; }
  catch { return null; }
}
