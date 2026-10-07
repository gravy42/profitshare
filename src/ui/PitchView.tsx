import { useState } from 'react';
import type { Comp, Project, RevenueLine } from '../engine/types';
import { CASES, DEFAULT_GROUP, adoptProjectionsAsScenarios, compGroups, compMultiple, compStats, newComp, newRevenueLine, newSection, projections, withPitch } from '../engine/pitch';
import { recoupableBudget } from '../engine/waterfall';
import { topSheet } from '../engine/budget';
import { incentiveProceeds } from '../engine/incentives';
import { money } from './format';
import { BreakdownReport, PrintPortal } from './print';

type SetProject = (f: (p: Project) => Project) => void;
const CASE_LABEL = { low: 'Low', mid: 'Mid', high: 'High' } as const;
const num = (v: string): number | null => { const n = +v.replace(/[^\d.-]/g, ''); return v.trim() === '' || isNaN(n) ? null : n; };

/** The investor-facing page: logline, who it's for, what it's like, what it could make. All of it typed by you; the math comes from the Deal. */
export function PitchView({ project, setProject }: { project: Project; setProject: SetProject }) {
  const p = withPitch(project); const pitch = p.pitch!;
  const set = (f: (x: NonNullable<Project['pitch']>) => NonNullable<Project['pitch']>) => setProject(q => { const w = withPitch(q); return { ...w, pitch: f(w.pitch!) }; });
  const setComp = (id: string, patch: Partial<Comp>) => set(x => ({ ...x, comps: x.comps.map(c => c.id === id ? { ...c, ...patch } : c) }));
  const setSec = (id: string, patch: Partial<{ heading: string; body: string }>) => set(x => ({ ...x, sections: x.sections.map(c => c.id === id ? { ...c, ...patch } : c) }));
  const moveSec = (id: string, dir: -1 | 1) => set(x => { const i = x.sections.findIndex(c => c.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= x.sections.length) return x; const a = x.sections.slice(); [a[i], a[j]] = [a[j], a[i]]; return { ...x, sections: a }; });
  const setRev = (id: string, patch: Partial<RevenueLine>) => set(x => ({ ...x, revenue: x.revenue.map(r => r.id === id ? { ...r, ...patch } : r) }));
  const [printing, setPrinting] = useState(false);
  const ts = topSheet(p); const budget = recoupableBudget(p); const pr = projections(p); const stats = compStats(pitch.comps);
  const incentives = incentiveProceeds(p);

  const body = (
    <div className="pitchdoc">
      <div className="panel"><h2>The film</h2>
        <div className="ctl"><label>Logline</label><textarea rows={2} value={pitch.logline} onChange={e => set(x => ({ ...x, logline: e.target.value }))} placeholder="One or two sentences." /></div>
        <div className="ctl" style={{ marginTop: 8 }}><label>Why this film, why now</label><textarea rows={4} value={pitch.why} onChange={e => set(x => ({ ...x, why: e.target.value }))} placeholder="In your words." /></div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="stat"><div className="label">Budget to raise</div><div className="value">{money(ts.cashBudget)}</div><div className="sub">{p.shootDays} shoot days · SAG {p.sag.targetTier}</div></div>
          <div className="stat"><div className="label">Investors put in</div><div className="value">{money(budget)}</div><div className="sub">after {money((p.waterfall.nonRecoupable ?? 0))} grants{incentives ? ` and ${money(incentives)} incentives` : ''}</div></div>
          <div className="stat"><div className="label">Back end</div><div className="value">{money(ts.pointsValue)}</div><div className="sub">value cast and crew traded for points · {p.participants.length} participants</div></div>
        </div>
      </div>

      <div className="panel"><h2>Who it's for</h2>
        <div className="grid3">
          <div className="ctl"><label>Primary audience</label><textarea rows={4} value={pitch.audience.primary} onChange={e => set(x => ({ ...x, audience: { ...x.audience, primary: e.target.value } }))} /></div>
          <div className="ctl"><label>Secondary</label><textarea rows={4} value={pitch.audience.secondary} onChange={e => set(x => ({ ...x, audience: { ...x.audience, secondary: e.target.value } }))} /></div>
          <div className="ctl"><label>How we reach them</label><textarea rows={4} value={pitch.audience.notes} onChange={e => set(x => ({ ...x, audience: { ...x.audience, notes: e.target.value } }))} /></div>
        </div>
      </div>

      <div className="panel"><h2>The case</h2>
        {pitch.sections.map((sec, i) => (
          <div className="section" key={sec.id}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <input className="l heading" value={sec.heading} placeholder="Heading" onChange={e => setSec(sec.id, { heading: e.target.value })} />
              <span className="row" style={{ gap: 4 }}>
                <button className="btn small" disabled={i === 0} onClick={() => moveSec(sec.id, -1)}>↑</button>
                <button className="btn small" disabled={i === pitch.sections.length - 1} onClick={() => moveSec(sec.id, 1)}>↓</button>
                <button className="x" onClick={() => set(x => ({ ...x, sections: x.sections.filter(y => y.id !== sec.id) }))}>×</button>
              </span>
            </div>
            <textarea rows={5} value={sec.body} placeholder="A few paragraphs, in your words." onChange={e => setSec(sec.id, { body: e.target.value })} />
          </div>
        ))}
        <div className="row"><button className="btn small" onClick={() => set(x => ({ ...x, sections: [...x.sections, newSection()] }))}>Add a section</button><span className="hint">The argument: why women will show up, the path to market, whatever you need an investor to believe. Each section prints under its heading.</span></div>
      </div>

      <div className="panel"><h2>Comparable films</h2>
        <table className="comps">
          <thead><tr><th className="l">Title</th><th>Year</th><th className="l">Distributor</th><th>Budget</th><th>Domestic</th><th>Worldwide</th><th>×</th><th className="l">Release / sale</th><th className="l">Group</th><th className="l">Source</th><th></th></tr></thead>
          <tbody>
            {compGroups(pitch.comps).map(g => (<>
              {compGroups(pitch.comps).length > 1 && <tr className="grp" key={'g' + g.group}><td className="l" colSpan={11}>{g.group}</td></tr>}
              {g.comps.map(c => (
              <tr key={c.id}>
                <td className="l"><input className="l" value={c.title} onChange={e => setComp(c.id, { title: e.target.value })} /></td>
                <td><input value={c.year} style={{ width: 56 }} onChange={e => setComp(c.id, { year: e.target.value })} /></td>
                <td className="l"><input className="l" value={c.distributor} onChange={e => setComp(c.id, { distributor: e.target.value })} /></td>
                <td><input value={c.budget ?? ''} style={{ width: 90 }} onChange={e => setComp(c.id, { budget: num(e.target.value) })} /></td>
                <td><input value={c.domestic ?? ''} style={{ width: 100 }} onChange={e => setComp(c.id, { domestic: num(e.target.value) })} /></td>
                <td><input value={c.worldwide ?? ''} style={{ width: 100 }} onChange={e => setComp(c.id, { worldwide: num(e.target.value) })} /></td>
                <td>{compMultiple(c) ? `${compMultiple(c)!.toFixed(1)}×` : ''}</td>
                <td className="l"><input className="l" value={c.note} onChange={e => setComp(c.id, { note: e.target.value })} /></td>
                <td className="l"><input className="l" value={c.group ?? ''} list="compgroups" style={{ width: 120 }} placeholder={DEFAULT_GROUP} onChange={e => setComp(c.id, { group: e.target.value })} /></td>
                <td className="l">{c.source ? <a href={c.source} target="_blank" rel="noreferrer">link</a> : null}<input className="l" value={c.source} style={{ width: 90 }} placeholder="url" onChange={e => setComp(c.id, { source: e.target.value })} /></td>
                <td><button className="x" onClick={() => set(x => ({ ...x, comps: x.comps.filter(y => y.id !== c.id) }))}>×</button></td>
              </tr>
              ))}
              {g.comps.length > 1 && (() => { const st = compStats(g.comps); return <tr className="total" key={'m' + g.group}><td className="l" colSpan={3}>Median of {st.n}{compGroups(pitch.comps).length > 1 ? ` (${g.group})` : ''}</td><td>{st.medianBudget != null ? money(st.medianBudget) : ''}</td><td></td><td>{st.medianWorldwide != null ? money(st.medianWorldwide) : ''}</td><td>{st.medianMultiple != null ? `${st.medianMultiple.toFixed(1)}×` : ''}</td><td colSpan={4}></td></tr>; })()}
            </>))}
            <datalist id="compgroups">{compGroups(pitch.comps).map(g => <option key={g.group} value={g.group} />)}</datalist>
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => set(x => ({ ...x, comps: [...x.comps, newComp({ group: compGroups(pitch.comps).slice(-1)[0]?.group })] }))}>Add a comp</button>
          <span className="hint">Grosses are box office, not what the film saw. Budget and gross in whole dollars; × is worldwide over budget. Type a group name to sort comps under the argument they support; each group gets its own median.</span></div>
      </div>

      <div className="panel"><h2>What it could make</h2>
        <table className="proj">
          <thead><tr><th className="l">Receipts to the film, by source</th>{CASES.map(c => <th key={c}>{CASE_LABEL[c]}</th>)}<th></th></tr></thead>
          <tbody>
            {pitch.revenue.map(r => (
              <tr key={r.id}>
                <td className="l"><input className="l" value={r.source} onChange={e => setRev(r.id, { source: e.target.value })} /></td>
                {CASES.map(c => <td key={c}><input value={r[c] || ''} style={{ width: 110 }} onChange={e => setRev(r.id, { [c]: num(e.target.value) ?? 0 })} /></td>)}
                <td><button className="x" onClick={() => set(x => ({ ...x, revenue: x.revenue.filter(y => y.id !== r.id) }))}>×</button></td>
              </tr>
            ))}
            <tr className="sub"><td className="l">Gross receipts</td>{CASES.map(c => <td key={c}>{money(pr[c].gross)}</td>)}<td></td></tr>
            <tr><td className="l">Fees and expenses off the top <input value={pitch.feePct} type="number" style={{ width: 60 }} onChange={e => set(x => ({ ...x, feePct: +e.target.value || 0 }))} />%</td>{CASES.map(c => <td key={c}>({money(pr[c].fees)})</td>)}<td></td></tr>
            <tr className="sub"><td className="l">Net to the film</td>{CASES.map(c => <td key={c}>{money(pr[c].net)}</td>)}<td></td></tr>
            <tr><td className="l">To investors ({p.waterfall.model === 'off-the-gross' ? `off the gross, ${p.waterfall.recoupPct}% recoup` : `recoup first, ${p.waterfall.recoupPct}%`})</td>{CASES.map(c => <td key={c}>{money(pr[c].investors)}</td>)}<td></td></tr>
            <tr><td className="l">To the cast & crew pool</td>{CASES.map(c => <td key={c}>{money(pr[c].pool)}</td>)}<td></td></tr>
            <tr className="total"><td className="l">Investor return on {money(budget)}</td>{CASES.map(c => <td key={c}>{pr[c].multiple.toFixed(2)}×</td>)}<td></td></tr>
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={() => set(x => ({ ...x, revenue: [...x.revenue, newRevenueLine()] }))}>Add a source</button>
          <button className="btn small" onClick={() => setProject(q => adoptProjectionsAsScenarios(withPitch(q)))} title="Replace the Deal tab's revenue scenarios with these three net figures so the Points tab shows the same cases">Use as the waterfall scenarios</button>
          <span className="hint">These are your numbers, not a forecast. The split follows the Deal tab's waterfall.</span>
        </div>
      </div>

      <div className="panel"><h2>Deck and sources</h2>
        <div className="ctl"><label>Pitch deck</label><input value={pitch.deck} onChange={e => set(x => ({ ...x, deck: e.target.value }))} placeholder="link or file name" /></div>
        <div className="ctl" style={{ marginTop: 8 }}><label>Research links, one per line</label><textarea rows={4} value={pitch.sources.join('\n')} onChange={e => set(x => ({ ...x, sources: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))} /></div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Pitch</h2>
          <button className="btn small" onClick={() => setPrinting(true)}>Print / save as PDF</button>
        </div>
        <p className="help small">Everything on this page is yours to write and edit; nothing here is computed from the script. The budget, back end and investor split are read live from the Deal, so when the budget moves the projection moves with it.</p>
      </div>
      {body}
      {printing && <PrintPortal title={`${p.name} · Pitch`} onDone={() => setPrinting(false)}><BreakdownReport p={p} what="Investor summary"><PitchReport p={p} /></BreakdownReport></PrintPortal>}
    </div>
  );
}

