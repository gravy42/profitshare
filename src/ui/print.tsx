import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../engine/types';
import { shootDays, eighthsToText, stripEighths, stripPart } from '../engine/board';
import { lineSubtotal, lineFringes, rollupCashTotal, topSheet } from '../engine/budget';
import { shootDates, shortDate, withCalendar } from '../engine/calendar';
import { storyDayOf } from '../engine/breakdowns';
import { money } from './format';

/**
 * Printing is the PDF export: the browser's print dialog saves to PDF on every platform with no library.
 * While a PrintPortal is mounted the app is hidden (print CSS) and only the report prints.
 */
export function PrintPortal({ title, landscape, onDone, children }: { title: string; landscape?: boolean; onDone: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.title; document.title = title;
    document.body.dataset.print = landscape ? 'landscape' : 'portrait';
    const after = () => { document.body.removeAttribute('data-print'); document.title = prev; onDone(); };
    window.addEventListener('afterprint', after);
    const t = setTimeout(() => window.print(), 80);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); document.body.removeAttribute('data-print'); document.title = prev; };
  }, []);
  return createPortal(<div className="print-root">{children}</div>, document.body);
}

const Head = ({ p, what }: { p: Project; what: string }) => (
  <div className="ph"><div><b>{p.name}</b> · {p.version}</div><div>{what} · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div></div>
);

