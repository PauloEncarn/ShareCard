import { parseItau, type PdfPage } from './itau';
export async function readStatement(file: File) {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Selecione um arquivo PDF.');
  if (file.size > 15 * 1024 * 1024) throw new Error('O PDF deve ter no máximo 15 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('O arquivo não é um PDF válido.');
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
  let pdfjs: typeof import('pdfjs-dist');
  try {
    pdfjs = await import('pdfjs-dist');
  } catch {
    throw new Error('Não foi possível preparar a leitura do PDF. Atualize a página e tente novamente.');
  }
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const doc = await task.promise;
    if (doc.numPages > 30) throw new Error('Este importador aceita faturas de até 30 páginas.');
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n), content = await page.getTextContent();
      pages.push({ width: page.getViewport({ scale: 1 }).width, parts: content.items.flatMap(item => 'str' in item ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }] : []) });
    }
    return parseItau(pages, file.name, fingerprint);
  } catch (e) {
    if (e instanceof Error && e.name === 'PasswordException') throw new Error('Este PDF tem senha. Exporte uma cópia sem senha para importar.');
    if (e instanceof Error && /worker|dynamically imported module|network/i.test(e.message)) throw new Error('Não foi possível carregar o leitor de PDF. Atualize a página e tente novamente.');
    throw e;
  } finally { await task.destroy(); }
}
