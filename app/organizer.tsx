'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download as ArrowDownToLine, NavArrowRight as ArrowRight, Check, DoubleCheck as CheckCheck, NavArrowRight as ChevronRight, Cloud, CreditCard, Page as FileText, Dashboard as LayoutDashboard, Lock as LockKeyhole, Plus, Search, Settings as Settings2, ShieldCheck, Trash as Trash2, StatsUpSquare as TrendingUp, Upload, Group as Users, Wallet, Xmark as X, WarningCircle as CircleAlert, EditPencil as Pencil, Calendar as CalendarDays, LogOut } from 'iconoir-react';
import { carryAssignments, colors, emptyState, forecast, money, parseMoney, scaleAllocations, splitEqual, sum, unassigned, validateAllocations, type Allocation, type AppState, type Statement, type Transaction } from '@/lib/model';
import { readStatement } from '@/lib/pdf';
import '@/lib/webmcp';
import { useRouter } from 'next/navigation';
import { useOrganizerState } from './state-provider';
import { PeopleWorkspace, ChargeSummary } from './people-workspace';
import CloudWorkspace from './conta/workspace';
import { downloadPersonStatement } from '@/lib/person-statement-pdf';
import { buyerOf, isSharedCost, withSharedCharges, type Person } from '@/lib/model';

const dateLabel = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
const monthLabel = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('');
type CloudCard = { id: string; name: string; dueDay: number; issuer?: string; last4?: string | null };
type BuyerSummary = { statement: { dueDate: string | null; totalCents: number | null } | null; personalCents: number; purchaseCount: number; pendingCount: number; status?: 'ready' | 'no_purchases' | 'no_statement' | 'person_not_linked' | 'person_not_in_workspace'; purchases?: Array<{ merchant: string; date: string; cents: number; assigned: boolean }> };
type CloudPerson = Person & { masterId?: string; version: number };
type InvitationStatus = { status: 'accepted' | 'pending' | 'expired' | 'not_sent'; at?: string };
const localHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const cloudBackend = process.env.NEXT_PUBLIC_ACCOUNT_BACKEND === 'floci' || localHost && !process.env.NEXT_PUBLIC_SUPABASE_URL ? 'floci' : 'supabase';
const cloudEndpoint = (path: string) => cloudBackend === 'floci'
  ? `/api/backend/${path}`
  : path === 'me' ? '/api/supabase/auth/me' : `/api/supabase/workspace/${path}`;
const logoutEndpoint = cloudBackend === 'floci' ? '/api/backend/logout' : '/api/supabase/auth/logout';
const cardLabel = (card: NonNullable<Statement['card']>) => `${card.issuer}${card.last4 ? ` •••• ${card.last4}` : ` · vence dia ${card.dueDay}`}`;
const cardTheme = (issuer?: string) => {
  const normalized = issuer?.toLocaleLowerCase() ?? '';
  if (normalized.includes('nubank')) return 'nubank';
  if (normalized.includes('caixa')) return 'caixa';
  return 'itau';
};
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
function easterSunday(year: number) { const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); return new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31), (h + l - 7 * m + 114) % 31 + 1)); }
function brazilNationalHolidays(year: number) { const easter = easterSunday(year), goodFriday = new Date(easter); goodFriday.setUTCDate(goodFriday.getUTCDate() - 2); return new Set([`${year}-01-01`, `${year}-04-21`, `${year}-05-01`, `${year}-09-07`, `${year}-10-12`, `${year}-11-02`, `${year}-11-15`, `${year}-11-20`, `${year}-12-25`, isoDate(goodFriday)]); }
function realDueDate(reference: string, dueDay: number) { const [year, month] = reference.split('-').map(Number), lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); const date = new Date(Date.UTC(year, month - 1, Math.min(dueDay, lastDay))); const holidays = brazilNationalHolidays(year); while (date.getUTCDay() === 0 || date.getUTCDay() === 6 || holidays.has(isoDate(date))) date.setUTCDate(date.getUTCDate() + 1); return isoDate(date); }
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} onCancel={onClose} aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><X width={20} height={20}/></button></div>{children}</dialog>;
}
function Avatar({ name, color, small = false }: { name: string; color: string; small?: boolean }) { return <span className={`avatar ${small ? 'small' : ''}`} style={{ background: color + '18', color }}>{initials(name)}</span>; }