/** The stripboard as a shooting schedule: one block per day, every strip in order. */
export function ScheduleReport({ p }: { p: Project }) {
  const b = p.board; const byId = new Map(b.scenes.map(s => [s.id, s]));
  const days = shootDays(b); const dates = shootDates(b, withCalendar(p).calendar!);
  const names = new Map(b.castList.map(c => [c.id, c.name]));
  let i = 0;
  return (
    <div className="report">
      <Head p={p} what={`Shooting schedule · ${days.length} days · ${eighthsToText(days.reduce((n, d) => n + d.eighths, 0))} pages`} />
      <table className="legend"><tbody><tr>{b.castList.map(c => <td key={c.id}><b>{c.id}</b> {c.name}</td>)}</tr></tbody></table>
      {days.map(day => {
        const rows: { strip: typeof b.strips[number]; idx: number }[] = [];
        while (i < b.strips.length && b.strips[i].type !== 'daybreak') { rows.push({ strip: b.strips[i], idx: i }); i++; }
        i++;
        const date = dates.get(day.index);
        const locs = [...new Set(day.scenes.map(s => s.location).filter(Boolean))];
        return (
          <div className="day" key={day.index}>
            <div className="dayhead"><b>Day {day.index}</b>{date ? ` · ${shortDate(date)}` : ''}{day.label ? ` · ${day.label}` : ''} · {eighthsToText(day.eighths)} pgs · {day.castIds.length} cast{locs.length ? ` · ${locs.join(' / ')}` : ''}</div>
            <table className="sched">
              <colgroup><col style={{ width: '5%' }} /><col style={{ width: '4%' }} /><col style={{ width: '27%' }} /><col style={{ width: '9%' }} /><col style={{ width: '6%' }} /><col style={{ width: '5%' }} /><col style={{ width: '12%' }} /><col /></colgroup>
              <thead><tr><th>Sc</th><th>I/E</th><th className="l">Set</th><th>D/N</th><th>Story day</th><th>Pgs</th><th className="l">Cast</th><th className="l">Synopsis</th></tr></thead>
              <tbody>{rows.map(({ strip, idx }) => {
                if (strip.type === 'banner') return <tr key={idx}><td colSpan={8} className="l banner">{strip.text}</td></tr>;
                if (strip.type !== 'scene') return null;
                const s = byId.get(strip.sceneId); if (!s) return null;
                const { part, parts } = stripPart(b, idx);
                return <tr key={idx}><td>{s.number}{parts > 1 ? ` (${part}/${parts})` : ''}</td><td>{s.ie}</td><td className="l">{s.set}</td><td>{s.tod}</td><td>{storyDayOf(s)}</td><td>{eighthsToText(stripEighths(b, strip, byId))}</td><td className="l small">{s.cast.map(c => c.id ?? names.get(c.id!) ?? c.name).join(', ')}</td><td className="l small">{s.synopsis}</td></tr>;
              })}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** Top sheet: every category with up front, deferred and points, then the totals. */
export function TopSheetReport({ p }: { p: Project }) {
  const ts = topSheet(p);
  const SEC: Record<string, string> = { ATL: 'Above the line', PRODUCTION: 'Production', POST: 'Post production', OTHER: 'Other' };
  return (
    <div className="report">
      <Head p={p} what={`Top sheet · ${p.shootDays} shoot days · ${p.contingencyPct}% contingency`} />
      <table>
        <thead><tr><th>Acct</th><th className="l">Category</th><th>Up front</th><th>Fringes</th><th>Deferred</th><th>Points</th><th>Total up front</th></tr></thead>
        <tbody>
          {ts.sections.map(sec => (<>{sec.categories.map(c => (
            <tr key={c.category.number}><td>{c.category.number}</td><td className="l">{c.category.name}</td><td>{money(c.cash)}</td><td>{money(c.cashFringes)}</td><td>{c.deferred ? money(c.deferred + c.deferredFringes) : ''}</td><td>{c.points ? money(c.points) : ''}</td><td>{money(rollupCashTotal(c))}</td></tr>
          ))}<tr className="sub" key={sec.section}><td></td><td className="l">Total {SEC[sec.section]}</td><td>{money(sec.cash)}</td><td>{money(sec.cashFringes)}</td><td>{sec.deferred ? money(sec.deferred + sec.deferredFringes) : ''}</td><td>{sec.points ? money(sec.points) : ''}</td><td>{money(rollupCashTotal(sec))}</td></tr></>))}
          <tr className="sub"><td></td><td className="l">Above the line</td><td colSpan={5}>{money(rollupCashTotal(ts.aboveTheLine))}</td></tr>
          <tr className="sub"><td></td><td className="l">Below the line</td><td colSpan={5}>{money(rollupCashTotal(ts.belowTheLine))}</td></tr>
          <tr><td></td><td className="l">Contingency {p.contingencyPct}%</td><td colSpan={5}>{money(ts.contingency)}</td></tr>
          <tr className="total"><td></td><td className="l">Budget to raise (up front)</td><td colSpan={5}>{money(ts.cashBudget)}</td></tr>
          {ts.deferredTotal > 0 && <tr><td></td><td className="l">Deferred (fixed, counts for SAG)</td><td colSpan={5}>{money(ts.deferredTotal)}</td></tr>}
          <tr><td></td><td className="l">Total production cost (SAG)</td><td colSpan={5}>{money(ts.totalProductionCost)}</td></tr>
          <tr><td></td><td className="l">Value traded for points</td><td colSpan={5}>{money(ts.pointsValue)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

/** The whole budget, every non-empty line, grouped by category and account. */
export function BudgetReport({ p, hideEmpty = true }: { p: Project; hideEmpty?: boolean }) {
  const ts = topSheet(p);
  const PAY: Record<string, string> = { cash: '', deferred: 'DEF', points: 'PTS' };
  return (
    <div className="report">
      <Head p={p} what={`Full budget · budget to raise ${money(ts.cashBudget)}`} />
      {ts.sections.map(sec => sec.categories.map(c => {
        const accts = c.accounts.filter(a => !hideEmpty || rollupCashTotal(a) + a.deferred + a.points !== 0);
        if (!accts.length) return null;
        return (
          <div className="cat" key={c.category.number}>
            <div className="dayhead"><b>{c.category.number} {c.category.name}</b> · {money(rollupCashTotal(c))}{c.points ? ` · points ${money(c.points)}` : ''}</div>
            <table>
              <thead><tr><th>Acct</th><th className="l">Description</th><th>Amt</th><th>Unit</th><th>×</th><th>Rate</th><th>Subtotal</th><th>Fringes</th><th>Pay</th></tr></thead>
              <tbody>{accts.map(a => {
                const lines = p.lines.filter(l => l.accountId === a.account.number && (!hideEmpty || lineSubtotal(l) !== 0));
                return (<>
                  <tr className="acct" key={a.account.number}><td>{a.account.number}</td><td className="l">{a.account.name}</td><td colSpan={4}></td><td>{money(rollupCashTotal(a))}</td><td></td><td></td></tr>
                  {lines.map(l => <tr key={l.id}><td></td><td className="l small">{l.description}{l.notes ? <span className="note"> · {l.notes}</span> : null}</td><td>{l.amount}</td><td>{l.unit}</td><td>{l.multiplier !== 1 ? l.multiplier : ''}</td><td>{l.rate ? money(l.rate, l.rate % 1 ? 2 : 0) : ''}</td><td>{money(lineSubtotal(l))}</td><td>{lineFringes(l, p.fringes) ? money(lineFringes(l, p.fringes)) : ''}</td><td>{PAY[l.payType]}</td></tr>)}
                </>);
              })}</tbody>
            </table>
          </div>
        );
      }))}
      <table className="totals"><tbody>
        <tr><td className="l">Above the line</td><td>{money(rollupCashTotal(ts.aboveTheLine))}</td></tr>
        <tr><td className="l">Below the line</td><td>{money(rollupCashTotal(ts.belowTheLine))}</td></tr>
        <tr><td className="l">Contingency {p.contingencyPct}%</td><td>{money(ts.contingency)}</td></tr>
        <tr className="total"><td className="l">Budget to raise</td><td>{money(ts.cashBudget)}</td></tr>
        <tr><td className="l">Total production cost (SAG)</td><td>{money(ts.totalProductionCost)}</td></tr>
        <tr><td className="l">Value traded for points</td><td>{money(ts.pointsValue)}</td></tr>
      </tbody></table>
    </div>
  );
}

/** Wraps any on-screen breakdown for print with the standard header. */
export function BreakdownReport({ p, what, children }: { p: Project; what: string; children: ReactNode }) {
  return <div className="report"><Head p={p} what={what} />{children}</div>;
}
