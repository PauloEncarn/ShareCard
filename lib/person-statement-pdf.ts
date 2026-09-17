import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Person, Statement } from './model';

const pageSize: [number, number] = [595, 842];
const navy = rgb(.06, .1, .2), blue = rgb(.15, .39, .92), teal = rgb(.08, .72, .65), purple = rgb(.55, .36, .95), orange = rgb(.98, .45, .09), slate = rgb(.34, .4, .52), line = rgb(.88, .9, .94);
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pdfText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');

export async function downloadPersonStatement(person: Person, statement: Statement) {
  const items = statement.transactions
    .map(transaction => ({ transaction, cents: transaction.allocations.find(item => item.personId === person.id)?.cents ?? 0 }))
    .filter(item => item.cents !== 0);
  const total = items.reduce((sum, item) => sum + item.cents, 0);
  const categories = new Set(items.map(item => item.transaction.category)).size;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fatura individual - ${person.name}`);
  pdf.setAuthor('ShareCard');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const contact = [person.email, person.phone].filter(Boolean).join(' | ');
  let page = pdf.addPage(pageSize);
  let y = 650;
  let pageNumber = 1;
  const write = (value: string, x: number, size = 10, font = regular, color = navy) => page.drawText(pdfText(value).slice(0, 88), { x, y, size, font, color });
  const logo = () => {
    [[blue, 42, 790], [teal, 57, 790], [purple, 42, 775], [orange, 57, 775]].forEach(([color, x, top]) => page.drawRectangle({ x: x as number, y: top as number, width: 12, height: 12, color: color as ReturnType<typeof rgb> }));
    y = 783;
    write('ShareCard', 78, 17, bold, rgb(1, 1, 1));
  };
  const footer = () => {
    page.drawLine({ start: { x: 42, y: 52 }, end: { x: 553, y: 52 }, thickness: .8, color: line });
    y = 35;
    write('ShareCard  |  Compartilhe compras. Organize pagamentos.', 42, 8, regular, slate);
    write(`Pagina ${pageNumber}`, 510, 8, regular, slate);
  };
  const header = (withSummary: boolean) => {
    page.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: navy });
    page.drawRectangle({ x: 0, y: 742, width: 9, height: 100, color: blue });
    logo();
    y = 758;
    write('FATURA INDIVIDUAL', 397, 9, bold, rgb(.75, .83, 1));
    y = 716;
    write(person.name, 42, 22, bold);
    y = 695;
    write(`Vencimento ${new Date(`${statement.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}`, 42, 10, regular, slate);
    if (contact) { y = 678; write(contact, 42, 9, regular, slate); }
    if (withSummary) {
      page.drawRectangle({ x: 42, y: 590, width: 511, height: 64, color: rgb(.96, .98, 1), borderColor: line, borderWidth: 1 });
      y = 630; write('SUA PARTE NESTA FATURA', 57, 8, bold, slate); y = 607; write(money(total), 57, 19, bold, blue);
      y = 630; write('LANCAMENTOS', 292, 8, bold, slate); y = 607; write(String(items.length), 292, 19, bold, navy);
      y = 630; write('CATEGORIAS', 424, 8, bold, slate); y = 607; write(String(categories), 424, 19, bold, navy);
      y = 565;
    } else y = 650;
  };
  const tableHeader = () => {
    page.drawRectangle({ x: 42, y: y - 2, width: 511, height: 23, color: rgb(.94, .96, 1) });
    y -= 17;
    write('COMPRA', 52, 8, bold, slate); write('DATA', 322, 8, bold, slate); write('SUA PARTE', 455, 8, bold, slate);
    y -= 16;
  };
  const nextPage = () => { footer(); page = pdf.addPage(pageSize); pageNumber += 1; header(false); tableHeader(); };

  header(true);
  tableHeader();
  if (!items.length) {
    y -= 24;
    write('Nenhum lancamento foi atribuido a esta pessoa nesta fatura.', 42, 11, regular, slate);
  }
  for (const { transaction, cents } of items) {
    const needsNote = Boolean(transaction.note);
    if (y < (needsNote ? 118 : 101)) nextPage();
    page.drawLine({ start: { x: 42, y: y + 6 }, end: { x: 553, y: y + 6 }, thickness: .6, color: line });
    write(transaction.merchant, 52, 10.5, bold);
    write(transaction.date, 322, 9, regular, slate);
    write(money(cents), 455, 10.5, bold, blue);
    y -= 16;
    write(`${transaction.category}${transaction.installment ? `  |  Parcela ${transaction.installment.current}/${transaction.installment.total}` : '  |  A vista'}`, 52, 8.5, regular, slate);
    y -= 14;
    if (transaction.note) { write(`Observacao: ${transaction.note}`, 52, 8.5, regular, slate); y -= 14; }
    y -= 8;
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
