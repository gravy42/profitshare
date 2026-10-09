import { useEffect, useState } from 'react';
import { PrintPortal, ScheduleReport } from './print';
import { shootDates, shortDate, withCalendar } from '../engine/calendar';
import { applyDeal, withDeal } from '../engine/deal';
import { topSheet } from '../engine/budget';
import { adoptBoardDays, syncCastDaysFromBoard } from '../engine/board';
import { money } from './format';
import type { Board, Project, Scene } from '../engine/types';
import { autoDayBreaks, fitDayBreaks, clearDayBreaks, dood, eighthsToText, insertDayBreak, moveStrip, removeStrip, shootDays, totalEighths, moveStrips, moveDay, dayOfIndex, castSceneCounts, castOrderByAppearance, castOrderByScenes, renumberCast, splitStrip, unsplitScene, setPartEighths, stripPart, stripEighths, dropCastMember, unusedCast } from '../engine/board';
import { BREAKDOWN_CATEGORIES, addCast, addElement, autoTag, autoTagBoard, categoryColor, namedAnimals, removeCast, removeElement } from '../engine/breakdown';

type SetProject = (f: (p: Project) => Project) => void;

const stripClass = (s: Scene) => {
  const night = /NIGHT|EVENING|DUSK|LATE/i.test(s.tod);
  return `strip ${night ? 'night' : 'day'}-${s.ie === 'EXT' ? 'ext' : 'int'}`;
};

