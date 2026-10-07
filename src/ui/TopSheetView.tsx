import { Fragment, useState, type MouseEvent } from 'react';
import type { FringeDef, LineItem, PayType, Project, Section } from '../engine/types';
import {
  addAccount, addCategory, addLine, lineFringes, lineSubtotal, removeAccount, removeCategory, removeFringe, removeLine,
  renameAccount, renameCategory, rollupCashTotal, toggleLineFringe, topSheet, updateLine, upsertFringe, type CategoryRollup,
  foldMemoLines, memoLines,
} from '../engine/budget';
import { money, PAY_LABEL } from './format';
import { weeklyWageLines, weeksToDays } from '../engine/sag';
import { BudgetReport, PrintPortal, TopSheetReport } from './print';

const PAY: PayType[] = ['cash', 'deferred', 'points'];
const UNITS = ['-', 'DAY', 'WEEK', 'HOUR', 'ALLOW', 'ITEM', 'MONTH', 'FLAT', 'FEET', 'MILE'];
const SECTION_LABEL: Record<Section, string> = { ATL: 'above the line', PRODUCTION: 'production', POST: 'post production', OTHER: 'other' };

type Setter = (f: (p: Project) => Project) => void;

export function TopSheetView({ project, raw, controlled, setProject }: { project: Project; raw?: Project; controlled?: Set<string>; setProject: Setter }) {
  const rawP = raw ?? project;
  const locked = controlled ?? new Set<string>();
  const ts = topSheet(project);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openAcct, setOpenAcct] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [printing, setPrinting] = useState<null | 'top' | 'full'>(null);
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const toggleAcct = (k: string) => setOpenAcct(o => ({ ...o, [k]: !o[k] }));
  const f = filter.trim().toLowerCase();
  const linesFor = (acct: string) => project.lines.filter(l => l.accountId === acct && (!f || l.description.toLowerCase().includes(f) || (l.notes ?? '').toLowerCase().includes(f)) && (!hideEmpty || lineSubtotal(l) !== 0));
  const memoCount = memoLines(rawP).length;
  const total = rollupCashTotal(ts.subtotal) + ts.deferredTotal + ts.pointsValue || 1;
  const empty = project.lines.length === 0;

  // an amount typed on a line the deal shows in days but the budget keeps in weeks goes back as weeks
  const patch = (id: string, p: Partial<LineItem>) => setProject(pr => {
    const rawLine = pr.lines.find(l => l.id === id); const shown = project.lines.find(l => l.id === id);
    if (p.amount !== undefined && rawLine?.unit === 'WEEK' && shown?.unit === 'DAY') p = { ...p, amount: Math.round(p.amount / 5 * 10) / 10 };
    return updateLine(pr, id, p);
  });
  const onAddLine = (acct: string) => { setProject(p => addLine(p, acct).project); setOpenAcct(o => ({ ...o, [acct]: true })); };

  // every category is listed, even empty ones, so a from-scratch budget has somewhere to put lines
  const catsOf = (section: Section): CategoryRollup[] => {
    const s = ts.sections.find(x => x.section === section)!;
    const have = new Set(s.categories.map(c => c.category.number));
    const extra = project.categories.filter(c => c.section === section && !have.has(c.number)).map(c => ({ category: c, accounts: [], cash: 0, cashFringes: 0, deferred: 0, deferredFringes: 0, points: 0 }));
    return [...s.categories, ...extra].sort((a, b) => a.category.number.localeCompare(b.category.number, undefined, { numeric: true }));
  };

  const renderCat = (c: CategoryRollup) => {
    const key = c.category.number;
    const anyMoney = c.cash + c.deferred + c.points > 0;
    if (!anyMoney && f) return null;
    if (!anyMoney && !editing && !empty && !open[key]) {
      // collapsed empty category: still show it, dimmed, so it can be opened
    }
    const accts = project.accounts.filter(a => a.categoryNumber === key || (!a.categoryNumber && a.number.slice(0, 2) + '00' === key));
    const roll = new Map(c.accounts.map(a => [a.account.number, a]));
    return (
      <>
        <tr key={key} className="cat" style={anyMoney ? undefined : { opacity: .7 }}>
          <td onClick={() => toggle(key)}>{open[key] ? '▾' : '▸'} {c.category.number}{' '}
            {editing ? <input className="l inline" value={c.category.name} onClick={e => e.stopPropagation()} onChange={e => setProject(p => renameCategory(p, key, e.target.value))} /> : c.category.name}
            {editing && <button className="btn small danger" title="Remove this category and everything in it" onClick={e => { e.stopPropagation(); if (confirm(`Remove ${key} ${c.category.name} and its ${accts.length} accounts?`)) setProject(p => removeCategory(p, key)); }}>×</button>}
          </td>
          <td>{money(c.cash + c.cashFringes)}</td>
          <td className="muted">{c.deferred ? money(c.deferred + c.deferredFringes) : ''}</td>
          <td className="muted">{c.points ? money(c.points) : ''}</td>
          <td className="muted">{c.cashFringes + c.deferredFringes ? money(c.cashFringes + c.deferredFringes) : ''}</td>
        </tr>
        {(open[key] || f) && accts.map(acc => {
          const a = roll.get(acc.number) ?? { account: acc, cash: 0, cashFringes: 0, deferred: 0, deferredFringes: 0, points: 0 };
          const lines = linesFor(acc.number);
          const ak = acc.number;
          const show = openAcct[ak] || f;
          if (a.cash + a.deferred + a.points === 0 && !openAcct[ak] && !editing && !f && !empty) return null;
          if (f && lines.length === 0) return null;
          return (
            <>
              <tr key={ak} className="acct" style={a.cash + a.deferred + a.points ? undefined : { opacity: .7 }}>
                <td style={{ paddingLeft: 22 }} onClick={() => toggleAcct(ak)}>{show ? '▾' : '▸'} {acc.number}{' '}
                  {editing ? <input className="l inline" value={acc.name} onClick={e => e.stopPropagation()} onChange={e => setProject(p => renameAccount(p, ak, e.target.value))} /> : acc.name}
                  {editing && <button className="btn small danger" title="Remove this account and its lines" onClick={e => { e.stopPropagation(); if (confirm(`Remove ${ak} ${acc.name} and its ${lines.length} lines?`)) setProject(p => removeAccount(p, ak)); }}>×</button>}
                </td>
                <td>{money(a.cash + a.cashFringes)}</td>
                <td className="muted">{a.deferred ? money(a.deferred + a.deferredFringes) : ''}</td>
                <td className="muted">{a.points ? money(a.points) : ''}</td>
                <td className="muted">{a.cashFringes + a.deferredFringes ? money(a.cashFringes + a.deferredFringes) : ''}</td>
              </tr>
              {show && (
                <tr key={ak + '_lines'}><td colSpan={5} style={{ padding: 0 }}>
                  <LineTable lines={lines} project={project} locked={locked} patch={patch} setProject={setProject} onAdd={() => onAddLine(ak)} />
                </td></tr>
              )}
            </>
          );
        })}
        {(open[key] || f) && editing && <NewAccountRow category={key} project={project} setProject={setProject} />}
      </>
    );
  };

  return (
    <div>
      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="label">Budget to raise</div><div className="value">{money(ts.cashBudget)}</div>
          <div className="sub">incl. {money(ts.contingency)} contingency at {project.contingencyPct}%</div></div>
        <div className="stat"><div className="label">Deferred (fixed IOUs)</div><div className="value">{money(ts.deferredTotal)}</div>
          <div className="sub">counts toward SAG total production cost</div></div>
        <div className="stat"><div className="label">Converted to points</div><div className="value">{money(ts.pointsValue)}</div>
          <div className="sub">value people traded for the back end</div></div>
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Top sheet</h2>
          <div className="row">
            <button className="btn small" title="The top sheet as a PDF (the browser's print dialog saves to PDF)" onClick={() => setPrinting('top')}>Print top sheet</button>
            <button className="btn small" title="Every account and line with money on it, as a PDF" onClick={() => setPrinting('full')}>Print full budget</button>
            <div className="bar" style={{ width: 220 }} title="up front / deferred / points">
              <i className="c" style={{ width: `${100 * rollupCashTotal(ts.subtotal) / total}%` }} />
              <i className="d" style={{ width: `${100 * ts.deferredTotal / total}%` }} />
              <i className="p" style={{ width: `${100 * ts.pointsValue / total}%` }} />
            </div>
            <input placeholder="filter lines…" value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 8 }} />
            {memoCount > 0 && <button className="btn small" title="Blank rows, headers and list rows that carry no money become notes on the line they sit above (or the prop allowance they sit under). Nothing about the money changes." onClick={() => setProject(p => foldMemoLines(p))}>Fold memo lines ({memoCount})</button>}
            <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Hide lines whose amount × rate is zero (held days, placeholders)"><input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} /> hide empty</label>
            {weeklyWageLines(rawP).length > 0 && <button className="btn small" title="Rewrite weekly crew and staff wage lines as days (five to the week, rate ÷ 5, same money). SAG weekly deals and rentals are left alone." onClick={() => setProject(weeksToDays)}>Weeks → days ({weeklyWageLines(rawP).length})</button>}
            <button className={`btn small ${editing ? 'primary' : ''}`} onClick={() => setEditing(e => !e)} title="Rename, add or remove categories and accounts">{editing ? 'Done editing accounts' : 'Edit accounts'}</button>
          </div>
        </div>
        <p className="help">
          {empty
            ? <>Nothing in the budget yet. Open a category, then an account, and press <b>+ line</b>. Every line is amount × rate × multiplier, with fringes on top. <b>Edit accounts</b> lets you rename, add or remove categories and accounts.</>
            : <>Click a category, then an account, to open its lines. Change <b>Pay</b> on any line to move it between up front, deferred and points. Up front is what you have to raise; deferred still counts for SAG; points live only in the back end.</>}
        </p>
        <table>
          <thead><tr><th>Account</th><th>Up front</th><th>Deferred</th><th>Points</th><th>Fringes</th></tr></thead>
          <tbody>
            {ts.sections.map(s => (
              <>
                {catsOf(s.section).map(renderCat)}
                {editing && <NewCategoryRow section={s.section} project={project} setProject={setProject} />}
                <tr key={s.section} className="total"><td>Total {SECTION_LABEL[s.section]}</td>
                  <td>{money(rollupCashTotal(s))}</td><td className="muted">{money(s.deferred + s.deferredFringes)}</td><td className="muted">{money(s.points)}</td><td className="muted">{money(s.cashFringes + s.deferredFringes)}</td></tr>
              </>
            ))}
            <tr className="total"><td>Subtotal</td><td>{money(rollupCashTotal(ts.subtotal))}</td><td className="muted">{money(ts.deferredTotal)}</td><td className="muted">{money(ts.pointsValue)}</td><td className="muted">{money(ts.subtotal.cashFringes + ts.subtotal.deferredFringes)}</td></tr>
            <tr><td>Contingency {project.contingencyPct}% <input type="number" value={project.contingencyPct} step={0.5} style={{ width: 60, textAlign: 'right' }} onChange={e => setProject(p => ({ ...p, contingencyPct: +e.target.value }))} /></td><td>{money(ts.contingency)}</td><td /><td /><td /></tr>
            <tr className="total hl"><td>Budget to raise</td><td>{money(ts.cashBudget)}</td><td className="muted">{money(ts.deferredTotal)}</td><td className="muted">{money(ts.pointsValue)}</td><td /></tr>
            <tr className="total"><td>Total production cost (SAG measures this)</td><td colSpan={2}>{money(ts.totalProductionCost)}</td><td /><td /></tr>
          </tbody>
        </table>
      </div>
      <FringesPanel project={rawP} setProject={setProject} />
      {printing === 'top' && <PrintPortal title={`${project.name} · Top sheet`} onDone={() => setPrinting(null)}><TopSheetReport p={project} /></PrintPortal>}
      {printing === 'full' && <PrintPortal title={`${project.name} · Budget`} onDone={() => setPrinting(null)}><BudgetReport p={project} /></PrintPortal>}
    </div>
  );
}

