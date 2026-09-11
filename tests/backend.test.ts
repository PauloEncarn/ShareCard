import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, type Account, authorize, avatarObjectKey, documentKey, dueDate, dueDay, hashPassword, checkPassword, publicAccount, validateAvatar, validatePdf } from '../lib/backend/domain';
import { Backend } from '../lib/backend/service';
import type { Store } from '../lib/backend/store';

const master: Account = { id: 'a', masterId: 'a', role: 'master', name: 'A', email: 'a@example.com', passwordHash: '', active: true };
test('tenant isolation: buyer reads own master, cannot write or cross masters', () => {
  const buyer: Account = { ...master, id: 'b', role: 'buyer' };
  authorize(buyer, 'a');
  assert.throws(() => authorize(buyer, 'a', true), ApiError);
  assert.throws(() => authorize(buyer, 'other'), ApiError);
  assert.throws(() => authorize({ ...buyer, active: false }, 'a'), ApiError);
  authorize(master, 'a', true);
});
test('full due dates and cards produce distinct keys and reject traversal', () => {
  assert.notEqual(documentKey('a', 'card', '2026-09-06', 'id'), documentKey('a', 'card', '2026-09-20', 'id'));
  assert.notEqual(documentKey('a', 'card', '2026-09-06', 'id'), documentKey('a', 'other', '2026-09-06', 'id'));
  assert.throws(() => documentKey('../other', 'card', '2026-09-06', 'id'));
  assert.throws(() => dueDate('2026-02-30'));
  assert.equal(dueDate('2028-02-29'), '2028-02-29');
  assert.throws(() => dueDay(0)); assert.throws(() => dueDay(32));
});
test('avatars use the master prefix and only accept verified raster formats', () => {
  assert.equal(avatarObjectKey('a', 'buyer_1'), 'masters/a/profiles/buyer_1/avatar');
  assert.throws(() => avatarObjectKey('../other', 'buyer'));
  assert.equal(validateAvatar(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg'), 'image/jpeg');
  assert.throws(() => validateAvatar(Buffer.from('<svg></svg>'), 'image/svg+xml'), ApiError);
});
test('passwords use salts and verification; public account excludes password', async () => {
  const one = await hashPassword('minha-senha-de-teste'), two = await hashPassword('minha-senha-de-teste');
  assert.notEqual(one, two);
  assert.equal(await checkPassword('minha-senha-de-teste', one), true);
  assert.equal(await checkPassword('outra-senha-de-teste', one), false);
  assert.equal('passwordHash' in publicAccount({ ...master, passwordHash: one }), false);
});
test('upload rejects invalid PDF and buyer writes before touching S3', async () => {
  assert.throws(() => validatePdf(Buffer.from('<html>')));
  const service = new Backend({} as Store);
  await assert.rejects(service.upload({ ...master, role: 'buyer' }, 'card', '2026-09-06', Buffer.from('%PDF-test')), { status: 403 });
});
test('download queries only authenticated master and missing file never touches S3', async () => {
  const keys: string[] = [];
  const service = new Backend({ get: async (pk: string) => { keys.push(pk); return undefined; } } as unknown as Store);
  await assert.rejects(service.download(master, 'other-master-file'), { status: 404 });
  assert.deepEqual(keys, ['MASTER#a']);
});
test('revocation blocks existing sessions immediately', async () => {
  const service = new Backend({ get: async (pk: string) => pk.startsWith('SESSION#') ? { userId: 'b', expiresAt: Math.floor(Date.now() / 1000) + 60 } : { ...master, id: 'b', role: 'buyer', active: false } } as unknown as Store);
  await assert.rejects(service.authenticate('a'.repeat(64)), { status: 401 });
});
test('buyer can download complete own master PDF', async () => {
  const content = Buffer.from('%PDF-ficticio');
  const service = new Backend({ get: async () => ({ id: 'doc', masterId: 'a', dueDate: '2026-09-20', key: 'masters/a/document.pdf' }), aws: { bucket: 'private', s3: { send: async () => ({ Body: { transformToByteArray: async () => content } }) } } } as unknown as Store);
  const result = await service.download({ ...master, id: 'b', role: 'buyer' }, 'doc');
  assert.deepEqual(result.bytes, content);
});
test('expired or wrong-email invitations never create accounts', async () => {
  const service = new Backend({ get: async () => ({ masterId: 'a', email: 'expected@example.com', expiresAt: 0 }) } as unknown as Store);
  await assert.rejects(service.register({ name: 'Pessoa', email: 'other@example.com', password: 'senha-de-teste-longa', inviteToken: 'abc' }), { status: 400 });
});
