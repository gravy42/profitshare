import type { Project } from '../engine/types';
import { SAG_TIERS, sagReport, tierCap } from '../engine/sag';
import { money } from './format';

export function SagView({ project }: { project: Project }) {
  const r = sagReport(project);

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
        <p className="help">Target tier, DIC and the contingency switch are set on the Deal tab. This page is the check.</p>
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

    </div>
  );
}
