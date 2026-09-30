import { useEffect, useState } from 'react';
import type { Board, Project, Scene } from '../engine/types';
import { autoDayBreaks, fitDayBreaks, clearDayBreaks, dood, eighthsToText, insertDayBreak, moveStrip, removeStrip, shootDays, syncCastDaysFromBoard, totalEighths, castSceneCounts, castOrderByAppearance, castOrderByScenes, renumberCast } from '../engine/board';
import { BREAKDOWN_CATEGORIES, addCast, addElement, autoTag, autoTagBoard, categoryColor, removeCast, removeElement } from '../engine/breakdown';

type Set = (f: (p: Project) => Project) => void;

const stripClass = (s: Scene) => {
  const night = /NIGHT|EVENING|DUSK|LATE/i.test(s.tod);
  return `strip ${night ? 'night' : 'day'}-${s.ie === 'EXT' ? 'ext' : 'int'}`;
};

export function BoardView({ project, setProject }: { project: Project; setProject: Set }) {
  const board = project.board;
  const setBoard = (f: (b: Board) => Board) => setProject(p => ({ ...p, board: f(p.board) }));
  const byId = new Map(board.scenes.map(s => [s.id, s]));
  const days = shootDays(board);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [target, setTarget] = useState(board.targetEighthsPerDay);
  const [showDood, setShowDood] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [doodOpen, setDoodOpen] = useState(false);
  const total = totalEighths(board);
  const hasText = board.scenes.some(s => s.text);
  const tagCount = (s: Scene) => Object.values(s.elements).reduce((n, v) => n + v.length, 0);

  // running day index per strip position, for the day banners
  let dayIdx = 1;
  const dayOfStrip: number[] = board.strips.map(s => { const d = dayIdx; if (s.type === 'daybreak') dayIdx++; return d; });

  const onDrop = (to: number) => { if (drag !== null) setBoard(b => moveStrip(b, drag, to)); setDrag(null); setOver(null); };

  if (!board.scenes.length) return <div className="panel"><h2>Stripboard</h2><p className="help">No scenes yet. Import a Final Draft .fdx or a Movie Magic .sex board from the toolbar.</p></div>;

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Stripboard · {board.scenes.length} scenes · {eighthsToText(total)} pages · {days.length} days</h2>
          <div className="row">
            <div className="ctl" style={{ minWidth: 80 }}><label>Shoot days</label><input type="number" min={1} value={project.shootDays} onChange={e => setProject(p => ({ ...p, shootDays: Math.max(1, +e.target.value || 1) }))} style={{ width: 80 }} /></div>
            <div className="ctl" style={{ minWidth: 90 }}><label>Pages / day</label><input type="number" step={0.5} value={target / 8} onChange={e => { setTarget(+e.target.value * 8); setBoard(b => ({ ...b, targetEighthsPerDay: +e.target.value * 8 })); }} /></div>
            <button className="btn" onClick={() => setBoard(b => autoDayBreaks(b, target))}>Auto day breaks</button>
            <button className="btn" title={`Split into exactly ${project.shootDays} days, keeping order, with the heaviest day as light as possible`} onClick={() => setBoard(b => fitDayBreaks(b, project.shootDays))}>Fit to {project.shootDays} days</button>
            <button className="btn" onClick={() => setBoard(clearDayBreaks)}>Clear day breaks</button>
            {hasText && <button className="btn" title="First-pass breakdown of every scene from the script text: props, vehicles, wardrobe, sounds, extras and the rest. Keeps tags you've added." onClick={() => setBoard(autoTagBoard)}>Auto-tag all scenes</button>}
            <button className="btn primary" onClick={() => setProject(syncCastDaysFromBoard)}>Push cast days → budget</button>
          </div>
        </div>
        <p className="help">Drag strips to reorder. Open a strip's ⌄ to read the scene and tag it: select any words in the script and pick a category, the way Final Draft's tagger works. Drop a day break with the ⏎ button on any strip (it goes in above it). Auto day breaks keeps your scene order and splits at the target; Fit to {project.shootDays} days keeps the order and balances the pages across the schedule; {eighthsToText(total)} pages over {project.shootDays} days is {(total / 8 / project.shootDays).toFixed(1)} pages a day.</p>
        <div className="legend"><span className="di">Day int</span><span className="ni">Night int</span><span className="de">Day ext</span><span className="ne">Night ext</span></div>
      </div>

      <div className="board">
        <div className="strips" onDragOver={e => e.preventDefault()}>
          {board.strips.map((strip, i) => {
            const common = {
              draggable: true,
              onDragStart: () => setDrag(i),
              onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(i); },
              onDragLeave: () => setOver(o => (o === i ? null : o)),
              onDrop: (e: React.DragEvent) => { e.preventDefault(); onDrop(i); },
            };
            if (strip.type === 'daybreak') {
              const d = days[dayOfStrip[i] - 1];
              const heavy = d && d.eighths > target * 1.15;
              return (
                <div key={strip.id} className={`daybreak ${over === i ? 'dragover' : ''}`} {...common}>
                  <span>End of Day {dayOfStrip[i]} · {d ? eighthsToText(d.eighths) : '0'} pgs · {d?.castIds.length ?? 0} cast {heavy && <span className="warn">· heavy</span>}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <input placeholder="date / label" value={strip.label ?? ''} onChange={e => setBoard(b => ({ ...b, strips: b.strips.map((s, j) => j === i && s.type === 'daybreak' ? { ...s, label: e.target.value } : s) }))} />
                    <button className="x" title="remove day break" onClick={() => setBoard(b => removeStrip(b, i))}>×</button>
                  </span>
                </div>
              );
            }
            if (strip.type === 'banner') return <div key={strip.id} className="daybreak" {...common}>{strip.text}</div>;
            const s = byId.get(strip.sceneId);
            if (!s) return null;
            const isOpen = openId === s.id;
            return (
              <div key={strip.sceneId}>
                <div className={`${stripClass(s)} ${over === i ? 'dragover' : ''} ${isOpen ? 'open' : ''}`} {...common} title={s.synopsis}>
                  <span className="handle">⋮⋮</span>
                  <span className="num">{s.number}</span>
                  <span>{s.ie}</span>
                  <span className="set">{s.set}<small>{s.synopsis}</small></span>
                  <span className="small muted">{s.tod}</span>
                  <span className="small">{eighthsToText(s.eighths)} pg</span>
                  <span className="cast" title={s.cast.map(c => c.name).join(', ')}>{s.cast.map(c => c.id ?? c.name.slice(0, 3)).join(', ')}</span>
                  <button className="btn small" title={isOpen ? 'close' : 'read and tag this scene'} onClick={() => setOpenId(isOpen ? null : s.id)}>{isOpen ? '⌃' : '⌄'}{tagCount(s) ? ` ${tagCount(s)}` : ''}</button>
                  <button className="btn small" title="insert day break above" onClick={() => setBoard(b => insertDayBreak(b, i))}>⏎</button>
                </div>
                {isOpen && <Tagger scene={s} board={board} setBoard={setBoard} />}
              </div>
            );
          })}
          <div style={{ height: 30 }} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(board.strips.length)} />
        </div>

        <div>
          <div className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2>Days</h2><button className="btn small" onClick={() => setShowDood(v => !v)}>{showDood ? 'hide DOOD' : 'show DOOD'}</button></div>
            <table>
              <thead><tr><th>Day</th><th>Scenes</th><th>Pages</th><th>Cast</th></tr></thead>
              <tbody>{days.map(d => <tr key={d.index} className={d.eighths > target * 1.15 ? 'hl' : ''}><td>{d.index}{d.label ? ` · ${d.label}` : ''}</td><td>{d.scenes.length}</td><td>{eighthsToText(d.eighths)}</td><td>{d.castIds.length}</td></tr>)}</tbody>
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
    </div>
  );
}

