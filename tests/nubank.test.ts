import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNubank } from '../lib/nubank';
import type { PdfPage } from '../lib/itau';
import { sum } from '../lib/model';

function page(lines: string[]): PdfPage {
  return { width: 600, parts: lines.map((text, index) => ({ text, x: 50, y: 800 - index * 15, width: 420 })) };
}

test('lê fatura Nubank: vencimento, compras, parcelas, estorno e outros lançamentos', () => {
  const first = page(['Olá, Cliente.', 'Esta é a sua fatura de novembro, no valor de R$ 120,00', 'Data de vencimento: 16 NOV 2026']);
  const summary = page(['Nu Pagamentos S.A.', 'RESUMO DA FATURA ATUAL', 'Outros lançamentos −R$ 10,00', 'Total a pagar R$ 120,00', 'PRÓXIMAS FATURAS', 'Saldo em aberto da próxima fatura R$ 70,00']);
  const activity = page(['TRANSAÇÕES', 'Ana Exemplo R$ 130,00', '08 NOV •••• 1234 Loja Exemplo - Parcela 2/3 R$ 100,00', '09 NOV Estorno de Loja Antiga −R$ 20,00', '10 NOV •••• 4567 Mercado R$ 50,00', 'Pagamentos -R$ 1.000,00', '10 NOV Pagamento em 10 NOV −R$ 1.000,00']);
  const bill = parseNubank([first, summary, activity], 'nubank.pdf', 'fixture');
  assert.equal(bill.dueDate, '2026-11-16');
  assert.deepEqual(bill.card, { issuer: 'Nubank', dueDay: 16 });
  assert.equal(bill.transactions.length, 4);
  assert.equal(bill.transactions[0].merchant, 'Loja Exemplo');
  assert.deepEqual(bill.transactions[0].installment, { current: 2, total: 3 });
  assert.equal(bill.transactions[1].cents, -2000);
  assert.equal(bill.transactions[1].carryForward, false);
  assert.equal(bill.transactions[3].sharedCost, true);
  assert.equal(sum(bill.transactions), 12000);
  assert.equal(bill.nextTotal, 7000);
  assert.equal(bill.holderTotals[0].name, 'Ana Exemplo');
  assert.deepEqual(bill.warnings, []);
});

test('rejeita conteúdo que não seja uma fatura Nubank', () => {
  assert.throws(() => parseNubank([page(['Documento qualquer'])], 'other.pdf', 'fixture'));
});
