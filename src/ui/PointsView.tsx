import { useState } from 'react';
import type { BoardElement, Participant, Project, WaterfallModel } from '../engine/types';
import { addPosition, suggestAccount, SUGGESTED_ACCOUNTS } from '../engine/positions';
import { scaleHourly } from '../engine/sag';
import { crewDayRateOf } from '../engine/deal';
import { waterfallReport, syncDaysFromBudget, participantPoints } from '../engine/waterfall';
import { boardElements, shootDays, syncCastDaysFromBoard } from '../engine/board';
import { newId } from '../engine/budget';
import { setParticipantDays } from '../engine/sag';
import { money, num, pct } from './format';

type Set = (f: (p: Project) => Project) => void;

export function PointsView({ project, setProject }: { project: Project; setProject: Set }) {
  const r = waterfallReport(project);
  const w = project.waterfall;
  const [followsOpen, setFollowsOpen] = useState<string | null>(null);
  const setFollows = (id: string, f: { followsCastIds?: number[]; followsElements?: BoardElement[] }) =>
    setProject(p => syncCastDaysFromBoard({ ...p, participants: p.participants.map(x => x.id === id ? { ...x, followsCastIds: f.followsCastIds?.length ? f.followsCastIds : undefined, followsElements: f.followsElements?.length ? f.followsElements : undefined } : x) }));

  const patchP = (id: string, patch: Partial<Participant>) =>
    setProject(p => ({ ...p, participants: p.participants.map(x => x.id === id ? { ...x, ...patch } : x) }));
  const addP = () => setProject(p => ({ ...p, participants: [...p.participants, { id: newId('p'), name: 'New participant', role: '', group: 'crew', tierId: 'crew', days: 20, bonusMultiplier: 1 }] }));
  const removeP = (id: string) => setProject(p => ({ ...p, participants: p.participants.filter(x => x.id !== id), lines: p.lines.map(l => l.participantId === id ? { ...l, participantId: undefined } : l) }));
  const patchTier = (id: string, multiplier: number) => setProject(p => ({ ...p, tiers: p.tiers.map(t => t.id === id ? { ...t, multiplier } : t) }));

  // the schedule reads ATL / cast / BTL, the way a budget does; group keys underneath stay as they are
  const GROUP_LABEL: Record<Participant['group'], string> = { producer: 'ATL', cast: 'Cast', crew: 'BTL', other: 'BTL (other)' };
  const sections: { key: string; title: string; groups: Participant['group'][] }[] = [
    { key: 'ATL', title: 'Above the line', groups: ['producer'] },
    { key: 'CAST', title: 'Cast', groups: ['cast'] },
    { key: 'BTL', title: 'Below the line', groups: ['crew', 'other'] },
  ];
  // department = the budget category of the participant's wage line (or of the account in their id)
  const catOfAcct = new Map(project.accounts.map(a => [a.number, a.categoryNumber]));
  const catName = new Map(project.categories.map(c => [c.number, c.name]));
  const deptOf = (pt: Participant): { number: string; name: string } => {
    const line = project.lines.find(l => l.participantId === pt.id && (l.unit === 'DAY' || l.unit === 'WEEK'));
    const acct = line?.accountId ?? /^p_(\d{4})_/.exec(pt.id)?.[1];
    const cat = acct ? catOfAcct.get(acct) : undefined;
    return cat ? { number: cat, name: catName.get(cat) ?? cat } : { number: '9999', name: 'Other' };
  };
  const sum = (rows: typeof r.rows) => ({
    people: rows.length, days: rows.reduce((n, x) => n + x.participant.days, 0), points: rows.reduce((n, x) => n + x.points, 0),
    share: rows.reduce((n, x) => n + x.share, 0), cash: rows.reduce((n, x) => n + (x.cashPay ?? 0), 0),
    payouts: r.scenarios.map((_, i) => rows.reduce((n, x) => n + x.payouts[i], 0)),
  });
  const rStar = w.model === 'off-the-gross' ? (r.budget * w.recoupPct / 100) / (1 - w.grossSharePct / 100) : r.budget * w.recoupPct / 100;

  return (
    <div>
      <div className="panel">
        <h2>The waterfall</h2>
        <p className="help"><b>{w.model === 'off-the-gross' ? 'Off the gross (Sing Sing)' : 'Recoup first'}</b> · investors recoup {w.recoupPct}% of {money(r.budget)}{(w.nonRecoupable ?? 0) > 0 ? ` (the budget less ${money(w.nonRecoupable!)} of grants)` : ''}{w.model === 'off-the-gross' ? ` · pool takes ${w.grossSharePct}% of gross until then` : ''} · pool {w.poolPct}% after recoup. Change any of this on the Deal tab.</p>
        <p className="help" style={{ marginTop: 10 }}>
          {w.model === 'off-the-gross'
            ? <>The pool takes {w.grossSharePct}% of every dollar until investors have recouped {w.recoupPct}% of the {money(r.budget)} they put in from their {100 - w.grossSharePct}% (that happens at {money(rStar)} of revenue). After that the split is {w.poolPct}/{100 - w.poolPct}. This is the Sing Sing structure: the back end pays even if the film only does modestly.</>
            : <>Investors take {w.recoupPct}% of the {money(r.budget)} they put in first ({money(rStar)}). Then {w.poolPct}% of everything above that funds the pool. Simpler to explain, but nobody on the crew sees a dollar until recoupment.</>}
        </p>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th className="l">At revenue of</th>{r.scenarios.map(s => <th key={s}>{money(s)}</th>)}</tr></thead>
          <tbody>
            <tr><td>Cast &amp; crew pool</td>{r.pools.map((p, i) => <td key={i}><b>{money(p)}</b></td>)}</tr>
            <tr><td>Investors</td>{r.investors.map((p, i) => <td key={i}>{money(p)}</td>)}</tr>
            <tr><td className="muted">Investor multiple</td>{r.investors.map((p, i) => <td key={i} className="muted">{(p / Math.max(1, r.budget)).toFixed(2)}×</td>)}</tr>
            <tr><td className="muted">One point is worth</td>{r.pools.map((p, i) => <td key={i} className="muted">{money(p / r.totalPoints)}</td>)}</tr>
          </tbody>
        </table>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>Tiers (multiplier on days worked)</h2>
          <table>
            <thead><tr><th className="l">Tier</th><th>×</th><th>People</th><th>Points</th></tr></thead>
            <tbody>
              {project.tiers.map(t => {
                const ppl = project.participants.filter(p => p.tierId === t.id);
                const pts = ppl.reduce((n, p) => n + participantPoints(p, project.tiers), 0);
                return <tr key={t.id}><td>{t.name}</td><td className="num"><input type="number" step={0.25} value={t.multiplier} onChange={e => patchTier(t.id, +e.target.value)} /></td><td>{ppl.length}</td><td>{num(pts)} <span className="muted">({pct(pts / r.totalPoints)})</span></td></tr>;
              })}
            </tbody>
          </table>
          <p className="help">Everyone earns points = days × tier multiplier. Set every tier to 1 for strict Sing Sing parity, where a PA who works every day earns more than a name actor who works seven.</p>
        </div>
        <div className="panel">
          <h2>Where the days come from</h2>
          <p className="help">Participants are linked to budget lines (cast to their SAG day lines, crew to prep/shoot/wrap lines). You can pull days from the budget, or from the stripboard's day-out-of-days once you've placed day breaks. The board sync also rewrites the cast day counts in the budget, so a schedule change reprices the cast automatically.</p>
          <div className="row">
            <button className="btn" onClick={() => setProject(syncDaysFromBudget)}>Sync days from budget lines</button>
            <button className="btn" onClick={() => setProject(syncCastDaysFromBoard)}>Sync cast days from board (DOOD)</button>
            <button className="btn" onClick={addP}>+ Add participant</button>
          </div>
          <AddPosition project={project} setProject={setProject} />
          <div className="small muted" style={{ marginTop: 8 }}>Total points: <b>{num(r.totalPoints)}</b> across {project.participants.length} participants.</div>
        </div>
      </div>

      <div className="panel">
        <h2>Points schedule</h2>
        <p className="help">Above the line, cast, then below the line by department, each with its own subtotal. A participant's group sets where they sit; change it in the Group column. Days typed here go straight onto the person's wage lines on the top sheet (weeks become days ÷ 5), so the budget, the SAG check and the points all move together.</p>
        <table>
          <thead><tr><th className="l">Participant</th><th className="l">Role</th><th>Group</th><th>Tier</th><th>Days</th><th>Bonus ×</th><th>Points</th><th>Share</th><th>Wages</th>{r.scenarios.map(s => <th key={s}>@ {money(s / 1e6, 1)}M</th>)}<th /></tr></thead>
          <tbody>
            {sections.map(sec => {
              const rows = r.rows.filter(x => sec.groups.includes(x.participant.group))
                .sort((a, b) => sec.key === 'CAST' ? (a.participant.castId ?? 999) - (b.participant.castId ?? 999) : 0);
              if (!rows.length) return null;
              const t = sum(rows);
              // below the line, rows sit under their department in chart-of-accounts order
              const depts = sec.key === 'BTL'
                ? [...rows.reduce((m, x) => { const d = deptOf(x.participant); const k = d.number; (m.get(k) ?? m.set(k, { d, rows: [] }).get(k)!).rows.push(x); return m; }, new Map<string, { d: { number: string; name: string }; rows: typeof rows }>()).values()].sort((a, b) => a.d.number.localeCompare(b.d.number))
                : [{ d: null, rows }];
              return [
                <tr key={sec.key + '-h'} className="section"><td colSpan={9 + r.scenarios.length + 1}>{sec.title} · {t.people} {t.people === 1 ? 'person' : 'people'}</td></tr>,
                ...depts.flatMap(({ d, rows }) => [
                  ...(d ? (() => { const dt = sum(rows); return [<tr key={sec.key + '-d-' + d.number} className="dept"><td colSpan={4}>{d.number !== '9999' ? d.number + ' ' : ''}{d.name} · {dt.people}</td><td className="num">{num(dt.days)}</td><td /><td>{num(dt.points)}</td><td>{pct(dt.share)}</td><td>{dt.cash ? money(dt.cash) : ''}</td>{dt.payouts.map((v, i) => <td key={i}>{money(v)}</td>)}<td /></tr>]; })() : []),
                  ...rows.flatMap(row => {
                  const p = row.participant;
                  const following = (p.followsCastIds?.length ?? 0) + (p.followsElements?.length ?? 0) > 0;
                  const followLabel = [...(p.followsCastIds ?? []).map(id => project.board.castList.find(c => c.id === id)?.name ?? `#${id}`), ...(p.followsElements ?? []).map(e => e.item)].join(', ');
                  return [
                    <tr key={p.id} className={p.group === 'cast' ? 'hl' : ''}>
                      <td><input className="l" value={p.name} onChange={e => patchP(p.id, { name: e.target.value })} />{following && <div className="small muted follows-label" title={followLabel}>⇢ with {followLabel}</div>}</td>
                      <td><input className="l" value={p.role} onChange={e => patchP(p.id, { role: e.target.value })} /></td>
                      <td><select value={p.group} onChange={e => patchP(p.id, { group: e.target.value as Participant['group'] })}>{(['producer', 'cast', 'crew', 'other'] as Participant['group'][]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></td>
                      <td><select value={p.tierId} onChange={e => patchP(p.id, { tierId: e.target.value })}>{project.tiers.map(t => <option key={t.id} value={t.id}>{t.name} ×{t.multiplier}</option>)}</select></td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}><input type="number" value={p.days} disabled={following} title={following ? `Days come from the stripboard: every shoot day with ${followLabel}` : "Days worked. Changing them here changes this person's wage lines on the top sheet."} onChange={e => setProject(q => setParticipantDays(q, p.id, +e.target.value))} />
                        {p.castId == null && <button type="button" className={`btn small${following ? ' follows' : ''}`} title={following ? `On set ${[p.followsCastIds?.length ? `whenever ${p.followsCastIds.map(id => project.board.castList.find(c => c.id === id)?.name ?? `#${id}`).join(' or ')} work` : '', p.followsElements?.length ? `whenever a scene has ${p.followsElements.map(e => e.item).join(' or ')}` : ''].filter(Boolean).join(', or ')}. Click to change.` : 'Tie this person\'s days to the stripboard: on set whenever certain cast, or certain tags (an animal, a picture car, stunts), are in the day'} onClick={() => setFollowsOpen(o => o === p.id ? null : p.id)}>⇢</button>}</td>
                      <td className="num"><input type="number" step={0.25} value={p.bonusMultiplier} onChange={e => patchP(p.id, { bonusMultiplier: +e.target.value })} /></td>
                      <td>{num(row.points)}</td>
                      <td className="muted">{pct(row.share)}</td>
                      <td className="muted">{row.cashPay ? money(row.cashPay) : ''}</td>
                      {row.payouts.map((v, i) => <td key={i}><b>{money(v)}</b></td>)}
                      <td><button className="btn small" title="remove" onClick={() => removeP(p.id)}>×</button></td>
                    </tr>,
                    ...(followsOpen === p.id ? [<tr key={p.id + '-f'} className="followsrow"><td colSpan={9 + r.scenarios.length + 1}>
                      <FollowsEditor project={project} cast={p.followsCastIds ?? []} elements={p.followsElements ?? []} onChange={f => setFollows(p.id, f)} />
                      <button type="button" className="btn small" style={{ marginTop: 6 }} onClick={() => setFollowsOpen(null)}>Done</button>
                    </td></tr>] : []),
                  ];
                  }),
                ]),
                <tr key={sec.key + '-t'} className="subtotal"><td colSpan={4}>{sec.title} subtotal</td><td className="num">{num(t.days)}</td><td /><td>{num(t.points)}</td><td>{pct(t.share)}</td><td>{t.cash ? money(t.cash) : ''}</td>{t.payouts.map((v, i) => <td key={i}>{money(v)}</td>)}<td /></tr>,
              ];
            })}
            {(() => { const t = sum(r.rows); return <tr className="total"><td colSpan={4}>Everyone · {t.people} people</td><td className="num">{num(t.days)}</td><td /><td>{num(t.points)}</td><td>{pct(t.share)}</td><td>{t.cash ? money(t.cash) : ''}</td>{t.payouts.map((v, i) => <td key={i}>{money(v)}</td>)}<td /></tr>; })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/** Hire someone: one form makes the wage line in the right account and the participant linked to it. */
function AddPosition({ project, setProject }: { project: Project; setProject: Set }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [acct, setAcct] = useState('');
  const [days, setDays] = useState(1);
  const [hourly, setHourly] = useState<number | ''>('');
  const [follows, setFollows] = useState<number[]>([]);
  const [followEls, setFollowEls] = useState<BoardElement[]>([]);
  const [note, setNote] = useState('');
  const suggestion = suggestAccount(project, title);
  const accountId = acct || suggestion?.number || '';
  const defaultHourly = scaleHourly(crewDayRateOf(project));
  const options = [...project.accounts.map(a => ({ number: a.number, name: a.name, exists: true })), ...SUGGESTED_ACCOUNTS.filter(s => !project.accounts.some(a => a.number === s.number)).map(s => ({ number: s.number, name: s.name, exists: false }))]
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !accountId) return;
    setProject(p => addPosition(p, { title, accountId, days, hourly: hourly === '' ? undefined : +hourly, note: note.trim() || undefined, followsCastIds: follows.length ? follows : undefined, followsElements: followEls.length ? followEls : undefined }).project);
    setTitle(''); setAcct(''); setDays(1); setHourly(''); setFollows([]); setFollowEls([]); setNote(''); setOpen(false);
  };
  if (!open) return <p className="help" style={{ marginTop: 8 }}><button className="btn small primary" onClick={() => setOpen(true)}>+ Add position</button> <span className="small muted">a wage line in the right account plus the person on this schedule, in one go</span></p>;
  return (
    <form className="addpos" onSubmit={submit}>
      <div className="row">
        <div className="ctl" style={{ flex: 2 }}><label>Position</label><input autoFocus placeholder="type a title, e.g. Intimacy Coordinator" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="ctl" style={{ flex: 2 }}><label>Account {suggestion && !acct ? <span className="hint">suggested{suggestion.exists ? '' : ', will be added'}</span> : null}</label>
          <select value={accountId} onChange={e => setAcct(e.target.value)}>
            <option value="">choose…</option>
            {options.map(o => <option key={o.number} value={o.number}>{o.number} {o.name}{o.exists ? '' : ' (add)'}</option>)}
          </select></div>
        <div className="ctl" style={{ minWidth: 80 }}><label>Days</label><input type="number" min={0} value={days} disabled={follows.length > 0 || followEls.length > 0} onChange={e => setDays(+e.target.value)} /></div>
        <div className="ctl" style={{ minWidth: 110 }}><label>Hourly (8-hr base)</label><input type="number" step="0.01" placeholder="crew rate" value={hourly} onChange={e => setHourly(e.target.value === '' ? '' : +e.target.value)} /><span className="hint">blank = crew rate {money(defaultHourly, 2)}/hr</span></div>
        <div className="ctl" style={{ flex: 1 }}><label>Note</label><input placeholder="optional, e.g. (skateboarding)" value={note} onChange={e => setNote(e.target.value)} /></div>
      </div>
      {project.board.scenes.length > 0 && <FollowsEditor project={project} cast={follows} elements={followEls} onChange={f => { setFollows(f.followsCastIds ?? []); setFollowEls(f.followsElements ?? []); }} />}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" type="submit" disabled={!title.trim() || !accountId}>{!title.trim() ? 'Type a position title first' : !accountId ? 'Pick an account' : `Add ${title.trim()}`}</button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}


/** Tie someone's days to the stripboard: on set whenever certain cast work, or whenever a scene carries certain tags
 *  (Animals: cat for the wrangler, Vehicles for the picture-car wrangler, Stunts for the coordinator). */
function FollowsEditor({ project, cast, elements, onChange }: { project: Project; cast: number[]; elements: BoardElement[]; onChange: (f: { followsCastIds: number[]; followsElements: BoardElement[] }) => void }) {
  const els = boardElements(project.board);
  const days = shootDays(project.board).length;
  const same = (a: BoardElement, b: BoardElement) => a.category === b.category && a.item.toLowerCase() === b.item.toLowerCase();
  const key = (e: BoardElement) => e.category + '\u0000' + e.item;
  const byCat = els.reduce((m, e) => { (m.get(e.category) ?? m.set(e.category, []).get(e.category)!).push(e); return m; }, new Map<string, typeof els>());
  const following = cast.length + elements.length > 0;
  return (
    <div className="follows">
      {project.board.castList.length > 0 && (
        <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
          <span className="small muted">On set whenever these cast work:</span>
          {project.board.castList.map(c => <label key={c.id} className="small" style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><input type="checkbox" checked={cast.includes(c.id)} onChange={e => onChange({ followsCastIds: e.target.checked ? [...cast, c.id] : cast.filter(x => x !== c.id), followsElements: elements })} />{c.id} {c.name}</label>)}
        </div>
      )}
      {els.length > 0 && (
        <div className="row" style={{ marginTop: 4, alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
          <span className="small muted">Or whenever a scene carries:</span>
          {elements.map(e => <span key={key(e)} className="chip">{e.category}: {e.item} <button type="button" title="remove" onClick={() => onChange({ followsCastIds: cast, followsElements: elements.filter(x => !same(x, e)) })}>×</button></span>)}
          <select value="" onChange={e => { const hit = els.find(x => key(x) === e.target.value); if (hit && !elements.some(x => same(x, hit))) onChange({ followsCastIds: cast, followsElements: [...elements, { category: hit.category, item: hit.item }] }); }}>
            <option value="">add a tag from the board…</option>
            {[...byCat.entries()].map(([c, items]) => <optgroup key={c} label={c}>{items.map(e => <option key={key(e)} value={key(e)}>{e.item} ({e.scenes} sc)</option>)}</optgroup>)}
          </select>
        </div>
      )}
      {following && <div className="small muted" style={{ marginTop: 4 }}>→ days come from the stripboard's day breaks{days ? ` (${days} shoot days on the board)` : ' (no day breaks yet, so 0 days until the board is broken into days)'}, and follow them as the schedule moves.</div>}
      {!els.length && !project.board.castList.length && <div className="small muted">Nothing on the board to follow yet.</div>}
    </div>
  );
}
