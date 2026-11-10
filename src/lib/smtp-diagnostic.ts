const diagnoses = {
  ip: { label: 'Réputation IP signalée', advice: 'Vérifier la réputation de l’IP et le diagnostic du fournisseur.' },
  domain: { label: 'Réputation domaine signalée', advice: 'Vérifier le domaine expéditeur et ses signaux de réputation.' },
  rate: { label: 'Limitation de débit', advice: 'Respecter le délai de réessai et vérifier les limites du fournisseur.' },
  content: { label: 'Contenu mis en cause', advice: 'Contrôler le contenu et les liens mentionnés par le diagnostic.' },
  missing: { label: 'Boîte inexistante', advice: 'Vérifier l’adresse auprès de sa source.' },
  full: { label: 'Boîte pleine', advice: 'Laisser du temps au destinataire pour libérer de l’espace.' },
  network: { label: 'Réseau ou DNS temporaire', advice: 'Vérifier la résolution et la connectivité si le problème persiste.' },
  greylist: { label: 'Greylisting déclaré', advice: 'Laisser KumoMTA gérer ses réessais.' },
  unknown: { label: 'Cause indéterminée', advice: 'Consulter la réponse complète du serveur destinataire.' },
} as const;

export function smtpDiagnostic(code: number | null, detail: string, isp = '') {
  if (code === null || code < 400 || code >= 600) return null;
  const candidate = /^(?:(?:DSN|[45]\d{2})\s+)?([45]\.\d{1,3}\.\d{1,3})(?=\s|$)/i.exec(detail.trim())?.[1];
  const enhanced = candidate?.[0] === String(Math.floor(code / 100)) ? candidate : null;
  const reasons: (keyof typeof diagnoses)[] = [];
  if (enhanced === '5.1.1') reasons.push('missing');
  else if (enhanced === '4.2.2' || enhanced === '5.2.2') reasons.push('full');
  else if (enhanced?.startsWith('4.4.')) reasons.push('network');
  else {
    if ((code === 421 || code === 451) && /\bgr[ae]y[-\s]?list(?:ed|ing)?\b/i.test(detail)) reasons.push('greylist');
    if ((isp.toLowerCase() === 'gmail' && enhanced === '4.7.28') || /\b(?:rate[- ]limit(?:ed|ing)?|too many (?:messages|connections))\b/i.test(detail)) reasons.push('rate');
    if (/\b(?:ip(?: address)? reputation|blocked (?:sending )?ip(?: address)?)\b/i.test(detail)) reasons.push('ip');
    if (/\b(?:domain reputation|reputation of (?:the |your )?sending domain)\b/i.test(detail)) reasons.push('domain');
    if (/\b(?:message content (?:blocked|rejected)|rejected due to (?:its |the )?content)\b/i.test(detail)) reasons.push('content');
  }
  const reason = reasons.length === 1 ? reasons[0]! : 'unknown';
  return { enhanced, ...diagnoses[reason] };
}
