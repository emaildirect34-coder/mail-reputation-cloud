import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const invoice = z.object({ vendor: z.string().trim().min(1).max(120), invoiceNumber: z.string().trim().min(1).max(160), amount: z.string().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/), currency: z.enum(['EUR','USD','GBP']), issuedOn: z.string().date(), dueOn: z.string().date().optional().or(z.literal('')), status: z.enum(['unpaid','paid','overdue','void']), description: z.string().max(1000).default('') });
async function admin(context: any) {
 const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
 if (role.error || !role.data) throw new Error('Accès réservé au Superadmin');
 return (await import('@/integrations/supabase/client.server')).supabaseAdmin;
}
export const readVendorInvoices = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).handler(async ({context}) => {
 const db = await admin(context);
 const result = await (db as any).from('infrastructure_invoices').select('*').order('issued_on',{ascending:false}).limit(2000);
 if (result.error) throw new Error('Impossible de charger les factures fournisseurs. Appliquez la migration 0084.');
 return result.data ?? [];
});
export const importVendorInvoices = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(input => z.array(invoice).min(1).max(500).parse(input))
 .handler(async ({context,data}) => {
  const db = await admin(context);
  const rows = data.map(row => ({ vendor:row.vendor, invoice_number:row.invoiceNumber, amount_cents:Math.round(Number(row.amount.replace(',','.'))*100), currency:row.currency, issued_on:row.issuedOn, due_on:row.dueOn || null, status:row.status, description:row.description, imported_by:context.userId }));
  if (rows.some(row => !Number.isSafeInteger(row.amount_cents))) throw new Error('Un montant dépasse la limite autorisée.');
  const result = await (db as any).from('infrastructure_invoices').upsert(rows,{onConflict:'vendor,invoice_number',ignoreDuplicates:true}).select('id');
  if (result.error) throw new Error('Import impossible. Vérifiez la migration 0084 et les lignes du fichier.');
  const {recordAuditEvent} = await import('./audit-log.server');
  await recordAuditEvent(db,{actorId:context.userId,action:'finance.vendor_invoices_imported',entityType:'infrastructure_invoice',summary:{received:rows.length,inserted:result.data?.length ?? 0}});
  return {received:rows.length,inserted:result.data?.length ?? 0,duplicates:rows.length-(result.data?.length ?? 0)};
 });

export const recordVendorInvoicePayment=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(input=>z.object({invoiceId:z.string().uuid(),reference:z.string().trim().min(1).max(200),amount:z.string().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/),currency:z.enum(['EUR','USD','GBP']),paidOn:z.string().date()}).parse(input))
 .handler(async ({context,data})=>{const db=await admin(context);const cents=Math.round(Number(data.amount.replace(',','.'))*100);if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('Montant de paiement invalide.');const {data:ok,error}=await (db as any).rpc('record_vendor_invoice_payment',{_invoice:data.invoiceId,_reference:data.reference,_amount:cents,_currency:data.currency,_paid_on:data.paidOn,_actor:context.userId});if(error)throw new Error('Rapprochement impossible. Appliquez la migration 0085.');if(!ok)throw new Error('Référence déjà enregistrée, devise différente ou facture introuvable.');const {recordAuditEvent}=await import('./audit-log.server');await recordAuditEvent(db,{actorId:context.userId,action:'finance.vendor_invoice_payment_recorded',entityType:'infrastructure_invoice',entityId:data.invoiceId,summary:{reference:data.reference,amountCents:cents,currency:data.currency,paidOn:data.paidOn}});return {ok:true};});
