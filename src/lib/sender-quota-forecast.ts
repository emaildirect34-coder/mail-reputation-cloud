const dayMillis = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(day) / dayMillis);
const dayLabel = (day: number) => new Date(day * dayMillis).toISOString().slice(0, 10);

export type QuotaQueueCohort = { day: string; last_day: string | null; volume: number };
export type QuotaDraftDay = { day: string; eligible: boolean; volume: number };

export function quotaForecastThrough(draft: QuotaDraftDay[]) {
  return dayLabel(Math.max(...draft.map(slot => dayNumber(slot.day))) + 7);
}

export function projectSenderQuota({
  asOf, limit, used, deadline, existing, draft,
}: {
  asOf: string; limit: number; used: number; deadline: string | null; existing: QuotaQueueCohort[]; draft: QuotaDraftDay[];
}) {
  const today = dayNumber(asOf);
  const draftDays = new Map<number, { planned: number; eligible: number }>();
  for (const slot of draft) {
    const day = dayNumber(slot.day);
    const totals = draftDays.get(day) ?? { planned: 0, eligible: 0 };
    totals.planned += slot.volume;
    if (slot.eligible) totals.eligible += slot.volume;
    draftDays.set(day, totals);
  }
  const draftDates = [...draftDays.keys()].sort((a, b) => a - b);
  const first = draftDates[0] ?? today;
  const last = draftDates.at(-1) ?? today;
  const deadlineDay = deadline ? Math.floor((Date.parse(deadline) - 1) / dayMillis) : Infinity;
  const starts = new Map<number, { until: number; remaining: number }[]>();
  const events = new Set([today, first]);
  for (const cohort of existing) {
    const day = Math.max(today, dayNumber(cohort.day));
    const until = cohort.last_day ? dayNumber(cohort.last_day) : Infinity;
    if (until < day) continue;
    const group = starts.get(day) ?? [];
    group.push({ until, remaining: cohort.volume });
    starts.set(day, group);
    if (day < first) events.add(day);
    if (until + 1 < first) events.add(until + 1);
  }

  let queue: { until: number; remaining: number }[] = [];
  function beginDay(day: number) {
    queue = queue.filter(cohort => cohort.until >= day && cohort.remaining > 0);
    queue.push(...(starts.get(day) ?? []).sort((a, b) => a.until === b.until ? 0 : a.until - b.until));
  }
  function allocateExisting(capacity: number) {
    let spare = capacity;
    for (const cohort of queue) {
      const allocated = Math.min(spare, cohort.remaining);
      cohort.remaining -= allocated;
      spare -= allocated;
      if (spare === 0) break;
    }
    return spare;
  }

  // Between arrivals and expiry dates, successive UTC days have the same capacity.
  const beforeDraft = [...events].sort((a, b) => a - b);
  for (let index = 0; index + 1 < beforeDraft.length; index++) {
    const day = beforeDraft[index]!;
    const next = beforeDraft[index + 1]!;
    beginDay(day);
    allocateExisting((next - day - 1) * limit + Math.max(0, limit - (day === today ? used : 0)));
  }

  let draftWaiting = 0, deferred = 0, expired = 0;
  const days = [];
  for (let day = first; day <= last + 7; day++) {
    beginDay(day);
    const { planned, eligible } = draftDays.get(day) ?? { planned: 0, eligible: 0 };
    const alreadyUsed = day === today ? used : 0;
    const existingReady = queue.reduce((total, cohort) => total + cohort.remaining, 0);
    const capacity = Math.max(0, limit - alreadyUsed);
    const spare = allocateExisting(capacity);
    const draftAuthorized = Math.min(draftWaiting + eligible, spare);
    const delayedToday = eligible - Math.max(0, draftAuthorized - draftWaiting);
    draftWaiting += eligible - draftAuthorized;
    let expiredToday = planned - eligible;
    if (day >= deadlineDay) {
      expiredToday += draftWaiting;
      draftWaiting = 0;
    } else {
      deferred += delayedToday;
    }
    expired += expiredToday;
    days.push({
      day: dayLabel(day), alreadyUsed, existingReady, existingAuthorized: capacity - spare,
      draftPlanned: planned, draftAuthorized, draftWaiting, draftExpired: expiredToday,
    });
    if (day >= last && draftWaiting === 0) break;
  }
  return { days, deferred, expired, waitingAfterHorizon: draftWaiting };
}
