export function campaignTimeZone(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Saisissez un fuseau horaire, par exemple Europe/Paris.');
  try {
    return new Intl.DateTimeFormat('fr', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    throw new Error('Fuseau horaire invalide. Exemple : Europe/Paris.');
  }
}

export function scheduledInstant(local: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Date de programmation invalide.');
  const wallTime = Date.parse(local + ':00Z');
  if (!Number.isFinite(wallTime) || new Date(wallTime).toISOString().slice(0, 16) !== local) {
    throw new Error('Date de programmation invalide.');
  }
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const format = (value: number) => formatter.format(value).replace(' ', 'T');
  const day = 86_400_000;
  const candidates = new Set([wallTime - day, wallTime, wallTime + day].map(probe => {
    const offset = Date.parse(format(probe) + ':00Z') - probe;
    return wallTime - offset;
  }));
  const matches = [...candidates].filter(value => format(value) === local);
  if (matches.length !== 1) throw new Error('Cette heure est ambiguë ou inexistante à cause du changement d’heure. Choisissez une autre heure.');
  return new Date(matches[0]!).toISOString();
}

export function recipientTimeZone(value: string) {
  const timeZone = value.trim();
  if (timeZone.length > 80 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(timeZone)) {
    throw new Error('Utilisez un fuseau horaire IANA, par exemple Europe/Paris.');
  }
  return campaignTimeZone(timeZone);
}

export function planRecipientSchedule(
  local: string, accountTimeZone: string, timeZones: (string | null | undefined)[], windowHours = 0, now = Date.now(),
) {
  const groups = new Map<string, number[]>();
  let fallbackCount = 0;
  for (const [index, timeZone] of timeZones.entries()) {
    if (!timeZone) fallbackCount++;
    const zone = timeZone || accountTimeZone;
    const group = groups.get(zone);
    if (group) group.push(index);
    else groups.set(zone, [index]);
  }

  const availableAt: string[] = [];
  let earliest = Infinity;
  for (const [timeZone, indexes] of groups) {
    let start: number;
    try {
      start = Date.parse(scheduledInstant(local, timeZone));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Heure locale invalide.';
      throw new Error(`${timeZone} · ${message}`);
    }
    if (start <= now) throw new Error(`L’heure programmée est déjà passée dans le fuseau ${timeZone}. Choisissez une date plus tardive.`);
    earliest = Math.min(earliest, start);
    indexes.forEach((index, position) => {
      const delay = Math.floor(position * windowHours * 3_600_000 / indexes.length);
      availableAt[index] = new Date(start + delay).toISOString();
    });
  }

  return { scheduledAt: new Date(earliest).toISOString(), availableAt, fallbackCount };
}