/** The DOOD grid. Compact shows the first days that fit; the popout shows them all and lets rows be dragged to renumber. */
function DoodTable({ board, days, compact, onReorder }: { board: Board; days: ReturnType<typeof shootDays>; compact?: boolean; onReorder?: (order: number[]) => void }) {
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
            <td className="l">{onReorder && <span className="handle">⋮⋮ </span>}{r.castId} {r.name}</td>
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

function DoodPopout({ project, setProject, onClose }: { project: Project; setProject: Set; onClose: () => void }) {
  const board = project.board; const days = shootDays(board);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const holds = dood(board).reduce((n, r) => n + Math.max(0, r.span - r.total), 0);
  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>Day out of days · {board.castList.length} cast · {days.length} days · {holds} hold days</h2>
          <div className="row">
            <button className="btn small" title="1 = most scenes, the way a breakdown numbers a cast list" onClick={() => setProject(p => renumberCast(p, castOrderByScenes(p.board)))}>Number by scenes</button>
            <button className="btn small" title="1 = first to appear in the script" onClick={() => setProject(p => renumberCast(p, castOrderByAppearance(p.board)))}>Number by first appearance</button>
            <button className="btn small" onClick={onClose}>Close (Esc)</button>
          </div>
        </div>
        <p className="help small">Drag a row to renumber by hand; scene tags and the points schedule follow the new numbers. W = work day, H = hold day between work days (paid on SAG weekly deals).</p>
        <div className="dood dood-full">
          <DoodTable board={board} days={days} onReorder={order => setProject(p => renumberCast(p, order))} />
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
          {s.text && <button className="btn small" title="Tag this scene from the script text; keeps what you've added" onClick={() => setBoard(b => ({ ...b, scenes: b.scenes.map(x => x.id === s.id ? { ...x, elements: autoTag(x, b.castList.map(c => c.name)) } : x) }))}>Auto-tag</button>}
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
