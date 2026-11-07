import { describe,it,expect } from 'vitest';
import { financialTotals,amountToCents,canReadFinance } from '../lib/finance.schemas';
describe('sponsor finance',()=>{
 const entries=[{kind:'revenue',status:'approved',amount_cents:10000,currency:'EUR'},{kind:'revenue',status:'paid',amount_cents:20000,currency:'EUR'},{kind:'revenue',status:'pending',amount_cents:5000,currency:'EUR'},{kind:'revenue',status:'rejected',amount_cents:7000,currency:'EUR'},{kind:'expense',status:'paid',amount_cents:10000,currency:'EUR'},{kind:'revenue',status:'paid',amount_cents:99999,currency:'USD'}];
 it('separates approved, paid, pending and rejected revenue',()=>{const t=financialTotals(entries,'EUR');expect(t.approved).toBe(30000);expect(t.paid).toBe(20000);expect(t.pending).toBe(5000);expect(t.receivable).toBe(10000);expect(t.rejected).toBe(7000);});
 it('computes profit and cash after costs without mixing currencies',()=>{const t=financialTotals(entries,'EUR');expect(t.profit).toBe(20000);expect(t.cash).toBe(10000);expect(financialTotals(entries,'USD').approved).toBe(99999);});
 it('uses measured delivery denominator and no invented eCPM at zero',()=>{expect(financialTotals(entries,'EUR',2000).ecpm).toBe(150);expect(financialTotals(entries,'EUR',0).ecpm).toBeNull();});
 it('stores amounts as exact cents',()=>{expect(amountToCents('4,20')).toBe(420);expect(()=>amountToCents('4.205')).toThrow();});
 it('financial data requires the finance task',()=>{expect(canReadFinance({role:'worker',paths:['/dashboard/templates']})).toBe(false);expect(canReadFinance({role:'worker',paths:['/dashboard/finance']})).toBe(true);});
});