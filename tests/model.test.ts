import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryAssignments, forecast, parseMoney, scaleAllocations, splitEqual, sum, validateAllocations, type Statement, type Transaction } from '../lib/model';
import { demoState } from '../lib/demo';

test('valores monetários são centavos inteiros e a divisão preserva o total', () => {
  assert.equal(parseMoney('7.723,19'), 772319);
  assert.equal(parseMoney('- 13,26'), -1326);
  assert.throws(() => parseMoney('1.2'));
  for (const cents of [100, 101, 1, -101]) assert.equal(sum(splitEqual(cents, ['a', 'b', 'c'])), cents);
  assert.deepEqual(splitEqual(100, ['a', 'b', 'c']).map(a => a.cents), [34, 33, 33]);
});
test('rejeita atribuição maior que compra, sinal errado e pessoas duplicadas', () => {
  const t = demoState().statements[0].transactions[0];
  assert.equal(validateAllocations(t, [{ personId: 'a', cents: t.cents + 1 }]), false);
  assert.equal(validateAllocations(t, [{ personId: 'a', cents: -10 }]), false);
  assert.equal(validateAllocations(t, [{ personId: 'a', cents: 1 }, { personId: 'a', cents: 1 }]), false);
  assert.equal(validateAllocations(t, [{ personId: 'a', cents: 100 }]), true);
});
test('projeção respeita término, próxima parcela exata e atribuição futura opcional', () => {
  const bill = demoState().statements[0];
  const t: Transaction = { ...bill.transactions[0], cents: 10001, installment: { current: 2, total: 4 }, nextCents: 9999, allocations: splitEqual(10001, ['a', 'b']), carryForward: true };
  bill.transactions = [t];
  assert.deepEqual(forecast(bill).slice(0, 3).map(m => m.cents), [9999, 9999, 0]);
  assert.equal(sum(scaleAllocations(t, 9999)), 9999);
  assert.equal(forecast(bill, 'a')[0].cents + forecast(bill, 'b')[0].cents, 9999);
  t.carryForward = false;
  assert.equal(forecast(bill, 'a')[0].cents, 0);
  assert.equal(forecast(bill)[0].cents, 9999);
});
test('transfere divisão apenas entre parcelas compatíveis; não adivinha quando ambíguo', () => {
  const prior = demoState().statements[0];
  prior.transactions = [{ ...prior.transactions[1], carryForward: true }];
  const incoming: Statement = { ...prior, id: 'new', dueDate: '2026-10-08', transactions: [{ ...prior.transactions[0], installment: { current: 4, total: 8 }, allocations: [] }] };
  assert.equal(carryAssignments(incoming, [prior]).transactions[0].allocations[0].personId, 'bruno');
  prior.transactions.push({ ...prior.transactions[0], id: 'duplicate' });
  assert.equal(carryAssignments(incoming, [prior]).transactions[0].allocations.length, 0);
});