export function BoardView({ project, raw, setProject, notify }: { project: Project; raw?: Project; setProject: SetProject; notify?: (m: string, sticky?: boolean) => void }) {
  const board = project.board;
  const setBoard = (f: (b: Board) => Board) => setProject(p => ({ ...p, board: f(p.board) }));
  const byId = new Map(board.scenes.map(s => [s.id, s]));
  const days = shootDays(board);
  const dayDates = shootDates(board, withCalendar(project).calendar!);
  const [printSched, setPrintSched] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [dragDay, setDragDay] = useState<number | null>(null);          // a whole day being lifted (1-based)
  const [over, setOver] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());    // strip indices picked to move together
  const [lastPick, setLastPick] = useState<number | null>(null);
  const [target, setTarget] = useState(board.targetEighthsPerDay);
  const [pagesText, setPagesText] = useState(String(board.targetEighthsPerDay / 8));   // typed freely, committed on blur / Enter so 5.5 never passes through 5
  const commitPages = () => { const v = parseFloat(pagesText); if (!(v > 0)) { setPagesText(String(target / 8)); return; } const t = Math.round(v * 8); setTarget(t); setPagesText(String(t / 8)); setBoard(b => ({ ...b, targetEighthsPerDay: t })); };
  const [showDood, setShowDood] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [doodOpen, setDoodOpen] = useState(false);
  const [howto, setHowto] = useState<boolean>(() => { try { return localStorage.getItem('profitshare.boardHowto') !== 'closed'; } catch { return true; } });
  const rememberHowto = (open: boolean) => { setHowto(open); try { localStorage.setItem('profitshare.boardHowto', open ? 'open' : 'closed'); } catch { /* private window */ } };
  const total = totalEighths(board);
  const hasText = board.scenes.some(s => s.text);
  const tagCount = (s: Scene) => Object.values(s.elements).reduce((n, v) => n + v.length, 0);

  // running day index per strip position, for the day banners
  let dayIdx = 1;
  const dayOfStrip: number[] = board.strips.map(s => { const d = dayIdx; if (s.type === 'daybreak') dayIdx++; return d; });

  const clearSel = () => { setSelected(new Set()); setLastPick(null); };
  /** What a new board does to the money: the board owns cast and follower days, so a schedule change reprices the film. */
  const priceOf = (b: Board) => { const base = raw ?? project; return topSheet(applyDeal(syncCastDaysFromBoard(adoptBoardDays({ ...withDeal(base), board: b })))).cashBudget; };
  /** Apply a whole-board change and say what it did, in dollars, with the way back. */
  const reschedule = (what: string, f: (b: Board) => Board) => {
    const next = f(board);
    const before = priceOf(board), after = priceOf(next);
    const breaksBefore = board.strips.filter(x => x.type === 'daybreak').length, breaksAfter = next.strips.filter(x => x.type === 'daybreak').length;
    setBoard(() => next);
    const delta = after - before;
    const dayWord = (n: number) => `${n} day break${n === 1 ? '' : 's'}`;
    notify?.(`${what}: ${breaksAfter === breaksBefore ? dayWord(breaksAfter) : `${dayWord(breaksAfter)} (was ${breaksBefore})`}; cast days recounted; Budget to raise ${delta === 0 ? 'unchanged' : `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))}`}. Undo (⌘Z) brings the old board back.`, true);
  };
  /** Drop a strip (or the selection it belongs to) so it lands where strip `to` is; `to` = strips.length appends. */
  const onDrop = (to: number) => {
    if (drag !== null) {
      const block = selected.has(drag) ? [...selected] : [drag];
      setBoard(b => moveStrips(b, block, to));
      clearSel();
    }
    setDrag(null); setOver(null);
  };
  /** Drop a lifted day: before the day that holds strip `at` (a scene), after it (a day bar), or last (the end). */
  const onDropDay = (where: { beforeDayOf?: number; afterDay?: number; end?: boolean }) => {
    if (dragDay !== null) {
      const n = days.length;
      const pos = where.end ? n : where.afterDay != null ? where.afterDay : dayOfIndex(board, where.beforeDayOf ?? 0) - 1;   // block slot in the current order
      const toDay = pos - (pos > dragDay - 1 ? 1 : 0) + 1;
      setBoard(b => moveDay(b, dragDay, toDay));
      clearSel();
    }
    setDragDay(null); setOver(null);
  };
  const pick = (i: number, shift: boolean) => {
    setSelected((prev: Set<number>) => {
      const next = new Set(prev);
      if (shift && lastPick !== null) {
        const [lo, hi] = [Math.min(lastPick, i), Math.max(lastPick, i)];
        for (let j = lo; j <= hi; j++) if (board.strips[j].type === 'scene') next.add(j);
      } else if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
    setLastPick(i);
  };
  const dropAny = (e: React.DragEvent, i: number, bar: boolean) => {
    e.preventDefault();
    if (dragDay !== null) onDropDay(bar ? { afterDay: dayOfStrip[i] } : { beforeDayOf: i });
    else onDrop(i);
  };

  if (!board.scenes.length) return <div className="panel"><h2>Stripboard</h2><p className="help">No scenes yet. Import a Final Draft .fdx or a Movie Magic .sex board from the toolbar.</p></div>;

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Stripboard <span className="figures"><b>{board.scenes.length}</b> scenes · <b>{eighthsToText(total)}</b> pages · <b>{days.length}</b> {days.length === 1 ? 'day' : 'days'}{days.length !== project.shootDays ? <span className="warn"> of {project.shootDays} planned</span> : null}</span></h2>
          <div className="row">
            <div className="ctl" style={{ minWidth: 80 }}><label>Shoot days</label><input type="number" min={1} value={project.shootDays} onChange={e => setProject(p => ({ ...p, shootDays: Math.max(1, +e.target.value || 1) }))} style={{ width: 80 }} /></div>
            <div className="ctl" style={{ minWidth: 90 }}><label>Pages / day</label><input type="number" step={0.5} min={0.5} value={pagesText} onChange={e => setPagesText(e.target.value)} onBlur={commitPages} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} title="The target for Auto day breaks; commits when you leave the field" /></div>
            <button className="btn" title="The board as a shooting schedule, one block per day, as a PDF" onClick={() => setPrintSched(true)}>Print schedule</button>
            <button className="btn" title={`Place a day break whenever the running pages pass ${target / 8} a day, keeping your order`} onClick={() => reschedule('Auto day breaks', b => autoDayBreaks(b, target))}>Auto day breaks</button>
            <button className={`btn ${days.length <= 1 && project.shootDays > 1 ? 'primary' : ''}`} title={`Split into exactly ${project.shootDays} days, keeping order, with the heaviest day as light as possible`} onClick={() => reschedule(`Fit to ${project.shootDays} days`, b => fitDayBreaks(b, project.shootDays))}>Fit to {project.shootDays} days</button>
            <button className="btn" disabled={days.length <= 1} title="Take every day break off the board (Undo brings them back)" onClick={() => reschedule('Clear day breaks', clearDayBreaks)}>Clear day breaks</button>
            {hasText && <button className="btn" title="First-pass breakdown of every scene from the script text: props, vehicles, wardrobe, sounds, extras and the rest. Keeps tags you've added." onClick={() => setBoard(autoTagBoard)}>Auto-tag all scenes</button>}
            <span className="small muted" title="Cast shoot days and followers (a studio teacher, an animal wrangler) are rewritten on the top sheet and in the points schedule after every edit here. Rehearsal and fitting days live on their own budget line.">cast days flow to the budget automatically</span>
          </div>
        </div>
        {days.length <= 1 && board.scenes.length > 1 && (
          <div className="notice">
            <b>No day breaks yet.</b> The {board.scenes.length} strips are in order but on one day. <b>Fit to {project.shootDays} days</b> places the breaks for a {project.shootDays}-day schedule and you can drag them after; or drop one yourself with a strip's ⏎ button.
          </div>
        )}
        <details className="howto" open={howto} onToggle={e => rememberHowto((e.target as HTMLDetailsElement).open)}>
          <summary className="help small">How the board works</summary>
        <p className="help">Drag strips to reorder; tick the boxes (shift-click for a run) to pick several and drag them as one block; grab ⋮⋮ day on a day bar to lift the whole day and drop it before a strip or after another day bar. Open a strip's ⌄ to read the scene and tag it: select any words in the script and pick a category, the way Final Draft's tagger works. Drop a day break with the ⏎ button on any strip (it goes in above it). ½ splits a strip so one scene shoots over two days: drag the second part below a day break, set each part's pages, and the cast and tags count on both days. Auto day breaks keeps your scene order and splits at the target; Fit to {project.shootDays} days keeps the order and balances the pages across the schedule; {eighthsToText(total)} pages over {project.shootDays} days is {(total / 8 / project.shootDays).toFixed(1)} pages a day.</p>
        </details>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="legend"><span className="di">Day int</span><span className="ni">Night int</span><span className="de">Day ext</span><span className="ne">Night ext</span></div>
          {selected.size > 0 && <span className="small"><b>{selected.size} picked</b> · drag any of them to move the group · <button className="btn small" onClick={clearSel}>clear</button></span>}
        </div>
      </div>

      <div className="board">
        <div className="strips" onDragOver={e => e.preventDefault()}>
          {board.strips.map((strip, i) => {
            const common = {
              draggable: true,
              onDragStart: () => setDrag(i),
              onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(i); },
              onDragLeave: () => setOver(o => (o === i ? null : o)),
              onDrop: (e: React.DragEvent) => dropAny(e, i, strip.type === 'daybreak'),
            };
            if (strip.type === 'daybreak') {
              const d = days[dayOfStrip[i] - 1];
              const heavy = d && d.eighths > target * 1.15;
              return (
                <div key={strip.id} className={`daybreak ${over === i ? 'dragover' : ''} ${dragDay === dayOfStrip[i] ? 'lifting' : ''}`} {...common}>
                  <span><span className="handle daygrip" draggable title={`Drag to move all of Day ${dayOfStrip[i]} (drop on a strip to go before that day, on a day bar to go after it)`} onDragStart={e => { e.stopPropagation(); setDragDay(dayOfStrip[i]); }} onDragEnd={() => { setDragDay(null); setOver(null); }}>⋮⋮ day</span> End of Day {dayOfStrip[i]}{dayDates.get(dayOfStrip[i]) ? <span className="daydate"> · {shortDate(dayDates.get(dayOfStrip[i])!)}</span> : null} · {d ? eighthsToText(d.eighths) : '0'} pgs · {d?.castIds.length ?? 0} cast {heavy && <span className="warn">· heavy</span>}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <input placeholder="label" title="A note for this day (the date comes from the Calendar tab)" value={strip.label ?? ''} onChange={e => setBoard(b => ({ ...b, strips: b.strips.map((s, j) => j === i && s.type === 'daybreak' ? { ...s, label: e.target.value } : s) }))} />
                    <button className="x" title="remove day break" onClick={() => setBoard(b => removeStrip(b, i))}>×</button>
                  </span>
                </div>
              );
            }
            if (strip.type === 'banner') return <div key={strip.id} className="daybreak" {...common}>{strip.text}</div>;
            const s = byId.get(strip.sceneId);
            if (!s) return null;
            const isOpen = openId === s.id;
            const { part, parts } = stripPart(board, i);
            const e = stripEighths(board, strip, byId);
            return (
              <div key={`${strip.sceneId}:${i}`}>
                <div className={`${stripClass(s)} ${over === i ? 'dragover' : ''} ${isOpen ? 'open' : ''} ${selected.has(i) ? 'sel' : ''} ${dragDay === dayOfStrip[i] ? 'lifting' : ''}`} {...common}>
                  <span className="handle" title={selected.size > 1 && selected.has(i) ? `drag moves all ${selected.size} picked strips` : 'drag to move; tick the box to pick several and move them together'}><input type="checkbox" className="pick" checked={selected.has(i)} onChange={() => undefined} onClick={e => { e.stopPropagation(); pick(i, e.shiftKey); }} onMouseDown={e => e.stopPropagation()} />⋮⋮</span>
                  <span className="num">{s.number}{parts > 1 && <span className="part" title={`part ${part} of ${parts}: this scene shoots over ${parts} days`}>{part}/{parts}</span>}</span>
                  <span>{s.ie}</span>
                  <span className="set">{s.set}<small>{s.synopsis}</small></span>
                  <span className="small muted">{s.tod}</span>
                  {parts > 1
                    ? <span className="small" title={`this part's pages, in eighths (scene is ${eighthsToText(s.eighths)})`}><input className="eighths" type="number" min={0} max={s.eighths} value={e} onChange={ev => setBoard(b => setPartEighths(b, i, +ev.target.value || 0))} onMouseDown={ev => ev.stopPropagation()} />/8</span>
                    : <span className="small">{eighthsToText(s.eighths)} pg</span>}
                  <span className="cast" title={s.cast.map(c => c.name).join(', ')}>{s.cast.map(c => c.id ?? c.name.slice(0, 3)).join(', ')}</span>
                  <button className="btn small act" aria-label={isOpen ? `Close scene ${s.number}` : `Read and tag scene ${s.number}${tagCount(s) ? ` (${tagCount(s)} tags)` : ''}`} title={isOpen ? 'Close the scene' : 'Read the scene and tag it'} onClick={() => setOpenId(isOpen ? null : s.id)}><span className="glyph">{isOpen ? '⌃' : '⌄'}</span><span className="word">{isOpen ? 'close' : 'tag'}</span>{tagCount(s) ? <span className="count">{tagCount(s)}</span> : null}</button>
                  <span className="row" style={{ gap: 4 }}>
                    <button className="btn small act" aria-label={`Day break above scene ${s.number}`} title="Start a new day here (a day break above this strip)" onClick={() => setBoard(b => insertDayBreak(b, i))}><span className="glyph">⏎</span><span className="word">day</span></button>
                    <button className="btn small act" aria-label={parts > 1 ? `Split scene ${s.number} again` : `Shoot scene ${s.number} over two days`} title={parts > 1 ? 'Split this part again (a third day)' : 'Shoot this scene over two days: splits the strip in two'} onClick={() => setBoard(b => splitStrip(b, i))}><span className="glyph">½</span><span className="word">split</span></button>
                    {parts > 1 && <button className="btn small act" aria-label={`Put scene ${s.number} back on one strip`} title="Put the scene back on one strip" onClick={() => setBoard(b => unsplitScene(b, s.id))}><span className="glyph">⊕</span><span className="word">join</span></button>}
                  </span>
                </div>
                {isOpen && <Tagger scene={s} board={board} setBoard={setBoard} />}
              </div>
            );
          })}
          {days.length > 0 && board.strips[board.strips.length - 1]?.type !== 'daybreak' && (() => {
            const d = days[days.length - 1];
            const heavy = d.eighths > target * 1.15;
            return (
              <div className="daybreak wrap" onDragOver={e => { e.preventDefault(); setOver(board.strips.length); }} onDragLeave={() => setOver(o => (o === board.strips.length ? null : o))} onDrop={e => { e.preventDefault(); if (dragDay !== null) onDropDay({ end: true }); else onDrop(board.strips.length); }}>
                <span>End of Day {d.index} · {eighthsToText(d.eighths)} pgs · {d.castIds.length} cast {heavy && <span className="warn">· heavy</span>} · wrap</span>
                <span className="small muted">last day of the schedule</span>
              </div>
            );
          })()}
          <div style={{ height: 30 }} onDragOver={e => e.preventDefault()} onDrop={() => (dragDay !== null ? onDropDay({ end: true }) : onDrop(board.strips.length))} />
        </div>

        <div>
          <div className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2>Days</h2><button className="btn small" onClick={() => setShowDood(v => !v)}>{showDood ? 'hide DOOD' : 'show DOOD'}</button></div>
            <table className="dayrows">
              <thead><tr><th>Day</th><th>Scenes</th><th>Pages</th><th>Cast</th></tr></thead>
              <tbody>{days.map(d => <tr key={d.index} className={`${d.eighths > target * 1.15 ? 'hl' : ''} ${dragDay === d.index ? 'lifting' : ''}`} draggable title="drag to reorder the days" onDragStart={() => setDragDay(d.index)} onDragEnd={() => setDragDay(null)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragDay !== null) { const from = dragDay; setBoard(b => moveDay(b, from, d.index)); setDragDay(null); clearSel(); } }}><td><span className="handle">⋮⋮ </span>{d.index}{d.label ? ` · ${d.label}` : ''}</td><td>{d.scenes.length}</td><td>{eighthsToText(d.eighths)}</td><td>{d.castIds.length}</td></tr>)}</tbody>
            </table>
          </div>
          {showDood && (
            <div className="panel dood">
              <div className="row" style={{ justifyContent: 'space-between' }}><h2>Day out of days</h2><button className="btn small" title="open the full day-out-of-days" onClick={() => setDoodOpen(true)}>⤢ pop out</button></div>
              <DoodTable board={board} days={days} compact />
              <p className="help small">W = work day, H = hold day between work days. Cast on SAG weekly deals are paid through holds, so a long span costs more than a short one. Pop out to see every day, and to renumber the cast.</p>
            </div>
          )}
        </div>
      </div>
      {doodOpen && <DoodPopout project={project} setProject={setProject} onClose={() => setDoodOpen(false)} />}
      {printSched && <PrintPortal title={`${project.name} · Shooting schedule`} landscape onDone={() => setPrintSched(false)}><ScheduleReport p={project} /></PrintPortal>}
    </div>
  );
}

