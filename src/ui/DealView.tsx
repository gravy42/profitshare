import type { Deal, PremiumChoice, PremiumGroup, Project, SagTierId, WaterfallModel } from '../engine/types';
import { SAG_TIERS, sagReport, sagTier, isPayrollLine, isSagPerformerLine, NON_SHOOT } from '../engine/sag';
import { topSheet, PAID_HOURS } from '../engine/budget';
import { crewDayRateOf, withDeal } from '../engine/deal';
import { recoupableBudget } from '../engine/waterfall';
import { PRESET_GROUPS } from '../engine/deal';
import { money } from './format';

type Set = (f: (p: Project) => Project) => void;

const PREMIUM_LABEL: Record<PremiumChoice, string> = { cash: 'up front, as budgeted', points: 'points (contingent)', deferred: 'deferred (fixed IOU, counts for SAG)', delete: 'gone: delete the lines' };

/** One page for every term of the deal. `raw` is what the user typed or imported; `eff` is the budget with the terms applied. */
export function DealView({ raw, eff, setProject, fresh }: { raw: Project; eff: Project; setProject: Set; fresh?: boolean }) {
  const d = withDeal(raw).deal!;
  const ts = topSheet(eff);
  const r = sagReport(eff);
  const set = (f: (p: Project) => Project) => setProject(p => f(withDeal(p)));
  const setDeal = (f: (d: Deal) => Deal) => set(p => ({ ...p, deal: f(p.deal!) }));
  const setPay = (patch: Partial<Deal['pay']>) => setDeal(x => ({ ...x, pay: { ...x.pay, ...patch } }));
  const setSag = (patch: Partial<Project['sag']>) => set(p => ({ ...p, sag: { ...p.sag, ...patch } }));
  const setW = (patch: Partial<Project['waterfall']>) => set(p => ({ ...p, waterfall: { ...p.waterfall, ...patch } }));
  const hours = PAID_HOURS[raw.dayHours ?? 12];
  const crewRate = crewDayRateOf(raw);
  const perDay = (base: number, h: number) => Math.round(base / 8 * 100) / 100 * h;
  const rawProducers = raw.participants.filter(x => x.group === 'producer' && x.id.startsWith('p_producer')).length;
  const nonShootDays = eff.lines.filter(l => isPayrollLine(l) && !isSagPerformerLine(l) && l.unit === 'DAY' && (NON_SHOOT.test(l.description) || /scale/i.test(l.description)) && !/balance to back end/.test(l.description))
    .reduce((n, l) => n + (l.accountId === '1201' && /scale/i.test(l.description) ? Math.max(0, l.amount - raw.shootDays) : l.amount), 0);
  const groupTotals = (Object.keys(PRESET_GROUPS) as PremiumGroup[]).map(g => {
    const ls = raw.lines.filter(PRESET_GROUPS[g].match);
    return { g, count: ls.length, total: ls.reduce((t, l) => t + l.amount * l.rate * l.multiplier, 0) };
  });

  return (
    <div>
      {fresh && <div className="notice">Set the terms of the film here. Everything on the other tabs is computed from your budget plus these terms, live, and you can come back and change any of them at any time.</div>}
      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="label">Budget to raise</div><div className="value">{money(ts.cashBudget)}</div><div className="sub">investors recoup {money(recoupableBudget(eff))} of it</div></div>
        <div className={`stat ${r.fits ? 'good' : 'bad'}`}><div className="label">SAG: {r.target.name}</div><div className="value">{r.targetCap === null ? 'no cap' : r.fits ? 'fits' : 'over'}</div>
          <div className="sub">{r.targetCap === null ? 'Basic Agreement' : `${r.fits ? 'headroom' : 'over by'} ${money(Math.abs(r.headroom))} of ${money(r.targetCap)}`} · qualifies for {r.qualifying.name}</div></div>
        <div className="stat"><div className="label">On the back end</div><div className="value">{money(ts.pointsValue)}</div><div className="sub">value traded for points · {eff.participants.length} participants</div></div>
      </div>

      <div className="panel">
        <h2>The film</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Title</label><input value={raw.name} onChange={e => set(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="ctl" style={{ minWidth: 80 }}><label>Version</label><input value={raw.version} onChange={e => set(p => ({ ...p, version: e.target.value }))} style={{ width: 90 }} /></div>
          <div className="ctl" style={{ minWidth: 80 }}><label>Shoot days</label><input type="number" min={1} value={raw.shootDays} onChange={e => set(p => ({ ...p, shootDays: Math.max(1, +e.target.value || 1) }))} style={{ width: 80 }} /></div>
          <div className="ctl"><label>Shooting day</label>
            <div className="row" style={{ gap: 4 }}>{([10, 12] as const).map(h => <button key={h} className={`btn small ${(raw.dayHours ?? 12) === h ? 'primary' : ''}`} onClick={() => set(p => ({ ...p, dayHours: h }))}>{h} hr</button>)}</div>
            <span className="hint">crew {hours.day} paid hrs · cast {hours.sag} · long days {hours.long}</span></div>
          <div className="ctl" style={{ minWidth: 80 }}><label>Contingency %</label><input type="number" step={0.5} value={raw.contingencyPct} onChange={e => set(p => ({ ...p, contingencyPct: +e.target.value || 0 }))} style={{ width: 80 }} /></div>
        </div>
        <p className="help small" style={{ marginTop: 8 }}>Hourly lines in the budget are read as 12-hour-day hours (14 paid for crew, 18 for long days, 15 for SAG day players). Pick 10 hr and every one of them is re-hoursed: crew 11, long days 14, cast 11. Hourly rates don't change, so the budget gets cheaper by exactly the overtime you're not paying.</p>
      </div>

      <div className="panel">
        <h2>SAG-AFTRA agreement</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Target tier</label>
            <select value={raw.sag.targetTier} onChange={e => setSag({ targetTier: e.target.value as SagTierId })}>
              {SAG_TIERS.map(t => <option key={t.id} value={t.id}>{t.name} · ${t.dayRate}/day · cap {t.cap ? money(t.cap) : 'none'}</option>)}
            </select></div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={raw.sag.dic} onChange={e => setSag({ dic: e.target.checked })} /> Diversity in Casting incentive</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={raw.sag.includeContingency} onChange={e => setSag({ includeContingency: e.target.checked })} /> Count contingency in total production cost</label>
          {d.pay.model === 'as-budgeted' && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={d.pay.rerateCast} onChange={e => setPay({ rerateCast: e.target.checked })} /> Re-rate cast lines at {raw.sag.targetTier} scale</label>}
        </div>
        <p className="help small" style={{ marginTop: 8 }}>The tier sets the bar the budget has to clear and the scale the cast get. It doesn't lower anything by itself. The SAG tab shows the full table.</p>
      </div>

      <div className="panel">
        <h2>How people are paid</h2>
        <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <label className="row" style={{ gap: 6 }}><input type="radio" checked={d.pay.model === 'as-budgeted'} onChange={() => setPay({ model: 'as-budgeted' })} /> <span><b>As budgeted.</b> Crew at their own rates, cast at scale if re-rated, ATL premiums handled below.</span></label>
          <label className="row" style={{ gap: 6 }}><input type="radio" checked={d.pay.model === 'everyone-at-scale'} onChange={() => setPay({ model: 'everyone-at-scale' })} /> <span><b>Everyone at scale (the <i>Sing Sing</i> deal).</b> One hourly for everyone, above and below the line, overtime on top; the upside split by points.</span></label>
        </div>
        {d.pay.model === 'everyone-at-scale' && (
          <div className="row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
            <div className="ctl"><label>Crew &amp; producers' 8-hour rate</label>
              <select value={d.pay.crewBasis} onChange={e => setPay({ crewBasis: e.target.value as any })}>
                {SAG_TIERS.map(t => <option key={t.id} value={t.id}>{t.id} scale · ${t.dayRate}</option>)}
                <option value="custom">custom…</option>
              </select>
              {d.pay.crewBasis === 'custom' && <input type="number" value={d.pay.crewCustomRate} onChange={e => setPay({ crewCustomRate: +e.target.value || 0 })} style={{ width: 110 }} />}
              <span className="hint">${(crewRate / 8).toFixed(2)}/hr → {money(perDay(crewRate, hours.day))} per {raw.dayHours ?? 12}-hr crew day · cast at {raw.sag.targetTier}: {money(perDay(sagTier(raw.sag.targetTier).dayRate, hours.sag))}</span></div>
            <div className="ctl" style={{ minWidth: 90 }}><label>Producers</label><input type="number" min={0} value={d.producers.count ?? rawProducers} onChange={e => setDeal(x => ({ ...x, producers: { ...x.producers, count: Math.max(0, +e.target.value || 0) } }))} style={{ width: 80 }} /><span className="hint">{d.producers.count === null ? `as budgeted (${rawProducers})` : 'paid at the crew rate'}</span></div>
            <div className="ctl" style={{ minWidth: 90 }}><label>Producer days</label><input type="number" min={0} value={d.producers.days} title="Sets every producer's days; a single producer can be changed on the points schedule afterwards" onChange={e => { const days = Math.max(0, +e.target.value || 0); setDeal(x => ({ ...x, producers: { ...x.producers, days } })); setProject(q => ({ ...q, participants: q.participants.map(pt => pt.group === 'producer' && pt.id.startsWith('p_producer') ? { ...pt, days } : pt) })); }} style={{ width: 80 }} /><span className="hint">shoot + prep / wrap / post, for every producer</span></div>
          </div>
        )}
        <p className="help small" style={{ marginTop: 8 }}>SAG scale covers an 8-hour day. Under everyone-at-scale, crew hourly is that rate ÷ 8 with California overtime (1.5× after 8, 2× after 12); cast get the target tier's rate ÷ 8 with SAG overtime (1.5× hours 9–10, 2× after). Cast can't be paid below the tier the film lands in, so equal pay means bringing crew up, never cast down.</p>
      </div>

      <div className="panel">
        <h2>Above-scale ATL money</h2>
        <p className="help">The three places above-scale money usually sits. Each can stay up front, go to points, go to deferred, or come off the budget entirely.</p>
        <table style={{ maxWidth: 820 }}>
          <thead><tr><th className="l">Group</th><th>Lines</th><th>Value</th><th className="l">Becomes</th></tr></thead>
          <tbody>
            {groupTotals.map(({ g, count, total }) => (
              <tr key={g}>
                <td className="l">{PRESET_GROUPS[g].label}</td><td>{count}</td><td>{money(total)}</td>
                <td className="l"><select value={d.pay.premiums[g]} onChange={e => setPay({ premiums: { ...d.pay.premiums, [g]: e.target.value as PremiumChoice } })}>
                  {(Object.keys(PREMIUM_LABEL) as PremiumChoice[]).map(c => <option key={c} value={c}>{PREMIUM_LABEL[c]}</option>)}
                </select></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Prep, wrap and post days</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={d.nonShoot.enabled} onChange={e => setDeal(x => ({ ...x, nonShoot: { ...x.nonShoot, enabled: e.target.checked } }))} /> Pay non-shoot days at a floor rate, balance to the back end</label>
          {d.nonShoot.enabled && <>
            <div className="ctl" style={{ minWidth: 90 }}><label>Floor, $/hour</label><input type="number" step="0.05" value={d.nonShoot.cashHourly} onChange={e => setDeal(x => ({ ...x, nonShoot: { ...x.nonShoot, cashHourly: +e.target.value || 0 } }))} style={{ width: 100 }} /></div>
            <div className="ctl"><label>Balance becomes</label>
              <select value={d.nonShoot.rest} onChange={e => setDeal(x => ({ ...x, nonShoot: { ...x.nonShoot, rest: e.target.value as any } }))}><option value="points">points (contingent)</option><option value="deferred">deferred (counts for SAG)</option></select></div>
          </>}
        </div>
        <p className="help small" style={{ marginTop: 8 }}>{nonShootDays} non-shoot crew and producer days in the budget right now. Shoot days are never touched; the days still count as worked, so nobody's points change. The floor isn't zero because a worked day at $0 is a wage-law problem for a W-2 crew member (California's 2026 state minimum is $16.90; Los Angeles city is higher). Check with your payroll company and attorney.</p>
      </div>

      <div className="panel">
        <h2>Financing and the waterfall</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Grants / fiscal sponsorship ($)</label><input type="number" step={10000} value={raw.waterfall.nonRecoupable ?? 0} onChange={e => setW({ nonRecoupable: Math.max(0, +e.target.value || 0) })} /><div className="hint">never paid back; investors put in the other {money(recoupableBudget(eff))}</div></div>
          <div className="ctl"><label>Model</label>
            <select value={raw.waterfall.model} onChange={e => setW({ model: e.target.value as WaterfallModel })}>
              <option value="off-the-gross">Off the gross (Sing Sing)</option><option value="recoup-first">Recoup first</option>
            </select></div>
          <div className="ctl" style={{ minWidth: 90 }}><label>Investor recoup %</label><input type="number" step={5} value={raw.waterfall.recoupPct} onChange={e => setW({ recoupPct: +e.target.value })} style={{ width: 80 }} /></div>
          {raw.waterfall.model === 'off-the-gross' && <div className="ctl" style={{ minWidth: 90 }}><label>Pool share of gross %</label><input type="number" step={5} value={raw.waterfall.grossSharePct} onChange={e => setW({ grossSharePct: +e.target.value })} style={{ width: 80 }} /></div>}
          <div className="ctl" style={{ minWidth: 90 }}><label>Pool share after recoup %</label><input type="number" step={5} value={raw.waterfall.poolPct} onChange={e => setW({ poolPct: +e.target.value })} style={{ width: 80 }} /></div>
          <div className="ctl"><label>Revenue scenarios ($)</label><input value={raw.waterfall.scenarios.join(', ')} onChange={e => setW({ scenarios: e.target.value.split(',').map(s => +s.replace(/[^\d.]/g, '')).filter(n => n > 0) })} /></div>
        </div>
        <p className="help small" style={{ marginTop: 8 }}>The Points tab shows who gets what at each scenario. Tier multipliers and per-person bonuses live there too.</p>
      </div>
    </div>
  );
}
