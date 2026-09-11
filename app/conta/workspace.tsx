'use client';
import './avatar.css';
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ArrowLeft, Calendar as CalendarDays, Check, Cloud, CreditCard, Download, EditPencil, Page as FileText, LogOut, Plus, ShieldCheck, Upload, UserPlus, Group as Users, Wallet } from 'iconoir-react';

type Account = { id: string; masterId: string; role: 'master' | 'buyer'; name: string; email: string; active: boolean; avatarUrl?: string | null };
type Card = { id: string; name: string; dueDay: number };
type Document = { id: string; cardId: string; dueDate: string; size: number; createdAt: string };
const accountBackend = process.env.NEXT_PUBLIC_ACCOUNT_BACKEND === 'supabase' ? 'supabase' : 'floci';
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

export default function CloudWorkspace() {
  const [account, setAccount] = useState<Account | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [cards, setCards] = useState<Card[]>([]), [documents, setDocuments] = useState<Document[]>([]), [members, setMembers] = useState<Account[]>([]), [mode, setMode] = useState<'login'|'register'>('login');
  const [invite, setInvite] = useState(''), [busy, setBusy] = useState(false); const fileInput = useRef<HTMLInputElement>(null), avatarInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async (current: Account) => {
    const [nextCards, nextDocuments, nextMembers] = await Promise.all([api<Card[]>('cards'), api<Document[]>('documents'), current.role === 'master' ? api<Account[]>('members') : Promise.resolve([])]);
    setCards(nextCards); setDocuments(nextDocuments); setMembers(nextMembers);
  }, []);
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get('demo');
    const session = demo === 'master' || demo === 'buyer' ? api<{account: Account}>('demo-login', json({ role: demo })).then(result => result.account) : api<Account>('me');
    session.then(async current => { setAccount(current); await refresh(current); }).catch(() => {}).finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('invite')) setMode('register'); }, []);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      const linkToken = new URLSearchParams(window.location.search).get('invite');
      const payload = { name: form.get('name'), email: form.get('email'), password: form.get('password'), ...((form.get('inviteToken') || linkToken) ? { inviteToken: form.get('inviteToken') || linkToken } : {}) };
      if (mode === 'register') await api<Account>('register', json(payload));
      const result = await api<{account: Account}>('login', json(payload)); setAccount(result.account); await refresh(result.account);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function demoAuthenticate(role: 'master'|'buyer') {
    setBusy(true); setError('');
    try { const result = await api<{account: Account}>('demo-login', json({ role })); setAccount(result.account); await refresh(result.account); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function createCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try { await api('cards', json({ name: form.get('name'), dueDay: Number(form.get('dueDay')) })); await refresh(account!); event.currentTarget.reset(); setNotice('Cartão cadastrado.'); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try { const result = await api<{token:string}>('invites', json({ email: form.get('email') })); setInvite(`${window.location.origin}/conta?invite=${result.token}`); setNotice('Link de convite criado. Copie e envie à pessoa.'); event.currentTarget.reset(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
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
  async function logout() { await api('logout', json({})).catch(() => {}); setAccount(null); setCards([]); setDocuments([]); setMembers([]); }
  if (loading) return <main className="cloud-loading"><Cloud/><span>Conectando ao backend local…</span></main>;
  if (!account) return <main className="auth-shell"><section className="auth-story"><a className="auth-logo" href="/"><img src="/brand/sharecard_logo.png" alt="ShareCard"/></a><div><span className="cloud-kicker">ESPAÇO COMPARTILHADO</span><h1>A fatura mora com o dono do cartão.</h1><p>O master organiza os cartões e convida seus compradores. Todos enxergam o mesmo documento, com acesso conferido pelo backend.</p></div><ul><li><ShieldCheck/> Bucket privado por aplicação</li><li><Users/> Grupo isolado por master</li><li><CalendarDays/> Ciclos 06 e 20 separados</li></ul></section><section className="auth-form"><a className="back-link" href="/"><ArrowLeft/> Voltar ao organizador</a><div className="auth-heading"><span>{mode === 'login' ? 'ENTRAR' : 'CRIAR CONTA'}</span><h2>{mode === 'login' ? 'Abra seu espaço.' : 'Comece como master ou aceite um convite.'}</h2></div><form onSubmit={authenticate}>{mode === 'register' && <label>Seu nome<input name="name" required maxLength={100} autoComplete="name"/></label>}<label>E-mail<input name="email" type="email" required autoComplete="email"/></label><label>Senha<input name="password" type="password" minLength={12} maxLength={128} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/><small>Mínimo de 12 caracteres.</small></label>{mode === 'register' && <label>Código de convite <span>opcional</span><input name="inviteToken" maxLength={64}/><small>Sem código, você cria um espaço master.</small></label>}{error && <p className="cloud-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Ainda não tenho uma conta' : 'Já tenho uma conta'}</button><p className="local-mode">Esta tela usa o Floci local. Ainda não é uma autenticação pronta para internet.</p></section></main>;
  const cardName = (id: string) => cards.find(card => card.id === id)?.name || 'Cartão';
  return <main className="cloud-shell"><header className="cloud-top"><a href="/" className="cloud-brand"><img src="/brand/sharecard_logo.png" alt="ShareCard"/></a><button className="profile-photo-button" type="button" onClick={() => avatarInput.current?.click()} aria-label="Alterar sua foto de perfil"><ProfilePhoto account={account}/><EditPencil/></button><div><span>{account.name}</span><small>{account.role === 'master' ? 'Master · dono do cartão' : 'Comprador vinculado'}</small></div><button onClick={logout}><LogOut/> Sair</button></header><section className="cloud-content"><input ref={avatarInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => uploadAvatar(event.target.files?.[0])}/><div className="cloud-title"><div><span className="cloud-kicker">BACKEND NODE.JS · FLOCI</span><h1>{account.role === 'master' ? 'Seu cofre de faturas.' : 'Faturas do seu grupo.'}</h1><p>{account.role === 'master' ? 'Cadastre seus ciclos, guarde PDFs e mantenha os compradores no mesmo contexto.' : 'Consulte os cartões e baixe os documentos compartilhados pelo master.'}</p></div><div className="cloud-status"><Check/><span>Espaço ativo<small>{documents.length} {documents.length === 1 ? 'fatura salva' : 'faturas salvas'}</small></span></div></div><button className="avatar-callout" type="button" onClick={() => avatarInput.current?.click()} disabled={busy}><ProfilePhoto account={account}/><span><strong>Sua foto no grupo</strong><small>JPEG, PNG ou WebP · até 2 MB · guardada no bucket privado</small></span><EditPencil/></button>{error && <p className="cloud-error" role="alert">{error}</p>}{notice && <p className="cloud-notice" role="status">{notice}<button onClick={() => setNotice('')}>Fechar</button></p>}
  {account.role === 'master' && <div className="master-tools"><section><div className="tool-title"><CreditCard/><div><h2>Novo cartão</h2><p>Use um cadastro para cada ciclo.</p></div></div><form onSubmit={createCard}><label>Apelido<input name="name" required placeholder="Ex.: Itaú principal" maxLength={100}/></label><label>Vence todo dia<input name="dueDay" type="number" min="1" max="31" required placeholder="06"/></label><button disabled={busy}><Plus/> Adicionar</button></form></section><section><div className="tool-title"><UserPlus/><div><h2>Convidar comprador</h2><p>O código vale por 48 horas e uma utilização.</p></div></div><form onSubmit={createInvite}><label>E-mail<input name="email" type="email" required placeholder="pessoa@email.com"/></label><button disabled={busy}><UserPlus/> Criar convite</button></form>{invite && <div className="invite-token"><span>Código do convite</span><code>{invite}</code></div>}</section></div>}
  <section className="cycle-section"><div className="section-line"><div><span>SEUS CICLOS</span><h2>Cartões e vencimentos</h2></div><strong>{cards.length}</strong></div>{cards.length ? <div className="cycle-list">{cards.map(card => <article key={card.id}><span className="due-day">{String(card.dueDay).padStart(2,'0')}</span><div><strong>{card.name}</strong><small>Vencimento mensal no dia {card.dueDay}</small></div></article>)}</div> : <p className="cloud-empty">{account.role === 'master' ? 'Cadastre o primeiro cartão para liberar o envio de PDFs.' : 'O master ainda não cadastrou cartões.'}</p>}</section>
  {account.role === 'master' && cards.length > 0 && <UploadForm cards={cards} busy={busy} fileRef={fileInput} onUpload={upload}/>}<section className="document-section"><div className="section-line"><div><span>ARQUIVO DO GRUPO</span><h2>Faturas por vencimento</h2></div><strong>{documents.length}</strong></div>{documents.length ? <div className="document-list">{documents.map(doc => <article key={doc.id}><div className="document-date"><span>{date(doc.dueDate).slice(0,5)}</span><small>{doc.dueDate.slice(0,4)}</small></div><FileText/><div><strong>{cardName(doc.cardId)}</strong><small>Vence em {date(doc.dueDate)} · {size(doc.size)}</small></div><a href={endpoint(`documents/${doc.id}`)}><Download/> Baixar PDF</a></article>)}</div> : <p className="cloud-empty">Nenhuma fatura foi enviada para este grupo.</p>}</section>
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
  return <section className="upload-band"><div><Upload/><span><strong>Guardar nova fatura</strong><small>Escolha o cartão e informe a data real do vencimento.</small></span></div><select aria-label="Cartão" value={cardId} onChange={event => setCardId(event.target.value)}>{cards.map(card => <option key={card.id} value={card.id}>{card.name} · dia {card.dueDay}</option>)}</select><input aria-label="Data real de vencimento" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/><label className="file-choice"><input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0])}/><span>{file?.name || 'Selecionar PDF'}</span></label><button disabled={busy || !file || !dueDate} onClick={() => onUpload(file, cardId, dueDate)}>{busy ? 'Enviando…' : 'Salvar no S3'}</button></section>;
}
