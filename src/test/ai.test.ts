import { describe, it, expect } from 'vitest';
import { aiInput, canUseAi, canApplyText, type AiResult } from '../lib/ai.schemas';
const proposal: AiResult = { summary: 'Diagnostic', risk:'unknown', findings:[], recommendations:[], replacement:'Nouvel objet', limitations:[] };
describe('AI task boundaries', () => {
  it('workers can diagnose only their assigned functionality', () => {
    expect(canUseAi({role:'worker',paths:['/dashboard/campaigns']},'subject')).toBe(true);
    expect(canUseAi({role:'worker',paths:['/dashboard/campaigns']},'logs')).toBe(false);
    expect(canUseAi({role:'worker',paths:['/dashboard/agent']},'dns')).toBe(false);
  });
  it('superadmins can use all four diagnostics', () => {
    for (const skill of ['subject','content','dns','logs'] as const) expect(canUseAi({role:'superadmin',paths:[]},skill)).toBe(true);
  });
  it('model output cannot apply infrastructure or delivery actions', () => {
    expect(canApplyText('dns',proposal)).toBe(false);
    expect(canApplyText('logs',proposal)).toBe(false);
    expect(canApplyText('subject',proposal)).toBe(true);
    expect(canApplyText('content',{...proposal,replacement:''})).toBe(false);
  });
  it('DNS requires an existing domain identifier', () => expect(aiInput.safeParse({skill:'dns'}).success).toBe(false));
});