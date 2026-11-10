export const campaignTopics = ['news', 'offers', 'events', 'education'] as const;
export type CampaignTopic = typeof campaignTopics[number];

export const campaignTopicLabels: Record<CampaignTopic, string> = {
  news: 'Actualités',
  offers: 'Offres',
  events: 'Événements',
  education: 'Conseils',
};

export function isCampaignTopic(value: unknown): value is CampaignTopic {
  return campaignTopics.some(topic => topic === value);
}

/** Null means all topics. Undefined means the form is invalid. */
export function parseTopicPreferences(form: URLSearchParams): CampaignTopic[] | null | undefined {
  const mode = form.get('mode');
  const topics = form.getAll('topic').filter(isCampaignTopic);
  if (form.getAll('mode').length !== 1 || topics.length !== form.getAll('topic').length ||
      new Set(topics).size !== topics.length) return undefined;
  if (mode === 'all') return null;
  if (mode === 'selected' && topics.length > 0) return topics;
  return undefined;
}
