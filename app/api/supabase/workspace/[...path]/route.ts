import { accountFromAccessToken, IdentityError } from '@/lib/supabase/identity';
import { buyerSummary, cards, createCard, documentUrl, documents, invite, members, people, revokeMember, savePerson, saveWorkspace, uploadAvatar, uploadDocument, workspace } from '@/lib/supabase/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const tokenFrom = (request: Request) => request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('sharecard_session='))?.slice('sharecard_session='.length) || '';
async function json(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IdentityError(400, 'JSON inválido.');
  return body as Record<string, unknown>;
}
async function handle(request: Request, context: Context) {
  try {
    const account = await accountFromAccessToken(tokenFrom(request));
    const path = (await context.params).path.join('/');
    if (request.method === 'GET' && path === 'cards') return Response.json(await cards(account), { headers });
    if (request.method === 'GET' && path === 'people') return Response.json(await people(account), { headers });
    if (request.method === 'GET' && path === 'members') return Response.json(await members(account), { headers });
    if (request.method === 'GET' && path === 'documents') return Response.json(await documents(account), { headers });
    if (request.method === 'GET' && path === 'workspace') return Response.json(await workspace(account), { headers });
    if (request.method === 'GET' && path === 'buyer-summary') return Response.json(await buyerSummary(account), { headers });
    if (request.method === 'GET' && path.startsWith('documents/')) return Response.redirect(await documentUrl(account, path.slice('documents/'.length)), 302);
    if (request.method !== 'POST') throw new IdentityError(404, 'Rota não encontrada.');
    if (path === 'documents') {
      const cardId = new URL(request.url).searchParams.get('cardId');
      const date = new URL(request.url).searchParams.get('dueDate');
      const bytes = new Uint8Array(await request.arrayBuffer());
      return Response.json(await uploadDocument(account, cardId, date, bytes, request.headers.get('x-sharecard-filename') || 'fatura.pdf'), { status: 201, headers });
    }
    if (path === 'avatar') return Response.json(await uploadAvatar(account, new Uint8Array(await request.arrayBuffer()), request.headers.get('content-type'), new URL(request.url).searchParams.get('userId')), { headers });
    const body = await json(request);
    if (path === 'workspace') return Response.json(await saveWorkspace(account, body), { headers });
    if (path === 'cards') return Response.json(await createCard(account, body), { status: 201, headers });
    if (path === 'people') return Response.json(await savePerson(account, body), { status: 201, headers });
    if (path.startsWith('people/')) return Response.json(await savePerson(account, body, path.slice('people/'.length)), { headers });
    if (path === 'invites') return Response.json(await invite(account, body.email), { status: 201, headers });
    if (path === 'members/revoke') return Response.json(await revokeMember(account, body.userId), { headers });
    throw new IdentityError(404, 'Rota não encontrada.');
  } catch (error) {
    return Response.json({ error: error instanceof IdentityError ? error.message : 'Serviço de espaço indisponível.' }, { status: error instanceof IdentityError ? error.status : 503, headers });
  }
}
export const GET = handle;
export const POST = handle;