export default function Organizer({ initialTab = 'overview', personId }: { initialTab?: string; personId?: string }) {
  const { state, setState, ready, storageError, refreshWorkspace } = useOrganizerState();
  const router = useRouter();
  const stateRef = useRef(state);
  stateRef.current = state;
  const tab = initialTab;
  async function logout() {
    try { await fetch(logoutEndpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } finally {
      window.sessionStorage.removeItem('sharecard:workspace-stale');
      window.sessionStorage.removeItem('sharecard:workspace-account-id');
      window.localStorage.removeItem('fatura-em-dia:v1');
      window.location.assign('/');
    }
  }
  function setTab(next: string) {
    const routes: Record<string, string> = { overview: '/organizador', transactions: '/organizador/lancamentos', people: '/pessoas', cards: '/cartoes', forecast: '/organizador/previsoes', account: '/perfil' };
    router.push(routes[next] || '/organizador');
  }
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<Statement | null>(null);
  const [candidateFile, setCandidateFile] = useState<File | null>(null);
  const [cloudCards, setCloudCards] = useState<CloudCard[]>([]);
  const [importFallbackCardId, setImportFallbackCardId] = useState('');
  const [importCardSetup, setImportCardSetup] = useState(false);
  const [newImportCard, setNewImportCard] = useState({ issuer: 'Itaú', name: '', last4: '', dueDay: '' });
  const [dueDateConflict, setDueDateConflict] = useState<{ actual: string; expected: string; card: string } | null>(null);
  const [cloudMaster, setCloudMaster] = useState(false);
  const [accountResolved, setAccountResolved] = useState(false);
  const [cloudAccountName, setCloudAccountName] = useState('');
  const [cloudBuyer, setCloudBuyer] = useState(false);
  const [buyerSummary, setBuyerSummary] = useState<BuyerSummary | null>(null);
  const [invitationStatuses, setInvitationStatuses] = useState<Record<string, InvitationStatus>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [forecastPerson, setForecastPerson] = useState('all');
  const [personModal, setPersonModal] = useState(false);
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [personEditing, setPersonEditing] = useState<Person | null>(null);
  const [personLimit, setPersonLimit] = useState('');
  const [personColor, setPersonColor] = useState(colors[0]);
  const [personDelete, setPersonDelete] = useState<Person | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [split, setSplit] = useState<Transaction | null>(null);
  const [splitPeople, setSplitPeople] = useState<string[]>([]);
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [carry, setCarry] = useState(true);
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [paymentStatement, setPaymentStatement] = useState<Statement | null>(null);
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const input = useRef<HTMLInputElement>(null);
  const rawActive = state.statements.find(s => s.id === state.activeId) ?? state.statements[0];
  const active = rawActive ? withSharedCharges(rawActive, state.people) : undefined;
  const transactions = active?.transactions ?? [];
  const pending = transactions.reduce((n, t) => n + unassigned(t), 0);
  const pendingCount = transactions.filter(t => unassigned(t) !== 0).length;
  const projections = active ? forecast(active, forecastPerson === 'all' ? undefined : forecastPerson) : [];
  const visible = transactions.filter(t => `${t.merchant} ${t.holder} ${t.note ?? ''} ${state.people.find(p => p.id === buyerOf(t))?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'pending' ? unassigned(t) !== 0 : t.allocations.some(a => a.personId === filter))) && (category === 'all' || t.category === category));
  const allocatedCount = transactions.length - pendingCount;
  const chart = projections.slice(0, 6);
  const maxChart = Math.max(1, ...chart.map(p => p.cents));
  const candidateUsesStatementTotal = candidate?.card?.issuer?.toLocaleLowerCase() === 'nubank';

  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(''), 6500); return () => clearTimeout(timer); } }, [message]);
  useEffect(() => {
    const loadCloud = async () => {
      try {
        const [me, cardsResponse] = await Promise.all([
          fetch(cloudEndpoint('me'), { credentials: 'same-origin' }),
          fetch(cloudEndpoint('cards'), { credentials: 'same-origin' }),
        ]);
        if (!me.ok) return;
        const currentAccount = await me.json() as { role: string; name?: string };
        setCloudAccountName(currentAccount.name || 'Minha conta');
        if (currentAccount.role !== 'master') {
          const response = await fetch(cloudEndpoint('buyer-summary'), { credentials: 'same-origin' });
          if (response.ok) setBuyerSummary(await response.json() as BuyerSummary);
          setCloudBuyer(true);
          return;
        }
        setCloudMaster(true);
        if (!cardsResponse.ok) return;
        const cards = await cardsResponse.json() as CloudCard[];
        setCloudCards(cards);
        setImportFallbackCardId('');
      } catch { /* The standalone organizer continues to support an offline draft. */ }
      finally { setAccountResolved(true); }
    };
    void loadCloud();
  }, []);
  useEffect(() => { if (!cloudMaster) return; fetch(cloudEndpoint('invitations'), { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).then(result => { if (result) setInvitationStatuses(result as Record<string, InvitationStatus>); }).catch(() => {}); }, [cloudMaster]);
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: 'get_statement_summary',
        description: 'Lê o total, os valores por pessoa e as parcelas previstas da fatura selecionada. Não altera dados.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Informe um objeto vazio.');
          const current = stateRef.current;
          const rawBill = current.statements.find(s => s.id === current.activeId) ?? current.statements[0];
          const bill = rawBill ? withSharedCharges(rawBill, current.people) : undefined;
          if (!bill) return { status: 'no_statement' };
          return { currency: 'BRL', unit: 'centavos', dueDate: bill.dueDate, total: bill.total, unassigned: bill.transactions.reduce((n, t) => n + unassigned(t), 0), people: current.people.map(p => ({ name: p.name, cents: bill.transactions.reduce((n, t) => n + (t.allocations.find(a => a.personId === p.id)?.cents ?? 0), 0) })), installments: forecast(bill) };
        }
      }, { signal: lifecycle.signal })).catch(() => { /* Optional browser capability. */ });
    } catch { /* Unsupported registry must not affect the organizer. */ }
    return () => lifecycle.abort();
  }, []);

  const buyerAllowedTab = ['overview', 'cards', 'account'].includes(tab);
  useEffect(() => {
    if (cloudBuyer && !buyerAllowedTab) router.replace('/organizador');
  }, [buyerAllowedTab, cloudBuyer, router]);

  if (cloudBuyer && !buyerAllowedTab) {
    return <main className="page-content"><section className="empty-workspace"><span className="pill">ACESSO DO COMPRADOR</span><h2>Esta área é do master.</h2><p>Você será levado para a sua visão geral.</p></section></main>;
  }
  function updateStatement(update: (s: Statement) => Statement) {
    if (!active) return;
    setState(prev => ({ ...prev, statements: prev.statements.map(s => s.id === active.id ? update(s) : s) }));
  }
  function guideBuyers(statement: Statement) {
    const participants = [...state.people]; let master = participants.find(person => person.name.toLocaleLowerCase() === cloudAccountName.toLocaleLowerCase());
    const guided = statement.transactions.map(transaction => {
      if (isSharedCost(transaction)) return transaction;
      const options = [`0 - Minha compra (${cloudAccountName || 'minha conta'})`, ...participants.map((person, index) => `${index + 1} - ${person.name}`)].join('\n');
      const answer = window.prompt(`Quem fez esta compra?\n\n${transaction.merchant} - ${money(transaction.cents)}\n\n${options}\n\nDeixe em branco para decidir depois.`);
      if (answer === null || answer.trim() === '') return transaction;
      const selected = Number(answer.trim());
      if (!Number.isInteger(selected) || selected < 0 || selected > participants.length) return transaction;
      if (selected === 0) {
        if (!master) { master = { id: crypto.randomUUID(), name: 'Master', color: '#2563EB' }; participants.unshift(master); }
        return { ...transaction, buyerId: master.id, allocations: [{ personId: master.id, cents: transaction.cents }] };
      }
      const person = participants[selected - 1];
      return person ? { ...transaction, buyerId: person.id, allocations: [{ personId: person.id, cents: transaction.cents }] } : transaction;
    });
    if (master && !state.people.some(person => person.id === master!.id)) setState(previous => ({ ...previous, people: [...previous.people, master!] }));
    return { ...statement, transactions: guided };
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    if (!accountResolved) { setMessage('Estamos preparando seu espaço. Aguarde alguns segundos e tente importar novamente.'); return; }
    if (!cloudMaster) { setMessage('A importação de faturas está disponível para o dono do cartão.'); return; }
    setBusy(true);
    try {
      const parsed = await readStatement(file);
      if (state.statements.some(s => s.fingerprint === parsed.fingerprint)) throw new Error('Esta fatura já foi importada. Selecione-a no histórico.');
      const candidate = carryAssignments(parsed, state.statements.filter(s => s.id !== 'demo'));
      const detectedCard = candidate.card;
      // A statement can contain additional cards. Never bind it automatically:
      // the master chooses an existing card or explicitly creates a new one.
      setImportFallbackCardId('');
      setNewImportCard({ issuer: detectedCard?.issuer || 'Itaú', name: detectedCard ? cardLabel(detectedCard) : '', last4: detectedCard?.last4 || '', dueDay: String(detectedCard?.dueDay || '') });
      setCandidateFile(file); setCandidate(candidate); setImportCardSetup(true);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível ler o PDF.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  function setCandidateBuyer(transactionId: string, selected: string) {
    if (!candidate) return;
    let buyerId = selected;
    if (selected === '__master__') {
      let master = state.people.find(person => person.name.toLocaleLowerCase() === cloudAccountName.toLocaleLowerCase());
      if (!master) {
        master = { id: crypto.randomUUID(), name: cloudAccountName || 'Minha conta', color: '#2563EB' };
        setState(previous => ({ ...previous, people: [...previous.people, master!] }));
      }
      buyerId = master.id;
    }
    setCandidate({ ...candidate, transactions: candidate.transactions.map(transaction => transaction.id === transactionId && !isSharedCost(transaction) ? { ...transaction, buyerId: buyerId || null, inheritedFromPrevious: false, allocations: buyerId ? [{ personId: buyerId, cents: transaction.cents }] : [] } : transaction) });
  }
  async function chooseImportCard() {
    if (importFallbackCardId) { setImportCardSetup(false); return; }
    const last4 = newImportCard.last4.replace(/\D/g, ''); const dueDay = Number(newImportCard.dueDay);
    if (!newImportCard.name.trim() || !/^\d{4}$/.test(last4) || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) { setFormError('Para criar o cartão, informe banco, nome, os 4 últimos números e o dia de vencimento.'); return; }
    setBusy(true); setFormError('');
    try { const response = await fetch(cloudEndpoint('cards'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newImportCard, last4, dueDay }) }); const created = await response.json() as CloudCard & { error?: string }; if (!response.ok) throw new Error(created.error || 'Não foi possível criar o cartão agora.'); setCloudCards(previous => [...previous, created].sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name))); setImportFallbackCardId(created.id); setImportCardSetup(false); } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível criar o cartão agora.'); } finally { setBusy(false); }
  }
  async function confirmImport(ignoreDueDateWarning?: unknown) {
    const ignoreWarning = ignoreDueDateWarning === true;
    if (!candidate) { setFormError('Não há uma fatura pronta para importar. Selecione o PDF novamente.'); return; }
    if (!candidate.dueDate || !candidate.transactions.length) { setFormError('Não foi possível identificar compras e vencimento suficientes para importar esta fatura.'); return; }
    if (!candidateUsesStatementTotal && sum(candidate.transactions) !== candidate.total) { setFormError('A soma dos lançamentos não fecha com o total da fatura. Revise os itens antes de continuar.'); return; }
    if (cloudMaster && !importFallbackCardId) { setImportCardSetup(true); return; }
    if (state.statements.some(s => s.dueDate === candidate.dueDate && s.total === candidate.total && s.id !== 'demo')) { setFormError('Já existe uma fatura com este vencimento e total. Confira o histórico antes de importar novamente.'); return; }
    let storageDocumentId: string | undefined;
    if (cloudMaster) {
      if (!candidateFile) { setFormError('Selecione o PDF da fatura novamente.'); return; }
      setBusy(true);
      try {
        const selectedCardId = importFallbackCardId, selectedCard = cloudCards.find(card => card.id === selectedCardId);
        if (!selectedCardId || !selectedCard) { setImportCardSetup(true); setBusy(false); return; }
        const expectedDate = realDueDate(candidate.dueDate, selectedCard.dueDay);
        if (!ignoreWarning && expectedDate !== candidate.dueDate) { setDueDateConflict({ actual: candidate.dueDate, expected: expectedDate, card: selectedCard.name }); setBusy(false); return; }
        if (cloudBackend === 'supabase') {
          const response = await fetch(`${cloudEndpoint('documents')}?cardId=${encodeURIComponent(selectedCardId)}&dueDate=${encodeURIComponent(candidate.dueDate)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf', 'X-ShareCard-Filename': candidateFile.name }, body: candidateFile });
          const result = await response.json() as { id?: string; error?: string };
          if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a fatura na nuvem.');
          storageDocumentId = result.id;
        } else {
          const form = new FormData(); form.set('file', candidateFile); form.set('cardId', selectedCardId); form.set('dueDate', candidate.dueDate); form.set('statement', JSON.stringify(candidate));
          const response = await fetch(cloudEndpoint('statements/import'), { method: 'POST', credentials: 'same-origin', body: form });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a fatura na nuvem.');
        }
        window.sessionStorage.setItem('sharecard:workspace-stale', '1');
      } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível salvar a fatura na nuvem.'); setBusy(false); return; }
      setBusy(false);
    }
    const savedCandidate = storageDocumentId ? { ...candidate, storageDocumentId } : candidate;
    setState(prev => ({ ...prev, people: prev.statements.length === 1 && prev.statements[0].id === 'demo' ? prev.people.filter(p => !['ana', 'bruno', 'clara'].includes(p.id)) : prev.people, statements: [...prev.statements.filter(s => s.id !== 'demo'), savedCandidate], activeId: savedCandidate.id }));
    setCandidate(null); setCandidateFile(null); setTab('overview'); setSearch(''); setFilter('all'); setCategory('all'); setFormError(''); setMessage(cloudMaster ? 'Fatura salva. Agora você pode dividir as compras.' : 'Fatura importada. Agora você pode dividir as compras.');
  }
  function assign(id: string, personId: string) {
    updateStatement(s => ({ ...s, transactions: s.transactions.map(t => t.id === id && !isSharedCost(t) ? { ...t, allocations: personId ? [{ personId, cents: t.cents }] : [] } : t) }));
  }
  function setBuyer(id: string, buyerId: string) {
    updateStatement(s => ({ ...s, transactions: s.transactions.map(t => {
      if (t.id !== id || isSharedCost(t)) return t;
      const follows = !t.allocations.length || (t.allocations.length === 1 && t.allocations[0].personId === buyerOf(t) && sum(t.allocations) === t.cents);
      return { ...t, buyerId: buyerId || null, allocations: follows ? (buyerId ? [{ personId: buyerId, cents: t.cents }] : []) : t.allocations };
    }) }));
  }
  function openPerson(person?: Person) {
    setPersonEditing(person ?? null); setPersonName(person?.name ?? ''); setPersonEmail(person?.email ?? ''); setPersonPhone(person?.phone ?? ''); setPersonLimit(person?.monthlyLimitCents ? (person.monthlyLimitCents / 100).toFixed(2).replace('.', ',') : ''); setPersonColor(person?.color ?? colors[state.people.length % colors.length]); setFormError(''); setPersonModal(true);
  }
  async function savePerson() {
    try {
      const name = personName.trim();
      if (!name || state.people.some(p => p.id !== personEditing?.id && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Informe um nome diferente dos já cadastrados.');
      const monthlyLimitCents = personLimit.trim() ? parseMoney(personLimit) : undefined;
      if (monthlyLimitCents !== undefined && monthlyLimitCents <= 0) throw new Error('O limite deve ser maior que zero, ou ficar vazio.');
      setBusy(true);
      const email = personEmail.trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido ou deixe o campo vazio.');
      const phone = personPhone.trim();
      let person: Person = { id: personEditing?.id ?? crypto.randomUUID(), name, email: email || null, phone: phone || null, color: personColor, monthlyLimitCents, version: personEditing?.version };
      if (cloudMaster && (!personEditing || personEditing.version)) {
        const path = personEditing?.version ? `people/${personEditing.id}` : 'people';
        const response = await fetch(cloudEndpoint(path), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email: email || null, phone: phone || null, color: personColor, monthlyLimitCents: monthlyLimitCents ?? null, ...(personEditing?.version ? { version: personEditing.version } : {}) }) });
        const saved = await response.json() as CloudPerson & { error?: string };
        if (!response.ok) throw new Error(saved.error || 'Não foi possível salvar a pessoa.');
        person = { id: saved.id, name: saved.name, email: saved.email ?? null, phone: saved.phone ?? null, color: saved.color, monthlyLimitCents: saved.monthlyLimitCents ?? undefined, accountId: saved.accountId, version: saved.version };
      }
      setState(prev => ({ ...prev, people: personEditing ? prev.people.map(p => p.id === person.id ? person : p) : [...prev.people, person] }));
      setMessage(email && !person.accountId ? 'Pessoa salva. Envie o convite quando quiser, a partir da página desta pessoa.' : personEditing ? 'Pessoa atualizada.' : 'Pessoa cadastrada.');
      setPersonModal(false);
    } catch (e) { setFormError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function invitePerson(person: Person) {
    if (!person.email) { openPerson(person); setFormError('Cadastre um e-mail para enviar o convite desta pessoa.'); return; }
    if (person.accountId) { setMessage(`${person.name} já possui acesso ativo ao espaço.`); return; }
    try {
      setBusy(true);
      const response = await fetch(cloudEndpoint('invites'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: person.email, personId: person.id }) });
      const invitation = await response.json() as { token?: string; error?: string };
      if (!response.ok || !invitation.token) throw new Error(invitation.error || 'Não foi possível criar o convite.');
      const link = `${window.location.origin}/acesso?invite=${invitation.token}`;
      try { await navigator.clipboard.writeText(link); setMessage(`Convite de ${person.name} copiado. Envie o link pelo canal que preferir.`); }
      catch { window.prompt(`Copie o convite de ${person.name}:`, link); setMessage(`Convite criado para ${person.name}.`); }
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  function openSplit(t: Transaction) {
    if (isSharedCost(t)) { setMessage('Este gasto geral é rateado automaticamente entre os compradores. Altere o tipo na edição para dividir individualmente.'); return; }
    setSplit(t); setSplitPeople(t.allocations.map(a => a.personId)); setSplitValues(Object.fromEntries(t.allocations.map(a => [a.personId, (a.cents / 100).toFixed(2).replace('.', ',')]))); setCarry(t.carryForward); setFormError('');
  }
  function equalSplit(ids = splitPeople) {
    if (!split) return;
    setSplitValues(Object.fromEntries(splitEqual(split.cents, ids).map(a => [a.personId, (a.cents / 100).toFixed(2).replace('.', ',')])));
  }
  function saveSplit() {
    if (!split) return;
    try {
      const allocations: Allocation[] = splitPeople.map(personId => ({ personId, cents: parseMoney(splitValues[personId] || '0,00') }));
      if (!validateAllocations(split, allocations)) throw new Error('A divisão não pode ultrapassar o valor da compra e deve manter o sinal do lançamento.');
      updateStatement(s => ({ ...s, transactions: s.transactions.map(t => t.id === split.id ? { ...t, allocations, carryForward: carry, inheritedFromPrevious: false } : t) })); setSplit(null); setMessage('Divisão salva.');
    } catch (e) { setFormError((e as Error).message); }
  }
  function exportCsv() {
    if (!active) return;
    const cell = (s: string) => '"' + (/^[=+@-]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';
    const rows = [['Data', 'Estabelecimento', 'Categoria', 'Portador', 'Parcela', 'Valor', 'Comprador', 'Observação', 'Tipo de rateio', 'Divisão', 'Sem responsável'], ...visible.map(t => [t.date, t.merchant, t.category, t.holder, t.installment ? `${t.installment.current}/${t.installment.total}` : '', (t.cents / 100).toFixed(2).replace('.', ','), state.people.find(p => p.id === buyerOf(t))?.name ?? '', t.note ?? '', isSharedCost(t) ? 'Geral: rateio automático' : 'Individual', t.allocations.map(a => `${state.people.find(p => p.id === a.personId)?.name ?? 'Pessoa'}: ${money(a.cents)}`).join(' | '), (unassigned(t) / 100).toFixed(2).replace('.', ',')])];
    download('\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n'), `fatura-${active.dueDate}.csv`, 'text/csv;charset=utf-8');
  }
  function exportPersonPdf() {
    if (!active || filter === 'all' || filter === 'pending') return;
    const person = state.people.find(item => item.id === filter);
    if (!person) { setMessage('Escolha uma pessoa no filtro para gerar a fatura individual.'); return; }
    void downloadPersonStatement(person, { ...active, transactions: visible });
  }
  function editSave(form: FormData) {
    if (!editing) return;
    try {
      const cents = parseMoney(String(form.get('amount'))), merchant = String(form.get('merchant')).trim(), date = String(form.get('date'));
      if (!merchant || !/^\d{2}\/\d{2}$/.test(date)) throw new Error('Preencha o estabelecimento e a data no formato DD/MM.');
      const current = Number(form.get('current')), total = Number(form.get('total'));
      if ((current || total) && (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || current > total || total > 60)) throw new Error('Confira as parcelas (entre 1 e 60).');
      const note = String(form.get('note') ?? '').trim();
      const buyerId = String(form.get('buyerId') ?? '') || null;
      const sharedCost = form.get('sharedCost') === 'on';
      const followsBuyer = !editing.allocations.length || (editing.allocations.length === 1 && editing.allocations[0].personId === buyerOf(editing) && sum(editing.allocations) === editing.cents);
      const updated = { ...editing, inheritedFromPrevious: false, merchant, date, cents, note, buyerId: sharedCost ? null : buyerId, sharedCost, category: String(form.get('category')).trim() || 'Outros', installment: current && total ? { current, total } : undefined, ...(cents !== editing.cents || current !== editing.installment?.current || total !== editing.installment?.total ? { nextCents: undefined } : {}), allocations: sharedCost ? [] : followsBuyer ? (buyerId ? [{ personId: buyerId, cents }] : []) : scaleAllocations(editing, cents) };
      if (candidate) setCandidate({ ...candidate, transactions: candidate.transactions.map(t => t.id === updated.id ? updated : t) });
      else updateStatement(s => ({ ...s, transactions: s.transactions.map(t => t.id === updated.id ? updated : t) }));
      setEditing(null); setFormError('');
    } catch (e) { setFormError((e as Error).message); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand brand-logo" href="/organizador" aria-label="Visão geral do ShareCard"><img src="/brand/sharecard_symbol.png" alt="ShareCard"/></a>
      <div className="workspace-label">SEU ORGANIZADOR</div>
      <nav aria-label="Navegação principal">{(cloudBuyer ? [{ id: 'overview', label: 'Minhas compras', icon: LayoutDashboard }, { id: 'cards', label: 'Faturas do grupo', icon: FileText }, { id: 'account', label: 'Meu perfil', icon: Wallet }] : [{ id: 'overview', label: 'Visão geral', icon: LayoutDashboard }, { id: 'transactions', label: 'Lançamentos', icon: CreditCard }, { id: 'people', label: 'Pessoas', icon: Users }, { id: 'cards', label: 'Cartões e grupo', icon: CreditCard }, { id: 'forecast', label: 'Próximas faturas', icon: TrendingUp }, { id: 'account', label: 'Minha conta', icon: Wallet }]).map(item => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><span className="nav-icon"><item.icon width={20} height={20}/></span><span>{item.label}</span>{tab === item.id && <span className="nav-mark"/>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck width={24} height={24}/><strong>Seu dinheiro.<br/>Sua privacidade.</strong><p>Suas faturas e informações ficam protegidas no seu espaço.</p><span><LockKeyhole width={12} height={12}/> Dados protegidos</span></div>
      <div className="local-user"><span className="user-avatar">EU</span><div>Meu espaço<small>Organize suas faturas</small></div><button type="button" className="icon-button" onClick={() => void logout()} aria-label="Sair do sistema" title="Sair"><LogOut width={18} height={18}/></button></div>
    </aside>

    <main>
      <header className="topbar"><div className="breadcrumb">Meu espaço <ChevronRight width={14} height={14}/><span>{({ overview: 'Visão geral', transactions: 'Lançamentos', people: 'Pessoas', forecast: 'Próximas faturas', cards: cloudBuyer ? 'Faturas' : 'Cartões e grupo', account: 'Minha conta' } as Record<string, string>)[tab]}</span></div><span className="private-label"><LockKeyhole width={14} height={14}/> Espaço protegido</span></header>
      <div className="page-content">
        {!ready && <div className="notice" role="status"><Cloud width={18}/><span>Preparando seu espaço compartilhado…</span></div>}{storageError && <div className="notice danger" role="alert"><CircleAlert width={18} height={18}/><span>{storageError}</span><button type="button" className="text-button" onClick={() => void refreshWorkspace().catch(error => setFormError(error instanceof Error ? error.message : 'Não foi possível atualizar agora.'))}>Atualizar agora</button></div>}
        <div className="page-heading"><div><div className="eyebrow">{cloudBuyer ? 'SEU ACOMPANHAMENTO' : 'MENOS CONTAS NA CABEÇA'}</div><h1>{cloudBuyer ? tab === 'overview' ? 'Suas compras, com clareza.' : tab === 'cards' ? 'Faturas do seu grupo.' : 'Seu perfil.' : tab === 'overview' ? 'Sua fatura, sem mistério.' : tab === 'transactions' ? 'Cada compra no seu lugar.' : tab === 'people' ? 'Tudo dividido, tudo claro.' : tab === 'cards' ? 'Cartões e compradores.' : tab === 'account' ? 'Minha conta.' : 'Olhe os próximos meses.'}</h1><p>{cloudBuyer ? tab === 'overview' ? 'Veja sua parte da fatura e acompanhe as compras vinculadas a você.' : tab === 'cards' ? 'Consulte os PDFs compartilhados pelo dono do cartão.' : 'Confira os dados da sua conta e sua foto no grupo.' : tab === 'overview' ? 'Entenda os gastos, divida as compras e planeje o que vem.' : tab === 'transactions' ? 'Confira os lançamentos e escolha quem fica com cada valor.' : tab === 'people' ? 'Veja quanto cabe a cada pessoa nesta fatura.' : tab === 'cards' ? 'Os cartões são criados automaticamente ao importar uma fatura. Convide pessoas já cadastradas em Pessoas.' : tab === 'account' ? 'Confira seu nome, e-mail, papel no grupo e foto de perfil.' : 'Acompanhe as parcelas que já estão comprometidas.'}</p></div>{tab === 'overview' && !active && cloudMaster && <button className="button primary" disabled={busy || !ready || !accountResolved} onClick={() => { setFormError(''); input.current?.click(); }}><Upload width={18} height={18}/>{busy ? 'Lendo fatura…' : 'Importar fatura'}</button>}<input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e => upload(e.target.files?.[0])}/></div>

        {cloudBuyer && tab === 'overview' ? <BuyerPanel summary={buyerSummary}/> : tab === 'cards' ? <CloudWorkspace embedded/> : tab === 'account' ? <CloudWorkspace embedded section="profile"/> : !active && tab !== 'people' ? <section className="empty-workspace" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}><div className="empty-art"><FileText width={48} height={48}/><span><Check width={18} height={18}/></span></div><span className="pill">COMECE POR AQUI</span><h2>Uma fatura. Tudo organizado.</h2><p>Arraste sua fatura Itaú em PDF e descubra quanto é de cada pessoa e o que já está previsto para os próximos meses.</p><button className="button primary" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Lendo PDF…' : 'Selecionar minha fatura'}<ArrowRight width={18} height={18}/></button><div className="empty-steps"><span><span>01</span> Importe o PDF</span><span><span>02</span> Divida as compras</span><span><span>03</span> Planeje o mês</span></div><small>PDF digital Itaú · Até 15 MB · Arquivo protegido no seu espaço</small></section> : <>
          {active && <><div className="statement-toolbar statement-context"><div className="statement-identity"><div className={`statement-card-preview ${cardTheme(active.card?.issuer)}`} aria-hidden="true"><span>{active.card?.issuer || 'Cartão'}</span><strong>{active.card?.last4 ? `•••• ${active.card.last4}` : 'FATURA'}</strong><small>Vence dia {String(active.card?.dueDay ?? Number(active.dueDate.slice(-2))).padStart(2, '0')}</small></div><div><label className="sr-only" htmlFor="statement">Fatura selecionada</label><select id="statement" value={active.id} onChange={e => { setState({ ...state, activeId: e.target.value }); setSearch(''); setFilter('all'); setCategory('all'); }}>{[...state.statements].sort((a, b) => b.dueDate.localeCompare(a.dueDate)).map(s => <option key={s.id} value={s.id}>{s.card ? cardLabel(s.card) : 'Cartão da fatura'} · {monthLabel(s.dueDate)}</option>)}</select><span>Vencimento em {dateLabel(active.dueDate)} · {money(active.total)}</span></div></div><div className="toolbar-actions"><span className="verified"><CheckCheck width={15} height={15}/>{sum(transactions) === active.total ? 'Total conferido' : 'Revisão necessária'}</span><button className={`button compact payment-button ${active.paidAt ? 'paid' : 'primary'}`} onClick={() => { setPaymentStatement(active); setPaidDate(active.paidAt || new Date().toISOString().slice(0, 10)); }}><Check width={15} height={15}/>{active.paidAt ? `Pago em ${dateLabel(active.paidAt)}` : 'Informar pagamento'}</button><button className="button secondary compact" onClick={exportCsv}><ArrowDownToLine width={15} height={15}/> Exportar CSV</button><button className="icon-button" aria-label="Excluir fatura" onClick={() => setDeleteId(active.id)}><Trash2 width={17} height={17}/></button></div></div>
          {sum(transactions) !== active.total && <div className="notice danger" role="alert"><CircleAlert width={17} height={17}/>Os lançamentos diferem do total do banco em {money(active.total - sum(transactions))}. Confira as correções antes de usar os valores.</div>}
          </>}
          {tab === 'people' && ready && <PeopleWorkspace state={{ ...state, people: state.people.filter(person => !['master', 'eu'].includes(person.name.trim().toLocaleLowerCase())) }} statement={active} personId={personId} invitationStatuses={invitationStatuses} onAdd={() => openPerson()} onEdit={openPerson} onDelete={p => { setPersonDelete(p); setFormError(''); }} onTransaction={t => { setEditing(t); setFormError(''); }} onSplit={openSplit} onInvite={invitePerson}/>}
          {active && <>
          {tab === 'overview' && <div className="stats-grid"><article className="stat-card main-stat"><div className="stat-label">Total da fatura <CreditCard width={19} height={19}/></div><strong>{money(active.total)}</strong><div className="stat-foot">{transactions.length} lançamentos <span>Vence {dateLabel(active.dueDate).slice(0, 5)}</span></div></article><article className="stat-card"><div className="stat-label">Já distribuído <Users width={19} height={19}/></div><strong>{money(sum(transactions) - pending)}</strong><div className="progress-track"><span style={{ width: `${transactions.length ? allocatedCount / transactions.length * 100 : 0}%` }}/></div><small>{allocatedCount} de {transactions.length} lançamentos completos</small></article><article className="stat-card"><div className="stat-label">Falta dividir <span className="amber-icon"><Settings2 width={19} height={19}/></span></div><strong>{money(pending)}</strong><button className="stat-link" onClick={() => { setTab('transactions'); setFilter('pending'); }}>{pendingCount ? `${pendingCount} lançamentos para revisar` : 'Tudo atribuído'}<ArrowRight width={15} height={15}/></button></article></div>}

          {(tab === 'overview' || tab === 'forecast') && <section className="panel forecast-panel"><div className="panel-heading"><div><h2>O que já vem por aí <span className="soft-tag">PARCELAS</span></h2><p>Compromissos existentes, sem novas compras.</p></div>{tab === 'overview' ? <button className="text-button" onClick={() => setTab('forecast')}>Ver projeção <ArrowRight width={16} height={16}/></button> : <select aria-label="Previsão por pessoa" value={forecastPerson} onChange={e => setForecastPerson(e.target.value)}><option value="all">Todas as pessoas</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div><div className="forecast-content"><div className="forecast-summary"><span>Próximo mês</span><strong>{money(projections[0]?.cents ?? 0)}</strong><p>{forecastPerson === 'all' && active.nextTotal !== undefined ? `Banco informa ${money(active.nextTotal)} em parcelas.` : 'Conforme a divisão das parcelas futuras.'}</p><span className="forecast-caption"><CalendarDays width={15} height={15}/> Valores sujeitos a ajustes</span></div><div className="chart" role="img" aria-label={chart.map(p => `${p.label}: ${money(p.cents)}`).join('; ')}>{chart.map((p, i) => <div className="chart-column" key={p.label}><span className="chart-value">{money(p.cents)}</span><div className="bar-area"><div className={`bar ${i === 0 ? 'first' : ''}`} style={{ height: `${Math.max(3, p.cents / maxChart * 100)}%` }}/></div><span className="chart-label">{p.label}</span></div>)}</div></div>{tab === 'forecast' && <><div className="notice"><CircleAlert width={17} height={17}/><span>A próxima parcela usa o valor do PDF quando identificado. Os meses seguintes repetem esse valor como estimativa. Assinaturas, novas compras, juros e tarifas futuras não estão incluídos.</span></div><div className="projection-list">{projections.map((p, i) => <div key={p.label}><span>{p.label}</span><strong>{money(p.cents)}</strong><small>{i === 0 ? 'Parcelas identificadas ou estimadas' : 'Estimativa das parcelas restantes'}</small></div>)}</div></>}</section>}

          {tab === 'overview' && active && <OverviewHighlights transactions={transactions} people={state.people} onTransactions={() => setTab('transactions')}/>}
          {tab === 'overview' && <section className="panel overview-recent"><div className="panel-heading"><div><h2>Movimentações recentes</h2><p>Um retrato rápido da fatura. A edição fica em Lançamentos.</p></div><button className="text-button" onClick={() => setTab('transactions')}>Abrir lançamentos <ArrowRight width={16} height={16}/></button></div><div className="overview-recent-list">{transactions.slice(0, 4).map(transaction => <div key={transaction.id}><span className={`merchant-icon ${transaction.kind === 'service' ? 'service' : ''}`}><CreditCard width={16}/></span><span><strong>{transaction.merchant}</strong><small>{transaction.date} · {state.people.find(person => person.id === buyerOf(transaction))?.name || 'Sem comprador'}</small></span><b>{money(transaction.cents)}</b></div>)}</div></section>}

          {tab === 'overview' && <section className="people-section"><div className="section-heading"><div><h2>Quem fica com quanto</h2></div><button className="text-button" onClick={() => openPerson()}><Plus width={17} height={17}/> Adicionar pessoa</button></div><div className="people-grid">{state.people.map(p => {
            const count = transactions.filter(t => t.allocations.some(a => a.personId === p.id)).length;
            const amount = transactions.reduce((n, t) => n + (t.allocations.find(a => a.personId === p.id)?.cents ?? 0), 0);
            return <button className="person-card" key={p.id} onClick={() => router.push('/pessoas/' + encodeURIComponent(p.id))}><div><Avatar name={p.name} color={p.color}/><span><strong>{p.name}</strong><small>{count} lançamentos</small></span><ChevronRight width={17} height={17}/></div><strong className="person-total">{money(amount)}</strong><div className="person-line" style={{ background: p.color + '18' }}><span style={{ width: `${Math.min(100, Math.max(0, amount / Math.max(active.total, 1) * 100))}%`, background: p.color }}/></div></button>;
          })}<button className="add-person-card" onClick={() => openPerson()}><span><Plus width={22} height={22}/></span><strong>Mais alguém na conta?</strong><small>Adicione uma pessoa para dividir</small></button></div></section>}

          {tab === 'transactions' && <ChargeSummary statement={active} people={state.people}/>}
          {tab === 'transactions' && <section className="panel transaction-panel"><div className="panel-heading"><div><h2>Lançamentos <span className="count-tag">{transactions.length}</span></h2><p>Pesquise, filtre, informe o comprador e corrija cada compra.</p></div>{filter !== 'all' && filter !== 'pending' ? <button className="button secondary compact" onClick={exportPersonPdf}><ArrowDownToLine width={15} height={15}/> Fatura individual</button> : null}</div><div className="filters"><label className="search-box"><Search width={18} height={18}/><input placeholder="Buscar compra, observação ou pessoa" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Filtrar por responsável" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos os responsáveis</option><option value="pending">Falta dividir</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Filtrar por categoria" value={category} onChange={e => setCategory(e.target.value)}><option value="all">Todas as categorias</option>{[...new Set(transactions.map(t => t.category))].sort().map(c => <option key={c}>{c}</option>)}</select></div><div className="table-scroll"><table><thead><tr><th>ESTABELECIMENTO</th><th>DATA</th><th>PARCELA</th><th>VALOR</th><th>COMPRADOR / DIVISÃO</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{visible.map(t => <tr key={t.id} className={isSharedCost(t) ? 'purchase-shared' : buyerOf(t) ? 'purchase-assigned' : 'purchase-pending'}><td><div className="merchant-cell"><span className={`merchant-icon ${t.kind === 'service' ? 'service' : ''}`}><CreditCard width={17} height={17}/></span><div><strong>{t.merchant}</strong><small>{t.category} · {t.holder}</small>{t.note && <span className="purchase-note">{t.note}</span>}</div></div></td><td className="muted">{t.date}</td><td>{t.installment ? <span className="installment-tag">{t.installment.current} de {t.installment.total}</span> : <span className="muted">À vista</span>}</td><td className="amount-cell">{money(t.cents)}</td><td className="buyer-assignment-cell">{isSharedCost(t) ? <span className="shared-label">{t.allocations.length ? `Rateado entre ${t.allocations.length}` : 'Aguardando compradores'}</span> : <><span className="purchase-control-label">Quem comprou</span><select className="buyer-select" aria-label={`Comprador de ${t.merchant}`} value={buyerOf(t) ?? ''} onChange={e => setBuyer(t.id, e.target.value)}><option value="">Indicar comprador</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="purchase-control-label">Quem paga</span><div className="assign-cell"><select aria-label={`Responsável por ${t.merchant}, ${t.date}, ${money(t.cents)}`} value={t.allocations.length === 1 && sum(t.allocations) === t.cents ? t.allocations[0].personId : t.allocations.length ? '__split' : ''} onChange={e => { if (e.target.value === '__split') openSplit(t); else assign(t.id, e.target.value); }} className={!t.allocations.length ? 'unassigned-select' : ''}><option value="">Definir pessoa</option>{t.allocations.length > 0 && <option value="__split">{t.allocations.length > 1 ? `Dividido entre ${t.allocations.length}` : 'Divisão parcial'}</option>}{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="icon-button" aria-label={`Dividir ${t.merchant}`} onClick={() => openSplit(t)}><Users width={17} height={17}/></button></div></>}</td><td><button className="icon-button" aria-label={`Editar ${t.merchant}`} onClick={() => { setEditing(t); setFormError(''); }}><Pencil width={15} height={15}/></button></td></tr>)}</tbody></table>{!visible.length && <div className="empty-table">Nenhum lançamento corresponde aos filtros.</div>}</div><div className="table-footer"><span>{visible.length} de {transactions.length} lançamentos</span><span>Total filtrado <strong>{money(sum(visible))}</strong></span></div></section>}
          </>}
        </>}
        <footer className="page-footer"><span><ShieldCheck width={14} height={14}/> Seus dados ficam protegidos no seu espaço compartilhado.</span><span>Fatura em dia · versão inicial</span></footer>
      </div>
    </main>
    {message && <div className="toast" role="status"><CircleAlert width={18} height={18}/><span>{message}</span><button onClick={() => setMessage('')} aria-label="Fechar aviso"><X width={16} height={16}/></button></div>}
    {importCardSetup && candidate && <div className="import-flow-overlay" role="dialog" aria-modal="true" aria-label="Escolha o cartão da fatura"><section className="import-flow-card"><span className="eyebrow">ANTES DE IMPORTAR</span><h2>Qual é o cartão desta fatura?</h2><p>O cartão define o ciclo de vencimento. O PDF informa a data real desta fatura e suas compras.</p>{cloudCards.length > 0 && <label className="field">Cartão já cadastrado<select value={importFallbackCardId} onChange={event => setImportFallbackCardId(event.target.value)}><option value="">Criar outro cartão</option>{cloudCards.map(card => <option key={card.id} value={card.id}>{card.issuer || card.name} •••• {card.last4 || '—'} · vence dia {card.dueDay}</option>)}</select></label>}{!importFallbackCardId && <div className="import-card-fields"><label className="field">Banco<select value={newImportCard.issuer} onChange={event => setNewImportCard(current => ({ ...current, issuer: event.target.value }))}><option>Itaú</option><option>Nubank</option><option>Caixa</option></select></label><label className="field">Nome do cartão<input value={newImportCard.name} onChange={event => setNewImportCard(current => ({ ...current, name: event.target.value }))} placeholder="Ex.: cartão principal"/></label><label className="field">4 últimos números<input inputMode="numeric" maxLength={4} value={newImportCard.last4} onChange={event => setNewImportCard(current => ({ ...current, last4: event.target.value.replace(/\D/g, '') }))} placeholder="1234"/></label><label className="field">Dia de vencimento<input type="number" min="1" max="31" value={newImportCard.dueDay} onChange={event => setNewImportCard(current => ({ ...current, dueDay: event.target.value }))} placeholder="20"/></label></div>}{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" type="button" onClick={() => { setImportCardSetup(false); setCandidate(null); setCandidateFile(null); }}>Cancelar importação</button><button className="button primary" type="button" disabled={busy} onClick={() => void chooseImportCard()}>{busy ? 'Salvando…' : importFallbackCardId ? 'Usar este cartão' : 'Criar e continuar'}</button></div></section></div>}
    {dueDateConflict && <div className="import-flow-overlay" role="dialog" aria-modal="true" aria-label="Conferir vencimento real"><section className="import-flow-card due-date-warning"><span className="eyebrow">CONFIRA O VENCIMENTO</span><h2>O PDF não bate com o ciclo do cartão.</h2><p>Para <strong>{dueDateConflict.card}</strong>, o próximo vencimento esperado seria <strong>{dateLabel(dueDateConflict.expected)}</strong>, considerando fins de semana e feriados nacionais. O PDF informa <strong>{dateLabel(dueDateConflict.actual)}</strong>.</p><p className="helper">Isso pode indicar a escolha de outro cartão ou uma exceção do emissor. O vencimento real do PDF será preservado no histórico.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDueDateConflict(null)}>Revisar cartão</button><button className="button primary" onClick={() => { setDueDateConflict(null); void confirmImport(true); }}>Continuar com o vencimento do PDF</button></div></section></div>}
    {paymentStatement && <Modal title={paymentStatement.paidAt ? 'Pagamento informado' : 'Informar pagamento'} onClose={() => setPaymentStatement(null)}><p className="modal-description">Registre a data em que a fatura de {money(paymentStatement.total)} foi paga. Isso organiza o acompanhamento; nenhum pagamento é realizado pelo ShareCard.</p><label className="field">Data do pagamento<input type="date" value={paidDate} onChange={event => setPaidDate(event.target.value)} max={new Date().toISOString().slice(0, 10)}/></label><div className="modal-actions">{paymentStatement.paidAt && <button className="text-button" onClick={() => { updateStatement(statement => ({ ...statement, paidAt: undefined })); setPaymentStatement(null); setMessage('Pagamento removido desta fatura.'); }}>Desfazer marcação</button>}<button className="button secondary" onClick={() => setPaymentStatement(null)}>Cancelar</button><button className="button primary" disabled={!paidDate} onClick={() => { updateStatement(statement => ({ ...statement, paidAt: paidDate })); setPaymentStatement(null); setMessage(`Pagamento registrado em ${dateLabel(paidDate)}.`); }}><Check width={17} height={17}/> Confirmar pagamento</button></div></Modal>}

    {personModal && <Modal title={personEditing ? 'Editar pessoa' : 'Adicionar pessoa'} onClose={() => setPersonModal(false)}><form onSubmit={e => { e.preventDefault(); savePerson(); }}><p className="modal-description">Cadastre quem participa das compras. O e-mail é opcional e permite enviar um convite para a própria pessoa acompanhar os gastos.</p><label className="field">Nome<input autoFocus maxLength={40} value={personName} onChange={e => setPersonName(e.target.value)} placeholder="Ex.: Maria" required/></label><label className="field">E-mail <small>opcional</small><input type="email" inputMode="email" value={personEmail} onChange={e => setPersonEmail(e.target.value)} placeholder="maria@email.com"/></label><label className="field">Telefone <small>opcional</small><input type="tel" inputMode="tel" value={personPhone} onChange={e => setPersonPhone(e.target.value)} placeholder="(11) 99999-9999"/></label><label className="field">Limite por fatura (R$)<input inputMode="decimal" value={personLimit} onChange={e => setPersonLimit(e.target.value)} placeholder="Opcional. Ex.: 800,00"/></label><label className="field">Cor de identificação<input type="color" value={personColor} onChange={e => setPersonColor(e.target.value)}/></label>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPersonModal(false)}>Cancelar</button><button className="button primary">{personEditing ? 'Salvar pessoa' : 'Adicionar pessoa'}</button></div></form></Modal>}
    {personDelete && <Modal title="Excluir pessoa?" onClose={() => setPersonDelete(null)}><p>Excluir {personDelete.name} do cadastro? Pessoas com compras ou divisões em qualquer fatura precisam ser desvinculadas antes.</p>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setPersonDelete(null)}>Cancelar</button><button className="button danger-button" onClick={() => { const id = personDelete.id; if (state.statements.some(s => s.transactions.some(t => buyerOf(t) === id || t.allocations.some(a => a.personId === id)))) { setFormError('Esta pessoa tem compras ou divisões vinculadas. Altere os vínculos antes de excluir.'); return; } setState(prev => ({ ...prev, people: prev.people.filter(p => p.id !== id) })); setPersonDelete(null); if (personId === id) router.push('/pessoas'); }}>Excluir pessoa</button></div></Modal>}
    {split && <Modal title="Dividir compra" onClose={() => setSplit(null)}><div className="split-summary"><div><strong>{split.merchant}</strong><small>{split.date}{split.installment ? ` · Parcela ${split.installment.current}/${split.installment.total}` : ''}</small></div><strong>{money(split.cents)}</strong></div>{!state.people.length ? <div className="notice">Cadastre uma pessoa na seção Pessoas para começar a dividir.</div> : <><div className="section-heading"><p>Escolha quem participa</p><button className="text-button" onClick={() => equalSplit()}>Dividir igualmente</button></div><div className="split-people">{state.people.map(p => <div className="split-row" key={p.id}><label><input type="checkbox" checked={splitPeople.includes(p.id)} onChange={e => { const ids = e.target.checked ? [...splitPeople, p.id] : splitPeople.filter(id => id !== p.id); setSplitPeople(ids); equalSplit(ids); }}/><Avatar name={p.name} color={p.color} small/>{p.name}</label>{splitPeople.includes(p.id) && <label className="currency-input"><span>R$</span><input aria-label={`Valor de ${p.name}`} inputMode="decimal" value={splitValues[p.id] ?? ''} onChange={e => setSplitValues({ ...splitValues, [p.id]: e.target.value })}/></label>}</div>)}</div>{split.installment && <label className="check-field"><input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)}/> Aplicar esta proporção às próximas parcelas reconhecidas</label>}<p className="helper">Você pode deixar parte do valor sem responsável para decidir depois.</p></>}{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setSplit(null)}>Cancelar</button><button className="button primary" disabled={!state.people.length} onClick={saveSplit}>Salvar divisão</button></div></Modal>}
    {candidate && !importCardSetup && !dueDateConflict && <Modal title="Confira sua fatura" onClose={() => { setCandidate(null); setFormError(''); }} wide><p className="modal-description">{candidate.filename} · {candidate.transactions.length} lançamentos encontrados. {candidate.card ? <>Cartão identificado: <strong>{candidate.card.issuer}{candidate.card.last4 ? ` •••• ${candidate.card.last4}` : ''}</strong> · vence dia {candidate.card.dueDay}.</> : 'Confira os dados antes de salvar.'}</p>{candidate.transactions.some(t => t.inheritedFromPrevious) && <div className="notice"><CheckCheck width={17}/><span>Algumas compras seguem a divisão da parcela anterior. Revise antes de confirmar.</span></div>}<div className="review-summary"><div><small>{candidateUsesStatementTotal ? 'Total a pagar' : 'Total da fatura'}</small><strong>{money(candidate.total)}</strong></div><div><small>{candidateUsesStatementTotal ? 'Compras e ajustes do período' : 'Soma dos lançamentos'}</small><strong>{money(sum(candidate.transactions))}</strong></div><div><small>{candidateUsesStatementTotal ? 'Saldo e pagamentos anteriores' : 'Diferença'}</small><strong className={candidateUsesStatementTotal || candidate.total === sum(candidate.transactions) ? 'success-text' : 'error-text'}>{money(candidate.total - sum(candidate.transactions))}</strong></div></div>{candidateUsesStatementTotal && <div className="notice"><CircleAlert width={17}/><span>Na Nubank, o total a pagar é o valor principal desta fatura. As compras abaixo servem para atribuir gastos; o saldo anterior e pagamentos já feitos não entram no rateio.</span></div>}{candidate.warnings.length > 0 && <details className="review-warnings"><summary>{candidate.warnings.length} observações da leitura</summary><ul>{candidate.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}<p className="helper">Os responsáveis ficam em branco. Compras parceladas reconhecidas de uma fatura anterior podem herdar a divisão.</p><div className="review-table table-scroll"><table><thead><tr><th>Compra / portador</th><th>Data</th><th>Parcela</th><th>Valor</th><th>Comprador</th><th>Ações</th></tr></thead><tbody>{candidate.transactions.map(t => <tr key={t.id}><td><strong>{t.merchant}</strong><small className="block">{t.holder}</small></td><td>{t.date}</td><td>{t.installment ? `${t.installment.current}/${t.installment.total}` : '—'}</td><td>{money(t.cents)}</td><td>{t.inheritedFromPrevious && <span className="soft-tag">Herdada</span>}<select aria-label={`Comprador de ${t.merchant}`} value={buyerOf(t) ?? ""} disabled={isSharedCost(t)} onChange={event => setCandidateBuyer(t.id, event.target.value)}><option value="">Decidir depois</option><option value="__master__">Minha compra</option>{state.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></td><td><button className="icon-button" aria-label={`Corrigir ${t.merchant}`} onClick={() => { setEditing(t); setFormError(''); }}><Pencil width={16} height={16}/></button><button className="icon-button" aria-label={`Remover ${t.merchant}`} onClick={() => setCandidate({ ...candidate, transactions: candidate.transactions.filter(x => x.id !== t.id) })}><Trash2 width={16} height={16}/></button></td></tr>)}</tbody></table></div><div className="review-tools"><button className="text-button" onClick={() => { const t: Transaction = { id: crypto.randomUUID(), date: '01/08', merchant: 'Novo lançamento', cents: 0, category: 'Outros', holder: 'Não identificado', kind: 'purchase', allocations: [], carryForward: true }; setCandidate({ ...candidate, transactions: [...candidate.transactions, t] }); setEditing(t); setFormError(''); }}><Plus width={16} height={16}/> Adicionar lançamento ausente</button></div>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><span className="helper">{candidateUsesStatementTotal ? 'O total a pagar será salvo; agora revise e atribua as compras do período.' : sum(candidate.transactions) === candidate.total ? 'Total conferido. Pronto para importar.' : 'Corrija a diferença para continuar.'}</span><button className="button secondary" onClick={() => setCandidate(null)}>Cancelar</button><button className="button primary" disabled={(!candidateUsesStatementTotal && sum(candidate.transactions) !== candidate.total) || !candidate.transactions.length} onClick={confirmImport}><Check width={17} height={17}/> Confirmar importação</button></div></Modal>}
    {editing && <Modal title="Editar compra" onClose={() => setEditing(null)}><form onSubmit={e => { e.preventDefault(); editSave(new FormData(e.currentTarget)); }}><label className="field">Estabelecimento<input name="merchant" defaultValue={editing.merchant} required maxLength={150}/></label><div className="two-fields"><label className="field">Data (DD/MM)<input name="date" defaultValue={editing.date} required pattern="[0-9]{2}/[0-9]{2}"/></label><label className="field">Valor (R$)<input name="amount" defaultValue={(editing.cents / 100).toFixed(2).replace('.', ',')} inputMode="decimal" required/></label></div><label className="field">Comprador<select name="buyerId" defaultValue={buyerOf(editing) ?? ''}><option value="">Ainda não identificado</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Observação<textarea name="note" defaultValue={editing.note ?? ''} maxLength={2000} rows={3} placeholder="Ex.: presente de aniversário, compra para a casa…"/></label><label className="check-field"><input type="checkbox" name="sharedCost" defaultChecked={isSharedCost(editing)}/> Gasto geral: dividir igualmente entre todos os compradores</label><p className="helper">Use para encargos, juros, IOF, seguros e outras despesas comuns. Neste caso o comprador individual é ignorado.</p><label className="field">Categoria<input name="category" defaultValue={editing.category} maxLength={40}/></label><div className="two-fields"><label className="field">Parcela atual<input type="number" name="current" min={1} max={60} defaultValue={editing.installment?.current}/></label><label className="field">Total de parcelas<input type="number" name="total" min={1} max={60} defaultValue={editing.installment?.total}/></label></div><p className="helper">Deixe as parcelas vazias para compras à vista. Ao alterar o valor, a divisão existente será ajustada proporcionalmente.</p>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancelar</button><button className="button primary">Salvar correção</button></div></form></Modal>}
    {deleteId && <Modal title="Excluir esta fatura?" onClose={() => setDeleteId(null)}><p className="modal-description">Os lançamentos e suas divisões serão removidos deste navegador. As outras faturas e pessoas serão mantidas.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteId(null)}>Cancelar</button><button className="button danger-button" onClick={() => { setState(prev => ({ ...prev, statements: prev.statements.filter(s => s.id !== deleteId), activeId: prev.statements.find(s => s.id !== deleteId)?.id ?? null })); setDeleteId(null); }}>Excluir fatura</button></div></Modal>}
  </div>;
}

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function OverviewHighlights({ transactions, people, onTransactions }: { transactions: Transaction[]; people: Person[]; onTransactions: () => void }) {
  const assigned = transactions.flatMap(transaction => transaction.allocations.map(allocation => ({ ...allocation, transaction })));
  const topPeople = people.map(person => ({ person, cents: assigned.filter(item => item.personId === person.id).reduce((total, item) => total + item.cents, 0) })).filter(item => item.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 3);
  const highest = [...transactions].filter(transaction => transaction.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 3);
  const ending = transactions.filter(transaction => transaction.installment && transaction.installment.total - transaction.installment.current <= 1).slice(0, 3);

  return <section className="overview-highlights">
    <div className="section-heading"><div><span className="eyebrow">LEITURA RÁPIDA</span><h2>O que merece atenção agora</h2></div><button className="text-button" onClick={onTransactions}>Abrir lançamentos <ArrowRight width={16}/></button></div>
    <div className="highlight-grid">
      <article className="highlight-card"><span>TOP COMPRADORES</span>{topPeople.length ? <ol>{topPeople.map(({ person, cents }, index) => <li key={person.id}><b>{index + 1}</b><Avatar name={person.name} color={person.color} small/><strong>{person.name}</strong><em>{money(cents)}</em></li>)}</ol> : <p>Atribua compras para ver o ranking.</p>}</article>
      <article className="highlight-card"><span>COMPRAS MAIS ALTAS</span>{highest.length ? <ol>{highest.map(transaction => <li key={transaction.id}><b><CreditCard width={15}/></b><strong>{transaction.merchant}</strong><em>{money(transaction.cents)}</em></li>)}</ol> : <p>Nenhuma compra para analisar.</p>}</article>
      <article className="highlight-card accent"><span>PARCELAS TERMINANDO</span>{ending.length ? <ol>{ending.map(transaction => <li key={transaction.id}><b>{transaction.installment?.current}/{transaction.installment?.total}</b><strong>{transaction.merchant}</strong><em>{money(transaction.cents)}</em></li>)}</ol> : <p>Nenhuma parcela termina nesta fatura.</p>}</article>
    </div>
  </section>;
}

function BuyerPanel({ summary }: { summary: BuyerSummary | null }) {
  if (!summary?.statement) {
    const message = summary?.status === 'person_not_in_workspace'
      ? 'Você foi adicionado como comprador. O master ainda precisa incluir seu perfil na organização desta fatura.'
      : summary?.status === 'no_statement'
        ? 'Você foi adicionado como comprador. Ainda não há faturas importadas neste cartão compartilhado.'
        : 'Você foi adicionado como comprador. Ainda não há compras registradas no seu perfil.';
    return <section className="empty-workspace"><span className="pill">SEU ESPAÇO</span><h2>Suas compras aparecerão aqui.</h2><p>{message}</p><a className="button primary" href="/cartoes">Ver cartões e faturas <ArrowRight width={18}/></a></section>;
  }
  return <section className="buyer-overview"><div className="buyer-context"><span className="eyebrow">SEU PAINEL DE COMPRAS</span><p>Você acompanha apenas os valores vinculados ao seu perfil. Ajustes e novas atribuições ficam com o dono do cartão.</p></div><div className="stats-grid"><article className="stat-card main-stat"><div className="stat-label">Sua parte nesta fatura <Wallet width={19}/></div><strong>{money(summary.personalCents)}</strong><div className="stat-foot">Vencimento {summary.statement.dueDate ? dateLabel(summary.statement.dueDate) : 'a confirmar'}</div></article><article className="stat-card"><div className="stat-label">Compras vinculadas <CreditCard width={19}/></div><strong>{summary.purchaseCount}</strong><small>Valores que fazem parte da sua divisão</small></article><article className="stat-card"><div className="stat-label">Compras divididas <Settings2 width={19}/></div><strong>{summary.pendingCount}</strong><small>Itens compartilhados com outras pessoas</small></article></div><section className="panel transaction-panel buyer-purchases"><div className="panel-heading"><div><h2>Suas compras recentes</h2><p>Valores atribuídos a você na fatura atual.</p></div><a className="text-button" href="/cartoes">Abrir faturas <ArrowRight width={16}/></a></div><div className="table-scroll"><table><thead><tr><th>ESTABELECIMENTO</th><th>DATA</th><th>SEU VALOR</th><th>SITUAÇÃO</th></tr></thead><tbody>{summary.purchases?.map(purchase => <tr key={`${purchase.merchant}-${purchase.date}`}><td><strong>{purchase.merchant}</strong></td><td className="muted">{purchase.date || '—'}</td><td className="amount-cell">{money(purchase.cents)}</td><td><span className="verified">{purchase.assigned ? 'Sua compra' : 'Compra dividida'}</span></td></tr>)}</tbody></table></div></section></section>;
}