/** The DOOD grid. Compact shows the first days that fit; the popout shows them all and lets rows be dragged to renumber. */
function DoodTable({ board, days, compact, onReorder, onRemove }: { board: Board; days: ReturnType<typeof shootDays>; compact?: boolean; onReorder?: (order: number[]) => void; onRemove?: (castId: number) => void }) {
  const rows = dood(board);
  const counts = castSceneCounts(board);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const drop = (to: number) => {
    if (drag === null || !onReorder) return;
    const ids = board.castList.map(c => c.id); const from = ids.indexOf(drag);
    if (from >= 0) { ids.splice(from, 1); ids.splice(to > from ? to - 1 : to, 0, drag); onReorder(ids); }
    setDrag(null); setOver(null);
  };
  return (
    <table className={compact ? '' : 'full'}>
      <thead><tr><th className="l">Cast</th>{!compact && <th title="scenes in the script">Sc</th>}{days.map(d => <th key={d.index} title={d.label || `Day ${d.index}`}>{d.index}</th>)}<th>W</th><th>Span</th></tr></thead>
      <tbody>
        {rows.filter(r => compact ? r.total > 0 : true).map((r, i) => (
          <tr key={r.castId} className={over === i ? 'dragover' : ''}
            draggable={!!onReorder} onDragStart={() => setDrag(r.castId)} onDragOver={e => { if (onReorder) { e.preventDefault(); setOver(i); } }} onDragLeave={() => setOver(o => (o === i ? null : o))} onDrop={e => { e.preventDefault(); drop(i); }}>
            <td className="l">{onReorder && <span className="handle">⋮⋮ </span>}{r.castId} {r.name}{onRemove && <button className="x" title={counts.get(r.castId) ? `remove ${r.name} from the cast list and untag them from ${counts.get(r.castId)} scene${counts.get(r.castId) === 1 ? '' : 's'}` : `remove ${r.name} from the cast list (no scenes)`} onClick={e => { e.stopPropagation(); if (!counts.get(r.castId) || window.confirm(`${r.name} is tagged in ${counts.get(r.castId)} scene(s). Remove them from the cast list and untag those scenes?`)) onRemove(r.castId); }}>×</button>}</td>
            {!compact && <td className="muted">{counts.get(r.castId) ?? 0}</td>}
            {days.map(d => {
              const w = r.workDays.includes(d.index);
              const hold = !w && d.index > r.workDays[0] && d.index < r.workDays[r.workDays.length - 1];
              return <td key={d.index} className={w ? 'w' : hold ? 'h' : ''}>{w ? 'W' : hold ? 'H' : ''}</td>;
            })}
            <td><b>{r.total}</b></td><td className="muted">{r.span}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function DoodPopout({ project, setProject, onClose }: { project: Project; setProject: SetProject; onClose: () => void }) {
  const board = project.board; const days = shootDays(board);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const holds = dood(board).reduce((n, r) => n + Math.max(0, r.span - r.total), 0);
  const unused = unusedCast(board);
  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>Day out of days · {board.castList.length} cast · {days.length} days · {holds} hold days</h2>
          <div className="row">
            <button className="btn small" title="1 = most scenes, the way a breakdown numbers a cast list" onClick={() => setProject(p => renumberCast(p, castOrderByScenes(p.board)))}>Number by scenes</button>
            <button className="btn small" title="1 = first to appear in the script" onClick={() => setProject(p => renumberCast(p, castOrderByAppearance(p.board)))}>Number by first appearance</button>
            {unused.length > 0 && <button className="btn small" title={`Drop ${unused.map(id => board.castList.find(c => c.id === id)?.name).join(', ')}: on the cast list but tagged in no scene`} onClick={() => setProject(p => unusedCast(p.board).reduce((q, id) => dropCastMember(q, id), p))}>Remove {unused.length} unused</button>}
            <button className="btn small" onClick={onClose}>Close (Esc)</button>
          </div>
        </div>
        <p className="help small">Drag a row to renumber by hand; scene tags and the points schedule follow the new numbers. × drops a character from the cast list (and untags their scenes). W = work day, H = hold day between work days (paid on SAG weekly deals).</p>
        <div className="dood dood-full">
          <DoodTable board={board} days={days} onReorder={order => setProject(p => renumberCast(p, order))} onRemove={id => setProject(p => dropCastMember(p, id))} />
        </div>
      </div>
    </div>
  );
}
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The scene as written, with everything tagged on it lit up; select words to tag them. */
function Tagger({ scene: s, board, setBoard }: { scene: Scene; board: Board; setBoard: (f: (b: Board) => Board) => void }) {
  const [pick, setPick] = useState<{ text: string; x: number; y: number } | null>(null);
  const [cat, setCat] = useState<string>('Props');
  const [item, setItem] = useState('');
  const tagged: { phrase: string; color: string; title: string }[] = [
    ...s.cast.map(c => ({ phrase: c.name, color: 'var(--plum)', title: `Cast ${c.id ?? ''}` })),
    ...Object.entries(s.elements).flatMap(([k, v]) => v.map(phrase => ({ phrase, color: categoryColor(k), title: k }))),
  ].filter(t => t.phrase.length >= 2).sort((a, b) => b.phrase.length - a.phrase.length);
  const parts: { text: string; tag?: typeof tagged[number] }[] = [];
  if (s.text) {
    const re = tagged.length ? new RegExp(`(${tagged.map(t => esc(t.phrase)).join('|')})`, 'gi') : null;
    let last = 0;
    if (re) for (const m of s.text.matchAll(re)) {
      if (m.index! > last) parts.push({ text: s.text.slice(last, m.index) });
      parts.push({ text: m[0], tag: tagged.find(t => t.phrase.toLowerCase() === m[0].toLowerCase()) });
      last = m.index! + m[0].length;
    }
    parts.push({ text: s.text.slice(last) });
  }
  const onSelect = () => {
    if (!s.text) return;   // the placeholder is not a scene
    const sel = window.getSelection(); const t = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!t || t.length > 60 || !sel || sel.rangeCount === 0) { setPick(null); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setPick({ text: t, x: Math.min(r.left, window.innerWidth - 420), y: r.bottom + 6 });
  };
  const tagAs = (k: string) => { if (!pick) return; setBoard(b => k === 'Cast' ? addCast(b, s.id, pick.text) : addElement(b, s.id, k, pick.text)); setPick(null); window.getSelection()?.removeAllRanges(); };
  const cats = [...new Set([...BREAKDOWN_CATEGORIES.map(c => c.key as string), ...Object.keys(s.elements)])];
  return (
    <div className="tagger" onMouseDown={e => { if (!(e.target as HTMLElement).closest('.tagmenu')) setPick(null); }}>
      <div className="script" onMouseUp={onSelect}>
        {s.text
          ? parts.map((p, i) => p.tag ? <mark key={i} style={{ background: p.tag.color }} title={p.tag.title}>{p.text}</mark> : <span key={i}>{p.text}</span>)
          : <span className="muted">No script text on this strip. A board from Movie Magic or Shamel carries its tags but not the pages; drop the script (.fdx, .pdf, .fountain or .txt) and the text comes with it.</span>}
      </div>
      <div className="tags">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>Scene {s.number} breakdown</b>
          {s.text && <button className="btn small" title="Tag this scene from the script text; keeps what you've added" onClick={() => setBoard(b => ({ ...b, scenes: b.scenes.map(x => x.id === s.id ? { ...x, elements: autoTag(x, b.castList.map(c => c.name), namedAnimals(b)) } : x) }))}>Auto-tag</button>}
        </div>
        <div className="tagrow"><span className="tagcat" style={{ color: 'var(--plum)' }}>Cast</span>
          {s.cast.map(c => <span key={c.name} className="chip" style={{ borderColor: 'var(--plum)' }}>{c.id ? `${c.id} ` : ''}{c.name}<button title="remove from this scene" onClick={() => setBoard(b => removeCast(b, s.id, c.name))}>×</button></span>)}
        </div>
        {Object.entries(s.elements).map(([k, items]) => (
          <div className="tagrow" key={k}><span className="tagcat" style={{ color: categoryColor(k) }}>{k}</span>
            {items.map(it => <span key={it} className="chip" style={{ borderColor: categoryColor(k) }}>{it}<button title="remove" onClick={() => setBoard(b => removeElement(b, s.id, k, it))}>×</button></span>)}
          </div>
        ))}
        <form className="row" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); if (!item.trim()) return; setBoard(b => cat === 'Cast' ? addCast(b, s.id, item) : addElement(b, s.id, cat, item)); setItem(''); }}>
          <select value={cat} onChange={e => setCat(e.target.value)}><option>Cast</option>{cats.map(c => <option key={c}>{c}</option>)}</select>
          <input placeholder="add an item" value={item} onChange={e => setItem(e.target.value)} style={{ flex: 1 }} />
          <button className="btn small" type="submit">Add</button>
        </form>
        <p className="help small">Select words in the script to tag them. Tags travel with the strip into the project file and any export.</p>
      </div>
      {pick && (
        <div className="tagmenu" style={{ left: pick.x, top: pick.y }}>
          <span className="muted small">“{pick.text}” is</span>
          <button style={{ borderColor: 'var(--plum)' }} onClick={() => tagAs('Cast')}>Cast</button>
          {BREAKDOWN_CATEGORIES.map(c => <button key={c.key} style={{ borderColor: c.color }} onClick={() => tagAs(c.key)}>{c.key}</button>)}
        </div>
      )}
    </div>
  );
}
