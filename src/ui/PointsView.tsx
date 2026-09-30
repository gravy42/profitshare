import type { Participant, Project, WaterfallModel } from '../engine/types';
import { waterfallReport, syncDaysFromBudget, participantPoints } from '../engine/waterfall';
import { syncCastDaysFromBoard } from '../engine/board';
import { newId } from '../engine/budget';
import { setParticipantDays } from '../engine/sag';
import { money, num, pct } from './format';

type Set = (f: (p: Project) => Project) => void;

export function PointsView({ project, setProject }: { project: Project; setProject: Set }) {
  const r = waterfallReport(project);
  const w = project.waterfall;
  
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
                  ...rows.map(row => {
                  const p = row.participant;
                  return (
                    <tr key={p.id} className={p.group === 'cast' ? 'hl' : ''}>
                      <td><input className="l" value={p.name} onChange={e => patchP(p.id, { name: e.target.value })} /></td>
                      <td><input className="l" value={p.role} onChange={e => patchP(p.id, { role: e.target.value })} /></td>
                      <td><select value={p.group} onChange={e => patchP(p.id, { group: e.target.value as Participant['group'] })}>{(['producer', 'cast', 'crew', 'other'] as Participant['group'][]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></td>
                      <td><select value={p.tierId} onChange={e => patchP(p.id, { tierId: e.target.value })}>{project.tiers.map(t => <option key={t.id} value={t.id}>{t.name} ×{t.multiplier}</option>)}</select></td>
                      <td className="num"><input type="number" value={p.days} title="Days worked. Changing them here changes this person's wage lines on the top sheet."  onChange={e => setProject(q => setParticipantDays(q, p.id, +e.target.value))} /></td>
                      <td className="num"><input type="number" step={0.25} value={p.bonusMultiplier} onChange={e => patchP(p.id, { bonusMultiplier: +e.target.value })} /></td>
                      <td>{num(row.points)}</td>
                      <td className="muted">{pct(row.share)}</td>
                      <td className="muted">{row.cashPay ? money(row.cashPay) : ''}</td>
                      {row.payouts.map((v, i) => <td key={i}><b>{money(v)}</b></td>)}
                      <td><button className="btn small" title="remove" onClick={() => removeP(p.id)}>×</button></td>
                    </tr>
                  );
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
