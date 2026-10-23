// AI breakdown on the Stripboard: say what goes out, read the scenes in runs, then show every proposed tag with a tick
// box. Nothing lands on the board until Apply, and Apply is one step that Undo takes back.
import { useEffect, useRef, useState } from 'react';
import type { Project } from '../engine/types';
import { aiSettings, breakdownBatch } from '../ai';
import { aiBatches, applyAiBreakdown, pickKey, whatsNew, type AiSceneTags } from '../engine/aiBreakdown';
import { categoryColor } from '../engine/breakdown';
import { syncFollowersFromBoard } from '../engine/board';
import { keepBoard } from '../store';
import { AiKeyFields } from './AiKey';

type SetProject = (f: (p: Project) => Project) => void;
const RUN = 15;   // scenes per request: small enough to finish well inside the reply limit, big enough to keep the story in view

export function AiBreakdown({ project, setProject, only, onClose, notify }: { project: Project; setProject: SetProject; only?: string[]; onClose: () => void; notify?: (m: string, sticky?: boolean) => void }) {
  const board = project.board;
  const [settings, setSettings] = useState(aiSettings());
  const batches = aiBatches(board, RUN, only);
  const scenes = batches.flat();
  const words = scenes.reduce((n, s) => n + (s.text ?? '').split(/\s+/).filter(Boolean).length, 0);
  const [replace, setReplace] = useState(false);
  const [stage, setStage] = useState<'intro' | 'running' | 'review'>('intro');
  const [done, setDone] = useState<AiSceneTags[]>([]);
  const [run, setRun] = useState(0);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const abort = useRef<AbortController | null>(null);
  const close = () => { abort.current?.abort(); onClose(); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });   // eslint-disable-line react-hooks/exhaustive-deps

  /** Read the runs from `from` on, one at a time, so each run knows the labels and story days before it. */
  const go = async (from: number, have: AiSceneTags[]) => {
    setStage('running'); setError('');
    const ctl = new AbortController(); abort.current = ctl;
    let acc = have;
    for (let i = from; i < batches.length; i++) {
      setRun(i);
      try { acc = [...acc, ...await breakdownBatch(board, batches[i], acc, ctl.signal)]; setDone(acc); }
      catch (e) {
        if (ctl.signal.aborted) return;
        setError(`Run ${i + 1} of ${batches.length} (scenes ${batches[i][0].number}–${batches[i][batches[i].length - 1].number}) did not come back: ${(e as Error).message}`);
        return;
      }
    }
    // a VFX-only suggestion starts unticked: parking a scene off the day count is a scheduling call to make on purpose
    setRejected(new Set(acc.filter(t => t.vfxOnly).map(t => pickKey.vfx(t.sceneId))));
    setStage('review');
  };

  const byId = new Map(board.scenes.map(s => [s.id, s]));
  const shown = done.map(t => ({ t, scene: byId.get(t.sceneId)!, view: replace ? t : whatsNew(byId.get(t.sceneId)!, t) })).filter(x => x.scene);
  const keysOf = ({ t, scene, view }: typeof shown[number]): string[] => [
    ...Object.entries(view.elements).flatMap(([k, v]) => v.map(it => pickKey.tag(t.sceneId, k, it))),
    ...view.cast.map(n => pickKey.cast(t.sceneId, n)),
    ...(t.scriptDay && t.scriptDay !== scene.scriptDay ? [pickKey.day(t.sceneId)] : []),
    ...(t.synopsis && t.synopsis !== scene.synopsis ? [pickKey.synopsis(t.sceneId)] : []),
    ...(t.vfxOnly && !scene.unit ? [pickKey.vfx(t.sceneId)] : []),
  ];
  const allKeys = shown.flatMap(keysOf);
  const ticked = allKeys.filter(k => !rejected.has(k));
  const toggle = (k: string) => setRejected(r => { const n = new Set(r); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const setMany = (keys: string[], on: boolean) => setRejected(r => { const n = new Set(r); for (const k of keys) { if (on) n.delete(k); else n.add(k); } return n; });
  const count = (kind: string) => ticked.filter(k => k.split('|')[1] === kind).length;

  const apply = () => {
    keepBoard(board, 'before the AI breakdown');
    setProject(p => syncFollowersFromBoard({ ...p, board: applyAiBreakdown(p.board, done, rejected, { replace }) }).project);
    const parts = [`${count('tag')} tag${count('tag') === 1 ? '' : 's'}`, count('cast') && `${count('cast')} silent cast`, count('day') && `${count('day')} script days`, count('synopsis') && `${count('synopsis')} synopses`, count('vfx') && `${count('vfx')} scene${count('vfx') === 1 ? '' : 's'} parked as VFX only`].filter(Boolean);
    notify?.(`AI breakdown applied to ${shown.length} scene${shown.length === 1 ? '' : 's'}: ${parts.join(', ')}. Undo (⌘Z) takes it all back.`, true);
    onClose();
  };

  const pick = (k: string, label: string, color?: string) => (
    <button type="button" key={k} className={`pick ${rejected.has(k) ? 'off' : ''}`} style={color ? { borderColor: color } : undefined} aria-pressed={!rejected.has(k)} title={rejected.has(k) ? 'Left out: click to include' : 'Included: click to leave out'} onClick={() => toggle(k)}>{label}</button>
  );

  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget && stage !== 'running') close(); }}>
      <div className="modal-card aibd">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>AI breakdown · {scenes.length} scene{scenes.length === 1 ? '' : 's'}</h2>
          <button className="btn small" onClick={close}>{stage === 'running' ? 'Stop' : 'Close (Esc)'}</button>
        </div>

        {stage === 'intro' && <>
          <p className="help">The model reads each scene the way an AD and a line producer would and proposes the breakdown: every prop, vehicle, effect, stunt, makeup note and the rest under the board's categories, plus the story day, a one-line synopsis, cast who are on screen without speaking, and whether a scene is VFX only. You see all of it, with a tick box on each item, before any of it lands.</p>
          <p className="help"><b>What leaves your machine:</b> the text of {scenes.length === 1 ? 'this scene' : `these ${scenes.length} scenes`} (about {words.toLocaleString()} words), the cast list and the tag names the run has used, sent to Anthropic in {batches.length} request{batches.length === 1 ? '' : 's'} with your key and billed to you. The budget, the deal, your look book and the rest of the project stay here.</p>
          {!settings.key && <p className="help">Paste your own Anthropic key to turn this on (keys are at console.anthropic.com). It lives in this browser only, never in the project file, and it's the same key the Pitch tab's AI assist uses.</p>}
          <AiKeyFields settings={settings} onChange={setSettings} />
          {!scenes.length && <p className="warn">No scene on this board has script text to read. Drop the script (.fdx, .pdf, .fountain or .txt) and merge it into the board first.</p>}
          <label className="small" style={{ display: 'block', margin: '8px 0' }}><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> Replace the tags on {scenes.length === 1 ? 'this scene' : 'these scenes'} instead of adding to them (cast is never removed; Undo brings the old tags back)</label>
          <div className="row"><button className="btn primary" disabled={!settings.key || !scenes.length} onClick={() => void go(0, [])}>Read {scenes.length === 1 ? 'the scene' : `${scenes.length} scenes`}</button></div>
        </>}

        {stage === 'running' && <>
          {!error && <p>Reading scenes {batches[run][0].number}–{batches[run][batches[run].length - 1].number}{batches.length > 1 ? ` (run ${run + 1} of ${batches.length})` : ''}…</p>}
          <progress max={batches.length} value={error ? run : run + 0.5} style={{ width: '100%' }} />
          {error && <>
            <p className="warn">{error}</p>
            <div className="row">
              <button className="btn primary small" onClick={() => void go(run, done)}>Try that run again</button>
              {done.length > 0 && <button className="btn small" onClick={() => { setRejected(new Set(done.filter(t => t.vfxOnly).map(t => pickKey.vfx(t.sceneId)))); setStage('review'); }}>Review the {done.length} scene{done.length === 1 ? '' : 's'} read so far</button>}
            </div>
          </>}
        </>}

        {stage === 'review' && <>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="small" style={{ flex: 1 }}>{ticked.length} of {allKeys.length} ticked: {count('tag')} tags, {count('cast')} silent cast, {count('day')} script days, {count('synopsis')} synopses, {count('vfx')} VFX only. {replace ? 'Each scene below gets exactly the ticked tags; what it has now is replaced.' : 'Only what is new is shown; tags the scenes already have stay.'}</span>
            <button className="btn small" onClick={() => setMany(allKeys, true)}>Tick all</button>
            <button className="btn small" onClick={() => setMany(allKeys, false)}>Untick all</button>
            <button className="btn primary small" disabled={!ticked.length && !replace} onClick={apply}>Apply to the board</button>
          </div>
          <div className="aibd-list">
            {shown.map(x => {
              const { t, scene, view } = x; const keys = keysOf(x);
              if (!keys.length) return null;
              const on = keys.filter(k => !rejected.has(k)).length;
              return (
                <div className="aibd-scene" key={t.sceneId}>
                  <label className="aibd-head"><input type="checkbox" checked={on === keys.length} ref={el => { if (el) el.indeterminate = on > 0 && on < keys.length; }} onChange={e => setMany(keys, e.target.checked)} /> <b>Scene {scene.number}</b> <span className="muted">{[scene.ie, scene.set, scene.tod].filter(Boolean).join(' ')}</span></label>
                  {t.scriptDay && t.scriptDay !== scene.scriptDay && <div className="tagrow"><span className="tagcat">Script day</span>{pick(pickKey.day(t.sceneId), `Day ${t.scriptDay}`)}{scene.scriptDay && <span className="muted small">now {scene.scriptDay}</span>}</div>}
                  {t.synopsis && t.synopsis !== scene.synopsis && <div className="tagrow"><span className="tagcat">Synopsis</span>{pick(pickKey.synopsis(t.sceneId), t.synopsis)}</div>}
                  {t.vfxOnly && !scene.unit && <div className="tagrow"><span className="tagcat">Unit</span>{pick(pickKey.vfx(t.sceneId), "VFX only: off the first unit's days")}</div>}
                  {view.cast.length > 0 && <div className="tagrow"><span className="tagcat" style={{ color: 'var(--plum)' }}>Silent cast</span>{view.cast.map(n => pick(pickKey.cast(t.sceneId, n), n, 'var(--plum)'))}</div>}
                  {Object.entries(view.elements).map(([k, items]) => (
                    <div className="tagrow" key={k}><span className="tagcat" style={{ color: categoryColor(k) }}>{k}</span>{items.map(it => pick(pickKey.tag(t.sceneId, k, it), it, categoryColor(k)))}</div>
                  ))}
                  {replace && Object.values(scene.elements).flat().length > 0 && <p className="muted small">Replaces: {Object.values(scene.elements).flat().join(', ')}</p>}
                </div>
              );
            })}
            {!allKeys.length && <p className="muted">Nothing new: the scenes already carry everything the model found.</p>}
          </div>
        </>}
      </div>
    </div>
  );
}
