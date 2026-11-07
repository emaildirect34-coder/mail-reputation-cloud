import { describe,it,expect } from 'vitest';
import { canReadLogs, deliveryBatch, protectionRules } from '@/lib/delivery.schemas';
describe('delivery protection',()=>{
  it('pauses above 3% hard bounces in the initial 500 sample',()=>{
    expect(protectionRules(500,15,0,0).hardBounce).toBe(false);
    expect(protectionRules(500,16,0,0).hardBounce).toBe(true);
  });
  it('pauses above 0.08% complaints for an ISP',()=>{
    expect(protectionRules(0,0,1250,1).complaint).toBe(false);
    expect(protectionRules(0,0,1249,1).complaint).toBe(true);
  });
  it('allows a worker only with an active task granting logs',()=>{
    expect(canReadLogs({role:'worker',paths:['/dashboard/campaigns']})).toBe(false);
    expect(canReadLogs({role:'worker',paths:['/dashboard/logs']})).toBe(true);
    expect(canReadLogs({role:'superadmin',paths:[]})).toBe(true);
  });
  it('rejects malformed or excessive agent events',()=>{
    expect(deliveryBatch.safeParse({events:[{messageId:'fake',type:'opened'}]}).success).toBe(false);
    expect(deliveryBatch.safeParse({events:Array(501).fill({eventKey:'k',messageId:'c30d9512-234c-4f27-baf5-8f0935a949d5',type:'delivered',occurredAt:'2026-11-07T14:55:00Z'})}).success).toBe(false);
  });
});