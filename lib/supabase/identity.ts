import { createSupabaseAdminClient } from './admin';
import { createSupabasePublicClient } from './client';

export type SupabaseAccount = {
  id: string;
  masterId: string;
  role: 'master' | 'buyer';
  name: string;
  email: string;
  active: boolean;
  avatarUrl: null;
};

type ProfileRow = { id: string; master_id: string; role: 'master' | 'buyer'; name: string; active: boolean };

const validEmail = (value: unknown) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const requiredText = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new IdentityError(400, `${label} inválido.`);
  return value.trim();
};
const password = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) throw new IdentityError(400, 'Use uma senha entre 6 e 128 caracteres.');
  return value;
};
const account = (profile: ProfileRow, email: string): SupabaseAccount => ({
  id: profile.id, masterId: profile.master_id, role: profile.role, name: profile.name, email, active: profile.active, avatarUrl: null,
});

export class IdentityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function registrationError(message?: string) {
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('already registered') || normalized.includes('already been registered') || normalized.includes('already exists')) {
    return new IdentityError(409, 'Este e-mail já possui uma conta. Entre ou use outro e-mail.');
  }
  if (normalized.includes('password')) return new IdentityError(400, 'Use uma senha entre 6 e 128 caracteres.');
  if (normalized.includes('signup') || normalized.includes('sign up')) return new IdentityError(403, 'O cadastro por e-mail está desativado no Supabase. Ative-o em Authentication > Providers > Email.');
  if (normalized.includes('not allowed') || normalized.includes('unauthorized') || normalized.includes('api key')) return new IdentityError(503, 'A chave de serviço do Supabase não está válida no ambiente de produção.');
  if (normalized.includes('email')) return new IdentityError(400, 'Informe um e-mail válido.');
  const detail = (message || 'motivo não informado').replace(/[\r\n]+/g, ' ').slice(0, 180);
  return new IdentityError(503, `Não foi possível criar a conta: ${detail}`);
}

export async function registerMaster(input: Record<string, unknown>) {
  if (input.inviteToken) throw new IdentityError(400, 'O cadastro por convite será liberado na próxima etapa.');
  const name = requiredText(input.name, 'Nome', 80);
  if (!validEmail(input.email)) throw new IdentityError(400, 'Informe um e-mail válido.');
  const email = (input.email as string).trim().toLowerCase();
  const admin = createSupabaseAdminClient();
  const created = await admin.auth.admin.createUser({ email, password: password(input.password), email_confirm: true });
  if (created.error || !created.data.user) {
    console.error('ShareCard registration failed', { message: created.error?.message, status: created.error?.status, code: created.error?.code });
    throw registrationError(created.error?.message);
  }

  const user = created.data.user;
  const inserted = await admin.from('profiles').insert({ id: user.id, master_id: user.id, role: 'master', name }).select('id, master_id, role, name, active').single<ProfileRow>();
  if (inserted.error || !inserted.data) {
    await admin.auth.admin.deleteUser(user.id);
    throw new IdentityError(503, 'A conta foi criada, mas o espaço não pôde ser preparado. Tente novamente.');
  }
  return signIn(email, input.password);
}

export async function signIn(rawEmail: unknown, rawPassword: unknown) {
  if (!validEmail(rawEmail)) throw new IdentityError(400, 'Informe um e-mail válido.');
  const email = (rawEmail as string).trim().toLowerCase();
  const client = createSupabasePublicClient();
  const login = await client.auth.signInWithPassword({ email, password: password(rawPassword) });
  if (login.error || !login.data.session || !login.data.user) throw new IdentityError(401, 'E-mail ou senha inválidos.');
  const profile = await createSupabaseAdminClient().from('profiles').select('id, master_id, role, name, active').eq('id', login.data.user.id).single<ProfileRow>();
  if (profile.error || !profile.data || !profile.data.active) throw new IdentityError(403, 'Esta conta não possui acesso ativo ao ShareCard.');
  return { session: login.data.session, account: account(profile.data, login.data.user.email || email) };
}

export async function accountFromAccessToken(token: string) {
  const admin = createSupabaseAdminClient();
  const current = await admin.auth.getUser(token);
  if (current.error || !current.data.user) throw new IdentityError(401, 'Faça login para continuar.');
  const profile = await admin.from('profiles').select('id, master_id, role, name, active').eq('id', current.data.user.id).single<ProfileRow>();
  if (profile.error || !profile.data || !profile.data.active) throw new IdentityError(401, 'Sessão inválida ou acesso revogado.');
  return account(profile.data, current.data.user.email || '');
}