/** Read-only layout of the same content for print. */
function PitchReport({ p }: { p: Project }) {
  const pitch = withPitch(p).pitch!; const ts = topSheet(p); const budget = recoupableBudget(p); const pr = projections(p); const stats = compStats(pitch.comps);
  return (
    <div>
      {pitch.logline && <p className="lead">{pitch.logline}</p>}
      {pitch.why && <p>{pitch.why}</p>}
      <table><tbody>
        <tr><td className="l">Budget to raise</td><td>{money(ts.cashBudget)}</td><td className="l">Investors put in</td><td>{money(budget)}</td><td className="l">Back end traded for points</td><td>{money(ts.pointsValue)}</td></tr>
      </tbody></table>
      {pitch.sections.filter(x => x.heading || x.body).map(sec => <div key={sec.id}><div className="dayhead"><b>{sec.heading}</b></div>{sec.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div>)}
      {(pitch.audience.primary || pitch.audience.secondary) && <>
        <div className="dayhead"><b>Audience</b></div>
        <table><tbody><tr><td className="l" style={{ width: '33%' }}>{pitch.audience.primary}</td><td className="l" style={{ width: '33%' }}>{pitch.audience.secondary}</td><td className="l">{pitch.audience.notes}</td></tr></tbody></table></>}
      {compGroups(pitch.comps).map(g => { const st = compStats(g.comps); return (<div key={g.group}>
        <div className="dayhead"><b>{g.group}</b></div>
        <table>
          <thead><tr><th className="l">Title</th><th>Year</th><th className="l">Distributor</th><th>Budget</th><th>Domestic</th><th>Worldwide</th><th>×</th><th className="l">Release / sale</th></tr></thead>
          <tbody>
            {g.comps.map(c => <tr key={c.id}><td className="l">{c.title}</td><td>{c.year}</td><td className="l">{c.distributor}</td><td>{c.budget != null ? money(c.budget) : 'n/a'}</td><td>{c.domestic != null ? money(c.domestic) : 'n/a'}</td><td>{c.worldwide != null ? money(c.worldwide) : 'n/a'}</td><td>{compMultiple(c) ? `${compMultiple(c)!.toFixed(1)}×` : ''}</td><td className="l small">{c.note}</td></tr>)}
            {st.n > 1 && <tr className="sub"><td className="l" colSpan={3}>Median of {st.n}</td><td>{st.medianBudget != null ? money(st.medianBudget) : ''}</td><td></td><td>{st.medianWorldwide != null ? money(st.medianWorldwide) : ''}</td><td>{st.medianMultiple != null ? `${st.medianMultiple.toFixed(1)}×` : ''}</td><td></td></tr>}
          </tbody>
        </table></div>); })}
      <div className="dayhead"><b>Projections</b></div>
      <table>
        <thead><tr><th className="l">Receipts to the film</th>{CASES.map(c => <th key={c}>{CASE_LABEL[c]}</th>)}</tr></thead>
        <tbody>
          {pitch.revenue.map(r => <tr key={r.id}><td className="l">{r.source}</td>{CASES.map(c => <td key={c}>{money(r[c] || 0)}</td>)}</tr>)}
          <tr className="sub"><td className="l">Gross receipts</td>{CASES.map(c => <td key={c}>{money(pr[c].gross)}</td>)}</tr>
          <tr><td className="l">Fees and expenses ({pitch.feePct}%)</td>{CASES.map(c => <td key={c}>({money(pr[c].fees)})</td>)}</tr>
          <tr className="sub"><td className="l">Net to the film</td>{CASES.map(c => <td key={c}>{money(pr[c].net)}</td>)}</tr>
          <tr><td className="l">To investors</td>{CASES.map(c => <td key={c}>{money(pr[c].investors)}</td>)}</tr>
          <tr><td className="l">To the cast & crew pool</td>{CASES.map(c => <td key={c}>{money(pr[c].pool)}</td>)}</tr>
          <tr className="total"><td className="l">Investor return on {money(budget)}</td>{CASES.map(c => <td key={c}>{pr[c].multiple.toFixed(2)}×</td>)}</tr>
        </tbody>
      </table>
      <p className="small muted">Waterfall: {p.waterfall.model === 'off-the-gross' ? `pool takes ${p.waterfall.grossSharePct}% of net from dollar one until investors recoup ${p.waterfall.recoupPct}%, then ${p.waterfall.poolPct}%` : `investors recoup ${p.waterfall.recoupPct}% first, then ${p.waterfall.poolPct}% of the rest to the pool`}. Comps are box-office grosses from the sources listed; they are not what those films' producers received.</p>
      {pitch.sources.length > 0 && <><div className="dayhead"><b>Sources</b></div><p className="small">{pitch.sources.join(' · ')}</p></>}
    </div>
  );
}
