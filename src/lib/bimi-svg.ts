const svgNamespace = 'http://www.w3.org/2000/svg';
const shapes = new Set(['svg', 'title', 'desc', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const attributes = new Set(('viewBox version baseProfile width height x y x1 x2 y1 y2 cx cy r rx ry d points transform fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity').split(' '));

export function prepareBimiSvg(source: string, brand: string) {
  if (!brand.trim() || /<\?|<!DOCTYPE|<!ENTITY/i.test(source.replace(/^\s*<\?xml[^?]*\?>/i, ''))) throw new Error('Indiquez une marque et utilisez un SVG sans déclaration externe.');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const svg = document.documentElement;
  if (svg.localName !== 'svg' || svg.namespaceURI !== svgNamespace || document.querySelector('parsererror')) throw new Error('SVG invalide.');
  for (const element of Array.from(svg.querySelectorAll('*')).concat(svg)) {
    if (element.namespaceURI !== svgNamespace || !shapes.has(element.localName) || (element !== svg && element.localName === 'svg')) {
      throw new Error('La conversion accepte uniquement des formes vectorielles simples.');
    }
    for (const attribute of Array.from(element.attributes)) {
      if (element === svg && attribute.name === 'xmlns' && attribute.value === svgNamespace) continue;
      if (attribute.namespaceURI || !attributes.has(attribute.name) || /url\s*\(|\\|[<>]/i.test(attribute.value)) {
        throw new Error('Aplatissez les styles et références dans votre éditeur vectoriel.');
      }
    }
  }
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2]! <= 0 || viewBox[2] !== viewBox[3]) {
    throw new Error('Le logo doit avoir un viewBox carré avant la conversion.');
  }
  const title = document.createElementNS(svgNamespace, 'title');
  title.textContent = brand.trim();
  for (const child of Array.from(svg.children)) if (child.localName === 'title') child.remove();
  svg.prepend(title);
  svg.setAttribute('version', '1.2');
  svg.setAttribute('baseProfile', 'tiny-ps');
  svg.removeAttribute('x');
  svg.removeAttribute('y');
  const output = new XMLSerializer().serializeToString(svg);
  if (new TextEncoder().encode(output).length > 32_768) throw new Error('Le logo converti dépasse 32 Kio. Simplifiez le tracé.');
  return output;
}
