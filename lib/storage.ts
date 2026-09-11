import { validateAllocations, type AppState } from './model';
export function validateBackup(value: unknown): AppState {
  const s = value as AppState;
  if (!s || s.version !== 1 || !Array.isArray(s.people) || !Array.isArray(s.statements) || s.people.length > 100 || s.statements.length > 200) throw new Error('Backup inválido');
  for (const p of s.people) if (typeof p.id !== 'string' || typeof p.name !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error('Pessoa inválida');
  if (new Set(s.people.map(p => p.id)).size !== s.people.length || new Set(s.statements.map(b => b.id)).size !== s.statements.length) throw new Error('IDs repetidos');
  for (const bill of s.statements) {
    if (typeof bill.id !== 'string' || typeof bill.fingerprint !== 'string' || typeof bill.filename !== 'string' || !Number.isSafeInteger(bill.total) || !/^\d{4}-\d{2}-\d{2}$/.test(bill.dueDate) || !Number.isFinite(new Date(bill.dueDate).getTime()) || !Array.isArray(bill.transactions) || !Array.isArray(bill.warnings) || bill.transactions.length > 10000) throw new Error('Fatura inválida');
    for (const t of bill.transactions) {
      if (typeof t.id !== 'string' || typeof t.merchant !== 'string' || typeof t.date !== 'string' || typeof t.category !== 'string' || typeof t.holder !== 'string' || !Number.isSafeInteger(t.cents) || !Array.isArray(t.allocations) || !validateAllocations(t, t.allocations) || t.allocations.some(a => !s.people.some(p => p.id === a.personId))) throw new Error('Lançamento inválido');
      if (t.installment && (!Number.isInteger(t.installment.current) || !Number.isInteger(t.installment.total) || t.installment.current < 1 || t.installment.total < t.installment.current || t.installment.total > 60)) throw new Error('Parcela inválida');
      if (t.buyerId != null && (typeof t.buyerId !== 'string' || !s.people.some(p => p.id === t.buyerId))) throw new Error('Comprador inválido');
      if (t.note !== undefined && (typeof t.note !== 'string' || t.note.length > 2000)) throw new Error('Observação inválida');
      if (t.sharedCost !== undefined && typeof t.sharedCost !== 'boolean') throw new Error('Rateio inválido');
      if (t.nextCents !== undefined && !Number.isSafeInteger(t.nextCents)) throw new Error('Valor inválido');
    }
  }
  for (const p of s.people) if (p.monthlyLimitCents !== undefined && (!Number.isSafeInteger(p.monthlyLimitCents) || p.monthlyLimitCents <= 0)) throw new Error('Limite inválido');
  return s;
}
