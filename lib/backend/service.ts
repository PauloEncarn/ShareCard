import { randomUUID } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Store } from './store';
import { ApiError, type Account, type Card, type Document, type PersonRecord, type StatementRecord, type TransactionRecord, authorize, email, text, identifier, dueDate, dueDay, integer, documentKey, avatarObjectKey, digest, secret, hashPassword, checkPassword, publicAccount, validateAvatar, validatePdf } from './domain';

type Invite = { masterId: string; email: string; expiresAt: number };
type Session = { userId: string; expiresAt: number };
type Workspace = { state: unknown; version: number; updatedAt: string };
const now = () => Math.floor(Date.now() / 1000);
export class Backend {
  constructor(readonly store = new Store()) {}
  async register(input: Record<string, unknown>) {
    const address = email(input.email), name = text(input.name, 'Nome');
    const passwordHash = await hashPassword(input.password), id = randomUUID();
    let invitation: Invite | undefined;
    let invitePk = '';
    if (input.inviteToken) {
      invitePk = `INVITE#${digest(text(input.inviteToken, 'Convite', 64))}`;
      invitation = await this.store.get<Invite>(invitePk);
      if (!invitation || invitation.email !== address || invitation.expiresAt <= now()) throw new ApiError(400, 'Convite inválido ou expirado.');
    }
    const account: Account = { id, masterId: invitation?.masterId || id, role: invitation ? 'buyer' : 'master', name, email: address, passwordHash, active: true };
    const writes = [this.store.unique(`USER#${id}`, 'PROFILE', account), this.store.unique(`EMAIL#${digest(address)}`, 'PROFILE', { userId: id }), this.store.unique(`MASTER#${account.masterId}`, `MEMBER#${id}`, { userId: id })];
    if (invitation) {
      await this.store.transaction([...writes, { Delete: { TableName: this.store.aws.table, Key: { pk: invitePk, sk: 'PROFILE' }, ConditionExpression: 'expiresAt > :now AND masterId = :master AND email = :email', ExpressionAttributeValues: { ':now': now(), ':master': invitation.masterId, ':email': address } } }]);
      const linked = (await this.store.list<PersonRecord>(`MASTER#${account.masterId}`, 'PERSON#')).find(person => !person.accountId && person.name.localeCompare(name, 'pt-BR', { sensitivity: 'accent' }) === 0);
      if (linked) await this.store.replaceVersioned(`MASTER#${account.masterId}`, `PERSON#${linked.id}`, { ...linked, accountId: account.id, version: linked.version + 1, updatedAt: new Date().toISOString() }, linked.version);
      else {
        const createdAt = new Date().toISOString();
        const person: PersonRecord = { id: randomUUID(), masterId: account.masterId, name, color: '#18794e', accountId: account.id, version: 1, createdAt, updatedAt: createdAt };
        await this.store.put(`MASTER#${account.masterId}`, `PERSON#${person.id}`, person);
      }
    } else await this.store.transaction(writes);
    return publicAccount(account);
  }
  async login(input: Record<string, unknown>) {
    const index = await this.store.get<{ userId: string }>(`EMAIL#${digest(email(input.email))}`);
    const account = index && await this.store.get<Account>(`USER#${index.userId}`);
    // Do comparable password work when the address does not exist.
    const fallback = '00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await checkPassword(input.password, account?.passwordHash || fallback);
    if (!account?.active || !valid) throw new ApiError(401, 'E-mail ou senha inválidos.');
    const token = secret(), expiresAt = now() + 8 * 60 * 60;
    await this.store.put(`SESSION#${digest(token)}`, 'PROFILE', { userId: account.id, expiresAt });
    return { token, expiresAt, account: publicAccount(account) };
  }
  async demoLogin(role: unknown) {
    if (process.env.BACKEND_MODE !== 'floci') throw new ApiError(404, 'Acesso de demonstração indisponível.');
    const buyer = role === 'buyer', masterEmail = 'master.demo@sharecard.local', buyerEmail = 'comprador.demo@sharecard.local', password = 'sharecard-demo-password-2026';
    const wantedEmail = buyer ? buyerEmail : masterEmail;
    const existing = await this.store.get<{ userId: string }>(`EMAIL#${digest(wantedEmail)}`);
    if (!existing) {
      if (buyer) {
        let master = await this.store.get<{ userId: string }>(`EMAIL#${digest(masterEmail)}`);
        if (!master) { await this.register({ name: 'Marina Demo', email: masterEmail, password }); master = await this.store.get<{ userId: string }>(`EMAIL#${digest(masterEmail)}`); }
        const masterAccount = master && await this.store.get<Account>(`USER#${master.userId}`);
        if (!masterAccount) throw new ApiError(503, 'Não foi possível preparar a demonstração.');
        const invite = await this.invite(masterAccount, buyerEmail);
        await this.register({ name: 'Rafael Demo', email: buyerEmail, password, inviteToken: invite.token });
      } else await this.register({ name: 'Marina Demo', email: masterEmail, password });
    }
    return this.login({ email: wantedEmail, password });
  }
  async authenticate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'Faça login.');
    const session = await this.store.get<Session>(`SESSION#${digest(token)}`);
    const account = session && session.expiresAt > now() && await this.store.get<Account>(`USER#${session.userId}`);
    if (!account || !account.active) throw new ApiError(401, 'Sessão inválida ou expirada.');
    return account;
  }
  async logout(token: string) { await this.store.remove(`SESSION#${digest(token)}`); }
  async invite(account: Account, address: unknown) {
    authorize(account, account.masterId, true);
    const token = secret(), expiresAt = now() + 48 * 60 * 60;
    await this.store.put(`INVITE#${digest(token)}`, 'PROFILE', { masterId: account.masterId, email: email(address), expiresAt });
    return { token, expiresAt }; // Returned to the master; no email is sent automatically.
  }
  async members(account: Account) {
    authorize(account, account.masterId, true);
    const members = await this.store.list<{ userId: string }>(`MASTER#${account.masterId}`, 'MEMBER#');
    const accounts = await Promise.all(members.map(m => this.store.get<Account>(`USER#${m.userId}`)));
    return accounts.filter((a): a is Account => Boolean(a)).map(publicAccount);
  }
  async revoke(account: Account, userId: unknown) {
    authorize(account, account.masterId, true);
    const buyer = await this.store.get<Account>(`USER#${identifier(userId)}`);
    if (!buyer || buyer.masterId !== account.masterId || buyer.role !== 'buyer') throw new ApiError(404, 'Comprador não encontrado.');
    await this.store.put(`USER#${buyer.id}`, 'PROFILE', { ...buyer, active: false });
  }
  async uploadAvatar(account: Account, bytes: Uint8Array, requestedType: string | null, targetUserId?: unknown) {
    authorize(account, account.masterId);
    const contentType = validateAvatar(bytes, requestedType);
    const targetId = targetUserId ? identifier(targetUserId) : account.id;
    const target = targetId === account.id ? account : await this.store.get<Account>(`USER#${targetId}`);
    if (!target || target.masterId !== account.masterId || (account.role !== 'master' && target.id !== account.id)) throw new ApiError(403, 'Acesso não permitido.');
    const updated: Account = { ...target, avatarKey: avatarObjectKey(account.masterId, target.id), avatarContentType: contentType, avatarUpdatedAt: new Date().toISOString() };
    await this.store.aws.s3.send(new PutObjectCommand({ Bucket: this.store.aws.bucket, Key: updated.avatarKey, Body: bytes, ContentType: contentType, ServerSideEncryption: 'AES256' }));
    await this.store.put(`USER#${target.id}`, 'PROFILE', updated);
    return publicAccount(updated);
  }
  async avatar(account: Account, userId: unknown) {
    authorize(account, account.masterId);
    const owner = await this.store.get<Account>(`USER#${identifier(userId)}`);
    if (!owner || !owner.active || owner.masterId !== account.masterId || !owner.avatarKey || !owner.avatarContentType) throw new ApiError(404, 'Foto não encontrada.');
    const result = await this.store.aws.s3.send(new GetObjectCommand({ Bucket: this.store.aws.bucket, Key: owner.avatarKey }));
    if (!result.Body) throw new ApiError(404, 'Foto não encontrada.');
    return { bytes: await result.Body.transformToByteArray(), contentType: owner.avatarContentType };
  }
  async cards(account: Account) {
    authorize(account, account.masterId);
    return this.store.list<Card>(`MASTER#${account.masterId}`, 'CARD#');
  }
  async createCard(account: Account, input: Record<string, unknown>) {
    authorize(account, account.masterId, true);
    const card: Card = { id: randomUUID(), masterId: account.masterId, name: text(input.name, 'Nome do cartão'), dueDay: dueDay(input.dueDay) };
    await this.store.put(`MASTER#${account.masterId}`, `CARD#${card.id}`, card);
    return card;
  }
  async people(account: Account) {
    authorize(account, account.masterId);
    const people = await this.store.list<PersonRecord>(`MASTER#${account.masterId}`, 'PERSON#');
    return account.role === 'master' ? people : people.filter(person => person.accountId === account.id);
  }
  async savePerson(account: Account, input: Record<string, unknown>, personId?: unknown) {
    authorize(account, account.masterId, true);
    const id = personId ? identifier(personId) : randomUUID(), key = `PERSON#${id}`, current = personId ? await this.store.get<PersonRecord>(`MASTER#${account.masterId}`, key) : undefined;
    if (personId && !current) throw new ApiError(404, 'Pessoa não encontrada.');
    const timestamp = new Date().toISOString();
    const person: PersonRecord = { id, masterId: account.masterId, name: text(input.name, 'Nome', 80), color: typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#18794e', monthlyLimitCents: input.monthlyLimitCents === undefined || input.monthlyLimitCents === null ? undefined : integer(input.monthlyLimitCents, 'Meta', 0), accountId: input.accountId === undefined || input.accountId === null || input.accountId === '' ? undefined : identifier(input.accountId), version: (current?.version || 0) + 1, createdAt: current?.createdAt || timestamp, updatedAt: timestamp };
    if (person.accountId) { const member = await this.store.get<Account>(`USER#${person.accountId}`); if (!member || member.masterId !== account.masterId || member.role !== 'buyer') throw new ApiError(400, 'A conta escolhida não pertence a este grupo.'); }
    if (current) {
      const version = integer(input.version, 'Versão', 1);
      await this.store.replaceVersioned(`MASTER#${account.masterId}`, key, person, version);
    } else await this.store.put(`MASTER#${account.masterId}`, key, person);
    return person;
  }
  async statements(account: Account, cardId?: unknown) {
    authorize(account, account.masterId);
    const all = await this.store.list<StatementRecord>(`MASTER#${account.masterId}`, 'STATEMENT#');
    const filtered = cardId ? all.filter(statement => statement.cardId === identifier(cardId)) : all;
    return filtered.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }
  async statement(account: Account, id: unknown) {
    authorize(account, account.masterId);
    const bill = await this.store.get<StatementRecord>(`MASTER#${account.masterId}`, `STATEMENT#${identifier(id)}`);
    if (!bill) throw new ApiError(404, 'Fatura não encontrada.');
    const transactions = await this.store.list<TransactionRecord>(`MASTER#${account.masterId}`, `TRANSACTION#${bill.id}#`);
    const people = await this.people(account);
    const visible = account.role === 'master' ? transactions : transactions.filter(transaction => transaction.buyerId && people.some(person => person.id === transaction.buyerId));
    return { ...bill, transactions: visible };
  }
  async importStatement(account: Account, cardId: unknown, date: unknown, bytes: Uint8Array, source: Record<string, unknown>) {
    authorize(account, account.masterId, true);
    const transactions = Array.isArray(source.transactions) ? source.transactions : [];
    if (!transactions.length || transactions.length > 2000) throw new ApiError(400, 'A fatura precisa ter de 1 a 2000 lançamentos.');
    const doc = await this.upload(account, cardId, date, bytes);
    const total = integer(source.total, 'Total'), computed = transactions.reduce((sum, value) => sum + integer((value as Record<string, unknown>).cents, 'Valor'), 0);
    if (computed !== total) throw new ApiError(400, 'A soma dos lançamentos não confere com o total da fatura.');
    const timestamp = new Date().toISOString();
    const statement: StatementRecord = { ...doc, fingerprint: text(source.fingerprint, 'Identificador', 128), filename: text(source.filename, 'Nome do arquivo', 255), total, nextTotal: source.nextTotal === undefined ? undefined : integer(source.nextTotal, 'Próximo total'), laterTotal: source.laterTotal === undefined ? undefined : integer(source.laterTotal, 'Demais faturas'), holderTotals: Array.isArray(source.holderTotals) ? source.holderTotals.map(value => ({ name: text((value as Record<string, unknown>).name, 'Portador'), cents: integer((value as Record<string, unknown>).cents, 'Valor') })) : [], warnings: Array.isArray(source.warnings) ? source.warnings.filter(value => typeof value === 'string').slice(0, 100) : [], importedAt: typeof source.importedAt === 'string' ? source.importedAt : timestamp, version: 1, transactionCount: transactions.length };
    const records = transactions.map((value, index): TransactionRecord => {
      const transaction = value as Record<string, unknown>, rawInstallment = transaction.installment as Record<string, unknown> | undefined;
      const allocations = Array.isArray(transaction.allocations) ? transaction.allocations.map(allocation => ({ personId: identifier((allocation as Record<string, unknown>).personId), cents: integer((allocation as Record<string, unknown>).cents, 'Divisão') })) : [];
      if (Math.abs(allocations.reduce((sum, allocation) => sum + allocation.cents, 0)) > Math.abs(integer(transaction.cents, 'Valor'))) throw new ApiError(400, 'A divisão não pode ultrapassar o valor da compra.');
      return { id: text(transaction.id, 'Lançamento', 128), statementId: doc.id, masterId: account.masterId, date: text(transaction.date, 'Data', 10), merchant: text(transaction.merchant, 'Estabelecimento', 150), cents: integer(transaction.cents, 'Valor'), holder: text(transaction.holder, 'Portador', 100), category: text(transaction.category, 'Categoria', 60), installment: rawInstallment ? { current: integer(rawInstallment.current, 'Parcela', 1, 60), total: integer(rawInstallment.total, 'Parcelas', 1, 60) } : undefined, nextCents: transaction.nextCents === undefined ? undefined : integer(transaction.nextCents, 'Próxima parcela'), kind: transaction.kind === 'service' ? 'service' : 'purchase', allocations, carryForward: transaction.carryForward !== false, note: transaction.note === undefined || transaction.note === null || transaction.note === '' ? undefined : text(transaction.note, 'Observação', 2000), buyerId: transaction.buyerId === undefined || transaction.buyerId === null || transaction.buyerId === '' ? null : identifier(transaction.buyerId), sharedCost: transaction.sharedCost === true, version: 1, updatedAt: timestamp };
    });
    try {
      await this.store.transaction([this.store.unique(`MASTER#${account.masterId}`, `STATEMENT#${doc.id}`, statement), ...records.map(record => this.store.unique(`MASTER#${account.masterId}`, `TRANSACTION#${doc.id}#${record.id}`, record))]);
    } catch (error) { await this.store.remove(`MASTER#${account.masterId}`, `DOCUMENT#${doc.id}`); await this.store.remove(`MASTER#${account.masterId}`, `DUE#${doc.cardId}#${doc.dueDate}`); await this.store.aws.s3.send(new DeleteObjectCommand({ Bucket: this.store.aws.bucket, Key: doc.key })); throw error; }
    return statement;
  }
  async updateTransaction(account: Account, statementId: unknown, transactionId: unknown, input: Record<string, unknown>) {
    authorize(account, account.masterId);
    const key = `TRANSACTION#${identifier(statementId)}#${identifier(transactionId)}`, current = await this.store.get<TransactionRecord>(`MASTER#${account.masterId}`, key);
    if (!current) throw new ApiError(404, 'Lançamento não encontrado.');
    const own = current.buyerId && (await this.people(account)).some(person => person.id === current.buyerId);
    if (account.role !== 'master') {
      if (!own || Object.keys(input).some(key => key !== 'note' && key !== 'version')) throw new ApiError(403, 'Compradores só podem editar a observação da própria compra.');
    }
    const version = integer(input.version, 'Versão', 1), updated: TransactionRecord = account.role === 'buyer' ? { ...current, note: input.note ? text(input.note, 'Observação', 2000) : undefined, version: current.version + 1, updatedAt: new Date().toISOString() } : { ...current, ...input, id: current.id, statementId: current.statementId, masterId: current.masterId, version: current.version + 1, updatedAt: new Date().toISOString() };
    await this.store.replaceVersioned(`MASTER#${account.masterId}`, key, updated, version);
    return updated;
  }
  async workspace(account: Account) {
    authorize(account, account.masterId);
    const saved = await this.store.get<Workspace>(`MASTER#${account.masterId}`, 'WORKSPACE');
    return saved || { state: null, version: 0, updatedAt: null };
  }
  async saveWorkspace(account: Account, input: Record<string, unknown>) {
    authorize(account, account.masterId, true);
    if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state)) throw new ApiError(400, 'Estado do organizador inválido.');
    const current = await this.store.get<Workspace>(`MASTER#${account.masterId}`, 'WORKSPACE');
    const expected = integer(input.version, 'Versão', 0);
    if ((current?.version || 0) !== expected) throw new ApiError(409, 'A organização foi alterada por outra pessoa. Atualize a tela antes de salvar.');
    const saved: Workspace = { state: input.state, version: expected + 1, updatedAt: new Date().toISOString() };
    if (current) await this.store.replaceVersioned(`MASTER#${account.masterId}`, 'WORKSPACE', saved, expected);
    else await this.store.put(`MASTER#${account.masterId}`, 'WORKSPACE', saved);
    return saved;
  }
  async documents(account: Account) {
    authorize(account, account.masterId);
    const docs = await this.store.list<Document>(`MASTER#${account.masterId}`, 'DOCUMENT#');
    return docs.sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.cardId.localeCompare(b.cardId));
  }
  async upload(account: Account, cardId: unknown, date: unknown, bytes: Uint8Array) {
    authorize(account, account.masterId, true);
    const card = await this.store.get<Card>(`MASTER#${account.masterId}`, `CARD#${identifier(cardId)}`);
    if (!card) throw new ApiError(404, 'Cartão não encontrado.');
    validatePdf(bytes);
    const id = randomUUID(), due = dueDate(date), hash = digest(bytes);
    const doc: Document = { id, masterId: account.masterId, cardId: card.id, dueDate: due, key: documentKey(account.masterId, card.id, due, id), size: bytes.length, sha256: hash, createdAt: new Date().toISOString() };
    const { s3, bucket } = this.store.aws;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: doc.key, Body: bytes, ContentType: 'application/pdf', ServerSideEncryption: 'AES256' }));
    try {
      // Card + complete due date is unique; same totals on different cards are allowed.
      await this.store.transaction([this.store.unique(`MASTER#${account.masterId}`, `DOCUMENT#${id}`, doc), this.store.unique(`MASTER#${account.masterId}`, `DUE#${card.id}#${due}`, { documentId: id })]);
    } catch (error) {
      // Only compensate a definite conflict. An uncertain transport failure may have committed.
      if (error instanceof ApiError && error.status === 409) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: doc.key }));
      throw error;
    }
    return doc;
  }
  async download(account: Account, id: unknown) {
    authorize(account, account.masterId);
    // Tenant comes exclusively from the authenticated account, never from request data.
    const doc = await this.store.get<Document>(`MASTER#${account.masterId}`, `DOCUMENT#${identifier(id)}`);
    if (!doc) throw new ApiError(404, 'Fatura não encontrada.');
    authorize(account, doc.masterId);
    const result = await this.store.aws.s3.send(new GetObjectCommand({ Bucket: this.store.aws.bucket, Key: doc.key }));
    if (!result.Body) throw new ApiError(404, 'Arquivo não encontrado.');
    return { bytes: await result.Body.transformToByteArray(), filename: `fatura-${doc.dueDate}-${doc.id}.pdf` };
  }
}
