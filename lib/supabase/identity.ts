import { createHash } from 'node:crypto';
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
type InvitationRow = { id: string; master_id: string; person_id: string | null; email: string; expires_at: string; used_at: string | null };

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
  if (normalized.includes('already registered') || normalized.includes('already been registered') || normalized.includes('already exists')) return new IdentityError(409, 'Este e-mail já possui uma conta. Entre ou use outro e-mail.');
  if (normalized.includes('password')) return new IdentityError(400, 'Use uma senha entre 6 e 128 caracteres.');
  if (normalized.includes('signup') || normalized.includes('sign up')) return new IdentityError(403, 'O cadastro por e-mail está desativado no Supabase. Ative-o em Authentication > Providers > Email.');
  if (normalized.includes('not allowed') || normalized.includes('unauthorized') || normalized.includes('api key')) return new IdentityError(503, 'A chave de serviço do Supabase não está válida no ambiente de produção.');
  if (normalized.includes('email')) return new IdentityError(400, 'Informe um e-mail válido.');
  const detail = (message || 'motivo não informado').replace(/[\r\n]+/g, ' ').slice(0, 180);
  return new IdentityError(503, `Não foi possível criar a conta: ${detail}`);
}

export async function registerMaster(input: Record<string, unknown>) {
  const name = requiredText(input.name, 'Nome', 80);
  if (!validEmail(input.email)) throw new IdentityError(400, 'Informe um e-mail válido.');
  const email = (input.email as string).trim().toLowerCase();
  const admin = createSupabaseAdminClient();
  const inviteToken = typeof input.inviteToken === 'string' && input.inviteToken.trim() ? requiredText(input.inviteToken, 'Convite', 128) : null;
  let invitation: InvitationRow | null = null;

  if (inviteToken) {
    const tokenHash = createHash('sha256').update(inviteToken).digest('hex');
    const found = await admin.from('invitations').select('id, master_id, person_id, email, expires_at, used_at').eq('token_hash', tokenHash).maybeSingle<InvitationRow>();
    invitation = found.data || null;
    if (found.error || !invitation || invitation.used_at || new Date(invitation.expires_at).getTime() <= Date.now()) throw new IdentityError(400, 'Convite inválido, utilizado ou expirado.');
    if (invitation.email.toLowerCase() !== email) throw new IdentityError(400, 'Use o mesmo e-mail que recebeu o convite.');
  }

  // A revogação preserva a conta no Supabase para manter seu histórico. Quando
  // o master convida esse mesmo e-mail novamente, reaproveitamos a conta e
  // reativamos apenas o acesso ao espaço indicado pelo novo convite.
  if (invitation) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) throw new IdentityError(503, 'Não foi possível verificar a conta convidada.');
    const existingUser = listed.data.users.find(user => user.email?.toLowerCase() === email);
    if (existingUser) {
      const existingProfile = await admin.from('profiles').select('id, master_id, role, name, active').eq('id', existingUser.id).maybeSingle<ProfileRow>();
      if (existingProfile.error || !existingProfile.data || existingProfile.data.role !== 'buyer' || existingProfile.data.master_id !== invitation.master_id) {
        throw new IdentityError(409, 'Este e-mail já possui uma conta em outro espaço. Entre com ela ou use outro e-mail.');
      }
      if (existingProfile.data.active) throw new IdentityError(409, 'Esta conta já possui acesso ativo. Entre com seu e-mail e senha.');

      const claimed = await admin.from('invitations').update({ used_at: new Date().toISOString() }).eq('id', invitation.id).is('used_at', null).gt('expires_at', new Date().toISOString()).select('id').maybeSingle();
      if (claimed.error || !claimed.data) throw new IdentityError(400, 'Este convite já foi utilizado ou expirou. Peça um novo convite ao master.');
      const restored = await admin.from('profiles').update({ active: true, name, updated_at: new Date().toISOString() }).eq('id', existingUser.id).eq('master_id', invitation.master_id).eq('role', 'buyer').eq('active', false).select('id').maybeSingle();
      if (restored.error || !restored.data) throw new IdentityError(503, 'Não foi possível reativar o acesso desta conta.');
      const passwordUpdate = await admin.auth.admin.updateUserById(existingUser.id, { password: password(input.password), email_confirm: true });
      if (passwordUpdate.error) throw new IdentityError(503, 'O acesso foi reativado, mas não foi possível atualizar a senha. Tente entrar com a senha anterior.');
      if (invitation.person_id) {
        const linked = await admin.from('people').update({ account_id: existingUser.id, updated_at: new Date().toISOString() }).eq('id', invitation.person_id).eq('master_id', invitation.master_id).is('account_id', null);
        if (linked.error) throw new IdentityError(503, 'O acesso foi reativado, mas não foi possível vincular a pessoa.');
      }
      return signIn(email, input.password);
    }
  }

  const created = await admin.auth.admin.createUser({ email, password: password(input.password), email_confirm: true });
  if (created.error || !created.data.user) {
    throw registrationError(created.error?.message);
  }

  const user = created.data.user;
  const inserted = await admin.from('profiles').insert({ id: user.id, master_id: invitation?.master_id || user.id, role: invitation ? 'buyer' : 'master', name }).select('id, master_id, role, name, active').single<ProfileRow>();
  if (inserted.error || !inserted.data) {
    await admin.auth.admin.deleteUser(user.id);
    throw new IdentityError(503, 'A conta foi criada, mas o espaço não pôde ser preparado. Tente novamente.');
  }

  if (invitation) {
    const claimed = await admin.from('invitations').update({ used_at: new Date().toISOString() }).eq('id', invitation.id).is('used_at', null).gt('expires_at', new Date().toISOString()).select('id').maybeSingle();
    if (claimed.error || !claimed.data) {
      await admin.auth.admin.deleteUser(user.id);
      throw new IdentityError(400, 'Este convite já foi utilizado ou expirou. Peça um novo convite ao master.');
    }
    if (invitation.person_id) {
      const linked = await admin.from('people').update({ account_id: user.id, updated_at: new Date().toISOString() }).eq('id', invitation.person_id).eq('master_id', invitation.master_id).is('account_id', null);
      if (linked.error) throw new IdentityError(503, 'A conta foi criada, mas não foi possível vinculá-la ao comprador.');
    } else {
      // Convites antigos não têm person_id. Mantemos esta compatibilidade uma única vez.
      const unlinked = await admin.from('people').select('id').eq('master_id', invitation.master_id).eq('name', name).is('account_id', null).maybeSingle<{ id: string }>();
      if (unlinked.data) await admin.from('people').update({ account_id: user.id, updated_at: new Date().toISOString() }).eq('id', unlinked.data.id);
      else await admin.from('people').insert({ master_id: invitation.master_id, account_id: user.id, name, email, color: '#2563EB' });
    }
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
