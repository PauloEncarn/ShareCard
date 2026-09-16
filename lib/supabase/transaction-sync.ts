import type { SupabaseClient } from '@supabase/supabase-js';

type WorkspaceTransaction = {
  id?: unknown; date?: unknown; merchant?: unknown; cents?: unknown; holder?: unknown;
  category?: unknown; installment?: { current?: unknown; total?: unknown }; nextCents?: unknown;
  kind?: unknown; buyerId?: unknown; sharedCost?: unknown; carryForward?: unknown;
  note?: unknown; allocations?: unknown[];
};
type WorkspaceStatement = {
  storageDocumentId?: unknown; dueDate?: unknown; total?: unknown; transactions?: WorkspaceTransaction[];
};
type WorkspaceState = { statements?: WorkspaceStatement[] };

const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const integer = (value: unknown, fallback = 0) => Number.isSafeInteger(value) ? value as number : fallback;
const transactionDate = (value: unknown, dueDate: string) => {
  if (typeof value !== 'string' || !/^\d{2}\/\d{2}$/.test(value)) return dueDate;
  const [day, month] = value.split('/');
  return `${dueDate.slice(0, 4)}-${month}-${day}`;
};

export async function syncWorkspaceTransactions(admin: SupabaseClient, masterId: string, rawState: unknown) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return;
  const state = rawState as WorkspaceState;
  const statements = Array.isArray(state.statements) ? state.statements : [];
  const rows: Record<string, unknown>[] = [];

  for (const statement of statements) {
    if (!isUuid(statement.storageDocumentId) || !isDate(statement.dueDate) || !Array.isArray(statement.transactions)) continue;
    for (const transaction of statement.transactions) {
      if (typeof transaction.id !== 'string' || !transaction.id || typeof transaction.merchant !== 'string' || typeof transaction.holder !== 'string' || typeof transaction.category !== 'string' || !Number.isSafeInteger(transaction.cents)) continue;
      const installment = transaction.installment;
      rows.push({
        statement_id: statement.storageDocumentId,
        master_id: masterId,
        source_id: transaction.id,
        transaction_date: transactionDate(transaction.date, statement.dueDate),
        merchant: transaction.merchant.slice(0, 150),
        cents: transaction.cents,
        holder: transaction.holder.slice(0, 100),
        category: transaction.category.slice(0, 60),
        installment_current: installment && Number.isInteger(installment.current) ? installment.current : null,
        installment_total: installment && Number.isInteger(installment.total) ? installment.total : null,
        next_cents: Number.isSafeInteger(transaction.nextCents) ? transaction.nextCents : null,
        kind: transaction.kind === 'service' ? 'service' : 'purchase',
        buyer_id: isUuid(transaction.buyerId) ? transaction.buyerId : null,
        shared_cost: transaction.sharedCost === true,
        carry_forward: transaction.carryForward !== false,
        note: typeof transaction.note === 'string' ? transaction.note.slice(0, 2000) : null,
        allocations: Array.isArray(transaction.allocations) ? transaction.allocations : [],
        source_updated_at: new Date().toISOString(),
      });
    }
  }

  if (!rows.length) return;
  const result = await admin.from('transactions').upsert(rows, { onConflict: 'statement_id,source_id' });
  if (result.error && !/source_id|source_updated_at|transactions_statement_source_idx/i.test(result.error.message || '')) {
    throw new Error(result.error.message);
  }
}
