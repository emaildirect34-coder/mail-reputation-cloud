import { describe, expect, it } from 'vitest';
import { allowsInfrastructure, bindingInput, plannedQuota, warmupInput } from '@/lib/infrastructure.schemas';

describe('Infrastructure access and automation', () => {
  it('allows workers only their assigned infrastructure task', () => {
    expect(allowsInfrastructure('worker', ['/dashboard/ips'], '/dashboard/ips')).toBe(true);
    expect(allowsInfrastructure('worker', ['/dashboard/ips'], '/dashboard/servers')).toBe(false);
    expect(allowsInfrastructure(null, [], '/dashboard/ips')).toBe(false);
  });
  it('lets superadmins manage all infrastructure pages', () => {
    expect(allowsInfrastructure('superadmin', [], '/dashboard/pools')).toBe(true);
  });
  it('requires explicit domain and sending server for automatic DKIM installation', () => {
    expect(bindingInput.safeParse({serverId:'',domainId:''}).success).toBe(false);
    expect(bindingInput.safeParse({serverId:'11111111-1111-4111-8111-111111111111',domainId:'22222222-2222-4222-8222-222222222222'}).success).toBe(true);
  });
  it('preserves the chosen daily warmup quotas', () => {
    expect(plannedQuota([50,100,200], 1)).toBe(50);
    expect(plannedQuota([50,100,200], 2)).toBe(100);
    expect(plannedQuota([50,100,200], 9)).toBe(200);
    expect(warmupInput.safeParse({ ipId:'11111111-1111-4111-8111-111111111111', isp:'Gmail', dailyLimits:[0] }).success).toBe(false);
  });
});