export type Allocation = { personId: string; cents: number };
export type Transaction = {
  id: string; date: string; merchant: string; cents: number; holder: string;
  category: string; installment?: { current: number; total: number };
  nextCents?: number; kind: 'purchase' | 'service'; allocations: Allocation[];
  carryForward: boolean;
  /** Division copied from a recognized installment in a previous statement. */
  inheritedFromPrevious?: boolean;
  note?: string;
  buyerId?: string | null;
  sharedCost?: boolean;
};
export type Statement = {
  id: string; fingerprint: string; filename: string; dueDate: string; total: number;
  /** ID do arquivo/registro no armazenamento remoto. */
  storageDocumentId?: string;
  card?: { issuer: string; last4?: string; dueDay: number };
  nextTotal?: number; laterTotal?: number; transactions: Transaction[];
  holderTotals: { name: string; cents: number }[]; warnings: string[]; importedAt: string;
};
export type Person = { id: string; name: string; color: string; email?: string | null; monthlyLimitCents?: number; accountId?: string | null; version?: number };
export type AppState = { version: 1; people: Person[]; statements: Statement[]; activeId: string | null };
export const emptyState: AppState = { version: 1, people: [], statements: [], activeId: null };
export const colors = ['#5263df', '#e18b31', '#149c87', '#c568a1', '#488ec9', '#986bce'];
export const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function parseMoney(value: string): number {
  const text = value.replace(/R\$|\s/g, '');
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(text)) throw new Error('Use um valor como 120,00.');
  const cents = Number(text.replace(/\./g, '').replace(',', ''));
  if (!Number.isSafeInteger(cents)) throw new Error('Valor inválido.');
  return cents;
}
export const sum = (items: { cents: number }[]) => items.reduce((n, t) => n + t.cents, 0);
export const unassigned = (t: Transaction) => t.cents - sum(t.allocations);
export function splitEqual(cents: number, people: string[]): Allocation[] {
  if (!people.length) return [];
  const abs = Math.abs(cents), base = Math.floor(abs / people.length), rest = abs % people.length;
  return people.map((personId, i) => ({ personId, cents: (base + (i < rest ? 1 : 0)) * Math.sign(cents) }));
}
export function validateAllocations(t: Transaction, allocations: Allocation[]) {
  if (new Set(allocations.map(a => a.personId)).size !== allocations.length) return false;
  return allocations.every(a => Number.isSafeInteger(a.cents) && (a.cents === 0 || Math.sign(a.cents) === Math.sign(t.cents))) && Math.abs(sum(allocations)) <= Math.abs(t.cents);
}
export function scaleAllocations(t: Transaction, cents: number): Allocation[] {
  if (!t.cents || !t.allocations.length) return [];
  const assigned = sum(t.allocations);
  const target = Math.round(cents * assigned / t.cents);
  let used = 0;
  return t.allocations.map((a, i) => {
    const value = i === t.allocations.length - 1 ? target - used : Math.trunc(cents * a.cents / t.cents);
    used += value;
    return { personId: a.personId, cents: value };
  });
}
export function forecast(statement: Statement, personId?: string) {
  const horizon = Math.max(6, ...statement.transactions.map(t => Math.max(0, (t.installment?.total ?? 0) - (t.installment?.current ?? 0))));
  const base = new Date(statement.dueDate + 'T12:00:00');
  return Array.from({ length: Math.min(horizon, 60) }, (_, i) => {
    const date = new Date(base.getFullYear(), base.getMonth() + i + 1, 1);
    let cents = 0;
    for (const t of statement.transactions) {
      if (!t.installment || t.installment.total - t.installment.current <= i) continue;
      const amount = t.nextCents ?? t.cents;
      cents += personId ? (t.carryForward ? scaleAllocations(t, amount).find(a => a.personId === personId)?.cents ?? 0 : 0) : amount;
    }
    return { label: date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''), cents };
  });
}
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const dayOfMonth = (date: string) => date.split('/')[0];
export function carryAssignments(incoming: Statement, previous: Statement[]): Statement {
  const currentMonth = Number(incoming.dueDate.slice(0, 4)) * 12 + Number(incoming.dueDate.slice(5, 7));
  return { ...incoming, transactions: incoming.transactions.map(t => {
    if (!t.installment) return t;
    for (const prior of [...previous].sort((a, b) => b.dueDate.localeCompare(a.dueDate))) {
      const months = currentMonth - (Number(prior.dueDate.slice(0, 4)) * 12 + Number(prior.dueDate.slice(5, 7)));
      if (months <= 0) continue;
      const candidates = prior.transactions.filter(p => p.carryForward && p.installment && dayOfMonth(p.date) === dayOfMonth(t.date) && normal(p.merchant) === normal(t.merchant) && normal(p.holder) === normal(t.holder) && p.installment.total === t.installment!.total && p.installment.current + months === t.installment!.current);
      if (candidates.length === 1) return { ...t, allocations: scaleAllocations(candidates[0], t.cents), buyerId: candidates[0].buyerId, note: candidates[0].note, sharedCost: candidates[0].sharedCost, carryForward: true, inheritedFromPrevious: true };
    }
    return t;
  }) };
}

