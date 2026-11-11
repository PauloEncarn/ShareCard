import { parseMoney, sum, type Statement, type Transaction } from './model';
import { pageLines, type PdfPage } from './itau';

const monthNumber: Record<string, string> = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06',
  JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12',
};

const amountAtEnd = /((?:−|-)?\s*(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*$/;
const value = (line: string) => {
  const match = line.match(amountAtEnd);
  return match ? parseMoney(match[1].replace('−', '-').replace(/R\$\s*/i, '')) : undefined;
};
const normalizeHolder = (holder: string) => holder.replace(/\s+/g, ' ').trim();

function nubankDate(text: string) {
  const match = text.match(/Data de vencimento:\s*(\d{2})\s+([A-ZÇ]{3})\s+(\d{4})/i);
  if (!match || !monthNumber[match[2].toUpperCase()]) return undefined;
  return `${match[3]}-${monthNumber[match[2].toUpperCase()]}-${match[1]}`;
}

/** Parses Nubank's text-based monthly credit card statement. */
export function parseNubank(pages: PdfPage[], filename: string, fingerprint: string): Statement {
  const allLines = pages.flatMap(page => pageLines(page, false));
  const text = allLines.join('\n');
  const dueDate = nubankDate(text);
  if (!dueDate || !/TRANSA[ÇC][ÕO]ES/i.test(text) || !/Nu Pagamentos|Nubank/i.test(text)) {
    throw new Error('Este PDF não corresponde ao modelo Nubank suportado. Use uma fatura digital com texto selecionável.');
  }
  const summaryStart = allLines.findIndex(line => /^RESUMO DA FATURA ATUAL$/i.test(line));
  const total = (summaryStart >= 0 ? allLines.slice(summaryStart + 1) : allLines)
    .map(line => /^Total a pagar\b/i.test(line) ? value(line) : undefined)
    .find((amount): amount is number => amount !== undefined);
  if (total === undefined) throw new Error('Não foi possível identificar o total da fatura Nubank.');

  const statement: Statement = {
    id: fingerprint,
    fingerprint,
    filename,
    dueDate,
    total,
    card: { issuer: 'Nubank', dueDay: Number(dueDate.slice(-2)) },
    transactions: [],
    holderTotals: [],
    warnings: [],
    importedAt: new Date().toISOString(),
  };

  let readingTransactions = false;
  let holder = 'Titular não identificado';
  let otherLaunches: number | undefined;
  let sawSeveralCards = false;
  const cardEnds = new Set<string>();

  for (const line of allLines) {
    if (/^PR[ÓO]XIMAS FATURAS/i.test(line)) { readingTransactions = false; continue; }
    if (/^Saldo em aberto da pr[óo]xima fatura/i.test(line)) { statement.nextTotal = value(line); continue; }
    if (/^Saldo em aberto total/i.test(line)) { statement.laterTotal = value(line); continue; }
    if (/^Outros lan[çc]amentos/i.test(line)) { otherLaunches = value(line); continue; }
    if (/^TRANSA[ÇC][ÕO]ES\b/i.test(line)) { readingTransactions = true; continue; }
    if (/^Pagamentos\b/i.test(line)) { readingTransactions = false; continue; }
    if (!readingTransactions) continue;

    const holderMatch = line.match(/^(.+?)\s+R\$\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/i);
    if (holderMatch && !/^\d{2}\s+[A-ZÇ]{3}\b/.test(line) && !/^Estorno\b/i.test(line)) {
      holder = normalizeHolder(holderMatch[1]);
      const cents = value(line);
      if (cents !== undefined) statement.holderTotals.push({ name: holder, cents });
      continue;
    }

    const row = line.match(/^(\d{2})\s+([A-ZÇ]{3})\s+(?:(?:••••\s+(\d{4})\s+)?)(.+?)\s+((?:−|-)?\s*R?\$?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})$/i);
    if (!row) continue;
    const month = monthNumber[row[2].toUpperCase()];
    if (!month) continue;
    const cents = parseMoney(row[5].replace(/[−]/g, '-').replace(/R\$\s*/i, ''));
    const last4 = row[3];
    if (last4) { cardEnds.add(last4); sawSeveralCards ||= cardEnds.size > 1; }
    let merchant = row[4].trim();
    const installmentMatch = merchant.match(/\s+-\s+Parcela\s+(\d{1,2})\/(\d{1,2})$/i);
    if (installmentMatch) merchant = merchant.slice(0, installmentMatch.index).trim();
    const isRefund = /^Estorno\b/i.test(merchant);
    const transaction: Transaction = {
      id: `${fingerprint.slice(0, 12)}-nubank-${statement.transactions.length}`,
      date: `${row[1]}/${month}`,
      merchant,
      cents,
      holder,
      category: isRefund ? 'Estorno' : 'Outros',
      kind: 'purchase',
      allocations: [],
      carryForward: !isRefund,
    };
    if (installmentMatch) {
      const current = Number(installmentMatch[1]), installmentTotal = Number(installmentMatch[2]);
      if (current > 0 && current <= installmentTotal) transaction.installment = { current, total: installmentTotal };
      else statement.warnings.push(`Parcela inválida em ${merchant}. Confira o lançamento.`);
    }
    statement.transactions.push(transaction);
  }

  if (!statement.transactions.length) throw new Error('Nenhuma transação Nubank foi identificada. PDFs escaneados ainda não são suportados.');
  if (otherLaunches && otherLaunches !== 0) {
    statement.transactions.push({
      id: `${fingerprint.slice(0, 12)}-nubank-other`,
      date: dueDate.slice(8, 10) + '/' + dueDate.slice(5, 7),
      merchant: 'Outros lançamentos',
      cents: otherLaunches,
      holder: 'Gastos gerais',
      category: 'Encargos',
      kind: 'service',
      sharedCost: true,
      allocations: [],
      carryForward: false,
      note: 'Valor informado no resumo da fatura Nubank.',
    });
  }
  if (sawSeveralCards) statement.warnings.push('A fatura Nubank possui lançamentos de mais de um cartão final. Confirme o cartão correto antes de salvar.');
  if (sum(statement.transactions) !== total) statement.warnings.push('O total a pagar da Nubank também considera fatura anterior e pagamentos recebidos. O ShareCard importou somente as transações do período para organizar.');
  return statement;
}
