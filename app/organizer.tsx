'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download as ArrowDownToLine, NavArrowRight as ArrowRight, Check, DoubleCheck as CheckCheck, NavArrowRight as ChevronRight, Cloud, CreditCard, Page as FileText, Dashboard as LayoutDashboard, Lock as LockKeyhole, Plus, Search, Settings as Settings2, ShieldCheck, Trash as Trash2, StatsUpSquare as TrendingUp, Upload, Group as Users, Wallet, Xmark as X, WarningCircle as CircleAlert, EditPencil as Pencil, Calendar as CalendarDays } from 'iconoir-react';
import { carryAssignments, colors, emptyState, forecast, money, parseMoney, scaleAllocations, splitEqual, sum, unassigned, validateAllocations, type Allocation, type AppState, type Statement, type Transaction } from '@/lib/model';
import { readStatement } from '@/lib/pdf';
import '@/lib/webmcp';
import { useRouter } from 'next/navigation';
import { useOrganizerState } from './state-provider';
import { PeopleWorkspace, ChargeSummary } from './people-workspace';
import CloudWorkspace from './conta/workspace';
import { buyerOf, isSharedCost, withSharedCharges, type Person } from '@/lib/model';

const dateLabel = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
const monthLabel = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('');
type CloudCard = { id: string; name: string; dueDay: number };
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} onCancel={onClose} aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><X width={20} height={20}/></button></div>{children}</dialog>;
}
function Avatar({ name, color, small = false }: { name: string; color: string; small?: boolean }) { return <span className={`avatar ${small ? 'small' : ''}`} style={{ background: color + '18', color }}>{initials(name)}</span>; }