export const isSharedCost = (t: Transaction) => t.sharedCost ?? t.kind === 'service';
export function buyerOf(t: Transaction): string | null {
  if (isSharedCost(t)) return null;
  if (t.buyerId !== undefined) return t.buyerId;
  return t.allocations.length === 1 && sum(t.allocations) === t.cents ? t.allocations[0].personId : null;
}
/** Participants are actual buyers and people with a positive share in purchases, not everyone registered. */
export function purchasingPeople(statement: Statement, people: Person[]): string[] {
  const ids = new Set<string>();
  for (const t of statement.transactions) {
    if (isSharedCost(t) || t.cents <= 0) continue;
    const buyer = buyerOf(t);
    if (buyer) ids.add(buyer);
    t.allocations.filter(a => a.cents > 0).forEach(a => ids.add(a.personId));
  }
  return people.filter(p => ids.has(p.id)).map(p => p.id).sort();
}
/** Derived allocations never replace saved manual allocations. Recomputed after every purchase change. */
export function withSharedCharges(statement: Statement, people: Person[]): Statement {
  const participants = purchasingPeople(statement, people);
  let remainderOffset = 0;
  return { ...statement, transactions: statement.transactions.map(t => {
    if (!isSharedCost(t)) return t;
    const rotated = [...participants.slice(remainderOffset), ...participants.slice(0, remainderOffset)];
    const allocations = splitEqual(t.cents, rotated);
    if (participants.length) remainderOffset = (remainderOffset + Math.abs(t.cents) % participants.length) % participants.length;
    return { ...t, allocations };
  }) };
}
export function personSummary(statement: Statement, personId: string) {
  let purchases = 0, charges = 0, bought = 0, count = 0;
  for (const t of statement.transactions) {
    const own = t.allocations.find(a => a.personId === personId)?.cents ?? 0;
    if (isSharedCost(t)) charges += own;
    else { purchases += own; if (own !== 0) count++; if (buyerOf(t) === personId) bought += t.cents; }
  }
  return { purchases, charges, bought, count, total: purchases + charges };
}
export function isOrganized(statement: Statement) {
  return statement.transactions.length > 0 && sum(statement.transactions) === statement.total && statement.transactions.every(t => unassigned(t) === 0 && (isSharedCost(t) || !!buyerOf(t)));
}
export function personMissions(statement: Statement | undefined, person: Person) {
  const organized = !!statement && isOrganized(statement);
  const summary = statement ? personSummary(statement, person.id) : null;
  const participates = !!statement?.transactions.some(t => !isSharedCost(t) && (buyerOf(t) === person.id || t.allocations.some(a => a.personId === person.id && a.cents !== 0)));
  const hasGoal = (person.monthlyLimitCents ?? 0) > 0;
  return [
    { title: 'Plano definido', detail: 'Defina seu limite por fatura.', done: hasGoal },
    { title: 'Cada compra no lugar', detail: 'Fatura conferida, com compradores e divisões completos.', done: organized && participates },
    { title: 'Dentro do combinado', detail: 'Sua parte, com encargos, dentro do limite na fatura organizada.', done: organized && participates && hasGoal && !!summary && summary.total <= person.monthlyLimitCents! },
  ];
}