function NewCategoryRow({ section, project, setProject }: { section: Section; project: Project; setProject: Setter }) {
  const [num, setNum] = useState(''); const [name, setName] = useState('');
  const taken = project.categories.some(c => c.number === num.trim());
  const add = () => { if (!num.trim() || taken) return; setProject(p => addCategory(p, num, name, section)); setNum(''); setName(''); };
  return (
    <tr className="new"><td colSpan={5}>
      <span className="muted small">New category in {SECTION_LABEL[section]}:</span>{' '}
      <input className="inline" placeholder="e.g. 3800" value={num} onChange={e => setNum(e.target.value)} style={{ width: 70 }} />{' '}
      <input className="inline l" placeholder="name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ width: 220 }} />{' '}
      <button className="btn small" disabled={!num.trim() || taken} onClick={add}>+ category</button>{taken && <span className="small muted"> that number exists</span>}
    </td></tr>
  );
}

function NewAccountRow({ category, project, setProject }: { category: string; project: Project; setProject: Setter }) {
  const [num, setNum] = useState(''); const [name, setName] = useState('');
  const taken = project.accounts.some(a => a.number === num.trim());
  const add = () => { if (!num.trim() || taken) return; setProject(p => addAccount(p, category, num, name)); setNum(''); setName(''); };
  return (
    <tr className="new"><td colSpan={5} style={{ paddingLeft: 22 }}>
      <span className="muted small">New account in {category}:</span>{' '}
      <input className="inline" placeholder={category.slice(0, 2) + '99'} value={num} onChange={e => setNum(e.target.value)} style={{ width: 70 }} />{' '}
      <input className="inline l" placeholder="name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ width: 220 }} />{' '}
      <button className="btn small" disabled={!num.trim() || taken} onClick={add}>+ account</button>{taken && <span className="small muted"> that number exists</span>}
    </td></tr>
  );
}

