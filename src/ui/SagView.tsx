import type { Project, SagTierId } from '../engine/types';
import { SAG_TIERS, rerateCast, sagReport, tierCap } from '../engine/sag';
import { PROFIT_SHARE_PRESET_MATCH } from '../data/seed';
import { money } from './format';

type Set = (f: (p: Project) => Project) => void;

export function SagView({ project, setProject }: { project: Project; setProject: Set }) {
  const r = sagReport(project);
  const setSag = (patch: Partial<Project['sag']>) => setProject(p => ({ ...p, sag: { ...p.sag, ...patch } }));
  const applyPreset = () => setProject(p => ({ ...p, lines: p.lines.map(l => PROFIT_SHARE_PRESET_MATCH(l) ? { ...l, payType: 'points' } : l) }));
  const undoPreset = () => setProject(p => ({ ...p, lines: p.lines.map(l => PROFIT_SHARE_PRESET_MATCH(l) ? { ...l, payType: 'cash' } : l) }));

  return (
    <div>
      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className={`stat ${r.fits ? 'good' : 'bad'}`}><div className="label">Total production cost</div><div className="value">{money(r.totalProductionCost)}</div>
          <div className="sub">cash budget {money(r.cashBudget)} + deferred {money(r.deferredTotal)}{project.sag.includeContingency ? ' (contingency in)' : ' (contingency out)'}</div></div>
        <div className={`stat ${r.fits ? 'good' : 'bad'}`}><div className="label">Target: {r.target.name}</div>
          <div className="value">{r.targetCap === null ? 'no cap' : (r.fits ? 'fits' : 'over')}</div>
          <div className="sub">{r.targetCap === null ? 'Basic Agreement, any budget' : `${r.fits ? 'headroom' : 'over by'} ${money(Math.abs(r.headroom))} of ${money(r.targetCap)} cap${project.sag.dic ? ' (DIC)' : ''}`}</div></div>
        <div className="stat"><div className="label">Cheapest tier you qualify for now</div><div className="value">{r.qualifying.name}</div>
          <div className="sub">${r.qualifying.dayRate}/day scale · {r.performerDays} performer days</div></div>
      </div>

      <div className="panel">
        <h2>Agreement</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Target tier</label>
            <select value={project.sag.targetTier} onChange={e => setSag({ targetTier: e.target.value as SagTierId })}>
              {SAG_TIERS.map(t => <option key={t.id} value={t.id}>{t.name} · ${t.dayRate}/day</option>)}
            </select></div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={project.sag.dic} onChange={e => setSag({ dic: e.target.checked })} /> Diversity in Casting incentive qualified</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={project.sag.includeContingency} onChange={e => setSag({ includeContingency: e.target.checked })} /> Count contingency in total production cost</label>
          <button className="btn primary" onClick={() => setProject(p => rerateCast(p, p.sag.targetTier))}>Re-rate cast at {project.sag.targetTier} scale</button>
        </div>
        {r.notes.map((n, i) => <div key={i} className="notice">{n}</div>)}
        <table style={{ marginTop: 10 }}>
          <thead><tr><th className="l">Tier</th><th>Day rate</th><th>Weekly</th><th>Cap</th><th>Cap with DIC</th><th>Cast scale wages ({r.performerDays} days)</th><th>Fits?</th></tr></thead>
          <tbody>
            {SAG_TIERS.map(t => {
              const cap = tierCap(t, project.sag.dic);
              const fits = cap === null || r.totalProductionCost <= cap;
              return <tr key={t.id} className={t.id === project.sag.targetTier ? 'hl' : ''}>
                <td>{t.name}</td><td>${t.dayRate}</td><td>{t.weeklyRate ? `$${t.weeklyRate.toLocaleString()}` : '—'}</td>
                <td>{t.cap ? money(t.cap) : 'none'}</td><td>{t.dicCap ? money(t.dicCap) : 'none'}</td>
                <td>{money(r.castScaleCostAtTier[t.id])}</td>
                <td><span className={`tag ${fits ? 'ok' : 'bad'}`}>{fits ? 'yes' : 'no'}</span></td>
              </tr>;
            })}
          </tbody>
        </table>
        <p className="help" style={{ marginTop: 10 }}>
          Rates effective 7/1/2026 (SAG-AFTRA low-budget agreements rise 3% every July through 2030; P&amp;H 22% from 9/6/2026). SAG defines total production cost as all above- and below-the-line costs <b>including deferred compensation</b>, so a fixed deferment does not help you get under a cap. Contingent points have no fixed value and are not a budget line. Confirm with your SAG signatory rep and attorney before you sign; this tool is not legal advice.
        </p>
      </div>

      <div className="panel">
        <h2>Profit-share preset</h2>
        <p className="help">Converts the above-scale above-the-line money to points in one click: producer fees, the script purchase, and any STAR / CAST ALLOWANCE lines. Everyone still gets paid scale in cash. Look at the Top Sheet afterwards; the cash budget drops and the points value rises by the same amount.</p>
        <div className="row">
          <button className="btn primary" onClick={applyPreset}>Convert above-scale ATL to points</button>
          <button className="btn" onClick={undoPreset}>Put it back to cash</button>
        </div>
      </div>
    </div>
  );
}
