from pathlib import Path
p=Path('app/organizer.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace("import '@/lib/webmcp';", """import '@/lib/webmcp';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrganizerState } from './state-provider';
import { PeopleWorkspace, ChargeSummary } from './people-workspace';
import { validateBackup } from '@/lib/storage';
import { buyerOf, isSharedCost, withSharedCharges, type Person } from '@/lib/model';""")
start=s.index('function validateBackup(')
validation=s[start:]
s=s[:start]
validation=validation.replace('function validateBackup(', 'export function validateBackup(')
validation=validation.replace("if (t.nextCents !== undefined", """if (t.buyerId != null && (typeof t.buyerId !== 'string' || !s.people.some(p => p.id === t.buyerId))) throw new Error('Comprador inválido');
      if (t.note !== undefined && (typeof t.note !== 'string' || t.note.length > 2000)) throw new Error('Observação inválida');
      if (t.sharedCost !== undefined && typeof t.sharedCost !== 'boolean') throw new Error('Rateio inválido');
      if (t.nextCents !== undefined""")
validation=validation.replace('  return s;', """  for (const p of s.people) if (p.monthlyLimitCents !== undefined && (!Number.isSafeInteger(p.monthlyLimitCents) || p.monthlyLimitCents <= 0)) throw new Error('Limite inválido');
  return s;""")
Path('lib/storage.ts').write_text("import { validateAllocations, type AppState } from './model';\n"+validation,encoding='utf-8')
s=s.replace('export default function Organizer() {\n  const [state, setState] = useState<AppState>(emptyState);', """export default function Organizer({ initialTab = 'overview', personId }: { initialTab?: string; personId?: string }) {
  const { state, setState, ready, storageError, setStorageError } = useOrganizerState();
  const router = useRouter();""")
s=s.replace("  const [ready, setReady] = useState(false);\n  const [tab, setTab] = useState('overview');", """  const [localTab, setLocalTab] = useState(initialTab);
  const tab = initialTab === 'people' ? 'people' : localTab;
  function setTab(next: string) {
    if (next === 'people') { router.push('/pessoas'); return; }
    if (initialTab === 'people') { router.push('/?view=' + next); return; }
    setLocalTab(next);
  }""")
s=s.replace("  const [storageError, setStorageError] = useState('');\n",'')
s=s.replace("  const [personName, setPersonName] = useState('');", """  const [personName, setPersonName] = useState('');
  const [personEditing, setPersonEditing] = useState<Person | null>(null);
  const [personLimit, setPersonLimit] = useState('');
  const [personColor, setPersonColor] = useState(colors[0]);
  const [personDelete, setPersonDelete] = useState<Person | null>(null);""")
s=s.replace('  const active = state.statements.find(s => s.id === state.activeId) ?? state.statements[0];', '  const rawActive = state.statements.find(s => s.id === state.activeId) ?? state.statements[0];\n  const active = rawActive ? withSharedCharges(rawActive, state.people) : undefined;')
s=s.replace('`${t.merchant} ${t.holder}`', "`${t.merchant} ${t.holder} ${t.note ?? ''} ${state.people.find(p => p.id === buyerOf(t))?.name ?? ''}`")
start=s.index('  useEffect(() => {\n    try { const saved')
end=s.index('  useEffect(() => { if (message)',start)
s=s[:start]+s[end:]
s=s.replace('          const bill = current.statements.find(s => s.id === current.activeId) ?? current.statements[0];\n          if (!bill) return', '          const rawBill = current.statements.find(s => s.id === current.activeId) ?? current.statements[0];\n          const bill = rawBill ? withSharedCharges(rawBill, current.people) : undefined;\n          if (!bill) return')
start=s.index('  function assign(')
end=s.index('  function openSplit(',start)
s=s[:start]+"""  function assign(id: string, personId: string) {
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
"""+s[end:]
s=s.replace('  function openSplit(t: Transaction) {','  function openSplit(t: Transaction) {\n    if (isSharedCost(t)) { setMessage(\'Este gasto geral é rateado automaticamente entre os compradores. Altere o tipo na edição para dividir individualmente.\'); return; }')
s=s.replace("'Parcela', 'Valor', 'Divisão'", "'Parcela', 'Valor', 'Comprador', 'Observação', 'Tipo de rateio', 'Divisão'")
s=s.replace("(t.cents / 100).toFixed(2).replace('.', ','), t.allocations.map", "(t.cents / 100).toFixed(2).replace('.', ','), state.people.find(p => p.id === buyerOf(t))?.name ?? '', t.note ?? '', isSharedCost(t) ? 'Geral: rateio automático' : 'Individual', t.allocations.map")
s=s.replace('      const updated = { ...editing, merchant, date, cents,', """      const note = String(form.get('note') ?? '').trim();
      const buyerId = String(form.get('buyerId') ?? '') || null;
      const sharedCost = form.get('sharedCost') === 'on';
      const followsBuyer = !editing.allocations.length || (editing.allocations.length === 1 && editing.allocations[0].personId === buyerOf(editing) && sum(editing.allocations) === editing.cents);
      const updated = { ...editing, merchant, date, cents, note, buyerId: sharedCost ? null : buyerId, sharedCost,""")
s=s.replace('allocations: scaleAllocations(editing, cents) };', "allocations: sharedCost ? [] : followsBuyer ? (buyerId ? [{ personId: buyerId, cents }] : []) : scaleAllocations(editing, cents) };")
s=s.replace("onClick={() => { setPersonModal(true); setFormError(''); }}", 'onClick={() => openPerson()}')
s=s.replace("{!active ? <section", "{!active && tab !== 'people' ? <section")
s=s.replace('          <div className="statement-toolbar">','          {active && <><div className="statement-toolbar">',1)
needle="          {(tab === 'overview' || tab === 'transactions') && <div className=\"stats-grid\">"
s=s.replace(needle, "          </>}\n          {tab === 'people' && ready && <PeopleWorkspace state={state} statement={active} personId={personId} onAdd={() => openPerson()} onEdit={openPerson} onDelete={p => { setPersonDelete(p); setFormError(''); }} onTransaction={t => { setEditing(t); setFormError(''); }} onSplit={openSplit}/>}\n          {active && <>\n          "+needle.strip())
s=s.replace("          {(tab === 'overview' || tab === 'people') && <section", "          {tab === 'overview' && <section")
s=s.replace("onClick={() => { setTab('transactions'); setFilter(p.id); }}", "onClick={() => router.push('/pessoas/' + encodeURIComponent(p.id))}")
s=s.replace("        </>}\n        <div className=\"mobile-backup\">", "          </>}\n        </>}\n        <div className=\"mobile-backup\">")
s=s.replace("          {(tab === 'overview' || tab === 'transactions') && <section className=\"panel transaction-panel\">", "          {(tab === 'overview' || tab === 'transactions') && <ChargeSummary statement={active} people={state.people}/>}\n          {(tab === 'overview' || tab === 'transactions') && <section className=\"panel transaction-panel\">")
s=s.replace('placeholder="Buscar estabelecimento ou portador"', 'placeholder="Buscar compra, observação ou pessoa"')
s=s.replace('<th>RESPONSÁVEL</th>', '<th>COMPRADOR / DIVISÃO</th>')
s=s.replace('<small>{t.category} · {t.holder}</small></div></div>', '<small>{t.category} · {t.holder}</small>{t.note && <span className="purchase-note">{t.note}</span>}</div></div>')
s=s.replace('<td><div className="assign-cell"><select', '<td>{isSharedCost(t) ? <span className="shared-label">{t.allocations.length ? `Rateado entre ${t.allocations.length}` : \'Aguardando compradores\'}</span> : <><select className="buyer-select" aria-label={`Comprador de ${t.merchant}`} value={buyerOf(t) ?? \'\'} onChange={e => setBuyer(t.id, e.target.value)}><option value="">Indicar comprador</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="assign-cell"><select')
s=s.replace('<Users size={17}/></button></div></td>', '<Users size={17}/></button></div></>}</td>')
start=s.index('    {personModal &&')
end=s.index('    {split &&',start)
s=s[:start]+"""    {personModal && <Modal title={personEditing ? 'Editar pessoa' : 'Adicionar pessoa'} onClose={() => setPersonModal(false)}><form onSubmit={e => { e.preventDefault(); savePerson(); }}><p className="modal-description">Uma pessoa tem suas compras, sua parte dos encargos e um limite opcional por fatura.</p><label className="field">Nome<input autoFocus maxLength={40} value={personName} onChange={e => setPersonName(e.target.value)} placeholder="Ex.: Maria" required/></label><label className="field">Limite por fatura (R$)<input inputMode="decimal" value={personLimit} onChange={e => setPersonLimit(e.target.value)} placeholder="Opcional. Ex.: 800,00"/></label><label className="field">Cor de identificação<input type="color" value={personColor} onChange={e => setPersonColor(e.target.value)}/></label>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPersonModal(false)}>Cancelar</button><button className="button primary">{personEditing ? 'Salvar pessoa' : 'Adicionar pessoa'}</button></div></form></Modal>}
    {personDelete && <Modal title="Excluir pessoa?" onClose={() => setPersonDelete(null)}><p>Excluir {personDelete.name} do cadastro? Pessoas com compras ou divisões em qualquer fatura precisam ser desvinculadas antes.</p>{formError && <p className="error-text" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setPersonDelete(null)}>Cancelar</button><button className="button danger-button" onClick={() => { const id = personDelete.id; if (state.statements.some(s => s.transactions.some(t => buyerOf(t) === id || t.allocations.some(a => a.personId === id)))) { setFormError('Esta pessoa tem compras ou divisões vinculadas. Altere os vínculos antes de excluir.'); return; } setState(prev => ({ ...prev, people: prev.people.filter(p => p.id !== id) })); setPersonDelete(null); if (personId === id) router.push('/pessoas'); }}>Excluir pessoa</button></div></Modal>}
"""+s[end:]
s=s.replace('<label className="field">Categoria<input name="category"', '<label className="field">Comprador<select name="buyerId" defaultValue={buyerOf(editing) ?? \'\'}><option value="">Ainda não identificado</option>{state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Observação<textarea name="note" defaultValue={editing.note ?? \'\'} maxLength={2000} rows={3} placeholder="Ex.: presente de aniversário, compra para a casa…"/></label><label className="check-field"><input type="checkbox" name="sharedCost" defaultChecked={isSharedCost(editing)}/> Gasto geral: dividir igualmente entre todos os compradores</label><p className="helper">Use para encargos, juros, IOF, seguros e outras despesas comuns. Neste caso o comprador individual é ignorado.</p><label className="field">Categoria<input name="category"')
s=s.replace('title="Corrigir lançamento"', 'title="Editar compra"')
s=s.replace('              ', '              ')
p.write_text(s,encoding='utf-8')
