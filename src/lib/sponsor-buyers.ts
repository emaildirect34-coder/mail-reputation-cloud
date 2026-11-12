export function purchaseReviewUrl(value: string) {
  const url = URL.parse(value);
  return url?.protocol === 'https:' && !url.username && !url.password ? url.href : null;
}

export const purchaseConsentText = 'Je souhaite recevoir par e-mail les prochaines offres et actualités d’Email Direct selon mes choix ci-dessous.';
