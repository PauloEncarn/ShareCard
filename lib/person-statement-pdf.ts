import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Person, Statement } from './model';

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pdfText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');

export async function downloadPersonStatement(person: Person, statement: Statement) {
  const items = statement.transactions
    .map(transaction => ({ transaction, cents: transaction.allocations.find(item => item.personId === person.id)?.cents ?? 0 }))
    .filter(item => item.cents !== 0);
  const total = items.reduce((sum, item) => sum + item.cents, 0);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const contact = [person.email, person.phone].filter(Boolean).join(' | ');
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const write = (value: string, x: number, size = 10, font = regular, color = rgb(.06, .1, .2)) => page.drawText(pdfText(value).slice(0, 88), { x, y, size, font, color });
  const footer = () => {
    page.drawLine({ start: { x: 42, y: 58 }, end: { x: 553, y: 58 }, thickness: 1, color: rgb(.15, .39, .92) });
    y = 40;
    write('ShareCard - compartilhe compras, organize pagamentos.', 42, 8, regular, rgb(.38, .45, .57));
  };
  const header = () => {
    page.drawRectangle({ x: 0, y: 760, width: 595, height: 82, color: rgb(.15, .39, .92) });
    y = 798;
    write('ShareCard', 42, 24, bold, rgb(1, 1, 1));
    y = 777;
    write('FATURA INDIVIDUAL', 42, 9, bold, rgb(.86, .93, 1));
    y = 730;
    write(person.name, 42, 20, bold);
    y = 708;
    write(`Vencimento: ${new Date(`${statement.dueDate}T12:00:00`).toLocaleDateString('pt-BR')} | Sua parte: ${money(total)}`, 42, 10);
    if (contact) {
      y = 690;
      write(contact, 42, 9, regular, rgb(.3, .37, .48));
    }
    y = 665;
  };
  const nextPage = () => { footer(); page = pdf.addPage([595, 842]); header(); };

  header();
  if (!items.length) {
    y = 620;
    write('Nenhum lancamento foi atribuido a esta pessoa nesta fatura.', 42, 11, regular, rgb(.3, .37, .48));
  }
  for (const { transaction, cents } of items) {
    if (y < 112) nextPage();
    page.drawLine({ start: { x: 42, y: y + 7 }, end: { x: 553, y: y + 7 }, thickness: .5, color: rgb(.88, .9, .94) });
    write(transaction.merchant, 42, 11, bold);
    write(money(cents), 470, 11, bold);
    y -= 16;
    write(`${transaction.date} | ${transaction.category}${transaction.installment ? ` | Parcela ${transaction.installment.current}/${transaction.installment.total}` : ''}`, 42, 9, regular, rgb(.3, .37, .48));
    y -= 14;
    if (transaction.note) {
      write(`Observacao: ${transaction.note}`, 42, 9, regular, rgb(.3, .37, .48));
      y -= 14;
    }
    y -= 10;
  }
  footer();
  const bytes = await pdf.save();
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `fatura-${person.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${statement.dueDate}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
