import { z } from 'zod';
import { canOpen, type Access } from './access';

export const aiSkills = {
  subject: { title: 'Objet', path: '/dashboard/campaigns', instruction: 'Évaluer clarté, promesses trompeuses, pression artificielle et adéquation au contenu. Proposer un objet fidèle, sans garantir le placement inbox.' },
  content: { title: 'Contenu email', path: '/dashboard/campaigns', instruction: 'Auditer le contenu pour lisibilité, accessibilité, identité expéditeur et désinscription. Préserver toutes les URL, macros, offres et informations factuelles. Ne jamais inventer de remise ou de témoignage. Ne jamais ajouter de scripts ou de formulaires.' },
  dns: { title: 'Authentification DNS', path: '/dashboard/domains', instruction: 'Analyser uniquement les contrôles DNS enregistrés, leurs dates et les associations DKIM. Distinguer un contrôle ancien, un enregistrement DNS publié et une installation DKIM confirmée. Une valeur TXT MTA-STS ne prouve pas la présence de la policy HTTPS. Ne jamais inventer des résultats DNS.' },
  logs: { title: 'Délivrabilité', path: '/dashboard/logs', instruction: 'Analyser les événements et alertes observés. Distinguer injection et livraison SMTP. Ne pas attribuer une plainte ou un placement spam à un objet sans preuve expérimentale. Respecter les protections existantes; aucune reprise ni contournement automatique.' },
} as const;
export const aiInput = z.object({
  skill: z.enum(['subject', 'content', 'dns', 'logs']),
  subject: z.string().max(500).default(''),
  body: z.string().max(40000).default(''),
  domainId: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  if (v.skill === 'dns' && !v.domainId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choisissez un domaine' });
  if (v.skill === 'subject' && !v.subject.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Saisissez un objet' });
  if (v.skill === 'content' && !v.body.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Saisissez le contenu' });
});
export type AiInput = z.input<typeof aiInput>;
export const aiResult = z.object({
  summary: z.string().min(1).max(3000),
  risk: z.enum(['low', 'medium', 'high', 'unknown']),
  findings: z.array(z.string().max(1500)).max(10),
  recommendations: z.array(z.string().max(1500)).max(10),
  replacement: z.string().max(40000),
  limitations: z.array(z.string().max(1000)).max(8),
});
export type AiResult = z.infer<typeof aiResult>;
export function canUseAi(access: Access, skill: keyof typeof aiSkills) {
  return access.role !== null && canOpen(access, aiSkills[skill].path);
}
/** Never apply edits to sending infrastructure based on model output. */
export function canApplyText(skill: keyof typeof aiSkills, result: AiResult) {
  return (skill === 'subject' || skill === 'content') && result.replacement.trim().length > 0;
}