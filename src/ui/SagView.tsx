import type { Project, SagTierId } from '../engine/types';
import { SAG_TIERS, everyoneAtScale, floorNonShootDays, rerateCast, sagReport, sagTier, tierCap, NON_SHOOT, isPayrollLine, isSagPerformerLine } from '../engine/sag';
import { useState } from 'react';
import { PRESET_GROUPS, type PresetGroup } from '../data/seed';
import { lineSubtotal, dayHoursOf, setDayHours, PAID_HOURS } from '../engine/budget';
import { money } from './format';

type Set = (f: (p: Project) => Project) => void;

export function SagView({ project, setProject }: { project: Project; setProject: Set }) {
  const r = sagReport(project);
  const setSag = (patch: Partial<Project['sag']>) => setProject(p => ({ ...p, sag: { ...p.sag, ...patch } }));
  const [premiums, setPremiums] = useState<'points' | 'deferred' | 'delete'>('points');
  const [producerDays, setProducerDays] = useState(project.shootDays + 40);
  const [floorHourly, setFloorHourly] = useState(16.9);
  const [floorRest, setFloorRest] = useState<'points' | 'deferred'>('points');
  const nonShoot = project.lines.filter(l => isPayrollLine(l) && !isSagPerformerLine(l) && l.unit === 'DAY' && l.multiplier > 1 && !/^SPLIT:/.test(l.id) && l.rate > floorHourly && (NON_SHOOT.test(l.description) || (l.accountId === '1201' && /scale/i.test(l.description))));
  const nonShootDays = nonShoot.reduce((n, l) => n + (l.accountId === '1201' && /scale/i.test(l.description) ? Math.max(0, l.amount - project.shootDays) : l.amount), 0);
  const nonShootCash = nonShoot.reduce((n, l) => n + (l.accountId === '1201' && /scale/i.test(l.description) ? Math.max(0, l.amount - project.shootDays) : l.amount) * l.rate * l.multiplier, 0);
  const [crewBasis, setCrewBasis] = useState<SagTierId | 'custom'>(project.sag.targetTier);
  const [crewCustom, setCrewCustom] = useState(400);
  const crewDayRate = crewBasis === 'custom' ? crewCustom : sagTier(crewBasis).dayRate;
  const hrsNow = PAID_HOURS[dayHoursOf(project)];
  const perDay = (base: number, h: number) => Math.round(base / 8 * 100) / 100 * h;
  const [groups, setGroups] = useState<Record<PresetGroup, boolean>>({ producers: true, script: true, allowances: true });
  const picked = (l: Project['lines'][number]) => (Object.keys(PRESET_GROUPS) as PresetGroup[]).some(g => groups[g] && PRESET_GROUPS[g].match(l));
  const setPicked = (payType: 'points' | 'cash' | 'deferred') => setProject(p => ({ ...p, lines: p.lines.map(l => picked(l) ? { ...l, payType } : l) }));
  const deletePicked = () => setProject(p => ({ ...p, lines: p.lines.filter(l => !picked(l)) }));
  const groupTotals = (Object.keys(PRESET_GROUPS) as PresetGroup[]).map(g => {
    const ls = project.lines.filter(PRESET_GROUPS[g].match);
    return { g, count: ls.length, total: ls.reduce((t, l) => t + lineSubtotal(l), 0), pay: [...new Set(ls.map(l => l.payType))].join(' / ') || '—' };
  });

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
        <h2>Everyone at scale</h2>
        <p className="help">The <i>Sing Sing</i> deal: one rate for everyone, above and below the line, and the upside split by points. SAG scale covers an 8-hour day, so this prices everyone hourly at a scale rate ÷ 8 with overtime on top: crew at 1.5× after 8 and 2× after 12, cast at 1.5× for hours 9 and 10 and 2× after. A 10-hour day is scale plus two hours; a 12-hour day scale plus four. Cast are priced at the target tier (SAG requires it); crew and producers can share that rate or a lower tier's, which is the knob that decides the budget. Weekly cast lines take the tier's weekly scale. Each producer gets a wage line at the crew hourly for the days they work, and the premiums (producer fees, the script purchase, star and cast allowances) go to the back end. Nobody works for free; nobody works for a flat fee either.</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Shooting day</label>
            <div className="row" style={{ gap: 4 }}>
              {([10, 12] as const).map(h => <button key={h} className={`btn small ${dayHoursOf(project) === h ? 'primary' : ''}`} onClick={() => setProject(p => setDayHours(p, h))}>{h} hr</button>)}
            </div>
            <span className="hint">crew {PAID_HOURS[dayHoursOf(project)].day} paid hrs · cast {PAID_HOURS[dayHoursOf(project)].sag} · long days {PAID_HOURS[dayHoursOf(project)].long}</span></div>
          <div className="ctl"><label>Crew &amp; producers' 8-hour rate</label>
            <select value={crewBasis} onChange={e => setCrewBasis(e.target.value as any)}>
              {SAG_TIERS.map(t => <option key={t.id} value={t.id}>{t.id} scale · ${t.dayRate}</option>)}
              <option value="custom">custom…</option>
            </select>
            {crewBasis === 'custom' && <input type="number" value={crewCustom} onChange={e => setCrewCustom(+e.target.value || 0)} style={{ width: 110 }} />}
            <span className="hint">${(crewDayRate / 8).toFixed(2)}/hr → ${money(perDay(crewDayRate, hrsNow.day)).slice(1)} per {dayHoursOf(project)}-hr day · cast at {project.sag.targetTier}: ${money(perDay(sagTier(project.sag.targetTier).dayRate, hrsNow.sag)).slice(1)}</span></div>
          <div className="ctl"><label>Premiums become</label>
            <select value={premiums} onChange={e => setPremiums(e.target.value as any)}>
              <option value="points">points (contingent)</option><option value="deferred">deferred (fixed IOU, counts for SAG)</option><option value="delete">nothing, delete the lines</option>
            </select></div>
          <div className="ctl"><label>Producer days (if no wage line yet)</label><input type="number" value={producerDays} onChange={e => setProducerDays(+e.target.value || 0)} style={{ width: 110 }} /><span className="hint">shoot days + prep / wrap / post</span></div>
          <button className="btn primary" onClick={() => setProject(p => everyoneAtScale(p, p.sag.targetTier, { premiums, producerDays, crewDayRate }))}>Pay everyone scale</button>
        </div>
        <p className="help small" style={{ marginTop: 8 }}>Undo reverses it. Adjust anyone's days afterwards on the Top Sheet; the points schedule follows days worked.</p>
      </div>

      <div className="panel">
        <h2>Prep, wrap and post days</h2>
        <p className="help">Shoot days are where the money has to be. Prep, wrap and post days can be paid at a cash floor per hour with the balance of the person's rate going to the back end; the days still count as worked, so their points don't change. The floor is not zero because a worked day at $0 is a wage-law problem for a W-2 crew member (California's 2026 state minimum is $16.90; Los Angeles city is higher). Talk to your payroll company and attorney before you sign anyone to this.</p>
        <p className="help">Above the floor right now: <b>{nonShootDays}</b> non-shoot crew and producer days, <b>{money(nonShootCash)}</b> of wages before fringes.</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Cash floor, $/hour</label><input type="number" step="0.05" value={floorHourly} onChange={e => setFloorHourly(+e.target.value || 0)} style={{ width: 100 }} /></div>
          <div className="ctl"><label>Balance becomes</label>
            <select value={floorRest} onChange={e => setFloorRest(e.target.value as any)}><option value="points">points (contingent)</option><option value="deferred">deferred (fixed IOU, counts for SAG)</option></select></div>
          <button className="btn primary" disabled={!nonShootDays} onClick={() => setProject(p => floorNonShootDays(p, { cashHourly: floorHourly, rest: floorRest }))}>Floor the non-shoot days</button>
        </div>
      </div>

      <div className="panel">
        <h2>Above-scale ATL money</h2>
        <p className="help">The three places above-scale above-the-line money usually sits. Tick the ones your deal puts on the back end and press <b>to points</b>; leave unticked what stays as cash pay (a writer or producer who needs rent money). <b>Delete</b> removes the lines entirely, for money nobody is getting in any form. Any single line can also be changed on the Top Sheet with its Pay dropdown or its ×.</p>
        <table style={{ maxWidth: 720 }}>
          <thead><tr><th className="l" /><th className="l">Group</th><th>Lines</th><th>Cash value</th><th className="l">Currently</th></tr></thead>
          <tbody>
            {groupTotals.map(({ g, count, total, pay }) => (
              <tr key={g}>
                <td><input type="checkbox" checked={groups[g]} onChange={e => setGroups(x => ({ ...x, [g]: e.target.checked }))} /></td>
                <td className="l">{PRESET_GROUPS[g].label}</td><td>{count}</td><td>{money(total)}</td><td className="l"><span className="small muted">{pay}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => setPicked('points')}>Ticked lines → to points</button>
          <button className="btn" onClick={() => setPicked('deferred')}>→ to deferred</button>
          <button className="btn" onClick={() => setPicked('cash')}>→ back to cash</button>
          <button className="btn danger" style={{ padding: '6px 11px' }} onClick={() => { const n = project.lines.filter(picked).length; if (n && confirm(`Delete ${n} line${n > 1 ? 's' : ''}? They come off the budget entirely (Undo brings them back).`)) deletePicked(); }}>Delete ticked lines</button>
        </div>
      </div>
    </div>
  );
}
