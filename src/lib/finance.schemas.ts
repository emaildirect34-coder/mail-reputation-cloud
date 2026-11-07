import { z } from 'zod';
import { canOpen, type Access } from './access';
export const currencySchema = z.enum(['EUR','USD','GBP']);
export const accountInput = z.object({ name:z.string().trim().min(1).max(120), provider:z.enum(['manual','everflow']).default('manual'), currency:currencySchema.default('EUR'), apiKey:z.string().max(500).default('') });
export const offerInput = z.object({ id:z.string().uuid().optional(), accountId:z.string().uuid(), externalId:z.string().max(120).optional(), name:z.string().trim().min(1).max(200), category:z.string().max(100).default(''), model:z.enum(['CPA','CPL','CPC','CPM','RevShare']), payout:z.number().finite().min(0).max(1000000), currency:currencySchema, geo:z.array(z.string().max(20)).max(100).default([]), status:z.enum(['active','paused','capped','missing']).default('active'), trackingUrl:z.string().url().refine(s=>s.startsWith('https://'),'URL HTTPS requise').or(z.literal('')).default(''), subject:z.string().max(500).default(''), html:z.string().max(500000).default(''), rules:z.string().max(10000).default('') });
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s,'Date invalide');
export const financeFilters = z.object({ from:day,to:day,currency:currencySchema,accountId:z.string().uuid().optional(),campaignId:z.string().uuid().optional() }).refine(v=>v.from<=v.to,'Période invalide');
export const entryInput = z.object({ accountId:z.string().uuid(),campaignId:z.string().uuid().optional(),offerId:z.string().uuid().optional(),externalId:z.string().trim().min(1).max(150),kind:z.enum(['revenue','expense']),status:z.enum(['pending','approved','paid','rejected']),amountCents:z.number().int().min(0).max(100000000000),currency:currencySchema,category:z.string().max(100).default(''),description:z.string().max(1000).default(''),occurredOn:day,dueOn:day.optional() });
export const entryBatch = z.object({ entries:z.array(entryInput).min(1).max(1000) });
export const entryStatus = z.object({id:z.string().uuid(),status:z.enum(['pending','approved','paid','rejected'])});
export const canReadFinance = (access:Access)=>access.role!==null && canOpen(access,'/dashboard/finance');
type Entry = {kind:string;status:string;amount_cents:number;currency:string};
export function financialTotals(entries:Entry[],currency:string,delivered=0) {
  let approved=0,pending=0,paid=0,rejected=0,expenses=0,expensePaid=0,expensePending=0;
  for(const e of entries.filter(e=>e.currency===currency)) {
    if(e.kind==='revenue') {
      if(e.status==='pending') pending+=e.amount_cents;
      if(e.status==='approved'||e.status==='paid') approved+=e.amount_cents;
      if(e.status==='paid') paid+=e.amount_cents;
      if(e.status==='rejected') rejected+=e.amount_cents;
    } else {
      if(e.status==='approved'||e.status==='paid') expenses+=e.amount_cents;
      if(e.status==='paid') expensePaid+=e.amount_cents;
      if(e.status==='pending') expensePending+=e.amount_cents;
    }
  }
  const profit=approved-expenses;
  return {approved,pending,paid,rejected,expenses,expensePaid,expensePending,profit,receivable:approved-paid,payable:expenses-expensePaid,cash:paid-expensePaid,margin:approved?profit/approved*100:null,ecpm:delivered?approved/100/delivered*1000:null};
}
export function amountToCents(text:string) {
  if(!/^\d+(?:[.,]\d{1,2})?$/.test(text.trim())) throw new Error('Montant positif avec 2 décimales maximum');
  const [whole,fraction='']=text.trim().replace(',','.').split('.');
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents>100000000000) throw new Error('Montant trop élevé');
  return cents;
}