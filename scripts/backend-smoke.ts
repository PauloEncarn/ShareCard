import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run against a local server + initialized Floci. Creates isolated synthetic fixtures.
const base = 'http://127.0.0.1:3000/api/backend';
async function call(path: string, input?: object, token?: string, expected = 200) {
  const response = await fetch(`${base}/${path}`, { method: input ? 'POST' : 'GET', headers: { ...(input ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: input ? JSON.stringify(input) : undefined });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
  return response.json();
}
async function main() {
  const run = randomUUID(), password = randomUUID();
  const masterEmail = `master-${run}@example.com`, buyerEmail = `buyer-${run}@example.com`;
  await call('register', { name: 'Master de teste', email: masterEmail, password }, undefined, 201);
  const master = await call('login', { email: masterEmail, password });
  const invite = await call('invites', { email: buyerEmail }, master.token, 201);
  await call('register', { name: 'Comprador de teste', email: buyerEmail, password, inviteToken: invite.token }, undefined, 201);
  const buyer = await call('login', { email: buyerEmail, password });
  assert.equal(buyer.account.masterId, master.account.id);
  const card = await call('cards', { name: 'Cartão 06', dueDay: 6 }, master.token, 201);
  const card20 = await call('cards', { name: 'Cartão 20', dueDay: 20 }, master.token, 201);
  await call('cards', { name: 'Não permitido', dueDay: 6 }, buyer.token, 403);
  // Minimal synthetic payload; this exercises transport/storage, not the PDF parser.
  const bytes = Buffer.from('%PDF-1.4\n% Synthetic integration fixture\n%%EOF');
  async function upload(cardId: string, dueDate: string, expected: number) {
    const response = await fetch(`${base}/documents?cardId=${cardId}&dueDate=${dueDate}`, { method: 'POST', headers: { Authorization: `Bearer ${master.token}`, 'Content-Type': 'application/pdf' }, body: bytes });
    assert.equal(response.status, expected, await response.clone().text()); return response.json();
  }
  const document = await upload(card.id, '2026-09-06', 201);
  await upload(card.id, '2026-09-06', 409);
  await upload(card20.id, '2026-09-20', 201);
  const documents = await call('documents', undefined, buyer.token);
  assert.deepEqual(documents.map((d: { dueDate: string }) => d.dueDate), ['2026-09-20', '2026-09-06']);
  const download = await fetch(`${base}/documents/${document.id}`, { headers: { Authorization: `Bearer ${buyer.token}` } });
  assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const otherEmail = `other-${run}@example.com`;
  await call('register', { name: 'Outro master', email: otherEmail, password }, undefined, 201);
  const other = await call('login', { email: otherEmail, password });
  await call(`documents/${document.id}`, undefined, other.token, 404);
  await call('members/revoke', { userId: buyer.account.id }, master.token);
  await call('documents', undefined, buyer.token, 401);
  await call('logout', {}, master.token);
  await call('me', undefined, master.token, 401);
  await call('logout', {}, other.token);
  console.log('Integração aprovada: dois masters isolados, comprador, PDFs, vencimentos 06/20, duplicidade e revogação. Dados fictícios permanecem no volume Floci.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
