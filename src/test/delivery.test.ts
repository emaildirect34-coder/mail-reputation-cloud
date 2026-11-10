import { describe,it,expect } from 'vitest';
import { canReadLogs, deliveryBatch, isExplicitGreylisting, isMailboxFull, parseMessageReference, protectionRules } from '@/lib/delivery.schemas';
describe('delivery protection',()=>{
  it('distinguishes mailbox quota from other temporary and permanent failures', () => {
    expect(isMailboxFull(452, '4.2.2 Mailbox full')).toBe(true);
    expect(isMailboxFull(452, '4.2.20 Mailbox unavailable')).toBe(false);
    expect(isMailboxFull(552, '4.2.2 Mailbox full')).toBe(false);
    expect(isMailboxFull(452, 'Quota exceeded')).toBe(false);
  });
  it('labels only temporary responses that explicitly identify greylisting', () => {
    expect(isExplicitGreylisting(451, '4.7.1 Greylisted, try again later')).toBe(true);
    expect(isExplicitGreylisting(421, 'Temporary gray-listing')).toBe(true);
    expect(isExplicitGreylisting(421, 'Rate limit exceeded')).toBe(false);
    expect(isExplicitGreylisting(550, 'Rejected after greylisting')).toBe(false);
  });
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
  it('accepts a bare queue UUID or a full Message-ID and rejects malformed references', () => {
    const id = 'c30d9512-234c-4f27-baf5-8f0935a949d5';
    expect(parseMessageReference(id)).toEqual({ id, domain: null });
    expect(parseMessageReference(` <${id.toUpperCase()}@Mail.Example.org> `)).toEqual({ id, domain: 'mail.example.org' });
    expect(parseMessageReference(`Message-ID: <${id}@mail.example.org>`)).toEqual({ id, domain: 'mail.example.org' });
    expect(parseMessageReference(`<${id}>`)).toBeNull();
    expect(parseMessageReference(`${id}@mail.example.org>`)).toBeNull();
    expect(parseMessageReference('Message-ID: invalid')).toBeNull();
  });
  it('rejects malformed or excessive agent events',()=>{
    expect(deliveryBatch.safeParse({events:[{messageId:'fake',type:'opened'}]}).success).toBe(false);
    expect(deliveryBatch.safeParse({events:Array(501).fill({eventKey:'k',messageId:'c30d9512-234c-4f27-baf5-8f0935a949d5',type:'delivered',occurredAt:'2026-11-07T14:55:00Z'})}).success).toBe(false);
  });
});
