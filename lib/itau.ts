import { parseMoney, sum, type Statement, type Transaction } from './model';
export type TextPart = { text: string; x: number; y: number; width: number };
export type PdfPage = { width: number; parts: TextPart[] };
function lines(parts: TextPart[]): string[] {
  const rows: { y: number; parts: TextPart[] }[] = [];
  for (const p of [...parts].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!p.text.trim()) continue;
    const row = rows.find(r => Math.abs(r.y - p.y) < 2);
    if (row) row.parts.push(p); else rows.push({ y: p.y, parts: [p] });
  }
  return rows.sort((a, b) => b.y - a.y).map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' ').replace(/\s+/g, ' ').trim());
}
export function pageLines(page: PdfPage, columns = true): string[] {
  if (!columns) return lines(page.parts);
  const headers = page.parts.filter(p => /^DATA(?:\s|$)/.test(p.text.trim())).map(p => p.x);
  const starts = [...new Set(headers.map(x => Math.round(x)))].sort((a, b) => a - b);
  if (starts.length < 2 || starts.at(-1)! - starts[0] < page.width * .2) return lines(page.parts);
  const divider = starts.at(-1)! - 6;
  return [...lines(page.parts.filter(p => p.x < divider)), ...lines(page.parts.filter(p => p.x >= divider))];
}
const amountEnd = /(-?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*$/;
const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
function getAmount(line: string) { const m = line.match(amountEnd); return m ? parseMoney(m[1]) : undefined; }
export function parseItau(pages: PdfPage[], filename: string, fingerprint: string): Statement {
  const first = pageLines(pages[0], false), text = first.join('\n');
  if (!/Ita[uú]/i.test(text) || !/Resumo da fatura/i.test(text)) throw new Error('Este PDF não corresponde ao modelo Itaú suportado. Use uma fatura digital com texto selecionável.');
  const dateMatch = text.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!dateMatch) throw new Error('Não foi possível identificar o vencimento.');
  const total = first.map(l => /Total desta fatura/.test(l) ? getAmount(l) : undefined).find(v => v !== undefined);
  if (total === undefined) throw new Error('Não foi possível identificar o total da fatura.');
  const statement: Statement = { id: fingerprint, fingerprint, filename, dueDate: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`, total, transactions: [], holderTotals: [], warnings: [], importedAt: new Date().toISOString() };
  let section: 'none' | 'current' | 'services' | 'future' = 'none';
  let holder = 'Portador não identificado', last: Transaction | undefined;
  const future: Transaction[] = [];
  const chargeSummary = new Map<string, number>();
  let readingCharges = false;
  for (const page of pages.slice(1)) {
    const content = pageLines(page);
    for (let i = 0; i < content.length; i++) {
      const line = content[i];
      if (/Encargos cobrados nesta fatura/i.test(line)) { readingCharges = true; section = 'none'; last = undefined; continue; }
      if (/Novo teto|Fique atento|Simula[çc][aã]o|Limites de cr[eé]dito|Lan[çc]amentos:|Compras parceladas/i.test(line)) readingCharges = false;
      if (readingCharges) {
        const label = line.match(/^(Juros do rotativo|Juros de mora|Multa por atraso|IOF de financiamento)/i)?.[1];
        const value = getAmount(line);
        if (label && value !== undefined && value !== 0) chargeSummary.set(label, value);
        continue;
      }
      if (/Compras parceladas\s*-?\s*pr[oó]ximas faturas/i.test(line)) { section = 'future'; last = undefined; continue; }
      if (/Lan[çc]amentos:\s*produtos e servi[çc]os/i.test(line)) { section = 'services'; last = undefined; continue; }
      if (/Lan[çc]amentos:\s*compras e saques/i.test(line)) { section = 'current'; last = undefined; continue; }
      if (/Pagamentos efetuados|Limites de cr[eé]dito|Encargos cobrados|Novo teto|Fique atento|Simula[çc][aã]o/i.test(line)) { section = 'none'; last = undefined; continue; }
      if (/^Pr[oó]xima fatura\s/.test(line)) { statement.nextTotal = getAmount(line); section = 'none'; continue; }
      if (/^Demais faturas\s/.test(line)) { statement.laterTotal = getAmount(line); continue; }
      if (/^Lan[çc]amentos no cart[aã]o/.test(line)) { const cents = getAmount(line); if (cents !== undefined) statement.holderTotals.push({ name: holder, cents }); last = undefined; continue; }
      if (/^(?:L\s*)?Total dos lan[çc]amentos|^Lan[çc]amentos produtos/.test(line)) { section = 'none'; last = undefined; continue; }
      if (section === 'current' && /^[A-ZÀ-Ü][A-ZÀ-Ü .]{6,}$/.test(line) && !/DATA|ESTABELECIMENTO|VALOR|CONTINUA/.test(line) && /^DATA/.test(content[i + 1] ?? '')) { holder = line; last = undefined; continue; }
      if (section === 'none') continue;
      const row = line.match(/^(\d{2}\/\d{2})\s+(.+?)\s+(-?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})$/);
      if (row) {
        let merchant = row[2];
        const installment = merchant.match(/\s+(\d{2})\/(\d{2})$/);
        if (installment) merchant = merchant.slice(0, installment.index).trim();
        const t: Transaction = { id: `${fingerprint.slice(0, 12)}-${section}-${statement.transactions.length}-${future.length}`, date: row[1], merchant, cents: parseMoney(row[3]), holder: section === 'services' ? 'Serviços do cartão' : holder, category: section === 'services' ? 'Serviços do cartão' : 'Outros', kind: section === 'services' ? 'service' : 'purchase', allocations: [], carryForward: true };
        if (/^(JUROS\b|ENCARGOS\b|IOF\b|MULTA\b|ANUIDADE\b|TARIFA\b)/i.test(merchant)) { t.kind = 'service'; t.sharedCost = true; }
        if (installment) {
          const current = Number(installment[1]), total = Number(installment[2]);
          if (current > 0 && current <= total) t.installment = { current, total };
          else statement.warnings.push(`Parcela inválida em ${merchant}. Confira o lançamento.`);
        }
        (section === 'future' ? future : statement.transactions).push(t); last = t;
      } else if (/^\d{2}\/\d{2}\s/.test(line)) { statement.warnings.push(`Linha não reconhecida: ${line}`); last = undefined; }
      else if (last && /^(supermercado|servi[çc]os|vestu[aá]rio|sa[uú]de|outros|casa|educa[çc][aã]o|eletr[oô]nicos|RETAIL|HEALTH)\b/i.test(line)) {
        const category = line.split(/\s+/)[0]; last.category = category === 'HEALTH' ? 'Saúde' : category === 'RETAIL' ? 'Compras' : category.charAt(0).toUpperCase() + category.slice(1);
      }
    }
  }
  // Some layouts list charged interest only in the summary. Add it only when it closes
  // the exact deficit: summaries can also repeat charges already listed as transactions.
  const deficit = total - sum(statement.transactions);
  if (deficit !== 0 && chargeSummary.size && [...chargeSummary.values()].reduce((n, c) => n + c, 0) === deficit) {
    for (const [merchant, cents] of chargeSummary) statement.transactions.push({ id: `${fingerprint.slice(0, 12)}-charge-${statement.transactions.length}`, date: `${dateMatch[1]}/${dateMatch[2]}`, merchant, cents, holder: 'Gastos gerais', category: 'Encargos', kind: 'service', sharedCost: true, allocations: [], carryForward: false, note: 'Extraído do resumo de encargos. Data de referência: vencimento da fatura.' });
  }
  const used = new Set<string>();
  for (const t of statement.transactions) {
    if (!t.installment || t.installment.current === t.installment.total) continue;
    const candidates = future.filter(f => !used.has(f.id) && f.date === t.date && normalize(f.merchant) === normalize(t.merchant) && f.installment?.current === t.installment!.current + 1 && f.installment?.total === t.installment!.total && Math.abs(f.cents - t.cents) <= 10);
    if (candidates.length === 1) { t.nextCents = candidates[0].cents; used.add(candidates[0].id); }
    else statement.warnings.push(`Próxima parcela de ${t.merchant}: valor estimado; associação não confirmada.`);
  }
  if (!statement.transactions.length) throw new Error('Nenhum lançamento identificado. PDFs escaneados ainda não são suportados.');
  if (sum(statement.transactions) !== total) statement.warnings.push('A soma dos lançamentos não fecha com o total. Revise antes de salvar.');
  if (statement.nextTotal !== undefined && sum(future) !== statement.nextTotal) statement.warnings.push('A leitura das parcelas futuras diverge do resumo do banco.');
  return statement;
}
