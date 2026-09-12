import { Backend } from '@/lib/backend/service';
import { ApiError, MAX_AVATAR, MAX_PDF, publicAccount } from '@/lib/backend/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
async function body(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Corpo obrigatório.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, 'Arquivo ou requisição muito grande.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function handle(request: Request, context: Context) {
  try {
    // Local development API only. Public deployment needs the production auth gateway.
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) throw new ApiError(503, 'API disponível apenas no ambiente local.');
    const api = new Backend(), path = (await context.params).path.join('/');
    const post = request.method === 'POST';
    const cookieToken = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('fatura_session='))?.slice('fatura_session='.length);
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || cookieToken || '';
    let input: Record<string, unknown> = {};
    if (post && path !== 'documents' && path !== 'avatar' && path !== 'statements/import') {
      try { input = JSON.parse((await body(request, 16 * 1024)).toString()); }
      catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'JSON inválido.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Objeto JSON obrigatório.');
    }
    if (post && path === 'register') return Response.json(await api.register(input), { status: 201, headers });
    if (post && path === 'login') {
      const login = await api.login(input);
      const response = Response.json(login, { headers });
      response.headers.append('Set-Cookie', `fatura_session=${login.token}; HttpOnly; SameSite=Strict; Path=/api/backend; Max-Age=28800`);
      return response;
    }
    const account = await api.authenticate(token);
    if (!post && path === 'me') return Response.json(publicAccount(account), { headers });
    if (post && path === 'logout') {
      await api.logout(token);
      const response = Response.json({ ok: true }, { headers });
      response.headers.append('Set-Cookie', 'fatura_session=; HttpOnly; SameSite=Strict; Path=/api/backend; Max-Age=0');
      return response;
    }
    if (post && path === 'invites') return Response.json(await api.invite(account, input.email), { status: 201, headers });
    if (!post && path === 'members') return Response.json(await api.members(account), { headers });
    if (post && path === 'members/revoke') { await api.revoke(account, input.userId); return Response.json({ ok: true }, { headers }); }
    if (path === 'workspace') return Response.json(post ? await api.saveWorkspace(account, input) : await api.workspace(account), { headers });
    if (path === 'people') return Response.json(post ? await api.savePerson(account, input) : await api.people(account), { status: post ? 201 : 200, headers });
    if (post && path.startsWith('people/')) return Response.json(await api.savePerson(account, input, path.slice('people/'.length)), { headers });
    if (post && path === 'avatar') return Response.json(await api.uploadAvatar(account, await body(request, MAX_AVATAR), request.headers.get('content-type'), new URL(request.url).searchParams.get('userId')), { headers });
    if (!post && path.startsWith('avatars/')) {
      const image = await api.avatar(account, path.slice('avatars/'.length));
      return new Response(Buffer.from(image.bytes), { headers: { ...headers, 'Content-Type': image.contentType, 'Content-Disposition': 'inline' } });
    }
    if (path === 'cards') return Response.json(post ? await api.createCard(account, input) : await api.cards(account), { status: post ? 201 : 200, headers });
    if (post && path === 'statements/import') {
      const form = await request.formData(), file = form.get('file'), parsed = form.get('statement');
      if (!(file instanceof File) || typeof parsed !== 'string') throw new ApiError(400, 'PDF e dados da fatura são obrigatórios.');
      let statement: Record<string, unknown>;
      try { statement = JSON.parse(parsed); } catch { throw new ApiError(400, 'Dados da fatura inválidos.'); }
      return Response.json(await api.importStatement(account, form.get('cardId'), form.get('dueDate'), new Uint8Array(await file.arrayBuffer()), statement), { status: 201, headers });
    }
    if (!post && path === 'statements') return Response.json(await api.statements(account, new URL(request.url).searchParams.get('cardId')), { headers });
    if (!post && path.startsWith('statements/')) return Response.json(await api.statement(account, path.slice('statements/'.length)), { headers });
    if (post && path.startsWith('transactions/')) {
      const [, statementId, transactionId] = path.split('/');
      return Response.json(await api.updateTransaction(account, statementId, transactionId, input), { headers });
    }
    if (path === 'documents') {
      if (!post) return Response.json(await api.documents(account), { headers });
      if (account.role !== 'master') throw new ApiError(403, 'Somente o master pode importar faturas.');
      const query = new URL(request.url).searchParams;
      return Response.json(await api.upload(account, query.get('cardId'), query.get('dueDate'), await body(request, MAX_PDF)), { status: 201, headers });
    }
    if (!post && path.startsWith('documents/')) {
      const file = await api.download(account, path.slice('documents/'.length));
      return new Response(Buffer.from(file.bytes), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file.filename}"` } });
    }
    throw new ApiError(404, 'Rota não encontrada.');
  } catch (error) {
    return Response.json({ error: error instanceof ApiError ? error.message : 'Serviço indisponível. Confira se o Floci foi iniciado e inicializado.' }, { status: error instanceof ApiError ? error.status : 503, headers });
  }
}
export const GET = handle;
export const POST = handle;
