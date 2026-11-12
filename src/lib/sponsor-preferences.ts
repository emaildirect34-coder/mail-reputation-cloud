type SponsorOption = { id: string; name: string; blocked: boolean };

export function parseSponsorPreference(form: Pick<FormData, 'getAll'> | URLSearchParams | null) {
  const ids = form?.getAll('brand') ?? [];
  const choices = form?.getAll('blocked') ?? [];
  const id = ids[0];
  const blocked = choices[0];
  if (ids.length !== 1 || typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
      choices.length !== 1 || (blocked !== 'true' && blocked !== 'false')) return null;
  return { id, blocked: blocked === 'true' };
}

export function sponsorPreferenceForms(options: SponsorOption[], nonce?: string) {
  if (!options.length) return '';
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<section><h2>Offres par marque</h2>
    <p>Vous pouvez arrêter les offres d’une marque et conserver vos autres choix.</p>
    ${options.map(brand => `<form method="post" style="margin-bottom:1rem">
      ${nonce ? `<input type="hidden" name="nonce" value="${escape(nonce)}">` : ''}
      <input type="hidden" name="action" value="sponsor">
      <input type="hidden" name="brand" value="${escape(brand.id)}">
      <p><strong>${escape(brand.name)}</strong>${brand.blocked ? ' · Offres arrêtées' : ''}</p>
      <button type="submit" name="blocked" value="${!brand.blocked}">${brand.blocked ? 'Retirer le blocage' : 'Arrêter les offres de cette marque'}</button>
    </form>`).join('')}
  </section>`;
}
