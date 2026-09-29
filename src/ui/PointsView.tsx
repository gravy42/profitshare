import type { Participant, Project, WaterfallModel } from '../engine/types';
import { waterfallReport, syncDaysFromBudget, participantPoints } from '../engine/waterfall';
import { syncCastDaysFromBoard } from '../engine/board';
import { newId } from '../engine/budget';
import { money, num, pct } from './format';

type Set = (f: (p: Project) => Project) => void;

export function PointsView({ project, setProject }: { project: Project; setProject: Set }) {
  const r = waterfallReport(project);
  const w = project.waterfall;
  const setW = (patch: Partial<typeof w>) => setProject(p => ({ ...p, waterfall: { ...p.waterfall, ...patch } }));
  const patchP = (id: string, patch: Partial<Participant>) =>
    setProject(p => ({ ...p, participants: p.participants.map(x => x.id === id ? { ...x, ...patch } : x) }));
  const addP = () => setProject(p => ({ ...p, participants: [...p.participants, { id: newId('p'), name: 'New participant', role: '', group: 'crew', tierId: 'crew', days: 20, bonusMultiplier: 1 }] }));
  const removeP = (id: string) => setProject(p => ({ ...p, participants: p.participants.filter(x => x.id !== id), lines: p.lines.map(l => l.participantId === id ? { ...l, participantId: undefined } : l) }));
  const patchTier = (id: string, multiplier: number) => setProject(p => ({ ...p, tiers: p.tiers.map(t => t.id === id ? { ...t, multiplier } : t) }));

  const rStar = w.model === 'off-the-gross' ? (r.budget * w.recoupPct / 100) / (1 - w.grossSharePct / 100) : r.budget * w.recoupPct / 100;

  return (
    <div>
      <div className="panel">
        <h2>The waterfall</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Model</label>
            <select value={w.model} onChange={e => setW({ model: e.target.value as WaterfallModel })}>
              <option value="off-the-gross">Off the gross (Sing Sing)</option>
              <option value="recoup-first">Recoup first</option>
            </select></div>
          <div className="ctl"><label>Grants / fiscal sponsorship ($)</label><input type="number" step={10000} value={w.nonRecoupable ?? 0} onChange={e => setW({ nonRecoupable: Math.max(0, +e.target.value || 0) })} /><div className="hint">never paid back; investors recoup the rest</div></div>
          <div className="ctl"><label>Investor recoup %</label><input type="number" step={5} value={w.recoupPct} onChange={e => setW({ recoupPct: +e.target.value })} /><div className="hint">of the invested {money(r.budget)}</div></div>
          {w.model === 'off-the-gross' && <div className="ctl"><label>Pool share of gross %</label><input type="number" step={5} value={w.grossSharePct} onChange={e => setW({ grossSharePct: +e.target.value })} /><div className="hint">from dollar one</div></div>}
          <div className="ctl"><label>Pool share after recoup %</label><input type="number" step={5} value={w.poolPct} onChange={e => setW({ poolPct: +e.target.value })} /></div>
          <div className="ctl"><label>Scenarios ($)</label><input value={w.scenarios.join(', ')} onChange={e => setW({ scenarios: e.target.value.split(',').map(s => +s.replace(/[^\d.]/g, '')).filter(n => n > 0) })} /><div className="hint">producer's net revenue</div></div>
        </div>
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
        <table>
          <thead><tr><th className="l">Participant</th><th className="l">Role</th><th>Group</th><th>Tier</th><th>Days</th><th>Bonus ×</th><th>Points</th><th>Share</th><th>Cash pay</th>{r.scenarios.map(s => <th key={s}>@ {money(s / 1e6, 1)}M</th>)}<th /></tr></thead>
          <tbody>
            {r.rows.map(row => {
              const p = row.participant;
              return (
                <tr key={p.id} className={p.group === 'cast' ? 'hl' : ''}>
                  <td><input className="l" value={p.name} onChange={e => patchP(p.id, { name: e.target.value })} /></td>
                  <td><input className="l" value={p.role} onChange={e => patchP(p.id, { role: e.target.value })} /></td>
                  <td><select value={p.group} onChange={e => patchP(p.id, { group: e.target.value as Participant['group'] })}>{['cast', 'crew', 'producer', 'other'].map(g => <option key={g}>{g}</option>)}</select></td>
                  <td><select value={p.tierId} onChange={e => patchP(p.id, { tierId: e.target.value })}>{project.tiers.map(t => <option key={t.id} value={t.id}>{t.name} ×{t.multiplier}</option>)}</select></td>
                  <td className="num"><input type="number" value={p.days} onChange={e => patchP(p.id, { days: +e.target.value })} /></td>
                  <td className="num"><input type="number" step={0.25} value={p.bonusMultiplier} onChange={e => patchP(p.id, { bonusMultiplier: +e.target.value })} /></td>
                  <td>{num(row.points)}</td>
                  <td className="muted">{pct(row.share)}</td>
                  <td className="muted">{row.cashPay ? money(row.cashPay) : ''}</td>
                  {row.payouts.map((v, i) => <td key={i}><b>{money(v)}</b></td>)}
                  <td><button className="btn small" title="remove" onClick={() => removeP(p.id)}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
