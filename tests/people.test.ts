import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoState } from '../lib/demo';
import { buyerOf, isOrganized, personMissions, personSummary, purchasingPeople, sum, withSharedCharges, type Transaction } from '../lib/model';
import { validateBackup } from '../lib/storage';
const people = [{ id: 'a', name: 'Ana', color: '#5263df' }, { id: 'b', name: 'Bruno', color: '#149c87' }, { id: 'c', name: 'Cris', color: '#112233' }];
function purchase(id: string, person: string, cents: number): Transaction { return { id, date: '01/08', merchant: id, cents, buyerId: person, category: 'Compras', holder: 'Titular', kind: 'purchase', allocations: person ? [{ personId: person, cents }] : [], carryForward: true }; }
function fixture() { return { ...demoState().statements[0], transactions: [purchase('p1', 'a', 10000), purchase('p2', 'b', 20000), { ...purchase('fee', '', 101), kind: 'service' as const }], total: 30101 }; }
test('rateio só inclui compradores e fecha em centavos; pessoa cadastrada sem compras fica fora', () => {
  const raw = fixture(), bill = withSharedCharges(raw, people);
  assert.deepEqual(purchasingPeople(raw, people), ['a', 'b']);
  assert.deepEqual(bill.transactions[2].allocations.map(a => a.cents), [51, 50]);
  assert.equal(sum(bill.transactions[2].allocations), 101);
  assert.equal(personSummary(bill, 'a').total + personSummary(bill, 'b').total, bill.total);
  assert.equal(personSummary(bill, 'c').total, 0);
  assert.equal(raw.transactions[2].allocations.length, 0);
});
test('trocar comprador recalcula gerais; remover todos deixa encargos pendentes', () => {
  const raw = fixture(); raw.transactions[1] = purchase('p2', 'c', 20000);
  assert.deepEqual(withSharedCharges(raw, people).transactions[2].allocations.map(a => a.personId), ['a', 'c']);
  raw.transactions = raw.transactions.slice(2);
  assert.equal(withSharedCharges(raw, people).transactions[0].allocations.length, 0);
});
test('co-participante na divisão entra no rateio; serviços individuais podem ser excluídos', () => {
  const raw = fixture(); raw.transactions[0].allocations = [{ personId: 'a', cents: 5000 }, { personId: 'c', cents: 5000 }];
  assert.deepEqual(purchasingPeople(raw, people), ['a', 'b', 'c']);
  raw.transactions[2].sharedCost = false;
  assert.equal(withSharedCharges(raw, people).transactions[2].allocations.length, 0);
});
test('restos de múltiplas taxas alternam; estornos preservam sinal e soma', () => {
  const raw = fixture(); raw.transactions.push({ ...raw.transactions[2], id: 'fee2' });
  const bill = withSharedCharges(raw, people);
  assert.equal(personSummary(bill, 'a').charges, 101);
  assert.equal(personSummary(bill, 'b').charges, 101);
  raw.transactions[2].cents = -101;
  assert.equal(sum(withSharedCharges(raw, people).transactions[2].allocations), -101);
});
test('legado preserva dados e infere comprador apenas da divisão integral individual', () => {
  const state = demoState(); const copy = JSON.parse(JSON.stringify(state));
  assert.deepEqual(validateBackup(copy), state);
  assert.equal(buyerOf(state.statements[0].transactions[0]), 'ana');
  state.statements[0].transactions[0].buyerId = null;
  assert.equal(buyerOf(state.statements[0].transactions[0]), null);
});
test('backup roundtrip preserva notas, comprador e limite; rejeita referências inválidas', () => {
  const state = demoState(); state.people[0].monthlyLimitCents = 100000;
  state.statements[0].transactions[0].note = 'Presente\nAniversário';
  state.statements[0].transactions[0].buyerId = 'bruno';
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
  state.statements[0].transactions[0].buyerId = 'inexistente';
  assert.throws(() => validateBackup(state));
});
test('conquistas dependem de fatura completa e meta real, sem premiar ausência de dados', () => {
  const person = { ...people[0], monthlyLimitCents: 12000 };
  const raw = fixture(), bill = withSharedCharges(raw, people);
  assert.equal(isOrganized(bill), true);
  assert.deepEqual(personMissions(bill, person).map(m => m.done), [true, true, true]);
  assert.deepEqual(personMissions(undefined, person).map(m => m.done), [true, false, false]);
  assert.deepEqual(personMissions(bill, { ...person, monthlyLimitCents: 5000 }).map(m => m.done), [true, true, false]);
  raw.transactions[0].buyerId = null;
  assert.deepEqual(personMissions(withSharedCharges(raw, people), person).map(m => m.done), [true, false, false]);
});
