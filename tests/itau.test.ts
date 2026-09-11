import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseItau, pageLines, type PdfPage } from '../lib/itau';
import { forecast, sum } from '../lib/model';

function page(left: string[], right: string[] = []): PdfPage {
  return { width: 600, parts: [...left.map((text, i) => ({ text, x: 50, y: 800 - i * 15, width: 240 })), ...right.map((text, i) => ({ text, x: 330, y: 800 - i * 15, width: 240 }))] };
}
test('lê colunas em sequência, separa pagamentos e previsões das compras', () => {
  const pages = [page(['Itaú', 'Resumo da fatura em R$', 'Vencimento: 08/09/2026', 'Total desta fatura 160,00']), page(['Pagamentos efetuados', 'DATA VALOR', '06/08 PAGAMENTO -500,00', 'Lançamentos: compras e saques', 'PESSOA EXEMPLO', 'DATA ESTABELECIMENTO VALOR', '10/08 LOJA UM 01/03 100,00', 'outros CIDADE'], ['Lançamentos: compras e saques', 'DATA ESTABELECIMENTO VALOR', '12/08 MERCADO 50,00', 'supermercado CIDADE', 'Lançamentos no cartão 150,00', 'Lançamentos: produtos e serviços', 'DATA PRODUTOS/SERVIÇOS VALOR', '18/08 SERVICO 10,00', 'Lançamentos produtos e serviços 10,00']), page(['Compras parceladas - próximas faturas', 'DATA ESTABELECIMENTO VALOR', '10/08 LOJA UM 02/03 99,99', 'Próxima fatura 99,99', 'Demais faturas 100,00', 'Limites de crédito'])];
  assert.ok(pageLines(pages[1]).indexOf('10/08 LOJA UM 01/03 100,00') < pageLines(pages[1]).indexOf('12/08 MERCADO 50,00'));
  const bill = parseItau(pages, 'sample.pdf', 'sample');
  assert.equal(bill.transactions.length, 3);
  assert.equal(sum(bill.transactions), 16000);
  assert.equal(bill.transactions[0].holder, 'PESSOA EXEMPLO');
  assert.equal(bill.transactions[0].nextCents, 9999);
  assert.equal(forecast(bill)[0].cents, 9999);
});
test('rejeita PDF de outro formato', () => assert.throws(() => parseItau([page(['Documento qualquer'])], 'bad.pdf', 'bad')));
test('encargos do resumo entram somente quando fecham a diferença e não são duplicados', () => {
  const first = page(['Itaú', 'Resumo da fatura em R$', 'Vencimento: 08/09/2026', 'Total desta fatura 110,00']);
  const current = page(['Lançamentos: compras e saques', 'PESSOA EXEMPLO', 'DATA ESTABELECIMENTO VALOR', '10/08 MERCADO 100,00', 'Encargos cobrados nesta fatura', 'Juros do rotativo 15,41 % 10,00', 'Juros de mora 1,00 % am 0,00', 'Novo teto de juros']);
  const bill = parseItau([first, current], 'fees.pdf', 'fees');
  assert.equal(sum(bill.transactions), 11000);
  assert.equal(bill.transactions[1].sharedCost, true);
  assert.equal(bill.transactions[1].cents, 1000);
  const alreadyListed = page(['Lançamentos: compras e saques', 'PESSOA EXEMPLO', 'DATA ESTABELECIMENTO VALOR', '10/08 MERCADO 100,00', '11/08 JUROS ROTATIVO 10,00', 'Encargos cobrados nesta fatura', 'Juros do rotativo 15,41 % 10,00', 'Novo teto de juros']);
  const repeated = parseItau([first, alreadyListed], 'fees.pdf', 'fees');
  assert.equal(repeated.transactions.length, 2);
  assert.equal(sum(repeated.transactions), 11000);
});
test('fatura real fornecida: reconcilia compras e parcelas futuras sem duplicidade', { skip: !process.env.ITAU_TEST_PDF }, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(process.env.ITAU_TEST_PDF!)), useSystemFonts: true });
  const doc = await task.promise;
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n), content = await p.getTextContent();
      pages.push({ width: p.getViewport({ scale: 1 }).width, parts: content.items.flatMap(i => 'str' in i ? [{ text: i.str, x: i.transform[4], y: i.transform[5], width: i.width }] : []) });
    }
    const bill = parseItau(pages, 'sample.pdf', 'real-test');
    assert.equal(bill.total, 772319);
    assert.equal(sum(bill.transactions), 772319);
    assert.deepEqual(bill.holderTotals.map(h => h.cents), [296298, 471538]);
    for (const holder of bill.holderTotals) assert.equal(sum(bill.transactions.filter(t => t.holder === holder.name)), holder.cents);
    assert.equal(sum(bill.transactions.filter(t => t.kind === 'service')), 4483);
    assert.equal(bill.nextTotal, 519541);
    assert.equal(forecast(bill)[0].cents, 519541);
    assert.equal(bill.laterTotal, 841077);
    assert.equal(bill.warnings.length, 0, bill.warnings.join('\n'));
    console.log(`Fatura real: ${bill.transactions.length} lançamentos; totais reconciliados.`);
  } finally { await task.destroy(); }
});
