import { useMemo, useState, type ReactNode } from 'react';
import type { Project } from '../engine/types';
import { eighthsToText } from '../engine/board';
import { characterBreakdown, departmentBreakdown, elementCategories, itemsIn, storyDayBreakdown, trackElement } from '../engine/breakdowns';
import { shootDates, shortDate, withCalendar } from '../engine/calendar';
import { BreakdownReport, PrintPortal } from './print';

type Mode = 'story' | 'character' | 'department' | 'element';

/** Breakdowns: the schedule re-cut for the people who have to live inside it. Everything prints. */
export function BreakdownsView({ project }: { project: Project }) {
  const b = project.board;
  const [mode, setMode] = useState<Mode>('story');
  const cats = useMemo(() => elementCategories(b), [b]);
  const [cat, setCat] = useState<string>('');
  const category = cat || cats.find(c => /makeup|hair/i.test(c)) || cats[0] || '';
  const items = useMemo(() => itemsIn(b, category), [b, category]);
  const [itemCat, setItemCat] = useState<string>(''); const [item, setItem] = useState<string>('');
  const tCat = itemCat || cats.find(c => /animal/i.test(c)) || cats[0] || '';
  const tItems = useMemo(() => itemsIn(b, tCat), [b, tCat]);
  const tItem = item && tItems.some(x => x.item === item) ? item : (tItems[0]?.item ?? '');
  const dates = useMemo(() => shootDates(b, withCalendar(project).calendar!), [b, project.calendar]);
  const [printing, setPrinting] = useState<null | { what: string; body: ReactNode }>(null);
  const when = (n: number) => { const d = dates.get(n); return d ? ` · ${shortDate(d)}` : ''; };

  const story = useMemo(() => storyDayBreakdown(b), [b]);
  const chars = useMemo(() => characterBreakdown(b), [b]);
  const dept = useMemo(() => departmentBreakdown(b, category), [b, category]);
  const tracked = useMemo(() => tCat && tItem ? trackElement(b, tCat, tItem) : [], [b, tCat, tItem]);

  if (!b.scenes.length) return <div className="panel"><p className="help">Import a board or a script first; breakdowns are cut from the stripboard.</p></div>;

  const storyBody = (
    <table className="bd">
      <thead><tr><th>Shoot day</th><th>Story days</th><th className="l">Scenes (story day · cast)</th></tr></thead>
      <tbody>{story.map(r => (
        <tr key={r.day.index} className={r.storyDays.length > 1 ? 'jump' : ''}>
          <td><b>Day {r.day.index}</b>{when(r.day.index)}<div className="muted small">{eighthsToText(r.day.eighths)} pgs</div></td>
          <td>{r.storyDays.join(' → ')}{r.storyDays.length > 1 && <div className="muted small">{r.storyDays.length} looks</div>}</td>
          <td className="l">{r.scenes.map(x => <div key={x.scene.id}><b>{x.scene.number}</b> <span className="tag ev note">day {x.storyDay}</span> {x.scene.ie} {x.scene.set} · {x.scene.tod}{x.cast.length ? <span className="muted"> · {x.cast.join(', ')}</span> : null}</div>)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
  const charBody = (
    <div>{chars.map(c => (
      <div className="charblock" key={c.castId}>
        <div className="dayhead"><b>{c.castId}. {c.name}</b> · {c.days.length} shoot days · {c.storyDaysTotal} story days{c.jumps ? ` · ${c.jumps} day${c.jumps > 1 ? 's' : ''} with more than one look` : ''}</div>
        <table className="bd">
          <thead><tr><th>Shoot day</th><th>Story days</th><th className="l">Scenes</th></tr></thead>
          <tbody>{c.days.map(d => (
            <tr key={d.day.index} className={d.storyDays.length > 1 ? 'jump' : ''}>
              <td>Day {d.day.index}{when(d.day.index)}</td>
              <td>{d.storyDays.join(' → ')}</td>
              <td className="l">{d.scenes.map(x => <span key={x.scene.id} className="sc">{x.scene.number} <span className="muted">(day {x.storyDay})</span> </span>)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    ))}</div>
  );
  const deptBody = (
    <table className="bd">
      <thead><tr><th>Shoot day</th><th className="l">{category} this day</th></tr></thead>
      <tbody>{dept.map(r => (
        <tr key={r.day.index}>
          <td><b>Day {r.day.index}</b>{when(r.day.index)}<div className="muted small">{[...new Set(r.day.scenes.map(s => s.location).filter(Boolean))].join(' / ')}</div></td>
          <td className="l">{r.items.length ? r.items.map(x => <div key={x.item}>{x.item} <span className="muted small">sc {x.scenes.map(s => s.number).join(', ')}</span></div>) : <span className="muted">nothing tagged</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );
  const trackBody = (
    <div>
      <p className="help small">{tItem ? `${tItem}: ${tracked.length} shoot day${tracked.length === 1 ? '' : 's'}, ${eighthsToText(tracked.reduce((n, t) => n + t.eighths, 0))} pages, ${new Set(tracked.flatMap(t => t.scenes.map(s => s.number))).size} scenes.` : 'Nothing tagged in this category.'}</p>
      <table className="bd">
        <thead><tr><th>Shoot day</th><th>Pgs</th><th className="l">Scenes</th><th className="l">Where</th><th className="l">With</th><th>Story days</th></tr></thead>
        <tbody>{tracked.map(t => (
          <tr key={t.day.index}>
            <td><b>Day {t.day.index}</b>{when(t.day.index)}</td>
            <td>{eighthsToText(t.eighths)}</td>
            <td className="l">{t.scenes.map(s => <div key={s.id}><b>{s.number}</b> {s.ie} {s.set} · {s.tod}<div className="muted small">{s.synopsis}</div></div>)}</td>
            <td className="l">{t.locations.join(' / ')}</td>
            <td className="l">{t.cast.join(', ')}</td>
            <td>{t.storyDays.join(', ')}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  const bodies: Record<Mode, { title: string; body: ReactNode }> = {
    story: { title: 'Story days by shoot day', body: storyBody },
    character: { title: 'Characters: shoot days and story days', body: charBody },
    department: { title: `${category} by shoot day`, body: deptBody },
    element: { title: `${tItem} (${tCat}) across the schedule`, body: trackBody },
  };

  return (
    <div>
      <div className="panel">
        <h2>Breakdowns</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="row" style={{ gap: 4 }}>
            {([['story', 'Story days'], ['character', 'By character'], ['department', 'By department'], ['element', 'Track one thing']] as [Mode, string][]).map(([k, l]) => <button key={k} className={`btn small ${mode === k ? 'primary' : ''}`} onClick={() => setMode(k)}>{l}</button>)}
          </div>
          {mode === 'department' && <div className="ctl"><label>Department</label><select value={category} onChange={e => setCat(e.target.value)}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></div>}
          {mode === 'element' && <>
            <div className="ctl"><label>Category</label><select value={tCat} onChange={e => { setItemCat(e.target.value); setItem(''); }}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div className="ctl"><label>Which one</label><select value={tItem} onChange={e => setItem(e.target.value)}>{tItems.map(x => <option key={x.item} value={x.item}>{x.item} ({x.scenes})</option>)}</select></div>
          </>}
          <button className="btn small" onClick={() => setPrinting({ what: bodies[mode].title, body: bodies[mode].body })}>Print / save as PDF</button>
        </div>
        <p className="help small" style={{ marginTop: 8 }}>
          {mode === 'story' && 'Each shoot day with the story days it touches, in schedule order. A day with more than one story day is a continuity jump: hair, makeup and wardrobe need a look change on set.'}
          {mode === 'character' && 'One block per character: every day they work, the story days they play that day, and the scenes. Hand this to the actor, costume and hair.'}
          {mode === 'department' && 'Everything tagged in one category, laid out by shoot day, so a department can see what it carries each day. Tags come from the breakdown on the Stripboard tab.'}
          {mode === 'element' && 'One element across the schedule: which days, how many pages, where, with whom. Built for the animal trainers, a picture-car vendor or a prosthetic, but it works for any tag.'}
          {' '}Dates appear once days are placed on the Calendar tab.
        </p>
      </div>
      <div className="panel">{bodies[mode].body}</div>
      {printing && <PrintPortal title={`${project.name} · ${printing.what}`} onDone={() => setPrinting(null)}><BreakdownReport p={project} what={printing.what}>{printing.body}</BreakdownReport></PrintPortal>}
    </div>
  );
}