function LineTable({ lines, project, locked, patch, setProject, onAdd }: { lines: LineItem[]; project: Project; locked: Set<string>; patch: (id: string, p: Partial<LineItem>) => void; setProject: Setter; onAdd: () => void }) {
  const [noting, setNoting] = useState<string | null>(null);
  return (
    <table>
      {lines.length > 0 && <thead><tr><th className="l">Description</th><th>Amt</th><th>Unit</th><th>×</th><th>Rate</th><th>Subtotal</th><th>Fringes</th><th>Total</th><th>Fringes</th><th>Pay</th><th /></tr></thead>}
      <tbody>
        {lines.map(l => {
          const sub = lineSubtotal(l), fr = lineFringes(l, project.fringes);
          const dim = l.amount === 0 || l.rate === 0;
          const byDeal = locked.has(l.id);
          const derived = /^(SPLIT:|L_scale_)/.test(l.id);   // a line the deal created; it has no raw line to edit
          const note = l.notes || noting === l.id;
          return (
            <Fragment key={l.id}>
            <tr className={`line${dim ? ' dim' : ''}${note ? ' noted' : ''}`} title={byDeal ? 'Set by the deal (Deal tab)' : undefined}>
              <td>{derived ? <span style={{ paddingLeft: 4 }}>{l.description} <span className="tag points">deal</span></span> : <><input className="l" value={l.description} placeholder="description" onChange={e => patch(l.id, { description: e.target.value })} />{byDeal && <span className="tag points" style={{ marginLeft: 4 }}>deal</span>}</>}</td>
              <td className="num">{derived ? l.amount : l.daysFrom === 'board' ? <span title="Days from the stripboard: this line follows the day-out-of-days. Put rehearsal or fitting days on their own line.">{l.amount} <span className="muted small">board</span></span> : <input type="number" step="any" value={l.amount} onChange={e => patch(l.id, { amount: +e.target.value })} />}</td>
              <td>{byDeal ? l.unit : <select value={l.unit} onChange={e => patch(l.id, { unit: e.target.value })}>{(UNITS.includes(l.unit) ? UNITS : [...UNITS, l.unit]).map(u => <option key={u}>{u}</option>)}</select>}</td>
              <td className="num">{byDeal ? l.multiplier : <input type="number" step="any" value={l.multiplier} onChange={e => patch(l.id, { multiplier: +e.target.value })} />}</td>
              <td className="num">{byDeal ? l.rate : <input type="number" step="any" value={l.rate} onChange={e => patch(l.id, { rate: +e.target.value })} />}</td>
              <td>{money(sub, 2)}</td>
              <td className="muted">{fr ? money(fr, 2) : ''}</td>
              <td><b>{money(sub + fr, 2)}</b></td>
              <td>{derived ? <span className="muted small">{l.fringes.length ? `${l.fringes.length} fr.` : 'none'}</span> : <FringePicker line={l} fringes={project.fringes} onToggle={id => setProject(p => toggleLineFringe(p, l.id, id))} />}</td>
              <td>{byDeal ? <span className={`tag ${l.payType}`}>{PAY_LABEL[l.payType]}</span> : <select value={l.payType} onChange={e => patch(l.id, { payType: e.target.value as PayType })} className={`tag ${l.payType}`}>{PAY.map(p => <option key={p} value={p}>{PAY_LABEL[p]}</option>)}</select>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{!derived && !note && <button className="btn small" title="Add a note to this line" onClick={() => setNoting(l.id)}>✎</button>}{!derived && <button className="btn small danger" title="Remove line" onClick={() => setProject(p => removeLine(p, l.id))}>×</button>}</td>
            </tr>
            {note && <tr className="linenote"><td colSpan={11}><textarea className="note" rows={Math.min(6, Math.ceil((l.notes?.length ?? 0) / 110) || 1)} value={l.notes ?? ''} placeholder="note: what this line covers, a list, a reminder" autoFocus={noting === l.id} onChange={e => patch(l.id, { notes: e.target.value || undefined })} onBlur={() => setNoting(null)} /></td></tr>}
            </Fragment>
          );
        })}
        <tr className="new"><td colSpan={11} style={{ paddingLeft: 34 }}><button className="btn small" onClick={onAdd}>+ line</button>{!lines.length && <span className="muted small"> No lines in this account.</span>}</td></tr>
      </tbody>
    </table>
  );
}

function FringePicker({ line, fringes, onToggle }: { line: LineItem; fringes: FringeDef[]; onToggle: (id: string) => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const label = line.fringes.length ? `${line.fringes.length} fr.` : 'none';
  const toggleOpen = (e: MouseEvent<HTMLButtonElement>) => {
    if (pos) { setPos(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 420), left: Math.max(8, Math.min(r.right - 320, window.innerWidth - 330)) });
  };
  return (
    <span className="pick">
      <button className="linkish muted small" title={line.fringes.join(', ') || 'Pick fringes'} onClick={toggleOpen}>{label}</button>
      {pos && (
        <div className="pop" style={pos}>
          {fringes.length === 0 && <div className="muted small">No fringes defined. Add them in the Fringes panel below.</div>}
          {fringes.map(f => (
            <label key={f.id}><input type="checkbox" checked={line.fringes.includes(f.id)} onChange={() => onToggle(f.id)} /> {f.name} <span className="muted">({(f.rate * 100).toFixed(2)}%{f.cap ? ` to $${f.cap.toLocaleString()}` : ''})</span></label>
          ))}
          <button className="btn small" style={{ alignSelf: 'flex-end' }} onClick={() => setPos(null)}>Done</button>
        </div>
      )}
    </span>
  );
}

function FringesPanel({ project, setProject }: { project: Project; setProject: Setter }) {
  const [id, setId] = useState(''); const [rate, setRate] = useState(''); const [cap, setCap] = useState('');
  const used = (fid: string) => project.lines.filter(l => l.fringes.includes(fid)).length;
  const add = () => {
    const key = id.trim(); if (!key || project.fringes.some(f => f.id === key)) return;
    setProject(p => upsertFringe(p, { id: key, name: key, rate: (+rate || 0) / 100, cap: +cap || null }));
    setId(''); setRate(''); setCap('');
  };
  return (
    <details className="panel" >
      <summary style={{ cursor: 'pointer' }}><h2 style={{ display: 'inline' }}>Fringes</h2> <span className="muted small">{project.fringes.length} defined · rates and per-line wage caps · click to edit</span></summary>
      <p className="help">A fringe is a percentage on top of a line's wages. The cap is the wage base it applies to per line (FUI and SUI stop at $7,000 of wages; the rest are uncapped). Each line picks which fringes apply in its Fringes column. Removing a fringe here takes it off every line.</p>
      <table>
        <thead><tr><th className="l">Id</th><th className="l">Name</th><th>Rate %</th><th>Cap $ (blank = none)</th><th>Lines</th><th /></tr></thead>
        <tbody>
          {project.fringes.map(f => (
            <tr key={f.id} className="line">
              <td className="l small muted">{f.id}</td>
              <td><input className="l" value={f.name} onChange={e => setProject(p => upsertFringe(p, { ...f, name: e.target.value }))} /></td>
              <td className="num"><input type="number" step="0.01" value={Math.round(f.rate * 10000) / 100} onChange={e => setProject(p => upsertFringe(p, { ...f, rate: (+e.target.value || 0) / 100 }))} /></td>
              <td className="num"><input type="number" step="1" value={f.cap ?? ''} placeholder="none" onChange={e => setProject(p => upsertFringe(p, { ...f, cap: +e.target.value || null }))} /></td>
              <td>{used(f.id)}</td>
              <td><button className="btn small danger" title="Remove this fringe from the project and every line" onClick={() => { if (!used(f.id) || confirm(`Remove ${f.name} from ${used(f.id)} lines?`)) setProject(p => removeFringe(p, f.id)); }}>×</button></td>
            </tr>
          ))}
          <tr className="new"><td colSpan={6}>
            <input className="inline" placeholder="id, e.g. SUI (NY)" value={id} onChange={e => setId(e.target.value)} style={{ width: 160 }} />{' '}
            <input className="inline" type="number" step="0.01" placeholder="rate %" value={rate} onChange={e => setRate(e.target.value)} style={{ width: 80 }} />{' '}
            <input className="inline" type="number" placeholder="cap $" value={cap} onChange={e => setCap(e.target.value)} style={{ width: 90 }} />{' '}
            <button className="btn small" disabled={!id.trim()} onClick={add}>+ fringe</button>
          </td></tr>
        </tbody>
      </table>
    </details>
  );
}
