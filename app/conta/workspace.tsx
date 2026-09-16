'use client';
import './avatar.css';
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, Calendar as CalendarDays, Check, Cloud, CreditCard, Download, EditPencil, Page as FileText, LogOut, Plus, ShieldCheck, Upload, UserPlus, Group as Users, Wallet } from 'iconoir-react';

type Account = { id: string; masterId: string; role: 'master' | 'buyer'; name: string; email: string; active: boolean; avatarUrl?: string | null };
type Card = { id: string; name: string; dueDay: number };
type Document = { id: string; cardId: string; dueDate: string; size: number; createdAt: string };
type WorkspaceCache = { account: Account; cards: Card[]; documents: Document[]; members: Account[]; managementLoaded: boolean; updatedAt: number };
const CACHE_TTL_MS = 45_000;
let workspaceCache: WorkspaceCache | null = null;
const cachedWorkspace = (section: 'profile' | 'management') => {
  if (typeof window !== 'undefined' && window.sessionStorage.getItem('sharecard:workspace-stale') === '1') return null;
  if (!workspaceCache || Date.now() - workspaceCache.updatedAt > CACHE_TTL_MS) return null;
  return section === 'profile' || workspaceCache.managementLoaded ? workspaceCache : null;
};
const localHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const accountBackend = process.env.NEXT_PUBLIC_ACCOUNT_BACKEND === 'floci' || localHost && !process.env.NEXT_PUBLIC_SUPABASE_URL ? 'floci' : 'supabase';
const endpoint = (path: string) => accountBackend === 'floci' ? `/api/backend/${path}` : ['register', 'login', 'me', 'logout'].includes(path) ? `/api/supabase/auth/${path}` : `/api/supabase/workspace/${path}`;
const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(endpoint(path), { credentials: 'same-origin', ...options, headers: { ...(options?.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir esta ação.');
  return data as T;
};
const json = (body: object): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
const size = (value: number) => value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

export default function CloudWorkspace({ embedded = false, section = 'management' }: { embedded?: boolean; section?: 'profile' | 'management' }) {
  const initial = cachedWorkspace(section);
  const [account, setAccount] = useState<Account | null>(() => initial?.account ?? null), [loading, setLoading] = useState(() => embedded && !initial), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [cards, setCards] = useState<Card[]>(() => initial?.cards ?? []), [documents, setDocuments] = useState<Document[]>(() => initial?.documents ?? []), [members, setMembers] = useState<Account[]>(() => initial?.members ?? []), [mode, setMode] = useState<'login'|'register'>('login');
  const [invite, setInvite] = useState(''), [busy, setBusy] = useState(false), [selectedCardId, setSelectedCardId] = useState(''); const fileInput = useRef<HTMLInputElement>(null), avatarInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async (current: Account) => {
    if (section === 'profile') {
      workspaceCache = { ...(workspaceCache ?? { cards: [], documents: [], members: [], managementLoaded: false }), account: current, updatedAt: Date.now() };
      return;
    }
    const [nextCards, nextDocuments, nextMembers] = await Promise.all([api<Card[]>('cards'), api<Document[]>('documents'), current.role === 'master' ? api<Account[]>('members') : Promise.resolve([])]);
    setCards(nextCards); setDocuments(nextDocuments); setMembers(nextMembers);
    workspaceCache = { account: current, cards: nextCards, documents: nextDocuments, members: nextMembers, managementLoaded: true, updatedAt: Date.now() };
    window.sessionStorage.removeItem('sharecard:workspace-stale');
  }, [section]);
  useEffect(() => {
    const cached = cachedWorkspace(section);
    if (cached) { setAccount(cached.account); setCards(cached.cards); setDocuments(cached.documents); setMembers(cached.members); setLoading(false); return; }
    api<Account>('me').then(async current => {
      if (!embedded) { window.location.replace('/organizador'); return; }
      setAccount(current); await refresh(current);
    }).catch(() => { workspaceCache = null; }).finally(() => setLoading(false));
  }, [refresh, section]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('invite')) setMode('register'); }, []);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      const linkToken = new URLSearchParams(window.location.search).get('invite');
      const payload = { name: form.get('name'), email: form.get('email'), password: form.get('password'), ...((form.get('inviteToken') || linkToken) ? { inviteToken: form.get('inviteToken') || linkToken } : {}) };
      if (mode === 'register') await api<Account>('register', json(payload));
      await api<{account: Account}>('login', json(payload)); window.location.replace('/organizador'); return;
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function createCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const target = event.currentTarget; setBusy(true); setError(''); const form = new FormData(target);
    try { await api('cards', json({ name: form.get('name'), dueDay: Number(form.get('dueDay')) })); await refresh(account!); target.reset(); setNotice('Cartão cadastrado.'); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const target = event.currentTarget; setBusy(true); setError(''); const form = new FormData(target);
    try { const result = await api<{token:string}>('invites', json({ email: form.get('email') })); setInvite(`${window.location.origin}/acesso?invite=${result.token}`); setNotice('Link de convite criado. Copie e envie à pessoa.'); target.reset(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function removeCard(card: Card) {
    if (!confirm(`Excluir o cartão ${card.name}? Esta ação só é possível quando não há faturas salvas.`)) return;
    setBusy(true); setError('');
    try { await api(`cards/${card.id}`, { method: 'DELETE' }); await refresh(account!); setNotice('Cartão excluído.'); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function removeDocument(document: Document) {
    if (!confirm(`Excluir a fatura com vencimento em ${date(document.dueDate)}? O PDF será removido do espaço do grupo.`)) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ workspace?: { state: unknown; version: number } | null }>(`documents/${document.id}`, { method: 'DELETE' });
      if (result.workspace) window.dispatchEvent(new CustomEvent('sharecard:workspace-replaced', { detail: result.workspace }));
      await refresh(account!); setNotice('Fatura, lançamentos e projeções vinculados foram excluídos. Agora o cartão pode ser removido, se desejar.');
    }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function upload(file?: File, cardId?: string, dueDate?: string) {
    if (!file || !cardId || !dueDate) return; setBusy(true); setError('');
    try { await api(`documents?cardId=${encodeURIComponent(cardId)}&dueDate=${dueDate}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' } }); await refresh(account!); setNotice('PDF salvo no espaço privado do master.'); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function uploadAvatar(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('Use uma foto JPEG, PNG ou WebP de até 2 MB.'); return; }
    setBusy(true); setError('');
    try { const updated = await api<Account>('avatar', { method: 'POST', body: file, headers: { 'Content-Type': file.type } }); setAccount(updated); await refresh(updated); setNotice('Foto de perfil salva no espaço privado do grupo.'); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); if (avatarInput.current) avatarInput.current.value = ''; }
  }
  async function logout() { await api('logout', json({})).catch(() => {}); workspaceCache = null; setAccount(null); setCards([]); setDocuments([]); setMembers([]); }
  if (loading) return embedded ? <section className="account-embedded-loading" aria-label="Carregando dados da conta"><span/></section> : <main className="cloud-loading"><Cloud/><span>Conectando ao seu espaço…</span></main>;
  if (!account && embedded) return <section className="account-auth-required panel"><span className="eyebrow">ACESSO NECESSÁRIO</span><h2>Entre para abrir seu espaço.</h2><p>Cartões, faturas e compradores ficam disponíveis após o login.</p><a className="button primary" href="/acesso">Entrar ou criar conta <ArrowRight/></a></section>;
  if (!account) return <main className="auth-shell auth-experience">
    <div className="auth-orbit auth-orbit-blue"/><div className="auth-orbit auth-orbit-teal"/><div className="auth-orbit auth-orbit-purple"/>
    <section className="auth-story">
      <a className="auth-logo" href="/"><img src="/brand/sharecard_logo.png" alt="ShareCard"/></a>
      <div className="auth-story-copy"><span className="cloud-kicker">COMPRAS EM CONJUNTO</span><h1>Compartilhe compras.<br/>Organize pagamentos.</h1><p>Tenha clareza sobre cada fatura e deixe os pagamentos de todos no mesmo lugar.</p></div>
      <div className="auth-illustration" aria-hidden="true"><div className="auth-mini-card auth-mini-total"><Wallet/><span><strong>R$ 320,00</strong><small>Dividido entre 4 pessoas</small></span><Check/></div><div className="auth-flow"><div className="auth-flow-card auth-flow-people"><Users/><span>Amigos<br/>e família</span></div><div className="auth-flow-card auth-flow-shopping"><CreditCard/><span>Compras<br/>compartilhadas</span></div><div className="auth-flow-mark"><img src="/brand/sharecard_symbol.png" alt=""/></div><div className="auth-flow-card auth-flow-split"><FileText/><span>Divisão<br/>automática</span></div><div className="auth-flow-card auth-flow-paid"><Check/><span>Tudo<br/>organizado</span></div></div><div className="auth-mini-card auth-mini-paid"><FileText/><span>Pagamento<br/><strong>confirmado!</strong></span><Check/></div></div>
      <ul className="auth-benefits"><li><ShieldCheck/> Seguro e confiável</li><li><Users/> Feito para compartilhar</li><li><CalendarDays/> Mais controle no dia a dia</li></ul>
    </section>
    <section className="auth-panel-wrap"><p className="auth-aside-note">Pagamentos mais simples<br/>para grandes momentos.</p><a className="back-link" href="/"><ArrowLeft/> Voltar</a><div className="auth-form">
      <div className="auth-tabs" role="tablist" aria-label="Acesso à conta"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Entrar</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Criar conta</button></div>
      <div className="auth-heading"><span className="auth-heading-icon"><ShieldCheck/></span><h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}</h2><p>{mode === 'login' ? 'Acesse sua conta para continuar.' : 'Comece a organizar as compras do seu grupo.'}</p></div>
      <form onSubmit={authenticate}>{mode === 'register' && <label>Seu nome<input name="name" required maxLength={100} autoComplete="name" placeholder="Seu nome completo"/></label>}<label>E-mail<input name="email" type="email" required autoComplete="email" placeholder="seu@email.com"/></label><label>Senha<input name="password" type="password" minLength={6} maxLength={128} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Digite sua senha' : 'Crie uma senha segura'}/><small>Use pelo menos 6 caracteres.</small></label>{mode === 'register' && <label>Código de convite <span>opcional</span><input name="inviteToken" maxLength={64} placeholder="Cole seu código"/><small>Sem código, você cria um espaço master.</small></label>}{error && <p className="cloud-error" role="alert">{error}</p>}<button className="button primary auth-submit" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? <>Entrar <ArrowRight/></> : <>Criar conta <ArrowRight/></>}</button></form>
      <p className="auth-switch">{mode === 'login' ? <>Ainda não tem uma conta? <button type="button" onClick={() => { setMode('register'); setError(''); }}>Criar conta</button></> : <>Já possui uma conta? <button type="button" onClick={() => { setMode('login'); setError(''); }}>Entrar</button></>}</p><p className="local-mode"><ShieldCheck/> Seus dados são protegidos e seguros.</p>
    </div></section>
  </main>;
  const cardName = (id: string) => cards.find(card => card.id === id)?.name || 'Cartão';
  return <main className={`cloud-shell ${embedded ? "account-embedded" : ""} ${section === "profile" ? "account-profile" : ""}`}><header hidden={embedded} className="cloud-top"><a href="/organizador" className="cloud-brand"><img src="/brand/sharecard_logo.png" alt="ShareCard"/></a><nav className="cloud-nav" aria-label="Navegação principal"><a href="/organizador">Organizador</a><a href="/pessoas">Pessoas</a><a className="active" href="/perfil">Conta</a></nav><button className="profile-photo-button" type="button" onClick={() => avatarInput.current?.click()} aria-label="Alterar sua foto de perfil"><ProfilePhoto account={account}/><EditPencil/></button><div className="cloud-user"><span>{account.name}</span><small>{account.role === 'master' ? 'Master' : 'Comprador'}</small></div><button className="cloud-logout" onClick={logout}><LogOut/> <span>Sair</span></button></header><section className="cloud-content"><input ref={avatarInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => uploadAvatar(event.target.files?.[0])}/><div hidden={embedded} className="cloud-title"><div><span className="cloud-kicker">ESPAÇO COMPARTILHADO</span><h1>{account.role === 'master' ? 'Seu cofre de faturas.' : 'Faturas do seu grupo.'}</h1><p>{account.role === 'master' ? 'Cadastre seus ciclos, guarde PDFs e mantenha os compradores no mesmo contexto.' : 'Consulte os cartões e baixe os documentos compartilhados pelo master.'}</p></div><div className="cloud-status"><Check/><span>Espaço ativo<small>{documents.length} {documents.length === 1 ? 'fatura salva' : 'faturas salvas'}</small></span></div></div>{section === 'profile' && <button className="avatar-callout" type="button" onClick={() => avatarInput.current?.click()} disabled={busy}><ProfilePhoto account={account}/><span><strong>Sua foto no grupo</strong><small>JPEG, PNG ou WebP · até 2 MB · guardada no bucket privado</small></span><EditPencil/></button>}{section === 'profile' && <section className="profile-details"><div><span className="eyebrow">MEU PERFIL</span><h2>{account.name}</h2><p>{account.email}</p></div><dl><div><dt>Perfil</dt><dd>{account.role === 'master' ? 'Dono do cartão' : 'Comprador convidado'}</dd></div><div><dt>Foto</dt><dd>Salva no espaço privado</dd></div></dl></section>}{error && <p className="cloud-error" role="alert">{error}</p>}{notice && <p className="cloud-notice" role="status">{notice}<button onClick={() => setNotice('')}>Fechar</button></p>}
  {account.role === 'master' && <div className="master-tools"><section><div className="tool-title"><CreditCard/><div><h2>Novo cartão</h2><p>Use um cadastro para cada ciclo.</p></div></div><form onSubmit={createCard}><label>Apelido<input name="name" required placeholder="Ex.: Itaú principal" maxLength={100}/></label><label>Vence todo dia<input name="dueDay" type="number" min="1" max="31" required placeholder="06"/></label><button disabled={busy}><Plus/> Adicionar</button></form></section><section><div className="tool-title"><UserPlus/><div><h2>Convidar comprador</h2><p>O código vale por 48 horas e uma utilização.</p></div></div><form onSubmit={createInvite}><label>E-mail<input name="email" type="email" required placeholder="pessoa@email.com"/></label><button disabled={busy}><UserPlus/> Criar convite</button></form>{invite && <div className="invite-token"><span>Código do convite</span><code>{invite}</code></div>}</section></div>}
  <section className="cycle-section"><div className="section-line"><div><span>SEUS CARTÕES</span><h2>Cartões e compradores</h2></div><strong>{cards.length}</strong></div>{cards.length ? <div className="visual-card-grid">{cards.map(card => <button key={card.id} type="button" className={`visual-credit-card ${card.name.toLowerCase().includes('nubank') ? 'nubank' : card.name.toLowerCase().includes('caixa') ? 'caixa' : 'itau'} ${selectedCardId === card.id ? 'selected' : ''}`} onClick={() => setSelectedCardId(card.id)}><span className="visual-card-bank">{card.name}</span><span className="visual-card-chip"/><span className="visual-card-number">•••• •••• •••• {card.id.slice(-4)}</span><span className="visual-card-due">VENCE DIA {String(card.dueDay).padStart(2,'0')}</span></button>)}</div> : <p className="cloud-empty">Cadastre seu primeiro cartão a partir da importação da fatura.</p>}{selectedCardId && <div className="selected-card-detail"><div><span className="eyebrow">CARTÃO SELECIONADO</span><h3>{cardName(selectedCardId)}</h3><p>{documents.filter(document => document.cardId === selectedCardId).length} faturas salvas neste cartão.</p></div><div className="selected-card-buyers">{members.filter(member => member.role === 'buyer' && member.active).map(member => <div key={member.id}><ProfilePhoto account={member}/><span>{member.name}</span></div>)}{!members.filter(member => member.role === 'buyer' && member.active).length && <span>Nenhum comprador com conta vinculado.</span>}</div>{account.role === 'master' && <button className="text-button" type="button" disabled={busy} onClick={() => { const card = cards.find(item => item.id === selectedCardId); if (card) void removeCard(card); }}>Excluir cartão</button>}</div>}</section>  {account.role === 'master' && cards.length > 0 && <UploadForm cards={cards} busy={busy} fileRef={fileInput} onUpload={upload}/>}<section className="document-section"><div className="section-line"><div><span>ARQUIVO DO GRUPO</span><h2>Faturas por vencimento</h2></div><strong>{documents.length}</strong></div>{documents.length ? <div className="document-list">{documents.map(doc => <article key={doc.id}><div className="document-date"><span>{date(doc.dueDate).slice(0,5)}</span><small>{doc.dueDate.slice(0,4)}</small></div><FileText/><div><strong>{cardName(doc.cardId)}</strong><small>Vence em {date(doc.dueDate)} · {size(doc.size)}</small></div><a href={endpoint(`documents/${doc.id}`)}><Download/> Baixar PDF</a>{account.role === 'master' && <button className="text-button document-delete" type="button" disabled={busy} onClick={() => removeDocument(doc)}>Excluir</button>}</article>)}</div> : <p className="cloud-empty">Nenhuma fatura foi enviada para este grupo.</p>}</section>
  {account.role === 'master' && <section className="member-section"><div className="section-line"><div><span>ACESSO</span><h2>Pessoas vinculadas</h2></div><strong>{members.length}</strong></div><div className="member-list">{members.map(member => <div key={member.id}><ProfilePhoto account={member}/><div><strong>{member.name}</strong><small>{member.email} · {member.role === 'master' ? 'Master' : member.active ? 'Comprador ativo' : 'Acesso revogado'}</small></div>{member.role === 'buyer' && member.active && <button onClick={async () => { if (!confirm(`Revogar o acesso de ${member.name}?`)) return; try { await api('members/revoke', json({ userId: member.id })); await refresh(account); setNotice('Acesso revogado.'); } catch (reason) { setError((reason as Error).message); } }}>Revogar</button>}</div>)}</div></section>}</section></main>;
}

function ProfilePhoto({ account }: { account: Account }) {
  async function choose(file?: File) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { window.alert('Use uma foto JPEG, PNG ou WebP de até 2 MB.'); return; }
    const response = await fetch(`${endpoint('avatar')}?userId=${encodeURIComponent(account.id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file });
    if (!response.ok) { const data = await response.json().catch(() => null); window.alert(data?.error || 'Não foi possível salvar a foto.'); return; }
    window.location.reload();
  }
  return <label className="profile-photo-upload" title={`Adicionar ou trocar foto de ${account.name}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => choose(event.target.files?.[0])}/>{account.avatarUrl ? <img className="profile-photo" src={account.avatarUrl} alt={`Foto de ${account.name}`}/> : <span className="profile-photo profile-initial" aria-label={`${account.name} sem foto`}>{account.name.slice(0, 1).toUpperCase()}</span>}<span>Adicionar foto</span></label>;
}

function UploadForm({ cards, busy, fileRef, onUpload }: { cards: Card[]; busy: boolean; fileRef: RefObject<HTMLInputElement | null>; onUpload: (file?: File, cardId?: string, date?: string) => void }) {
  const [file, setFile] = useState<File>(), [cardId, setCardId] = useState(cards[0]?.id || ''), [dueDate, setDueDate] = useState('');
  return <section className="upload-band"><div><Upload/><span><strong>Guardar nova fatura</strong><small>Escolha o cartão e informe a data real do vencimento.</small></span></div><select aria-label="Cartão" value={cardId} onChange={event => setCardId(event.target.value)}>{cards.map(card => <option key={card.id} value={card.id}>{card.name} · dia {card.dueDay}</option>)}</select><input aria-label="Data real de vencimento" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/><label className="file-choice"><input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0])}/><span>{file?.name || 'Selecionar PDF'}</span></label><button disabled={busy || !file || !dueDate} onClick={() => onUpload(file, cardId, dueDate)}>{busy ? 'Enviando…' : 'Guardar fatura'}</button></section>;
}
