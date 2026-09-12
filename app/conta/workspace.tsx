'use client';
import './avatar.css';
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, Calendar as CalendarDays, Check, Cloud, CreditCard, Download, EditPencil, Page as FileText, LogOut, Plus, ShieldCheck, Upload, UserPlus, Group as Users, Wallet } from 'iconoir-react';

type Account = { id: string; masterId: string; role: 'master' | 'buyer'; name: string; email: string; active: boolean; avatarUrl?: string | null };
type Card = { id: string; name: string; dueDay: number };
type Document = { id: string; cardId: string; dueDate: string; size: number; createdAt: string };
const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const accountBackend = process.env.NEXT_PUBLIC_ACCOUNT_BACKEND === 'floci' || !hasSupabase ? 'floci' : 'supabase';
const endpoint = (path: string) => accountBackend === 'floci' ? `/api/backend/${path}` : ['register', 'login', 'me', 'logout'].includes(path) ? `/api/supabase/auth/${path}` : `/api/supabase/workspace/${path}`;
const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(endpoint(path), { credentials: 'same-origin', ...options, headers: { ...(options?.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || 'NÃƒÂ£o foi possÃƒÂ­vel concluir esta aÃƒÂ§ÃƒÂ£o.');
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
    api<Account>('me').then(async current => { setAccount(current); await refresh(current); }).catch(() => {}).finally(() => setLoading(false));
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
  async function createCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try { await api('cards', json({ name: form.get('name'), dueDay: Number(form.get('dueDay')) })); await refresh(account!); event.currentTarget.reset(); setNotice('CartÃƒÂ£o cadastrado.'); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try { const result = await api<{token:string}>('invites', json({ email: form.get('email') })); setInvite(`${window.location.origin}/conta?invite=${result.token}`); setNotice('Link de convite criado. Copie e envie ÃƒÂ  pessoa.'); event.currentTarget.reset(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function upload(file?: File, cardId?: string, dueDate?: string) {
    if (!file || !cardId || !dueDate) return; setBusy(true); setError('');
    try { await api(`documents?cardId=${encodeURIComponent(cardId)}&dueDate=${dueDate}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' } }); await refresh(account!); setNotice('PDF salvo no espaÃƒÂ§o privado do master.'); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function uploadAvatar(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('Use uma foto JPEG, PNG ou WebP de atÃƒÂ© 2 MB.'); return; }
    setBusy(true); setError('');
    try { const updated = await api<Account>('avatar', { method: 'POST', body: file, headers: { 'Content-Type': file.type } }); setAccount(updated); await refresh(updated); setNotice('Foto de perfil salva no espaÃƒÂ§o privado do grupo.'); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); if (avatarInput.current) avatarInput.current.value = ''; }
  }
  async function logout() { await api('logout', json({})).catch(() => {}); setAccount(null); setCards([]); setDocuments([]); setMembers([]); }
  if (loading) return <main className="cloud-loading"><Cloud/><span>Conectando ao seu espaÃƒÂ§oÃ¢â‚¬Â¦</span></main>;
  if (!account) return <main className="auth-shell auth-experience">
    <div className="auth-orbit auth-orbit-blue"/><div className="auth-orbit auth-orbit-teal"/><div className="auth-orbit auth-orbit-purple"/>
    <section className="auth-story">
      <a className="auth-logo" href="/"><img src="/brand/sharecard_logo.png" alt="ShareCard"/></a>
      <div className="auth-story-copy"><span className="cloud-kicker">COMPRAS EM CONJUNTO</span><h1>Compartilhe compras.<br/>Organize pagamentos.</h1><p>Tenha clareza sobre cada fatura e deixe os pagamentos de todos no mesmo lugar.</p></div>
      <div className="auth-illustration" aria-hidden="true"><div className="auth-mini-card auth-mini-total"><Wallet/><span><strong>R$ 320,00</strong><small>Dividido entre 4 pessoas</small></span><Check/></div><div className="auth-flow"><div className="auth-flow-card auth-flow-people"><Users/><span>Amigos<br/>e famÃ­lia</span></div><div className="auth-flow-card auth-flow-shopping"><CreditCard/><span>Compras<br/>compartilhadas</span></div><div className="auth-flow-mark"><img src="/brand/sharecard_symbol.png" alt=""/></div><div className="auth-flow-card auth-flow-split"><FileText/><span>DivisÃ£o<br/>automÃ¡tica</span></div><div className="auth-flow-card auth-flow-paid"><Check/><span>Tudo<br/>organizado</span></div></div><div className="auth-mini-card auth-mini-paid"><FileText/><span>Pagamento<br/><strong>confirmado!</strong></span><Check/></div></div>
      <ul className="auth-benefits"><li><ShieldCheck/> Seguro e confiÃ¡vel</li><li><Users/> Feito para compartilhar</li><li><CalendarDays/> Mais controle no dia a dia</li></ul>
    </section>
    <section className="auth-panel-wrap"><p className="auth-aside-note">Pagamentos mais simples<br/>para grandes momentos.</p><a className="back-link" href="/"><ArrowLeft/> Voltar</a><div className="auth-form">
      <div className="auth-tabs" role="tablist" aria-label="Acesso Ã  conta"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Entrar</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Criar conta</button></div>
      <div className="auth-heading"><span className="auth-heading-icon"><ShieldCheck/></span><h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}</h2><p>{mode === 'login' ? 'Acesse sua conta para continuar.' : 'Comece a organizar as compras do seu grupo.'}</p></div>
      <form onSubmit={authenticate}>{mode === 'register' && <label>Seu nome<input name="name" required maxLength={100} autoComplete="name" placeholder="Seu nome completo"/></label>}<label>E-mail<input name="email" type="email" required autoComplete="email" placeholder="seu@email.com"/></label><label>Senha<input name="password" type="password" minLength={6} maxLength={128} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Digite sua senha' : 'Crie uma senha segura'}/><small>MÃ­nimo de 12 caracteres.</small></label>{mode === 'register' && <label>CÃ³digo de convite <span>opcional</span><input name="inviteToken" maxLength={64} placeholder="Cole seu cÃ³digo"/><small>Sem cÃ³digo, vocÃª cria um espaÃ§o master.</small></label>}{error && <p className="cloud-error" role="alert">{error}</p>}<button className="button primary auth-submit" disabled={busy}>{busy ? 'Aguardeâ€¦' : mode === 'login' ? <>Entrar <ArrowRight/></> : <>Criar conta <ArrowRight/></>}</button></form>
      <p className="auth-switch">{mode === 'login' ? <>Ainda nÃ£o tem uma conta? <button type="button" onClick={() => { setMode('register'); setError(''); }}>Criar conta</button></> : <>JÃ¡ possui uma conta? <button type="button" onClick={() => { setMode('login'); setError(''); }}>Entrar</button></>}</p><p className="local-mode"><ShieldCheck/> Seus dados sÃ£o protegidos e seguros.</p>
    </div></section>
  </main>;
  const cardName = (id: string) => cards.find(card => card.id === id)?.name || 'CartÃƒÂ£o';
  return <main className="cloud-shell"><header className="cloud-top"><a href="/" className="cloud-brand"><img src="/brand/sharecard_logo.png" alt="ShareCard"/></a><button className="profile-photo-button" type="button" onClick={() => avatarInput.current?.click()} aria-label="Alterar sua foto de perfil"><ProfilePhoto account={account}/><EditPencil/></button><div><span>{account.name}</span><small>{account.role === 'master' ? 'Master Ã‚Â· dono do cartÃƒÂ£o' : 'Comprador vinculado'}</small></div><button onClick={logout}><LogOut/> Sair</button></header><section className="cloud-content"><input ref={avatarInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => uploadAvatar(event.target.files?.[0])}/><div className="cloud-title"><div><span className="cloud-kicker">ESPAÃƒâ€¡O COMPARTILHADO</span><h1>{account.role === 'master' ? 'Seu cofre de faturas.' : 'Faturas do seu grupo.'}</h1><p>{account.role === 'master' ? 'Cadastre seus ciclos, guarde PDFs e mantenha os compradores no mesmo contexto.' : 'Consulte os cartÃƒÂµes e baixe os documentos compartilhados pelo master.'}</p></div><div className="cloud-status"><Check/><span>EspaÃƒÂ§o ativo<small>{documents.length} {documents.length === 1 ? 'fatura salva' : 'faturas salvas'}</small></span></div></div><button className="avatar-callout" type="button" onClick={() => avatarInput.current?.click()} disabled={busy}><ProfilePhoto account={account}/><span><strong>Sua foto no grupo</strong><small>JPEG, PNG ou WebP Ã‚Â· atÃƒÂ© 2 MB Ã‚Â· guardada no bucket privado</small></span><EditPencil/></button>{error && <p className="cloud-error" role="alert">{error}</p>}{notice && <p className="cloud-notice" role="status">{notice}<button onClick={() => setNotice('')}>Fechar</button></p>}
  {account.role === 'master' && <div className="master-tools"><section><div className="tool-title"><CreditCard/><div><h2>Novo cartÃƒÂ£o</h2><p>Use um cadastro para cada ciclo.</p></div></div><form onSubmit={createCard}><label>Apelido<input name="name" required placeholder="Ex.: ItaÃƒÂº principal" maxLength={100}/></label><label>Vence todo dia<input name="dueDay" type="number" min="1" max="31" required placeholder="06"/></label><button disabled={busy}><Plus/> Adicionar</button></form></section><section><div className="tool-title"><UserPlus/><div><h2>Convidar comprador</h2><p>O cÃƒÂ³digo vale por 48 horas e uma utilizaÃƒÂ§ÃƒÂ£o.</p></div></div><form onSubmit={createInvite}><label>E-mail<input name="email" type="email" required placeholder="pessoa@email.com"/></label><button disabled={busy}><UserPlus/> Criar convite</button></form>{invite && <div className="invite-token"><span>CÃƒÂ³digo do convite</span><code>{invite}</code></div>}</section></div>}
  <section className="cycle-section"><div className="section-line"><div><span>SEUS CICLOS</span><h2>CartÃƒÂµes e vencimentos</h2></div><strong>{cards.length}</strong></div>{cards.length ? <div className="cycle-list">{cards.map(card => <article key={card.id}><span className="due-day">{String(card.dueDay).padStart(2,'0')}</span><div><strong>{card.name}</strong><small>Vencimento mensal no dia {card.dueDay}</small></div></article>)}</div> : <p className="cloud-empty">{account.role === 'master' ? 'Cadastre o primeiro cartÃƒÂ£o para liberar o envio de PDFs.' : 'O master ainda nÃƒÂ£o cadastrou cartÃƒÂµes.'}</p>}</section>
  {account.role === 'master' && cards.length > 0 && <UploadForm cards={cards} busy={busy} fileRef={fileInput} onUpload={upload}/>}<section className="document-section"><div className="section-line"><div><span>ARQUIVO DO GRUPO</span><h2>Faturas por vencimento</h2></div><strong>{documents.length}</strong></div>{documents.length ? <div className="document-list">{documents.map(doc => <article key={doc.id}><div className="document-date"><span>{date(doc.dueDate).slice(0,5)}</span><small>{doc.dueDate.slice(0,4)}</small></div><FileText/><div><strong>{cardName(doc.cardId)}</strong><small>Vence em {date(doc.dueDate)} Ã‚Â· {size(doc.size)}</small></div><a href={endpoint(`documents/${doc.id}`)}><Download/> Baixar PDF</a></article>)}</div> : <p className="cloud-empty">Nenhuma fatura foi enviada para este grupo.</p>}</section>
  {account.role === 'master' && <section className="member-section"><div className="section-line"><div><span>ACESSO</span><h2>Pessoas vinculadas</h2></div><strong>{members.length}</strong></div><div className="member-list">{members.map(member => <div key={member.id}><ProfilePhoto account={member}/><div><strong>{member.name}</strong><small>{member.email} Ã‚Â· {member.role === 'master' ? 'Master' : member.active ? 'Comprador ativo' : 'Acesso revogado'}</small></div>{member.role === 'buyer' && member.active && <button onClick={async () => { if (!confirm(`Revogar o acesso de ${member.name}?`)) return; try { await api('members/revoke', json({ userId: member.id })); await refresh(account); setNotice('Acesso revogado.'); } catch (reason) { setError((reason as Error).message); } }}>Revogar</button>}</div>)}</div></section>}</section></main>;
}

function ProfilePhoto({ account }: { account: Account }) {
  async function choose(file?: File) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { window.alert('Use uma foto JPEG, PNG ou WebP de atÃƒÂ© 2 MB.'); return; }
    const response = await fetch(`${endpoint('avatar')}?userId=${encodeURIComponent(account.id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file });
    if (!response.ok) { const data = await response.json().catch(() => null); window.alert(data?.error || 'NÃƒÂ£o foi possÃƒÂ­vel salvar a foto.'); return; }
    window.location.reload();
  }
  return <label className="profile-photo-upload" title={`Adicionar ou trocar foto de ${account.name}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => choose(event.target.files?.[0])}/>{account.avatarUrl ? <img className="profile-photo" src={account.avatarUrl} alt={`Foto de ${account.name}`}/> : <span className="profile-photo profile-initial" aria-label={`${account.name} sem foto`}>{account.name.slice(0, 1).toUpperCase()}</span>}<span>Adicionar foto</span></label>;
}

function UploadForm({ cards, busy, fileRef, onUpload }: { cards: Card[]; busy: boolean; fileRef: RefObject<HTMLInputElement | null>; onUpload: (file?: File, cardId?: string, date?: string) => void }) {
  const [file, setFile] = useState<File>(), [cardId, setCardId] = useState(cards[0]?.id || ''), [dueDate, setDueDate] = useState('');
  return <section className="upload-band"><div><Upload/><span><strong>Guardar nova fatura</strong><small>Escolha o cartÃƒÂ£o e informe a data real do vencimento.</small></span></div><select aria-label="CartÃƒÂ£o" value={cardId} onChange={event => setCardId(event.target.value)}>{cards.map(card => <option key={card.id} value={card.id}>{card.name} Ã‚Â· dia {card.dueDay}</option>)}</select><input aria-label="Data real de vencimento" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/><label className="file-choice"><input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0])}/><span>{file?.name || 'Selecionar PDF'}</span></label><button disabled={busy || !file || !dueDate} onClick={() => onUpload(file, cardId, dueDate)}>{busy ? 'EnviandoÃ¢â‚¬Â¦' : 'Guardar fatura'}</button></section>;
}
