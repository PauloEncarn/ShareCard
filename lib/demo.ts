import type { AppState, Transaction } from './model';
export function demoState(): AppState {
  const people = [{ id: 'ana', name: 'Ana', color: '#5263df' }, { id: 'bruno', name: 'Bruno', color: '#149c87' }, { id: 'clara', name: 'Clara', color: '#e18b31' }];
  const data: [string, string, number, string, string, number?, number?][] = [
    ['03/08', 'Mercado do bairro', 38652, 'Supermercado', 'ana'], ['05/08', 'Loja de móveis', 24990, 'Casa', 'bruno', 3, 8],
    ['08/08', 'Livraria da praça', 8990, 'Educação', 'clara'], ['09/08', 'Farmácia Central', 6743, 'Saúde', 'ana'],
    ['12/08', 'Notebook', 32990, 'Eletrônicos', 'bruno', 2, 10], ['14/08', 'Restaurante do centro', 18600, 'Alimentação', ''],
    ['17/08', 'Tênis e companhia', 11990, 'Vestuário', 'clara', 1, 3], ['21/08', 'Cinema', 8400, 'Lazer', ''],
    ['23/08', 'Mercado do bairro', 22138, 'Supermercado', 'ana'], ['25/08', 'Cafeteria', 4250, 'Alimentação', ''],
    ['27/08', 'Curso de fotografia', 14900, 'Educação', 'clara', 1, 4], ['28/08', 'Serviço do cartão', 1990, 'Serviços', ''],
  ];
  const transactions: Transaction[] = data.map(([date, merchant, cents, category, person, current, total], i) => ({ id: `demo-${i}`, date, merchant, cents, category, holder: person === 'bruno' ? 'Bruno' : 'Ana', kind: i === 11 ? 'service' : 'purchase', allocations: person ? [{ personId: person, cents }] : [], carryForward: true, ...(current && total ? { installment: { current, total }, nextCents: cents } : {}) }));
  return { version: 1, people, activeId: 'demo', statements: [{ id: 'demo', fingerprint: 'demo', filename: 'Exemplo fictício', dueDate: '2026-09-08', total: transactions.reduce((n, t) => n + t.cents, 0), nextTotal: 84870, transactions, holderTotals: [], warnings: [], importedAt: new Date().toISOString() }] };
}
