import { createHash, randomBytes } from 'node:crypto';
import { createSupabaseAdminClient } from './admin';
import { IdentityError, type SupabaseAccount } from './identity';
import { syncWorkspaceTransactions } from './transaction-sync';

type CardRow = { id: string; master_id: string; name: string; due_day: number; issuer?: string; last4?: string | null; created_at: string };
type PersonRow = { id: string; master_id: string; account_id: string | null; name: string; email?: string | null; color: string; monthly_limit_cents: number | null; version: number; created_at: string; updated_at: string };
type ProfileRow = { id: string; master_id: string; role: 'master' | 'buyer'; name: string; active: boolean };
type StatementRow = { id: string; master_id: string; card_id: string; due_date: string; filename: string; storage_path: string; sha256: string; size_bytes: number; created_at: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const code = () => randomBytes(32).toString('hex');
const text = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new IdentityError(400, `${label} inválido.`);
  return value.trim();
};
const day = (value: unknown) => {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31) throw new IdentityError(400, 'Dia de vencimento inválido.');
  return value as number;
};
const cents = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new IdentityError(400, 'Meta inválida.');
  return value as number;
};
const publicCard = (row: CardRow) => ({ id: row.id, masterId: row.master_id, name: row.name, dueDay: row.due_day, issuer: row.issuer || 'Itaú', last4: row.last4 ?? null, createdAt: row.created_at });
const cardIdentityUnavailable = (error: { code?: string; message?: string } | null) => !!error && (error.code === '42703' || error.code === 'PGRST204' || /\b(issuer|last4)\b/i.test(error.message || ''));
const publicPerson = (row: PersonRow) => ({ id: row.id, masterId: row.master_id, accountId: row.account_id, name: row.name, email: row.email ?? null, color: row.color, monthlyLimitCents: row.monthly_limit_cents, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
const publicMember = (row: ProfileRow, email: string) => ({ id: row.id, masterId: row.master_id, role: row.role, name: row.name, email, active: row.active, avatarUrl: null });
const publicDocument = (row: StatementRow) => ({ id: row.id, masterId: row.master_id, cardId: row.card_id, dueDate: row.due_date, size: row.size_bytes, sha256: row.sha256, createdAt: row.created_at });

async function syncTransactionsSafely(admin: ReturnType<typeof createSupabaseAdminClient>, masterId: string, state: unknown) {
  try {
    await syncWorkspaceTransactions(admin, masterId, state);
  } catch (error) {
  }
}

function masterOnly(account: SupabaseAccount) {
  if (account.role !== 'master' || account.id !== account.masterId) throw new IdentityError(403, 'Acesso permitido somente ao master.');
}

export async function cards(account: SupabaseAccount) {
  const admin = createSupabaseAdminClient();
  let result = await admin.from('cards').select('id, master_id, name, due_day, issuer, last4, created_at').eq('master_id', account.masterId).order('due_day').returns<CardRow[]>();
  if (cardIdentityUnavailable(result.error)) result = await admin.from('cards').select('id, master_id, name, due_day, created_at').eq('master_id', account.masterId).order('due_day').returns<CardRow[]>();
  if (result.error) throw new IdentityError(503, 'Não foi possível consultar os cartões.');
  return (result.data || []).map(publicCard);
}

export async function createCard(account: SupabaseAccount, input: Record<string, unknown>) {
  masterOnly(account);
  const admin = createSupabaseAdminClient();
  const value = { master_id: account.masterId, name: text(input.name, 'Nome do cartão', 100), due_day: day(input.dueDay) };
  let result = await admin.from('cards').insert({ ...value, issuer: typeof input.issuer === 'string' && input.issuer.trim() ? input.issuer.trim().slice(0, 40) : 'Itaú', last4: typeof input.last4 === 'string' && /^\d{4}$/.test(input.last4) ? input.last4 : null }).select('id, master_id, name, due_day, issuer, last4, created_at').single<CardRow>();
  if (cardIdentityUnavailable(result.error)) result = await admin.from('cards').insert(value).select('id, master_id, name, due_day, created_at').single<CardRow>();
  if (result.error || !result.data) throw new IdentityError(503, 'Não foi possível criar o cartão.');
  return publicCard(result.data);
}
export async function deleteCard(account: SupabaseAccount, rawId: unknown) {
  masterOnly(account);
  const id = text(rawId, 'Cartão', 80), admin = createSupabaseAdminClient();
  const linked = await admin.from('statements').select('id').eq('card_id', id).eq('master_id', account.masterId).limit(1);
  if (linked.error) throw new IdentityError(503, 'Não foi possível verificar as faturas deste cartão.');
  if (linked.data?.length) throw new IdentityError(409, 'Este cartão possui faturas salvas. Exclua as faturas antes de excluir o cartão.');
  const removed = await admin.from('cards').delete().eq('id', id).eq('master_id', account.masterId).select('id').maybeSingle();
  if (removed.error) throw new IdentityError(503, 'Não foi possível excluir o cartão.');
  if (!removed.data) throw new IdentityError(404, 'Cartão não encontrado. Atualize a tela e tente novamente.');
  return { ok: true };
}
export async function people(account: SupabaseAccount) {
  const result = await createSupabaseAdminClient().from('people').select('id, master_id, account_id, name, email, color, monthly_limit_cents, version, created_at, updated_at').eq('master_id', account.masterId).order('name').returns<PersonRow[]>();
  if (result.error) throw new IdentityError(503, 'Não foi possível consultar as pessoas.');
  const rows = result.data || [];
  return (account.role === 'master' ? rows : rows.filter(row => row.account_id === account.id)).map(publicPerson);
}

export async function savePerson(account: SupabaseAccount, input: Record<string, unknown>, id?: string) {
  masterOnly(account);
  const admin = createSupabaseAdminClient();
  const accountId = input.accountId === undefined || input.accountId === null || input.accountId === '' ? null : text(input.accountId, 'Conta', 80);
  if (accountId) {
    const member = await admin.from('profiles').select('id, master_id, role, name, active').eq('id', accountId).single<ProfileRow>();
    if (member.error || !member.data || member.data.master_id !== account.masterId || member.data.role !== 'buyer') throw new IdentityError(400, 'A conta escolhida não pertence a este grupo.');
  }
  const email = input.email === undefined || input.email === null || input.email === '' ? null : text(input.email, 'E-mail', 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IdentityError(400, 'E-mail inválido.');
  const value = { master_id: account.masterId, account_id: accountId, name: text(input.name, 'Nome', 80), email, color: typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#2563EB', monthly_limit_cents: cents(input.monthlyLimitCents), updated_at: new Date().toISOString() };
  if (!id) {
    const inserted = await admin.from('people').insert(value).select('id, master_id, account_id, name, email, color, monthly_limit_cents, version, created_at, updated_at').single<PersonRow>();
    if (inserted.error || !inserted.data) throw new IdentityError(503, 'Não foi possível criar a pessoa.');
    return publicPerson(inserted.data);
  }
  const version = input.version;
  if (!Number.isInteger(version) || (version as number) < 1) throw new IdentityError(400, 'Versão inválida.');
  const updated = await admin.from('people').update({ ...value, version: (version as number) + 1 }).eq('id', id).eq('master_id', account.masterId).eq('version', version as number).select('id, master_id, account_id, name, email, color, monthly_limit_cents, version, created_at, updated_at').maybeSingle<PersonRow>();
  if (updated.error) throw new IdentityError(503, 'Não foi possível atualizar a pessoa.');
  if (!updated.data) throw new IdentityError(409, 'Esta pessoa foi alterada por outra pessoa. Atualize a tela e tente novamente.');
  return publicPerson(updated.data);
}

export async function members(account: SupabaseAccount) {
  masterOnly(account);
  const admin = createSupabaseAdminClient();
  const profiles = await admin.from('profiles').select('id, master_id, role, name, active').eq('master_id', account.masterId).returns<ProfileRow[]>();
  if (profiles.error) throw new IdentityError(503, 'Não foi possível consultar os membros.');
  const users = await Promise.all((profiles.data || []).map(async profile => {
    const user = await admin.auth.admin.getUserById(profile.id);
    return publicMember(profile, user.data.user?.email || '');
  }));
  return users;
}

export async function invite(account: SupabaseAccount, rawEmail: unknown, rawPersonId?: unknown) {
  masterOnly(account);
  const email = text(rawEmail, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IdentityError(400, 'E-mail inválido.');
  const admin = createSupabaseAdminClient();
  const personId = rawPersonId ? text(rawPersonId, 'Pessoa', 80) : null;
  if (personId) {
    const person = await admin.from('people').select('id, email').eq('id', personId).eq('master_id', account.masterId).maybeSingle<{ id: string; email: string | null }>();
    if (person.error || !person.data) throw new IdentityError(404, 'Pessoa não encontrada.');
    if (!person.data.email || person.data.email.toLowerCase() !== email) throw new IdentityError(400, 'O e-mail do convite deve ser o e-mail cadastrado para esta pessoa.');
  }
  const token = code(), expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const result = await admin.from('invitations').insert({ master_id: account.masterId, person_id: personId, email, token_hash: hash(token), expires_at: expiresAt });
  if (result.error) throw new IdentityError(503, 'Não foi possível criar o convite.');
  return { token, expiresAt };
}

export async function revokeMember(account: SupabaseAccount, rawId: unknown) {
  masterOnly(account);
  const id = text(rawId, 'Comprador', 80);
  const result = await createSupabaseAdminClient().from('profiles').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('master_id', account.masterId).eq('role', 'buyer');
  if (result.error) throw new IdentityError(503, 'Não foi possível revogar o acesso.');
  return { ok: true };
}

const dueDate = (value: unknown) => {
  const date = text(value, 'Vencimento', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new IdentityError(400, 'Use uma data de vencimento válida.');
  return date;
};

export async function documents(account: SupabaseAccount) {
  const result = await createSupabaseAdminClient().from('statements').select('id, master_id, card_id, due_date, filename, storage_path, sha256, size_bytes, created_at').eq('master_id', account.masterId).order('due_date', { ascending: false }).returns<StatementRow[]>();
  if (result.error) throw new IdentityError(503, 'Não foi possível consultar as faturas.');
  return (result.data || []).map(publicDocument);
}

export async function uploadDocument(account: SupabaseAccount, rawCardId: unknown, rawDate: unknown, bytes: Uint8Array, filename = 'fatura.pdf') {
  masterOnly(account);
  if (bytes.length < 5 || bytes.length > 15 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new IdentityError(400, 'Envie um PDF válido de até 15 MB.');
  const cardId = text(rawCardId, 'Cartão', 80), due = dueDate(rawDate), admin = createSupabaseAdminClient();
  const card = await admin.from('cards').select('id').eq('id', cardId).eq('master_id', account.masterId).maybeSingle();
  if (card.error || !card.data) throw new IdentityError(404, 'Cartão não encontrado.');
  const id = crypto.randomUUID(), storagePath = `masters/${account.masterId}/cards/${cardId}/due/${due}/${id}.pdf`, sha256 = createHash('sha256').update(bytes).digest('hex');
  const upload = await admin.storage.from('statements').upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });
  if (upload.error) throw new IdentityError(503, 'Não foi possível guardar o PDF.');
  const created = await admin.from('statements').insert({ id, master_id: account.masterId, card_id: cardId, due_date: due, filename: text(filename, 'Nome do arquivo', 255), storage_path: storagePath, sha256, size_bytes: bytes.length, fingerprint: sha256, total_cents: 0 }).select('id, master_id, card_id, due_date, filename, storage_path, sha256, size_bytes, created_at').single<StatementRow>();
  if (created.error || !created.data) {
    await admin.storage.from('statements').remove([storagePath]);
    if (created.error?.code === '23505') throw new IdentityError(409, 'Já existe uma fatura para este cartão e vencimento.');
    throw new IdentityError(503, 'Não foi possível registrar a fatura.');
  }
  return publicDocument(created.data);
}

export async function documentUrl(account: SupabaseAccount, rawId: unknown) {
  const id = text(rawId, 'Fatura', 80), admin = createSupabaseAdminClient();
  const result = await admin.from('statements').select('storage_path, filename').eq('id', id).eq('master_id', account.masterId).maybeSingle<{ storage_path: string; filename: string }>();
  if (result.error || !result.data) throw new IdentityError(404, 'Fatura não encontrada.');
  const signed = await admin.storage.from('statements').createSignedUrl(result.data.storage_path, 60);
  if (signed.error || !signed.data) throw new IdentityError(503, 'Não foi possível disponibilizar o PDF.');
  return signed.data.signedUrl;
}

export async function deleteDocument(account: SupabaseAccount, rawId: unknown) {
  masterOnly(account);
  const id = text(rawId, 'Fatura', 80), admin = createSupabaseAdminClient();
  const found = await admin.from('statements').select('id, storage_path, sha256').eq('id', id).eq('master_id', account.masterId).maybeSingle<{ id: string; storage_path: string; sha256: string }>();
  if (found.error) throw new IdentityError(503, 'Não foi possível localizar a fatura.');
  if (!found.data) throw new IdentityError(404, 'Fatura não encontrada. Atualize a tela e tente novamente.');
  const document = found.data;
  const savedWorkspace = await admin.from('workspaces').select('state, version').eq('master_id', account.masterId).maybeSingle<{ state: unknown; version: number }>();
  if (savedWorkspace.error) throw new IdentityError(503, 'Não foi possível atualizar a organização desta fatura.');
  let syncedState: unknown = null, syncedVersion: number | null = null;
  if (savedWorkspace.data?.state && typeof savedWorkspace.data.state === 'object' && !Array.isArray(savedWorkspace.data.state)) {
    const current = savedWorkspace.data.state as { statements?: Array<{ storageDocumentId?: unknown; fingerprint?: unknown }>; activeId?: unknown };
    const statements = Array.isArray(current.statements) ? current.statements : [];
    const nextStatements = statements.filter(statement => statement.storageDocumentId !== id && statement.fingerprint !== document.sha256);
    if (nextStatements.length !== statements.length) {
      const nextActiveId = nextStatements.some(statement => statement.fingerprint === current.activeId) ? current.activeId : nextStatements[0]?.fingerprint ?? null;
      const nextState = { ...current, statements: nextStatements, activeId: nextActiveId };
      const updated = await admin.from('workspaces').update({ state: nextState, version: savedWorkspace.data.version + 1, updated_at: new Date().toISOString() }).eq('master_id', account.masterId).eq('version', savedWorkspace.data.version).select('state, version').maybeSingle<{ state: unknown; version: number }>();
      if (updated.error) throw new IdentityError(503, 'Não foi possível atualizar a organização desta fatura.');
      if (!updated.data) throw new IdentityError(409, 'A organização foi alterada por outra pessoa. Atualize a tela e tente novamente.');
      syncedState = updated.data.state; syncedVersion = updated.data.version;
    }
  }
  const removed = await admin.from('statements').delete().eq('id', id).eq('master_id', account.masterId);
  if (removed.error) throw new IdentityError(503, 'Não foi possível excluir a fatura.');
  const file = await admin.storage.from('statements').remove([document.storage_path]);
  if (file.error)
  return { ok: true, workspace: syncedVersion === null ? null : { state: syncedState, version: syncedVersion } };
}

export async function uploadAvatar(account: SupabaseAccount, bytes: Uint8Array, contentType: string | null, rawUserId?: unknown) {
  if (bytes.length < 12 || bytes.length > 2 * 1024 * 1024) throw new IdentityError(400, 'Envie uma foto de até 2 MB.');
  const type = contentType?.split(';', 1)[0].trim().toLowerCase();
  const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : null;
  if (!extension) throw new IdentityError(400, 'Use uma imagem JPEG, PNG ou WebP válida.');
  const targetId = rawUserId ? text(rawUserId, 'Usuário', 80) : account.id;
  if (targetId !== account.id) masterOnly(account);
  const admin = createSupabaseAdminClient();
  const target = await admin.from('profiles').select('id, master_id, role, name, active').eq('id', targetId).single<ProfileRow>();
  if (target.error || !target.data || target.data.master_id !== account.masterId) throw new IdentityError(404, 'Pessoa não encontrada.');
  const path = `masters/${account.masterId}/profiles/${targetId}/avatar.${extension}`;
  const upload = await admin.storage.from('avatars').upload(path, bytes, { contentType: type, upsert: true });
  if (upload.error) throw new IdentityError(503, 'Não foi possível guardar a foto.');
  const saved = await admin.from('profiles').update({ avatar_path: path, updated_at: new Date().toISOString() }).eq('id', targetId);
  if (saved.error) throw new IdentityError(503, 'Não foi possível registrar a foto.');
  const url = await admin.storage.from('avatars').createSignedUrl(path, 60 * 15);
  if (url.error || !url.data) throw new IdentityError(503, 'Não foi possível disponibilizar a foto.');
  return { id: target.data.id, masterId: target.data.master_id, role: target.data.role, name: target.data.name, active: target.data.active, avatarUrl: url.data.signedUrl };
}

export async function workspace(account: SupabaseAccount) {
  const result = await createSupabaseAdminClient().from('workspaces').select('state, version, updated_at').eq('master_id', account.masterId).maybeSingle<{ state: unknown; version: number; updated_at: string }>();
  if (result.error) throw new IdentityError(503, 'Não foi possível abrir a organização.');
  return result.data || { state: null, version: 0, updatedAt: null };
}

export async function buyerSummary(account: SupabaseAccount) {
  if (account.role !== 'buyer') throw new IdentityError(403, 'Este resumo é destinado a compradores.');
  const admin = createSupabaseAdminClient();
  const [result, personResult] = await Promise.all([
    admin.from('workspaces').select('state').eq('master_id', account.masterId).maybeSingle<{ state: unknown }>(),
    admin.from('people').select('id').eq('master_id', account.masterId).eq('account_id', account.id).maybeSingle<{ id: string }>(),
  ]);
  if (result.error) throw new IdentityError(503, 'Não foi possível abrir suas compras.');
  if (personResult.error || !personResult.data) return { statement: null, personalCents: 0, purchaseCount: 0, pendingCount: 0, status: 'person_not_linked' as const };
  const databasePerson = personResult.data;
  const data = result.data?.state;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { statement: null, personalCents: 0, purchaseCount: 0, pendingCount: 0, status: 'no_statement' as const };
  const state = data as { people?: Array<{ id?: unknown; name?: unknown }>; statements?: Array<Record<string, unknown>>; activeId?: unknown };
  const person = state.people?.find(item => item.id === databasePerson.id);
  const statements = Array.isArray(state.statements) ? state.statements : [];
  const statement = statements.find(item => item.id === state.activeId) || statements[0];
  if (!person) return { statement: null, personalCents: 0, purchaseCount: 0, pendingCount: 0, status: 'person_not_in_workspace' as const };
  if (!statement || !Array.isArray(statement.transactions)) return { statement: null, personalCents: 0, purchaseCount: 0, pendingCount: 0, status: 'no_statement' as const };
  const purchases = statement.transactions.filter(item => item && typeof item === 'object').map(item => item as { merchant?: unknown; date?: unknown; cents?: unknown; allocations?: Array<{ personId?: unknown; cents?: unknown }>; buyerId?: unknown }).map(item => {
    const allocation = item.allocations?.find(value => value.personId === person.id);
    return allocation && typeof allocation.cents === 'number' ? { merchant: typeof item.merchant === 'string' ? item.merchant : 'Compra', date: typeof item.date === 'string' ? item.date : '', cents: allocation.cents, assigned: item.buyerId === person.id } : null;
  }).filter((item): item is { merchant: string; date: string; cents: number; assigned: boolean } => !!item);
  return { statement: { dueDate: typeof statement.dueDate === 'string' ? statement.dueDate : null, totalCents: typeof statement.total === 'number' ? statement.total : null }, personalCents: purchases.reduce((total, item) => total + item.cents, 0), purchaseCount: purchases.length, pendingCount: purchases.filter(item => !item.assigned).length, purchases: purchases.slice(0, 6), status: purchases.length ? 'ready' as const : 'no_purchases' as const };
}

export async function saveWorkspace(account: SupabaseAccount, input: Record<string, unknown>) {
  masterOnly(account);
  if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state) || !Number.isInteger(input.version) || (input.version as number) < 0) throw new IdentityError(400, 'Organização inválida.');
  const admin = createSupabaseAdminClient(), expected = input.version as number, updatedAt = new Date().toISOString();
  if (expected === 0) {
    const insert = await admin.from('workspaces').insert({ master_id: account.masterId, state: input.state, version: 1, updated_at: updatedAt }).select('state, version, updated_at').maybeSingle();
    if (insert.error?.code === '23505') throw new IdentityError(409, 'A organização foi alterada. Atualize a tela.');
    if (insert.error || !insert.data) throw new IdentityError(503, 'Não foi possível salvar a organização.');
    await syncTransactionsSafely(admin, account.masterId, input.state);
    return insert.data;
  }
  const update = await admin.from('workspaces').update({ state: input.state, version: expected + 1, updated_at: updatedAt }).eq('master_id', account.masterId).eq('version', expected).select('state, version, updated_at').maybeSingle();
  if (update.error) throw new IdentityError(503, 'Não foi possível salvar a organização.');
  if (!update.data) throw new IdentityError(409, 'A organização foi alterada. Atualize a tela.');
  await syncTransactionsSafely(admin, account.masterId, input.state);
  return update.data;
}
