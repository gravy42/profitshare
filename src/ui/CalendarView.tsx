import { useMemo, useState } from 'react';
import type { CalEventKind, Project } from '../engine/types';
import { shootDays, eighthsToText } from '../engine/board';
import { EVENT_KINDS, daysInMonth, dow, eventsOn, holidaysBetween, monthName, monthRange, newEvent, shootDates, shortDate, stampBoardDates, toIcs, withCalendar, ymd } from '../engine/calendar';

type SetProject = (f: (p: Project) => Project) => void;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A month-by-month production calendar. You pick the months, you place the days; the board supplies what each shoot day holds. */
export function CalendarView({ project, setProject }: { project: Project; setProject: SetProject }) {
  const p = withCalendar(project);
  const cal = p.calendar!;
  const set = (f: (c: NonNullable<Project['calendar']>) => NonNullable<Project['calendar']>) => setProject(q => { const w = withCalendar(q); return { ...w, calendar: f(w.calendar!) }; });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; kind: CalEventKind; end: string; dayIndex: number }>({ label: '', kind: 'shoot', end: '', dayIndex: 0 });

  const days = useMemo(() => shootDays(p.board), [p.board]);
  const dates = useMemo(() => shootDates(p.board, cal), [p.board, cal]);
  const dayByDate = useMemo(() => { const m = new Map<string, typeof days[number]>(); for (const d of days) { const dt = dates.get(d.index); if (dt) m.set(dt, d); } return m; }, [days, dates]);
  const holidays = useMemo(() => holidaysBetween(cal.from, cal.to), [cal.from, cal.to]);
  const months = monthRange(cal.from, cal.to);
  const unplaced = days.filter(d => !dates.get(d.index)).map(d => d.index);
  const placed = days.length - unplaced.length;
  const first = [...dates.values()].sort()[0]; const lastDate = [...dates.values()].sort().slice(-1)[0];
  const today = ymd(new Date());

  const open = (date: string) => {
    setEditing(date);
    const next = unplaced[0] ?? 0;
    setDraft(x => ({ ...x, end: '', dayIndex: next, label: x.kind === 'shoot' ? '' : x.label }));
  };
  const add = (date: string) => {
    if (draft.kind === 'shoot' && draft.dayIndex) {
      set(c => ({ ...c, events: [...c.events.filter(e => !(e.kind === 'shoot' && e.dayIndex === draft.dayIndex)), newEvent(date, `Shoot Day ${draft.dayIndex}`, 'shoot', undefined, draft.dayIndex)] }));
    } else {
      if (!draft.label.trim()) return;
      set(c => ({ ...c, events: [...c.events, newEvent(date, draft.label.trim(), draft.kind, draft.end || undefined)] }));
    }
    setDraft(x => ({ ...x, label: '', end: '' })); setEditing(null);
  };
  const remove = (id: string) => set(c => ({ ...c, events: c.events.filter(e => e.id !== id) }));
  const unpin = (dayIndex: number) => set(c => ({ ...c, events: c.events.filter(e => !(e.kind === 'shoot' && e.dayIndex === dayIndex)) }));
  const download = () => {
    const blob = new Blob([toIcs(p)], { type: 'text/calendar' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${p.name.replace(/[^\w]+/g, '_')}_calendar.ics`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="panel">
        <h2>Production calendar</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="ctl"><label>Show from</label><input type="month" value={cal.from} onChange={e => set(c => ({ ...c, from: e.target.value, to: c.to && c.to < e.target.value ? e.target.value : c.to }))} /></div>
          <div className="ctl"><label>to</label><input type="month" value={cal.to} min={cal.from || undefined} onChange={e => set(c => ({ ...c, to: e.target.value }))} /></div>
          <div className="ctl"><label>Work week</label>
            <div className="row" style={{ gap: 3 }}>{[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} className={`btn small ${cal.workDays.includes(d) ? 'primary' : ''}`} onClick={() => set(c => ({ ...c, workDays: c.workDays.includes(d) ? c.workDays.filter(x => x !== d) : [...c.workDays, d] }))}>{WD[d]}</button>)}</div></div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={cal.skipHolidays} onChange={e => set(c => ({ ...c, skipHolidays: e.target.checked }))} /> Skip US holidays</label>
          <button className="btn small" disabled={!placed} title="Write each placed shoot day's date onto its day break on the stripboard" onClick={() => setProject(q => stampBoardDates(withCalendar(q)))}>Stamp dates on the board</button>
          <button className="btn small" disabled={!placed && !cal.events.length} onClick={download} title="Shoot days and events as an .ics file for Google / Apple / Outlook">Download .ics</button>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary className="help small" style={{ cursor: 'pointer' }}>Optional: auto-place the shoot days from a Day 1</summary>
          <div className="row" style={{ alignItems: 'flex-end', marginTop: 6 }}>
            <div className="ctl"><label>Shoot Day 1</label><input type="date" value={cal.dayOne ?? ''} onChange={e => set(c => ({ ...c, dayOne: e.target.value || undefined }))} /></div>
            {cal.dayOne && <button className="btn small" onClick={() => set(c => ({ ...c, dayOne: undefined }))}>Clear</button>}
            <span className="hint">Days you haven't placed by hand walk forward from here over the work week, skipping holidays and days off. Leave it blank to place every day yourself.</span>
          </div>
        </details>
        <p className="help small" style={{ marginTop: 8 }}>
          {days.length} shoot days on the board, {placed} placed{first && lastDate ? ` (${shortDate(first)} → ${shortDate(lastDate)})` : ''}{unplaced.length ? `; next up: Day ${unplaced[0]}` : ''}.
          Click a date, pick "Shoot day" and which day it is, or add prep, a test shoot, wrap, travel, a hold, a day off or a note. Dates typed on the stripboard's day breaks count as placed.
        </p>
      </div>

      {months.length === 0 && <div className="notice">Pick the first and last month to show, above. Nothing is placed until you put it there.</div>}

      <div className="months">
        {months.map(ym => {
          const n = daysInMonth(ym); const lead = dow(ym + '-01');
          const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
          while (cells.length % 7) cells.push(null);
          const shootCount = [...dayByDate.keys()].filter(d => d.startsWith(ym)).length;
          return (
            <div className="panel month" key={ym}>
              <h2>{monthName(ym)}{shootCount ? <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> · {shootCount} shoot day{shootCount === 1 ? '' : 's'}</span> : null}</h2>
              <div className="cal">
                {WD.map(w => <div key={w} className="wd">{w}</div>)}
                {cells.map((d, i) => {
                  if (!d) return <div key={i} className="cell blank" />;
                  const day = dayByDate.get(d); const hol = holidays.get(d);
                  const evs = eventsOn(cal, d).filter(e => !(e.kind === 'shoot' && e.dayIndex));
                  const pin = cal.events.find(e => e.kind === 'shoot' && e.dayIndex === day?.index);
                  const work = cal.workDays.includes(dow(d));
                  const off = evs.some(e => e.kind === 'off');
                  return (
                    <div key={d} className={`cell ${work ? '' : 'weekend'} ${day ? 'shoot' : ''} ${off ? 'off' : ''} ${d === today ? 'today' : ''} ${editing === d ? 'editing' : ''}`} onClick={() => { if (editing !== d) open(d); }}>
                      <div className="num">{+d.slice(8)}{hol && <span className="hol" title={hol}>{hol}</span>}</div>
                      {day && <div className="chip shootchip" title={`Scenes ${day.scenes.map(s => s.number).join(', ')}`}><span>Day {day.index} · {eighthsToText(day.eighths)} pgs<small>{(() => { const locs = [...new Set(day.scenes.map(s => s.location).filter(Boolean))]; return locs.length > 1 ? `${locs[0]} +${locs.length - 1}` : locs[0] ?? ''; })()}</small></span>{pin && <button className="x" onClick={ev => { ev.stopPropagation(); unpin(day.index); }} title="take this day off the calendar">×</button>}</div>}
                      {evs.map(e => { const isFirst = e.date === d; return <div key={e.id} className={`chip ev ${e.kind} ${isFirst ? '' : 'cont'}`} title={`${e.label}${e.end ? ` (${shortDate(e.date)} → ${shortDate(e.end)})` : ''}`}>{isFirst ? e.label : <span className="muted">↳ {e.label.split(/[:(]/)[0].trim()}</span>}{isFirst && <button className="x" onClick={ev => { ev.stopPropagation(); remove(e.id); }} title="remove">×</button>}</div>; })}
                      {editing === d && (
                        <div className="adder" onClick={e => e.stopPropagation()}>
                          <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as CalEventKind })}>{EVENT_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
                          {draft.kind === 'shoot' ? (
                            <select value={draft.dayIndex} onChange={e => setDraft({ ...draft, dayIndex: +e.target.value })}>
                              <option value={0}>which day?</option>
                              {days.map(x => <option key={x.index} value={x.index}>Day {x.index}{dates.get(x.index) ? ` (on ${shortDate(dates.get(x.index)!)})` : ''} · {eighthsToText(x.eighths)} pgs</option>)}
                            </select>
                          ) : (<>
                            <input autoFocus placeholder={draft.kind === 'test' ? 'camera test, hair & makeup test, cat…' : 'what happens'} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') add(d); if (e.key === 'Escape') setEditing(null); }} />
                            <input type="date" value={draft.end} min={d} title="through (optional)" onChange={e => setDraft({ ...draft, end: e.target.value })} />
                          </>)}
                          <span className="row" style={{ gap: 4 }}><button className="btn small primary" disabled={draft.kind === 'shoot' ? !draft.dayIndex : !draft.label.trim()} onClick={() => add(d)}>Add</button><button className="btn small" onClick={() => setEditing(null)}>Cancel</button></span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {cal.events.length > 0 && (
        <div className="panel">
          <h2>Everything on the calendar</h2>
          <table style={{ maxWidth: 820 }}>
            <thead><tr><th className="l">When</th><th className="l">What</th><th className="l">Kind</th><th></th></tr></thead>
            <tbody>{[...cal.events].sort((a, b) => a.date.localeCompare(b.date)).map(e => (
              <tr key={e.id}><td className="l">{shortDate(e.date)}{e.end ? ` → ${shortDate(e.end)}` : ''}</td><td className="l">{e.label}</td><td className="l"><span className={`tag ev ${e.kind}`}>{EVENT_KINDS.find(k => k.id === e.kind)?.label}</span></td><td><button className="x" onClick={() => remove(e.id)}>×</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