export default function Organizer({ initialTab = 'overview', personId }: { initialTab?: string; personId?: string }) {
  const { state, setState, ready, storageError } = useOrganizerState();
  const router = useRouter();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [localTab, setLocalTab] = useState(initialTab);
  const tab = initialTab === 'people' ? 'people' : localTab;
  function setTab(next: string) {
    if (next === 'people') { router.push('/pessoas'); return; }
    if (initialTab === 'people') { router.push('/organizador?view=' + next); return; }
    setLocalTab(next);
  }
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<Statement | null>(null);
  const [candidateFile, setCandidateFile] = useState<File | null>(null);
  const [cloudCards, setCloudCards] = useState<CloudCard[]>([]);
  const [cloudCardId, setCloudCardId] = useState('local');
  const [cloudMaster, setCloudMaster] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [forecastPerson, setForecastPerson] = useState('all');
  const [personModal, setPersonModal] = useState(false);
  const [personName, setPersonName] = useState('');
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

  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(''), 6500); return () => clearTimeout(timer); } }, [message]);
  useEffect(() => {
    const loadCloud = async () => {
      try {
        const me = await fetch('/api/backend/me', { credentials: 'same-origin' });
        if (!me.ok || (await me.json() as { role: string }).role !== 'master') return;
        const response = await fetch('/api/backend/cards', { credentials: 'same-origin' });
        if (!response.ok) return;
        const cards = await response.json() as CloudCard[];
        setCloudMaster(true); setCloudCards(cards); setCloudCardId(cards[0]?.id || '');
      } catch { /* The standalone organizer continues to support an offline draft. */ }
    };
    void loadCloud();
  }, []);
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

  function updateStatement(update: (s: Statement) => Statement) {
    if (!active) return;
    setState(prev => ({ ...prev, statements: prev.statements.map(s => s.id === active.id ? update(s) : s) }));
  }
  function guideBuyers(statement: Statement) {
    const participants = [...state.people]; let master = participants.find(person => person.name.toLocaleLowerCase() === 'master' || person.name.toLocaleLowerCase() === 'eu');
    const guided = statement.transactions.map(transaction => {
      if (isSharedCost(transaction)) return transaction;
      const options = ['0 - Minha compra (master)', ...participants.map((person, index) => `${index + 1} - ${person.name}`)].join('\n');
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
    setBusy(true);
    try {
      const parsed = await readStatement(file);
      if (state.statements.some(s => s.fingerprint === parsed.fingerprint)) throw new Error('Esta fatura já foi importada. Selecione-a no histórico.');
      setCandidateFile(file); setCandidate(carryAssignments(parsed, state.statements.filter(s => s.id !== 'demo')));
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível ler o PDF.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  function setCandidateBuyer(transactionId: string, selected: string) {
    if (!candidate) return;
    let buyerId = selected;
    if (selected === '__master__') {
      let master = state.people.find(person => person.name.toLocaleLowerCase() === 'master' || person.name.toLocaleLowerCase() === 'eu');
      if (!master) {
        master = { id: crypto.randomUUID(), name: 'Master', color: '#2563EB' };
        setState(previous => ({ ...previous, people: [...previous.people, master!] }));
      }
      buyerId = master.id;
    }
    setCandidate({ ...candidate, transactions: candidate.transactions.map(transaction => transaction.id === transactionId && !isSharedCost(transaction) ? { ...transaction, buyerId: buyerId || null, allocations: buyerId ? [{ personId: buyerId, cents: transaction.cents }] : [] } : transaction) });
  }
  async function confirmImport() {
    if (!candidate || sum(candidate.transactions) !== candidate.total || !candidate.dueDate || !candidate.transactions.length) return;
    if (state.statements.some(s => s.dueDate === candidate.dueDate && s.total === candidate.total && s.id !== 'demo')) { setFormError('Já existe uma fatura com este vencimento e total. Confira o histórico antes de importar novamente.'); return; }
    if (cloudMaster) {
      if (!candidateFile || !cloudCardId) { setFormError(cloudCards.length ? 'Selecione o cartão desta fatura.' : 'Cadastre um cartão em Conta e nuvem antes de importar.'); return; }
      setBusy(true);
      try {
        const form = new FormData(); form.set('file', candidateFile); form.set('cardId', cloudCardId); form.set('dueDate', candidate.dueDate); form.set('statement', JSON.stringify(candidate));
        const response = await fetch('/api/backend/statements/import', { method: 'POST', credentials: 'same-origin', body: form });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a fatura na nuvem.');
      } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível salvar a fatura na nuvem.'); setBusy(false); return; }
      setBusy(false);
    }
    setState(prev => ({ ...prev, people: prev.statements.length === 1 && prev.statements[0].id === 'demo' ? prev.people.filter(p => !['ana', 'bruno', 'clara'].includes(p.id)) : prev.people, statements: [...prev.statements.filter(s => s.id !== 'demo'), candidate], activeId: candidate.id }));
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
    setPersonEditing(person ?? null); setPersonName(person?.name ?? ''); setPersonLimit(person?.monthlyLimitCents ? (person.monthlyLimitCents / 100).toFixed(2).replace('.', ',') : ''); setPersonColor(person?.color ?? colors[state.people.length % colors.length]); setFormError(''); setPersonModal(true);
  }
  function savePerson() {
    try {
      const name = personName.trim();
      if (!name || state.people.some(p => p.id !== personEditing?.id && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Informe um nome diferente dos já cadastrados.');
      const monthlyLimitCents = personLimit.trim() ? parseMoney(personLimit) : undefined;
      if (monthlyLimitCents !== undefined && monthlyLimitCents <= 0) throw new Error('O limite deve ser maior que zero, ou ficar vazio.');
      const person: Person = { id: personEditing?.id ?? crypto.randomUUID(), name, color: personColor, monthlyLimitCents };
      setState(prev => ({ ...prev, people: personEditing ? prev.people.map(p => p.id === person.id ? person : p) : [...prev.people, person] }));
      setPersonModal(false); setMessage(personEditing ? 'Pessoa atualizada.' : 'Pessoa cadastrada.');
    } catch (e) { setFormError((e as Error).message); }
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
      updateStatement(s => ({ ...s, transactions: s.transactions.map(t => t.id === split.id ? { ...t, allocations, carryForward: carry } : t) })); setSplit(null); setMessage('Divisão salva.');
    } catch (e) { setFormError((e as Error).message); }
  }
  function exportCsv() {
    if (!active) return;
    const cell = (s: string) => '"' + (/^[=+@-]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';
    const rows = [['Data', 'Estabelecimento', 'Categoria', 'Portador', 'Parcela', 'Valor', 'Comprador', 'Observação', 'Tipo de rateio', 'Divisão', 'Sem responsável'], ...transactions.map(t => [t.date, t.merchant, t.category, t.holder, t.installment ? `${t.installment.current}/${t.installment.total}` : '', (t.cents / 100).toFixed(2).replace('.', ','), state.people.find(p => p.id === buyerOf(t))?.name ?? '', t.note ?? '', isSharedCost(t) ? 'Geral: rateio automático' : 'Individual', t.allocations.map(a => `${state.people.find(p => p.id === a.personId)?.name ?? 'Pessoa'}: ${money(a.cents)}`).join(' | '), (unassigned(t) / 100).toFixed(2).replace('.', ',')])];
    download('\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n'), `fatura-${active.dueDate}.csv`, 'text/csv;charset=utf-8');
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
      const updated = { ...editing, merchant, date, cents, note, buyerId: sharedCost ? null : buyerId, sharedCost, category: String(form.get('category')).trim() || 'Outros', installment: current && total ? { current, total } : undefined, ...(cents !== editing.cents || current !== editing.installment?.current || total !== editing.installment?.total ? { nextCents: undefined } : {}), allocations: sharedCost ? [] : followsBuyer ? (buyerId ? [{ personId: buyerId, cents }] : []) : scaleAllocations(editing, cents) };
      if (candidate) setCandidate({ ...candidate, transactions: candidate.transactions.map(t => t.id === updated.id ? updated : t) });
      else updateStatement(s => ({ ...s, transactions: s.transactions.map(t => t.id === updated.id ? updated : t) }));
      setEditing(null); setFormError('');
    } catch (e) { setFormError((e as Error).message); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand brand-logo" href="/" aria-label="ShareCard"><img src="/brand/sharecard_symbol.png" alt="ShareCard"/></a>
      <div className="workspace-label">SEU ORGANIZADOR</div>
      <nav aria-label="Navegação principal">{[{ id: 'overview', label: 'Visão geral', icon: LayoutDashboard }, { id: 'transactions', label: 'Lançamentos', icon: CreditCard }, { id: 'people', label: 'Pessoas', icon: Users }, { id: 'forecast', label: 'Próximas faturas', icon: TrendingUp }, { id: 'account', label: 'Conta e acesso', icon: Wallet }].map(item => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><span className="nav-icon"><item.icon width={20} height={20}/></span><span>{item.label}</span>{tab === item.id && <span className="nav-mark"/>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck width={24} height={24}/><strong>Seu dinheiro.<br/>Sua privacidade.</strong><p>Suas faturas e informações ficam protegidas no seu espaço.</p><span><LockKeyhole width={12} height={12}/> Dados protegidos</span></div>
      <div className="local-user"><span className="user-avatar">EU</span><div>Meu espaço<small>Organize suas faturas</small></div></div>
    </aside>

    <main>
      <header className="topbar"><div className="breadcrumb">Meu espaço <ChevronRight width={14} height={14}/><span>{({ overview: 'Visão geral', transactions: 'Lançamentos', people: 'Pessoas', forecast: 'Próximas faturas', account: 'Conta e acesso' } as Record<string, string>)[tab]}</span></div><span className="private-label"><LockKeyhole width={14} height={14}/> Espaço protegido</span></header>
      <div className="page-content">
        {storageError && <div className="notice danger" role="alert"><CircleAlert width={18} height={18}/>{storageError}</div>}
        <div className="page-heading"><div><div className="eyebrow">MENOS CONTAS NA CABEÇA</div><h1>{tab === 'overview' ? 'Sua fatura, sem mistério.' : tab === 'transactions' ? 'Cada compra no seu lugar.' : tab === 'people' ? 'Tudo dividido, tudo claro.' : tab === 'account' ? 'Seu espaço compartilhado.' : 'Olhe os próximos meses.'}</h1><p>{tab === 'overview' ? 'Entenda os gastos, divida as compras e planeje o que vem.' : tab === 'transactions' ? 'Confira os lançamentos e escolha quem fica com cada valor.' : tab === 'people' ? 'Veja quanto cabe a cada pessoa nesta fatura.' : tab === 'account' ? 'Cuide dos cartões, acessos e faturas que fazem parte do seu grupo.' : 'Acompanhe as parcelas que já estão comprometidas.'}</p></div>{tab !== 'account' && <button className="button primary" disabled={busy || !ready} onClick={() => { setFormError(''); input.current?.click(); }}><Upload width={18} height={18}/>{busy ? 'Lendo fatura…' : 'Importar fatura'}</button>}<input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e => upload(e.target.files?.[0])}/></div>

        {cloudMaster && tab !== 'account' && <div className="statement-toolbar cloud-cycle-picker"><div className="statement-identity"><span className="bank-icon"><CreditCard width={18} height={18}/></span><div><label htmlFor="cloud-card">Cartão para a próxima importação</label><select id="cloud-card" value={cloudCardId} onChange={event => setCloudCardId(event.target.value)}><option value="">Selecione um cartão</option>{cloudCards.map(card => <option key={card.id} value={card.id}>{card.name} · vence dia {card.dueDay}</option>)}</select></div></div><span className="verified">O vencimento real virá do PDF</span></div>}
        {tab === 'account' ? <CloudWorkspace embedded/> : !active && tab !== 'people' ? <section className="empty-workspace" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}><div className="empty-art"><FileText width={48} height={48}/><span><Check width={18} height={18}/></span></div><span className="pill">COMECE POR AQUI</span><h2>Uma fatura. Tudo organizado.</h2><p>Arraste sua fatura Itaú em PDF e descubra quanto é de cada pessoa e o que já está previsto para os próximos meses.</p><button className="button primary" onClick={() => input.current?.click()} disabled={busy || !cloudCardId}>{busy ? 'Lendo PDF…' : 'Selecionar minha fatura'}<ArrowRight width={18} height={18}/></button><div className="empty-steps"><span><span>01</span> Importe o PDF</span><span><span>02</span> Divida as compras</span><span><span>03</span> Planeje o mês</span></div><small>PDF digital Itaú · Até 15 MB · Arquivo protegido no seu espaço</small></section> : <>
          {active && <><div className="statement-toolbar"><div className="statement-identity"><span className="bank-icon"><CreditCard width={21} height={21}/></span><div><label className="sr-only" htmlFor="statement">Fatura selecionada</label><select id="statement" value={active.id} onChange={e => { setState({ ...state, activeId: e.target.value }); setSearch(''); setFilter('all'); setCategory('all'); }}>{[...state.statements].sort((a, b) => b.dueDate.localeCompare(a.dueDate)).map(s => <option key={s.id} value={s.id}>Itaú · {monthLabel(s.dueDate)}</option>)}</select><span>Vencimento em {dateLabel(active.dueDate)}</span></div></div><div className="toolbar-actions"><span className="verified"><CheckCheck width={15} height={15}/>{sum(transactions) === active.total ? 'Total conferido' : 'Revisão necessária'}</span><button className="button secondary compact" onClick={exportCsv}><ArrowDownToLine width={15} height={15}/> Exportar CSV</button><button className="icon-button" aria-label="Excluir fatura" onClick={() => setDeleteId(active.id)}><Trash2 width={17} height={17}/></button></div></div>
          {sum(transactions) !== active.total && <div className="notice danger" role="alert"><CircleAlert width={17} height={17}/>Os lançamentos diferem do total do banco em {money(active.total - sum(transactions))}. Confira as correções antes de usar os valores.</div>}
          </>}
          {tab === 'people' && ready && <PeopleWorkspace state={state} statement={active} personId={personId} onAdd={() => openPerson()} onEdit={openPerson} onDelete={p => { setPersonDelete(p); setFormError(''); }} onTransaction={t => { setEditing(t); setFormError(''); }} onSplit={openSplit}/>}
          {active && <>
          {(tab === 'overview' || tab === 'transactions') && <div className="stats-grid"><article className="stat-card main-stat"><div className="stat-label">Total da fatura <CreditCard width={19} height={19}/></div><strong>{money(active.total)}</strong><div className="stat-foot">{transactions.length} lançamentos <span>Vence {dateLabel(active.dueDate).slice(0, 5)}</span></div></article><article className="stat-card"><div className="stat-label">Já distribuído <Users width={19} height={19}/></div><strong>{money(sum(transactions) - pending)}</strong><div className="progress-track"><span style={{ width: `${transactions.length ? allocatedCount / transactions.length * 100 : 0}%` }}/></div><small>{allocatedCount} de {transactions.length} lançamentos completos</small></article><article className="stat-card"><div className="stat-label">Falta dividir <span className="amber-icon"><Settings2 width={19} height={19}/></span></div><strong>{money(pending)}</strong><button className="stat-link" onClick={() => { setTab('transactions'); setFilter('pending'); }}>{pendingCount ? `${pendingCount} lançamentos para revisar` : 'Tudo atribuído'}<ArrowRight width={15} height={15}/></button></article></div>}

          {(tab === 'overview' || tab === 'forecast') && <section className="panel forecast-panel"><div className="panel-heading"><div><h2>O que já vem por aí <span className="soft-tag">PARCELAS</span></h2><p>Compromissos existentes, sem novas compras.</p></div>{tab === 'overview' ? <button className="text-button" onClick={() => setTab('forecast')}>Ver projeção <ArrowRight width={16} height={16}/></button> : <select aria-label="Previsão por pessoa" value={forecastPerson} onChange={e => setForecastPerson(e.target.value)}><option value="all">Todas as pessoas</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div><div className="forecast-content"><div className="forecast-summary"><span>Próximo mês</span><strong>{money(projections[0]?.cents ?? 0)}</strong><p>{forecastPerson === 'all' && active.nextTotal !== undefined ? `Banco informa ${money(active.nextTotal)} em parcelas.` : 'Conforme a divisão das parcelas futuras.'}</p><span className="forecast-caption"><CalendarDays width={15} height={15}/> Valores sujeitos a ajustes</span></div><div className="chart" role="img" aria-label={chart.map(p => `${p.label}: ${money(p.cents)}`).join('; ')}>{chart.map((p, i) => <div className="chart-column" key={p.label}><span className="chart-value">{money(p.cents)}</span><div className="bar-area"><div className={`bar ${i === 0 ? 'first' : ''}`} style={{ height: `${Math.max(3, p.cents / maxChart * 100)}%` }}/></div><span className="chart-label">{p.label}</span></div>)}</div></div>{tab === 'forecast' && <><div className="notice"><CircleAlert width={17} height={17}/><span>A próxima parcela usa o valor do PDF quando identificado. Os meses seguintes repetem esse valor como estimativa. Assinaturas, novas compras, juros e tarifas futuras não estão incluídos.</span></div><div className="projection-list">{projections.map((p, i) => <div key={p.label}><span>{p.label}</span><strong>{money(p.cents)}</strong><small>{i === 0 ? 'Parcelas identificadas ou estimadas' : 'Estimativa das parcelas restantes'}</small></div>)}</div></>}</section>}

          {tab === 'overview' && <section className="people-section"><div className="section-heading"><div><h2>Quem fica com quanto</h2></div><button className="text-button" onClick={() => openPerson()}><Plus width={17} height={17}/> Adicionar pessoa</button></div><div className="people-grid">{state.people.map(p => {
            const count = transactions.filter(t => t.allocations.some(a => a.personId === p.id)).length;
            const amount = transactions.reduce((n, t) => n + (t.allocations.find(a => a.personId === p.id)?.cents ?? 0), 0);
            return <button className="person-card" key={p.id} onClick={() => router.push('/pessoas/' + encodeURIComponent(p.id))}><div><Avatar name={p.name} color={p.color}/><span><strong>{p.name}</strong><small>{count} lançamentos</small></span><ChevronRight width={17} height={17}/></div><strong className="person-total">{money(amount)}</strong><div className="person-line" style={{ background: p.color + '18' }}><span style={{ width: `${Math.min(100, Math.max(0, amount / Math.max(active.total, 1) * 100))}%`, background: p.color }}/></div></button>;
          })}<button className="add-person-card" onClick={() => openPerson()}><span><Plus width={22} height={22}/></span><strong>Mais alguém na conta?</strong><small>Adicione uma pessoa para dividir</small></button></div></section>}

          {(tab === 'overview' || tab === 'transactions') && <ChargeSummary statement={active} people={state.people}/>}
          {(tab === 'overview' || tab === 'transactions') && <section className="panel transaction-panel"><div className="panel-heading"><div><h2>Lançamentos <span className="count-tag">{transactions.length}</span></h2><p>Atribua uma pessoa ou divida uma compra.</p></div>{tab === 'overview' && <button className="text-button" onClick={() => setTab('transactions')}>Ver todos <ArrowRight width={16} height={16}/></button>}</div><div className="filters"><label className="search-box"><Search width={18} height={18}/><input placeholder="Buscar compra, observação ou pessoa" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Filtrar por responsável" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos os responsáveis</option><option value="pending">Falta dividir</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Filtrar por categoria" value={category} onChange={e => setCategory(e.target.value)}><option value="all">Todas as categorias</option>{[...new Set(transactions.map(t => t.category))].sort().map(c => <option key={c}>{c}</option>)}</select></div><div className="table-scroll"><table><thead><tr><th>ESTABELECIMENTO</th><th>DATA</th><th>PARCELA</th><th>VALOR</th><th>COMPRADOR / DIVISÃO</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{(tab === 'overview' ? visible.slice(0, 7) : visible).map(t => <tr key={t.id}><td><div className="merchant-cell"><span className={`merchant-icon ${t.kind === 'service' ? 'service' : ''}`}><CreditCard width={17} height={17}/></span><div><strong>{t.merchant}</strong><small>{t.category} · {t.holder}</small>{t.note && <span className="purchase-note">{t.note}</span>}</div></div></td><td className="muted">{t.date}</td><td>{t.installment ? <span className="installment-tag">{t.installment.current} de {t.installment.total}</span> : <span className="muted">À vista</span>}</td><td className="amount-cell">{money(t.cents)}</td><td>{isSharedCost(t) ? <span className="shared-label">{t.allocations.length ? `Rateado entre ${t.allocations.length}` : 'Aguardando compradores'}</span> : <><span className="purchase-control-label">Quem comprou</span><select className="buyer-select" aria-label={`Comprador de ${t.merchant}`} value={buyerOf(t) ?? ''} onChange={e => setBuyer(t.id, e.target.value)}><option value="">Indicar comprador</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="purchase-control-label">Quem paga</span><div className="assign-cell"><select aria-label={`Responsável por ${t.merchant}, ${t.date}, ${money(t.cents)}`} value={t.allocations.length === 1 && sum(t.allocations) === t.cents ? t.allocations[0].personId : t.allocations.length ? '__split' : ''} onChange={e => { if (e.target.value === '__split') openSplit(t); else assign(t.id, e.target.value); }} className={!t.allocations.length ? 'unassigned-select' : ''}><option value="">Definir pessoa</option>{t.allocations.length > 0 && <option value="__split">{t.allocations.length > 1 ? `Dividido entre ${t.allocations.length}` : 'Divisão parcial'}</option>}{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="icon-button" aria-label={`Dividir ${t.merchant}`} onClick={() => openSplit(t)}><Users width={17} height={17}/></button></div></>}</td><td><button className="icon-button" aria-label={`Editar ${t.merchant}`} onClick={() => { setEditing(t); setFormError(''); }}><Pencil width={15} height={15}/></button></td></tr>)}</tbody></table>{!visible.length && <div className="empty-table">Nenhum lançamento corresponde aos filtros.</div>}</div><div className="table-footer"><span>{tab === 'overview' ? Math.min(7, visible.length) : visible.length} de {transactions.length} lançamentos</span><span>Total filtrado <strong>{money(sum(visible))}</strong></span></div></section>}
          </>}
        </>}
        <footer className="page-footer"><span><ShieldCheck width={14} height={14}/> Seus dados ficam neste navegador. Exporte um backup para guardá-los.</span><span>Fatura em dia · versão inicial</span></footer>
      </div>
    </main>
    {message && <div className="toast" role="status"><CircleAlert width={18} height={18}/><span>{message}</span><button onClick={() => setMessage('')} aria-label="Fechar aviso"><X width={16} height={16}/></button></div>}

    {personModal && <Modal title={personEditing ? 'Editar pessoa' : 'Adicionar pessoa'} onClose={() => setPersonModal(false)}><form onSubmit={e => { e.preventDefault(); savePerson(); }}><p className="modal-description">Uma pessoa tem suas compras, sua parte dos encargos e um limite opcional por fatura.</p><label className="field">Nome<input autoFocus maxLength={40} value={personName} onChange={e => setPersonName(e.target.value)} placeholder="Ex.: Maria" required/></label><label className="field">Limite por fatura (R$)<input inputMode="decimal" value={personLimit} onChange={e => setPersonLimit(e.target.value)} placeholder="Opcional. Ex.: 800,00"/></label><label className="field">Cor de identificação<input type="color" value={personColor} onChange={e => setPersonColor(e.target.value)}/></label>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPersonModal(false)}>Cancelar</button><button className="button primary">{personEditing ? 'Salvar pessoa' : 'Adicionar pessoa'}</button></div></form></Modal>}
    {personDelete && <Modal title="Excluir pessoa?" onClose={() => setPersonDelete(null)}><p>Excluir {personDelete.name} do cadastro? Pessoas com compras ou divisões em qualquer fatura precisam ser desvinculadas antes.</p>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setPersonDelete(null)}>Cancelar</button><button className="button danger-button" onClick={() => { const id = personDelete.id; if (state.statements.some(s => s.transactions.some(t => buyerOf(t) === id || t.allocations.some(a => a.personId === id)))) { setFormError('Esta pessoa tem compras ou divisões vinculadas. Altere os vínculos antes de excluir.'); return; } setState(prev => ({ ...prev, people: prev.people.filter(p => p.id !== id) })); setPersonDelete(null); if (personId === id) router.push('/pessoas'); }}>Excluir pessoa</button></div></Modal>}
    {split && <Modal title="Dividir compra" onClose={() => setSplit(null)}><div className="split-summary"><div><strong>{split.merchant}</strong><small>{split.date}{split.installment ? ` · Parcela ${split.installment.current}/${split.installment.total}` : ''}</small></div><strong>{money(split.cents)}</strong></div>{!state.people.length ? <div className="notice">Cadastre uma pessoa na seção Pessoas para começar a dividir.</div> : <><div className="section-heading"><p>Escolha quem participa</p><button className="text-button" onClick={() => equalSplit()}>Dividir igualmente</button></div><div className="split-people">{state.people.map(p => <div className="split-row" key={p.id}><label><input type="checkbox" checked={splitPeople.includes(p.id)} onChange={e => { const ids = e.target.checked ? [...splitPeople, p.id] : splitPeople.filter(id => id !== p.id); setSplitPeople(ids); equalSplit(ids); }}/><Avatar name={p.name} color={p.color} small/>{p.name}</label>{splitPeople.includes(p.id) && <label className="currency-input"><span>R$</span><input aria-label={`Valor de ${p.name}`} inputMode="decimal" value={splitValues[p.id] ?? ''} onChange={e => setSplitValues({ ...splitValues, [p.id]: e.target.value })}/></label>}</div>)}</div>{split.installment && <label className="check-field"><input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)}/> Aplicar esta proporção às próximas parcelas reconhecidas</label>}<p className="helper">Você pode deixar parte do valor sem responsável para decidir depois.</p></>}{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setSplit(null)}>Cancelar</button><button className="button primary" disabled={!state.people.length} onClick={saveSplit}>Salvar divisão</button></div></Modal>}
    {candidate && <Modal title="Confira sua fatura" onClose={() => { setCandidate(null); setFormError(''); }} wide><p className="modal-description">{candidate.filename} · {candidate.transactions.length} lançamentos encontrados. Confira os dados antes de salvar.</p><div className="review-summary"><div><small>Total da fatura</small><strong>{money(candidate.total)}</strong></div><div><small>Soma dos lançamentos</small><strong>{money(sum(candidate.transactions))}</strong></div><div><small>Diferença</small><strong className={candidate.total === sum(candidate.transactions) ? 'success-text' : 'error-text'}>{money(candidate.total - sum(candidate.transactions))}</strong></div></div>{candidate.warnings.length > 0 && <details className="review-warnings"><summary>{candidate.warnings.length} observações da leitura</summary><ul>{candidate.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}<p className="helper">Os responsáveis ficam em branco. Compras parceladas reconhecidas de uma fatura anterior podem herdar a divisão.</p><div className="review-table table-scroll"><table><thead><tr><th>Compra / portador</th><th>Data</th><th>Parcela</th><th>Valor</th><th>Comprador</th><th>Ações</th></tr></thead><tbody>{candidate.transactions.map(t => <tr key={t.id}><td><strong>{t.merchant}</strong><small className="block">{t.holder}</small></td><td>{t.date}</td><td>{t.installment ? `${t.installment.current}/${t.installment.total}` : '—'}</td><td>{money(t.cents)}</td><td><select aria-label={`Comprador de ${t.merchant}`} value={buyerOf(t) ?? ""} disabled={isSharedCost(t)} onChange={event => setCandidateBuyer(t.id, event.target.value)}><option value="">Decidir depois</option><option value="__master__">Minha compra</option>{state.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></td><td><button className="icon-button" aria-label={`Corrigir ${t.merchant}`} onClick={() => { setEditing(t); setFormError(''); }}><Pencil width={16} height={16}/></button><button className="icon-button" aria-label={`Remover ${t.merchant}`} onClick={() => setCandidate({ ...candidate, transactions: candidate.transactions.filter(x => x.id !== t.id) })}><Trash2 width={16} height={16}/></button></td></tr>)}</tbody></table></div><div className="review-tools"><button className="text-button" onClick={() => { const t: Transaction = { id: crypto.randomUUID(), date: '01/08', merchant: 'Novo lançamento', cents: 0, category: 'Outros', holder: 'Não identificado', kind: 'purchase', allocations: [], carryForward: true }; setCandidate({ ...candidate, transactions: [...candidate.transactions, t] }); setEditing(t); setFormError(''); }}><Plus width={16} height={16}/> Adicionar lançamento ausente</button></div>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><span className="helper">{sum(candidate.transactions) === candidate.total ? 'Total conferido. Pronto para importar.' : 'Corrija a diferença para continuar.'}</span><button className="button secondary" onClick={() => setCandidate(null)}>Cancelar</button><button className="button primary" disabled={sum(candidate.transactions) !== candidate.total || !candidate.transactions.length} onClick={confirmImport}><Check width={17} height={17}/> Confirmar importação</button></div></Modal>}
    {editing && <Modal title="Editar compra" onClose={() => setEditing(null)}><form onSubmit={e => { e.preventDefault(); editSave(new FormData(e.currentTarget)); }}><label className="field">Estabelecimento<input name="merchant" defaultValue={editing.merchant} required maxLength={150}/></label><div className="two-fields"><label className="field">Data (DD/MM)<input name="date" defaultValue={editing.date} required pattern="[0-9]{2}/[0-9]{2}"/></label><label className="field">Valor (R$)<input name="amount" defaultValue={(editing.cents / 100).toFixed(2).replace('.', ',')} inputMode="decimal" required/></label></div><label className="field">Comprador<select name="buyerId" defaultValue={buyerOf(editing) ?? ''}><option value="">Ainda não identificado</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Observação<textarea name="note" defaultValue={editing.note ?? ''} maxLength={2000} rows={3} placeholder="Ex.: presente de aniversário, compra para a casa…"/></label><label className="check-field"><input type="checkbox" name="sharedCost" defaultChecked={isSharedCost(editing)}/> Gasto geral: dividir igualmente entre todos os compradores</label><p className="helper">Use para encargos, juros, IOF, seguros e outras despesas comuns. Neste caso o comprador individual é ignorado.</p><label className="field">Categoria<input name="category" defaultValue={editing.category} maxLength={40}/></label><div className="two-fields"><label className="field">Parcela atual<input type="number" name="current" min={1} max={60} defaultValue={editing.installment?.current}/></label><label className="field">Total de parcelas<input type="number" name="total" min={1} max={60} defaultValue={editing.installment?.total}/></label></div><p className="helper">Deixe as parcelas vazias para compras à vista. Ao alterar o valor, a divisão existente será ajustada proporcionalmente.</p>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancelar</button><button className="button primary">Salvar correção</button></div></form></Modal>}
    {deleteId && <Modal title="Excluir esta fatura?" onClose={() => setDeleteId(null)}><p className="modal-description">Os lançamentos e suas divisões serão removidos deste navegador. As outras faturas e pessoas serão mantidas.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteId(null)}>Cancelar</button><button className="button danger-button" onClick={() => { setState(prev => ({ ...prev, statements: prev.statements.filter(s => s.id !== deleteId), activeId: prev.statements.find(s => s.id !== deleteId)?.id ?? null })); setDeleteId(null); }}>Excluir fatura</button></div></Modal>}
  </div>;
}

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
