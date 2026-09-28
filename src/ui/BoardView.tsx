import { useState } from 'react';
import type { Board, Project, Scene } from '../engine/types';
import { autoDayBreaks, fitDayBreaks, clearDayBreaks, dood, eighthsToText, insertDayBreak, moveStrip, removeStrip, shootDays, syncCastDaysFromBoard, totalEighths } from '../engine/board';

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
  const total = totalEighths(board);

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
            <div className="ctl" style={{ minWidth: 90 }}><label>Pages / day</label><input type="number" step={0.5} value={target / 8} onChange={e => { setTarget(+e.target.value * 8); setBoard(b => ({ ...b, targetEighthsPerDay: +e.target.value * 8 })); }} /></div>
            <button className="btn" onClick={() => setBoard(b => autoDayBreaks(b, target))}>Auto day breaks</button>
            <button className="btn" title={`Split into exactly ${project.shootDays} days, keeping order, with the heaviest day as light as possible`} onClick={() => setBoard(b => fitDayBreaks(b, project.shootDays))}>Fit to {project.shootDays} days</button>
            <button className="btn" onClick={() => setBoard(clearDayBreaks)}>Clear day breaks</button>
            <button className="btn primary" onClick={() => setProject(syncCastDaysFromBoard)}>Push cast days → budget</button>
          </div>
        </div>
        <p className="help">Drag strips to reorder. Drop a day break with the ⏎ button on any strip (it goes in above it). Auto day breaks keeps your scene order and splits at the target; Fit to {project.shootDays} days keeps the order and balances the pages across the schedule; {eighthsToText(total)} pages over {project.shootDays} days is {(total / 8 / project.shootDays).toFixed(1)} pages a day.</p>
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
            return (
              <div key={strip.sceneId} className={`${stripClass(s)} ${over === i ? 'dragover' : ''}`} {...common} title={s.synopsis}>
                <span className="handle">⋮⋮</span>
                <span className="num">{s.number}</span>
                <span>{s.ie}</span>
                <span className="set">{s.set}<small>{s.synopsis}</small></span>
                <span className="small muted">{s.tod}</span>
                <span className="small">{eighthsToText(s.eighths)} pg</span>
                <span className="cast" title={s.cast.map(c => c.name).join(', ')}>{s.cast.map(c => c.id ?? c.name.slice(0, 3)).join(', ')}</span>
                <button className="btn small" title="insert day break above" onClick={() => setBoard(b => insertDayBreak(b, i))}>⏎</button>
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
              <h2>Day out of days</h2>
              <table>
                <thead><tr><th className="l">Cast</th>{days.map(d => <th key={d.index}>{d.index}</th>)}<th>W</th><th>Span</th></tr></thead>
                <tbody>
                  {dood(board).filter(r => r.total > 0).map(r => (
                    <tr key={r.castId}><td className="l">{r.castId} {r.name}</td>
                      {days.map(d => {
                        const w = r.workDays.includes(d.index);
                        const hold = !w && d.index > r.workDays[0] && d.index < r.workDays[r.workDays.length - 1];
                        return <td key={d.index} className={w ? 'w' : hold ? 'h' : ''}>{w ? 'W' : hold ? 'H' : ''}</td>;
                      })}
                      <td><b>{r.total}</b></td><td className="muted">{r.span}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="help small">W = work day, H = hold day between work days. Cast on SAG weekly deals are paid through holds, so a long span costs more than a short one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
