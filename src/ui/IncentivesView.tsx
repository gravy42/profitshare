import type { Incentives, Project } from '../engine/types';
import { CA_DAYS_TO_START, CA_QUALIFIED_CAP, FED_FIRST_START, LOCAL_PERKS, fmtDate, incentiveReport, withIncentives } from '../engine/incentives';
import type { CreditReport } from '../engine/incentives';
import { topSheet } from '../engine/budget';
import { recoupableBudget } from '../engine/waterfall';
import { money } from './format';

type Set = (f: (p: Project) => Project) => void;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** Tax credits and perks as toggles. Nothing here changes what the film spends; it changes who puts the money in. */
export function IncentivesView({ project, setProject }: { project: Project; setProject: Set }) {
  const inc = withIncentives(project);
  const r = incentiveReport(project);
  const ts = topSheet(project);
  const before = Math.max(0, ts.cashBudget - (project.waterfall.nonRecoupable ?? 0));
  const after = recoupableBudget(project);
  const set = (f: (i: Incentives) => Incentives) => setProject(p => ({ ...p, incentives: f(withIncentives(p)) }));
  const setCa = (patch: Partial<Incentives['ca']>) => set(i => ({ ...i, ca: { ...i.ca, ...patch } }));
  const setFed = (patch: Partial<Incentives['federal']>) => set(i => ({ ...i, federal: { ...i.federal, ...patch } }));
  const num = (v: string, lo = 0, hi = Infinity) => Math.max(lo, Math.min(hi, +v || 0));
  const catsBySection = ['ATL', 'PRODUCTION', 'POST', 'OTHER'].map(s => ({ s, cats: project.categories.filter(c => c.section === s) }));

  return (
    <div>
      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className={`stat ${r.total > 0 ? 'good' : ''}`}><div className="label">Comes back to the film</div><div className="value">{money(r.total)}</div>
          <div className="sub">{r.ca.net > 0 ? `California ${money(r.ca.net)}` : 'California off'}{r.federal.net > 0 ? ` · federal ${money(r.federal.net)}` : ''}{r.perksTotal > 0 ? ` · perks ${money(r.perksTotal)}` : ''}</div></div>
        <div className="stat"><div className="label">In the bank for the shoot</div><div className="value">{money(r.duringProduction)}</div>
          <div className="sub">{r.afterDelivery > 0 ? `${money(r.afterDelivery)} more after the audit and the tax filing` : 'bridged credits and perks; the rest comes after delivery'}</div></div>
        <div className="stat"><div className="label">Investors put in</div><div className="value">{money(after)}</div>
          <div className="sub">was {money(before)} · budget {money(ts.cashBudget)}{(project.waterfall.nonRecoupable ?? 0) > 0 ? ` less ${money(project.waterfall.nonRecoupable!)} grants` : ''} less {money(r.total)} incentives</div></div>
      </div>

      <div className="panel">
        <h2>When</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>First day of principal photography</label><input type="date" value={inc.startDate} onChange={e => e.target.value && set(i => ({ ...i, startDate: e.target.value }))} /></div>
          <div className="help small" style={{ maxWidth: 560 }}>
            {r.window
              ? <>California: apply in the <b>{r.window.apply}</b> window. The allocation letter comes {fmtDate(r.window.cal)}, and you have to roll camera within {CA_DAYS_TO_START} days of it, by <b>{fmtDate(r.window.startBy)}</b>.</>
              : <>California: no open application window puts an allocation letter before this start date with camera rolling within {CA_DAYS_TO_START} days of it. Move the date or wait for the next fiscal year's windows.</>}
            {' '}Federal: {r.federalDateOk ? <>a start after {fmtDate(FED_FIRST_START)} is inside the bill's window, if it passes.</> : <>the bill covers productions beginning in taxable years after Dec 31, 2026; this start is too early.</>}
          </div>
        </div>
        <table style={{ marginTop: 10, maxWidth: 720 }}>
          <thead><tr><th className="l">Feature film window</th><th>Allocation letter</th><th>Camera must roll by</th><th>For this start</th></tr></thead>
          <tbody>{r.windows.map(w => <tr key={w.apply} className={r.window?.apply === w.apply ? 'hl' : ''}>
            <td className="l">{w.apply}{w.closed ? ' (closed)' : ''}</td><td>{fmtDate(w.cal)}</td><td>{fmtDate(w.startBy)}</td>
            <td>{w.fits && !w.closed ? 'apply here' : w.fits ? 'would have fit' : inc.startDate < w.cal ? 'letter comes after you start' : 'too late to start'}</td></tr>)}
          </tbody>
        </table>
        <p className="help small" style={{ marginTop: 8 }}>Fiscal 2026–27 windows from the California Film Commission. Applications rank on the jobs ratio (qualified wages against the credit); independents have their own $75M of the $750M a year.</p>
      </div>

      <div className="panel">
        <h2><label style={{ cursor: 'pointer' }}><input type="checkbox" checked={inc.ca.enabled} onChange={e => setCa({ enabled: e.target.checked })} /> California Film &amp; Television Tax Credit</label></h2>
        <p className="help">Program 4.0 as amended in 2025: an independent film gets <b>35%</b> of what it spends in California below the line, wages and vendors alike, plus 5% for days shot outside the Los Angeles zone, 10% more on the wages of people who live and work outside it, 5% on visual effects, and half a percent per Career Pathways trainee. Figured on the first {money(CA_QUALIFIED_CAP)} of qualified spend. Writers, producers, directors and cast never qualify; stunts, background and everyone below the line do. Post counts here too, so the separate post-production credit signed in Sept 2026 (AB 2319: 35% of editorial post, for pictures that did not take this credit and that do at least $1M of post in California) is not something a film in this program adds on top.</p>
        <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
          <div className="ctl" style={{ minWidth: 90 }}><label>Bought in CA %</label><input type="number" min={0} max={100} value={inc.ca.caSharePct} onChange={e => setCa({ caSharePct: num(e.target.value, 0, 100) })} style={{ width: 80 }} /><span className="hint">of non-wage spend</span></div>
          <div className="ctl" style={{ minWidth: 90 }}><label>Days outside LA zone %</label><input type="number" min={0} max={100} value={inc.ca.outOfZonePct} onChange={e => setCa({ outOfZonePct: num(e.target.value, 0, 100) })} style={{ width: 80 }} /><span className="hint">+5% on that share</span></div>
          <div className="ctl" style={{ minWidth: 90 }}><label>Local hire wages %</label><input type="number" min={0} max={100} value={inc.ca.localHirePct} onChange={e => setCa({ localHirePct: num(e.target.value, 0, 100) })} style={{ width: 80 }} /><span className="hint">live and work outside the zone: +10%</span></div>
          <div className="ctl" style={{ minWidth: 80 }}><label>Trainees</label><input type="number" min={0} max={4} value={inc.ca.trainees} onChange={e => setCa({ trainees: num(e.target.value, 0, 4) })} style={{ width: 70 }} /><span className="hint">+0.5% each, up to 4</span></div>
          <div className="ctl"><label>VFX uplift</label><label className="check"><input type="checkbox" checked={inc.ca.vfx} onChange={e => setCa({ vfx: e.target.checked })} /> 75% of VFX done in CA</label></div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
          <div className="ctl"><label>Turn it into cash</label>
            <select value={inc.ca.monetize} onChange={e => setCa({ monetize: e.target.value as Incentives['ca']['monetize'] })}>
              <option value="transfer">sell the credit</option><option value="refund">refund election, 95% over 2 years (SB 186)</option><option value="own-tax">use against the film's own CA tax</option>
            </select></div>
          {inc.ca.monetize === 'transfer' && <div className="ctl" style={{ minWidth: 80 }}><label>Sold at ¢</label><input type="number" min={50} max={100} value={inc.ca.transferCents} onChange={e => setCa({ transferCents: num(e.target.value, 50, 100) })} style={{ width: 70 }} /><span className="hint">brokers see 85–95¢; from 2027 an indie credit is exempt from the buyer's $5M cap (SB 186)</span></div>}
          <div className="ctl"><label>Bridge it</label><label className="check"><input type="checkbox" checked={inc.ca.bridge} onChange={e => setCa({ bridge: e.target.checked })} /> borrow against it for the shoot</label></div>
          {inc.ca.bridge && <div className="ctl" style={{ minWidth: 80 }}><label>Loan cost %</label><input type="number" min={0} max={30} step={0.5} value={inc.ca.bridgeCostPct} onChange={e => setCa({ bridgeCostPct: num(e.target.value, 0, 30) })} style={{ width: 70 }} /><span className="hint">interest and fees on the credit</span></div>}
          <div className="ctl" style={{ minWidth: 90 }}><label>CPA audit ($)</label><input type="number" min={0} step={1000} value={inc.ca.auditCost} onChange={e => setCa({ auditCost: num(e.target.value) })} style={{ width: 90 }} /></div>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="help" style={{ cursor: 'pointer' }}>What counts: {project.categories.length - inc.ca.excludedCategories.length} of {project.categories.length} categories qualify (click to change)</summary>
          <div className="row" style={{ alignItems: 'flex-start', marginTop: 6, gap: 18 }}>
            {catsBySection.map(({ s, cats }) => cats.length > 0 && <div key={s}>
              <div className="ctl"><label>{s === 'ATL' ? 'Above the line' : s === 'PRODUCTION' ? 'Production' : s === 'POST' ? 'Post' : 'Other'}</label></div>
              {cats.map(c => <label key={c.number} className="check" style={{ fontSize: 12, marginBottom: 2 }}>
                <input type="checkbox" checked={!inc.ca.excludedCategories.includes(c.number)} onChange={e => setCa({ excludedCategories: e.target.checked ? inc.ca.excludedCategories.filter(x => x !== c.number) : [...inc.ca.excludedCategories, c.number] })} /> {c.number} {c.name}
              </label>)}
            </div>)}
          </div>
          <p className="help small" style={{ marginTop: 6 }}>Check the CFC's Qualified Expenditure Charts before you file; insurance, publicity and financing costs are the usual arguments.</p>
        </details>
        <CreditTable r={r.ca} on={inc.ca.enabled} label="California" />
      </div>

      <div className="panel">
        <h2><label style={{ cursor: 'pointer' }}><input type="checkbox" checked={inc.federal.enabled} onChange={e => setFed({ enabled: e.target.checked })} /> Federal credit (proposed)</label></h2>
        <p className="help">The Motion Picture, Television, and Entertainment Revitalization Act, introduced in the House and Senate on Sept 24, 2026: a transferable <b>20%</b> credit on labor for American workers on productions over $1M with 75% of photography days in the US, plus 5% each for an independent production, for 30% of days in a rural opportunity zone or disaster area, for $10M of wages across ten states, and for growing domestic production, to a ceiling of 30%. It would apply to productions beginning in taxable years after Dec 31, 2026. It is a bill, not a law; this is the number if it passes as announced.</p>
        <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
          <div className="ctl"><label>Labor</label><label className="check"><input type="checkbox" checked={inc.federal.includeAtl} onChange={e => setFed({ includeAtl: e.target.checked })} /> count above-the-line wages</label></div>
          <div className="ctl"><label>Bonuses</label>
            <label className="check"><input type="checkbox" checked={inc.federal.independent} onChange={e => setFed({ independent: e.target.checked })} /> independent production +5%</label>
            <label className="check"><input type="checkbox" checked={inc.federal.rural} onChange={e => setFed({ rural: e.target.checked })} /> rural opportunity zone / disaster area days +5%</label></div>
          <div className="ctl" style={{ minWidth: 80 }}><label>Sold at ¢</label><input type="number" min={50} max={100} value={inc.federal.transferCents} onChange={e => setFed({ transferCents: num(e.target.value, 50, 100) })} style={{ width: 70 }} /></div>
          <div className="ctl"><label>Bridge it</label><label className="check"><input type="checkbox" checked={inc.federal.bridge} onChange={e => setFed({ bridge: e.target.checked })} /> borrow against it for the shoot</label></div>
          {inc.federal.bridge && <div className="ctl" style={{ minWidth: 80 }}><label>Loan cost %</label><input type="number" min={0} max={30} step={0.5} value={inc.federal.bridgeCostPct} onChange={e => setFed({ bridgeCostPct: num(e.target.value, 0, 30) })} style={{ width: 70 }} /></div>}
        </div>
        <CreditTable r={r.federal} on={inc.federal.enabled} label="Federal" />
      </div>

      <div className="panel">
        <h2>California perks</h2>
        <p className="help">The state's other incentives are fee waivers and exemptions, not credits. Tick the ones you'll use and put a number on what they save, and it comes off what investors put in.</p>
        <table style={{ marginTop: 8, maxWidth: 760 }}>
          <tbody>{LOCAL_PERKS.map(k => {
            const on = k.id in inc.perks;
            return <tr key={k.id}>
              <td className="l" style={{ width: '60%' }}><label className="check"><input type="checkbox" checked={on} onChange={e => set(i => { const perks = { ...i.perks }; if (e.target.checked) perks[k.id] = perks[k.id] ?? 0; else delete perks[k.id]; return { ...i, perks }; })} /> {k.label}</label><div className="hint" style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 24 }}>{k.hint}</div></td>
              <td>{on && <input type="number" min={0} step={500} value={inc.perks[k.id] || 0} onChange={e => set(i => ({ ...i, perks: { ...i.perks, [k.id]: num(e.target.value) } }))} style={{ width: 110 }} placeholder="$ saved" />}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      <div className="panel">
        <h2>For the investors</h2>
        <p className="help">Separate from the credits: since 2025, 100% bonus depreciation under §168(k) covers film costs, so whoever owns the picture at release can deduct the whole production cost that year. Section 181's deduct-as-you-spend treatment lapsed for productions starting after Dec 31, 2025 unless Congress extends it. That's a line for the offering documents and an accountant, not a number here.</p>
      </div>
    </div>
  );
}

function CreditTable({ r, on, label }: { r: CreditReport; on: boolean; label: string }) {
  if (!on) return <p className="help small" style={{ marginTop: 10 }}>Off. Would be worth about <b>{money(r.gross)}</b> before costs.</p>;
  return <div style={{ marginTop: 10 }}>
    <table style={{ maxWidth: 760 }}>
      <tbody>
        <tr><td className="l">Qualified wages</td><td>{money(r.qualifiedWages)}</td><td className="l" style={{ color: 'var(--muted)' }}>plus fringes {money(r.qualifiedFringes)}</td></tr>
        {r.qualifiedNonWage > 0 && <tr><td className="l">Qualified vendors, rentals, locations</td><td>{money(r.qualifiedNonWage)}</td><td /></tr>}
        <tr className="hl"><td className="l">Qualified spend{r.capped ? ' (capped)' : ''}</td><td>{money(r.qualified)}</td><td /></tr>
        {r.parts.map(x => <tr key={x.label}><td className="l">{x.label}</td><td>{money(x.amount)}</td><td /></tr>)}
        <tr className="hl"><td className="l">{label} credit</td><td>{money(r.gross)}</td><td className="l" style={{ color: 'var(--muted)' }}>{pct(r.qualified ? r.gross / r.qualified : 0)} of qualified spend</td></tr>
        {r.costs.map(x => <tr key={x.label}><td className="l">less {x.label}</td><td>−{money(x.amount)}</td><td /></tr>)}
        <tr className="hl"><td className="l"><b>Net to the film</b></td><td><b>{money(r.net)}</b></td><td className="l" style={{ color: 'var(--muted)' }}>{pct(r.rate)} of the budget to raise</td></tr>
      </tbody>
    </table>
    {r.notes.map((n, i) => <div key={i} className="notice" style={{ marginTop: 8 }}>{n}</div>)}
  </div>;
}
