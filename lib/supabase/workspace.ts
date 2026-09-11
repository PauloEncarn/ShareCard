import { createHash, randomBytes } from 'node:crypto';
import { createSupabaseAdminClient } from './admin';
import { IdentityError, type SupabaseAccount } from './identity';

type CardRow = { id: string; master_id: string; name: string; due_day: number; created_at: string };
type PersonRow = { id: string; master_id: string; account_id: string | null; name: string; color: string; monthly_limit_cents: number | null; version: number; created_at: string; updated_at: string };
type ProfileRow = { id: string; master_id: string; role: 'master' | 'buyer'; name: string; active: boolean };
type StatementRow = { id: string; master_id: string; card_id: string; due_date: string; filename: string; storage_path: string; sha256: string; size_bytes: number; created_at: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const code = () => randomBytes(32).toString('hex');
const text = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new IdentityError(400, `${label} invÃ¡lido.`);
  return value.trim();
};
const day = (value: unknown) => {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31) throw new IdentityError(400, 'Dia de vencimento invÃ¡lido.');
  return value as number;
};
const cents = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new IdentityError(400, 'Meta invÃ¡lida.');
  return value as number;
};
const publicCard = (row: CardRow) => ({ id: row.id, masterId: row.master_id, name: row.name, dueDay: row.due_day, createdAt: row.created_at });
const publicPerson = (row: PersonRow) => ({ id: row.id, masterId: row.master_id, accountId: row.account_id, name: row.name, color: row.color, monthlyLimitCents: row.monthly_limit_cents, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
const publicMember = (row: ProfileRow, email: string) => ({ id: row.id, masterId: row.master_id, role: row.role, name: row.name, email, active: row.active, avatarUrl: null });
const publicDocument = (row: StatementRow) => ({ id: row.id, masterId: row.master_id, cardId: row.card_id, dueDate: row.due_date, size: row.size_bytes, sha256: row.sha256, createdAt: row.created_at });

function masterOnly(account: SupabaseAccount) {
  if (account.role !== 'master' || account.id !== account.masterId) throw new IdentityError(403, 'Acesso permitido somente ao master.');
}

export async function cards(account: SupabaseAccount) {
  const result = await createSupabaseAdminClient().from('cards').select('id, master_id, name, due_day, created_at').eq('master_id', account.masterId).order('due_day').returns<CardRow[]>();
  if (result.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel consultar os cartÃµes.');
  return (result.data || []).map(publicCard);
}

export async function createCard(account: SupabaseAccount, input: Record<string, unknown>) {
  masterOnly(account);
  const result = await createSupabaseAdminClient().from('cards').insert({ master_id: account.masterId, name: text(input.name, 'Nome do cartÃ£o', 100), due_day: day(input.dueDay) }).select('id, master_id, name, due_day, created_at').single<CardRow>();
  if (result.error || !result.data) throw new IdentityError(503, 'NÃ£o foi possÃ­vel criar o cartÃ£o.');
  return publicCard(result.data);
}

export async function people(account: SupabaseAccount) {
  const result = await createSupabaseAdminClient().from('people').select('id, master_id, account_id, name, color, monthly_limit_cents, version, created_at, updated_at').eq('master_id', account.masterId).order('name').returns<PersonRow[]>();
  if (result.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel consultar as pessoas.');
  const rows = result.data || [];
  return (account.role === 'master' ? rows : rows.filter(row => row.account_id === account.id)).map(publicPerson);
}

export async function savePerson(account: SupabaseAccount, input: Record<string, unknown>, id?: string) {
  masterOnly(account);
  const admin = createSupabaseAdminClient();
  const accountId = input.accountId === undefined || input.accountId === null || input.accountId === '' ? null : text(input.accountId, 'Conta', 80);
  if (accountId) {
    const member = await admin.from('profiles').select('id, master_id, role, name, active').eq('id', accountId).single<ProfileRow>();
    if (member.error || !member.data || member.data.master_id !== account.masterId || member.data.role !== 'buyer') throw new IdentityError(400, 'A conta escolhida nÃ£o pertence a este grupo.');
  }
  const value = { master_id: account.masterId, account_id: accountId, name: text(input.name, 'Nome', 80), color: typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#2563EB', monthly_limit_cents: cents(input.monthlyLimitCents), updated_at: new Date().toISOString() };
  if (!id) {
    const inserted = await admin.from('people').insert(value).select('id, master_id, account_id, name, color, monthly_limit_cents, version, created_at, updated_at').single<PersonRow>();
    if (inserted.error || !inserted.data) throw new IdentityError(503, 'NÃ£o foi possÃ­vel criar a pessoa.');
    return publicPerson(inserted.data);
  }
  const version = input.version;
  if (!Number.isInteger(version) || (version as number) < 1) throw new IdentityError(400, 'VersÃ£o invÃ¡lida.');
  const updated = await admin.from('people').update({ ...value, version: (version as number) + 1 }).eq('id', id).eq('master_id', account.masterId).eq('version', version as number).select('id, master_id, account_id, name, color, monthly_limit_cents, version, created_at, updated_at').maybeSingle<PersonRow>();
  if (updated.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel atualizar a pessoa.');
  if (!updated.data) throw new IdentityError(409, 'Esta pessoa foi alterada por outra pessoa. Atualize a tela e tente novamente.');
  return publicPerson(updated.data);
}

export async function members(account: SupabaseAccount) {
  masterOnly(account);
  const admin = createSupabaseAdminClient();
  const profiles = await admin.from('profiles').select('id, master_id, role, name, active').eq('master_id', account.masterId).returns<ProfileRow[]>();
  if (profiles.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel consultar os membros.');
  const users = await Promise.all((profiles.data || []).map(async profile => {
    const user = await admin.auth.admin.getUserById(profile.id);
    return publicMember(profile, user.data.user?.email || '');
  }));
  return users;
}

export async function invite(account: SupabaseAccount, rawEmail: unknown) {
  masterOnly(account);
  const email = text(rawEmail, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IdentityError(400, 'E-mail invÃ¡lido.');
  const token = code(), expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const result = await createSupabaseAdminClient().from('invitations').insert({ master_id: account.masterId, email, token_hash: hash(token), expires_at: expiresAt });
  if (result.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel criar o convite.');
  return { token, expiresAt };
}

export async function revokeMember(account: SupabaseAccount, rawId: unknown) {
  masterOnly(account);
  const id = text(rawId, 'Comprador', 80);
  const result = await createSupabaseAdminClient().from('profiles').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('master_id', account.masterId).eq('role', 'buyer');
  if (result.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel revogar o acesso.');
  return { ok: true };
}

const dueDate = (value: unknown) => {
  const date = text(value, 'Vencimento', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new IdentityError(400, 'Use uma data de vencimento vÃ¡lida.');
  return date;
};

export async function documents(account: SupabaseAccount) {
  const result = await createSupabaseAdminClient().from('statements').select('id, master_id, card_id, due_date, filename, storage_path, sha256, size_bytes, created_at').eq('master_id', account.masterId).order('due_date', { ascending: false }).returns<StatementRow[]>();
  if (result.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel consultar as faturas.');
  return (result.data || []).map(publicDocument);
}

export async function uploadDocument(account: SupabaseAccount, rawCardId: unknown, rawDate: unknown, bytes: Uint8Array, filename = 'fatura.pdf') {
  masterOnly(account);
  if (bytes.length < 5 || bytes.length > 15 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new IdentityError(400, 'Envie um PDF vÃ¡lido de atÃ© 15 MB.');
  const cardId = text(rawCardId, 'CartÃ£o', 80), due = dueDate(rawDate), admin = createSupabaseAdminClient();
  const card = await admin.from('cards').select('id').eq('id', cardId).eq('master_id', account.masterId).maybeSingle();
  if (card.error || !card.data) throw new IdentityError(404, 'CartÃ£o nÃ£o encontrado.');
  const id = crypto.randomUUID(), storagePath = `masters/${account.masterId}/cards/${cardId}/due/${due}/${id}.pdf`, sha256 = createHash('sha256').update(bytes).digest('hex');
  const upload = await admin.storage.from('statements').upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });
  if (upload.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel guardar o PDF.');
  const created = await admin.from('statements').insert({ id, master_id: account.masterId, card_id: cardId, due_date: due, filename: text(filename, 'Nome do arquivo', 255), storage_path: storagePath, sha256, size_bytes: bytes.length, fingerprint: sha256, total_cents: 0 }).select('id, master_id, card_id, due_date, filename, storage_path, sha256, size_bytes, created_at').single<StatementRow>();
  if (created.error || !created.data) {
    await admin.storage.from('statements').remove([storagePath]);
    if (created.error?.code === '23505') throw new IdentityError(409, 'JÃ¡ existe uma fatura para este cartÃ£o e vencimento.');
    throw new IdentityError(503, 'NÃ£o foi possÃ­vel registrar a fatura.');
  }
  return publicDocument(created.data);
}

export async function documentUrl(account: SupabaseAccount, rawId: unknown) {
  const id = text(rawId, 'Fatura', 80), admin = createSupabaseAdminClient();
  const result = await admin.from('statements').select('storage_path, filename').eq('id', id).eq('master_id', account.masterId).maybeSingle<{ storage_path: string; filename: string }>();
  if (result.error || !result.data) throw new IdentityError(404, 'Fatura nÃ£o encontrada.');
  const signed = await admin.storage.from('statements').createSignedUrl(result.data.storage_path, 60);
  if (signed.error || !signed.data) throw new IdentityError(503, 'NÃ£o foi possÃ­vel disponibilizar o PDF.');
  return signed.data.signedUrl;
}

export async function uploadAvatar(account: SupabaseAccount, bytes: Uint8Array, contentType: string | null, rawUserId?: unknown) {
  if (bytes.length < 12 || bytes.length > 2 * 1024 * 1024) throw new IdentityError(400, 'Envie uma foto de atÃ© 2 MB.');
  const type = contentType?.split(';', 1)[0].trim().toLowerCase();
  const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : null;
  if (!extension) throw new IdentityError(400, 'Use uma imagem JPEG, PNG ou WebP vÃ¡lida.');
  const targetId = rawUserId ? text(rawUserId, 'UsuÃ¡rio', 80) : account.id;
  if (targetId !== account.id) masterOnly(account);
  const admin = createSupabaseAdminClient();
  const target = await admin.from('profiles').select('id, master_id, role, name, active').eq('id', targetId).single<ProfileRow>();
  if (target.error || !target.data || target.data.master_id !== account.masterId) throw new IdentityError(404, 'Pessoa nÃ£o encontrada.');
  const path = `masters/${account.masterId}/profiles/${targetId}/avatar.${extension}`;
  const upload = await admin.storage.from('avatars').upload(path, bytes, { contentType: type, upsert: true });
  if (upload.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel guardar a foto.');
  const saved = await admin.from('profiles').update({ avatar_path: path, updated_at: new Date().toISOString() }).eq('id', targetId);
  if (saved.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel registrar a foto.');
  const url = await admin.storage.from('avatars').createSignedUrl(path, 60 * 15);
  if (url.error || !url.data) throw new IdentityError(503, 'NÃ£o foi possÃ­vel disponibilizar a foto.');
  return { id: target.data.id, masterId: target.data.master_id, role: target.data.role, name: target.data.name, active: target.data.active, avatarUrl: url.data.signedUrl };
}

export async function workspace(account: SupabaseAccount) {
  const result = await createSupabaseAdminClient().from('workspaces').select('state, version, updated_at').eq('master_id', account.masterId).maybeSingle<{ state: unknown; version: number; updated_at: string }>();
  if (result.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel abrir a organizaÃ§Ã£o.');
  return result.data || { state: null, version: 0, updatedAt: null };
}

export async function saveWorkspace(account: SupabaseAccount, input: Record<string, unknown>) {
  masterOnly(account);
  if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state) || !Number.isInteger(input.version) || (input.version as number) < 0) throw new IdentityError(400, 'OrganizaÃ§Ã£o invÃ¡lida.');
  const admin = createSupabaseAdminClient(), expected = input.version as number, updatedAt = new Date().toISOString();
  if (expected === 0) {
    const insert = await admin.from('workspaces').insert({ master_id: account.masterId, state: input.state, version: 1, updated_at: updatedAt }).select('state, version, updated_at').maybeSingle();
    if (insert.error?.code === '23505') throw new IdentityError(409, 'A organizaÃ§Ã£o foi alterada. Atualize a tela.');
    if (insert.error || !insert.data) throw new IdentityError(503, 'NÃ£o foi possÃ­vel salvar a organizaÃ§Ã£o.');
    return insert.data;
  }
  const update = await admin.from('workspaces').update({ state: input.state, version: expected + 1, updated_at: updatedAt }).eq('master_id', account.masterId).eq('version', expected).select('state, version, updated_at').maybeSingle();
  if (update.error) throw new IdentityError(503, 'NÃ£o foi possÃ­vel salvar a organizaÃ§Ã£o.');
  if (!update.data) throw new IdentityError(409, 'A organizaÃ§Ã£o foi alterada. Atualize a tela.');
  return update.data;
}
