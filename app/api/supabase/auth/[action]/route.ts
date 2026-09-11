import { accountFromAccessToken, IdentityError, registerMaster, signIn } from '@/lib/supabase/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const cookie = (token: string, maxAge: number) => `sharecard_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

async function input(request: Request) {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IdentityError(400, 'JSON invÃ¡lido.');
  return value as Record<string, unknown>;
}

export async function POST(request: Request, context: Context) {
  try {
    const action = (await context.params).action;
    const body = await input(request);
    if (action === 'logout') {
      const response = Response.json({ ok: true }, { headers });
      response.headers.append('Set-Cookie', cookie('', 0));
      return response;
    }
    const result = action === 'register' ? await registerMaster(body) : action === 'login' ? await signIn(body.email, body.password) : null;
    if (!result) throw new IdentityError(404, 'Rota nÃ£o encontrada.');
    const response = Response.json({ account: result.account }, { status: action === 'register' ? 201 : 200, headers });
    response.headers.append('Set-Cookie', cookie(result.session.access_token, result.session.expires_in));
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof IdentityError ? error.message : 'ServiÃ§o de identidade indisponÃ­vel.' }, { status: error instanceof IdentityError ? error.status : 503, headers });
  }
}

export async function GET(request: Request, context: Context) {
  try {
    if ((await context.params).action !== 'me') throw new IdentityError(404, 'Rota nÃ£o encontrada.');
    const token = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith('sharecard_session='))?.slice('sharecard_session='.length) || '';
    return Response.json(await accountFromAccessToken(token), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof IdentityError ? error.message : 'ServiÃ§o de identidade indisponÃ­vel.' }, { status: error instanceof IdentityError ? error.status : 503, headers });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    if ((await context.params).action !== 'logout') throw new IdentityError(404, 'Rota nÃ£o encontrada.');
    const response = Response.json({ ok: true }, { headers });
    response.headers.append('Set-Cookie', cookie('', 0));
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof IdentityError ? error.message : 'ServiÃ§o de identidade indisponÃ­vel.' }, { status: error instanceof IdentityError ? error.status : 503, headers });
  }
}
