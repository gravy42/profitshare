import { useEffect, useRef, useState } from 'react';
import { useProject, downloadJson, pickFile, hadSavedProject } from './store';
import { topSheet } from './engine/budget';
import { sagReport } from './engine/sag';
import { parseBudgetFile } from './engine/importers/budget';
import { parseSex } from './engine/importers/sex';
import { parseFdx } from './engine/importers/fdx';
import { sampleProject, blankProject, deriveParticipants, standardChartOfAccounts, type BlankOptions } from './data/seed';
import type { Project } from './engine/types';
import { TopSheetView } from './ui/TopSheetView';
import { PointsView } from './ui/PointsView';
import { SagView } from './ui/SagView';
import { BoardView } from './ui/BoardView';
import { StartView } from './ui/StartView';
import { money } from './ui/format';

type Tab = 'start' | 'topsheet' | 'board' | 'points' | 'sag' | 'about';

export default function App() {
  const { project, setProject, undo, replace, canUndo } = useProject();
  const [hadSaved] = useState(hadSavedProject);
  const [tab, setTab] = useState<Tab>(hadSaved ? 'topsheet' : 'start');
  const [msg, setMsg] = useState<string | null>(null);
  const ts = topSheet(project);
  const sag = sagReport(project);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };

  // ---- file intake: one path for the buttons and for drag-and-drop ----
  const kindOf = (name: string): 'project' | 'budget' | 'board' | 'mbd' | 'unknown' =>
    /\.json$/i.test(name) ? 'project' : /\.(xlsx|xls|csv|tsv|txt)$/i.test(name) ? 'budget' : /\.(sex|fdx)$/i.test(name) ? 'board' : /\.mbd$/i.test(name) ? 'mbd' : 'unknown';

  const [pendingProject, setPendingProject] = useState<{ project: Project; name: string } | null>(null);
  const loadProjectFile = async (f: File) => {
    const p = JSON.parse(await f.text());
    if (p?.schemaVersion !== 1) throw new Error(`${f.name} is not a ProfitShare project`);
    const current = project;
    const empty = current.lines.length === 0 && current.board.scenes.length === 0;
    if (fresh || empty) { replace(p); setFresh(false); setTab('topsheet'); return `Opened ${f.name}`; }
    setPendingProject({ project: p, name: f.name });
    return `${f.name} is ready; it will replace the project you have open.`;
  };
  const loadBudgetFile = async (f: File) => {
    const imp = parseBudgetFile(await f.arrayBuffer(), f.name, standardChartOfAccounts());
    setProject(p => {
      const { participants, lines } = deriveParticipants(imp.lines, imp.accounts, p.board, imp.shootDays || p.shootDays);
      return { ...p, name: imp.name || p.name, version: imp.version || p.version, shootDays: imp.shootDays || p.shootDays,
        categories: imp.categories, accounts: imp.accounts, fringes: imp.fringes, lines, participants };
    });
    setFresh(false);
    const via = imp.source === 'shamel' ? 'Shamel Studio' : 'spreadsheet';
    setTab('topsheet');
    return `${imp.lines.length} budget lines from ${f.name} (${via}${imp.reportedTotal ? `, file total ${money(imp.reportedTotal)}` : ''})${imp.warnings.length ? `. ${imp.warnings.length} note${imp.warnings.length > 1 ? 's' : ''}: ${imp.warnings.slice(0, 3).join('; ')}` : ''}`;
  };
  const loadBoardFile = async (f: File) => {
    const board = /\.fdx$/i.test(f.name) ? parseFdx(await f.text()) : parseSex(await f.arrayBuffer());
    setProject(p => ({ ...p, board }));
    setFresh(false);
    setTab('board');
    return `${board.scenes.length} scenes from ${f.name}${/\.fdx$/i.test(f.name) ? ' (script order; drag strips to build the shooting order)' : ' (board order kept)'}`;
  };
  /** Take any mix of files, work out what each one is, and load it. Budgets before boards so cast days can link. */
  const intake = async (files: File[]) => {
    const order = { budget: 0, board: 1, project: 2, mbd: 3, unknown: 3 };
    const sorted = [...files].sort((x, y) => order[kindOf(x.name)] - order[kindOf(y.name)]);
    const out: string[] = [];
    for (const f of sorted) {
      try {
        const k = kindOf(f.name);
        if (k === 'project') out.push(await loadProjectFile(f));
        else if (k === 'budget') out.push(await loadBudgetFile(f));
        else if (k === 'board') out.push(await loadBoardFile(f));
        else if (k === 'mbd') out.push(`${f.name}: Movie Magic's native .mbd is a closed format. In Movie Magic Budgeting use File → Export to Excel or CSV and drop that instead.`);
        else out.push(`${f.name}: not a file type I know. Budgets: .xlsx .csv (Shamel, Movie Magic export, any sheet). Boards: .sex (Movie Magic Scheduling). Scripts: .fdx. Projects: .json.`);
      } catch (e: any) { out.push(`${f.name}: ${e.message}`); }
    }
    flash(out.join(' · '));
  };
  const pick = async (accept: string) => { const f = await pickFile(accept); if (f) await intake([f]); };
  const openJson = () => pick('.json');
  const importBudget = () => pick('.xlsx,.xls,.csv,.txt,.tsv');
  const importBoard = () => pick('.sex,.fdx');

  // drag-and-drop anywhere on the page
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void intake(files);
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });

  // Replacing a project needs a second click, unless this browser had nothing saved and the user is still on the start screen.
  const [armed, setArmed] = useState(false);
  const [fresh, setFresh] = useState(!hadSaved);
  const guard = (go: () => void) => {
    if (fresh || armed) { setArmed(false); setFresh(false); go(); }
    else { setArmed(true); flash('Press the button again to replace the current project (Save first if you want to keep it).'); }
  };
  const startBlank = (o: BlankOptions) => guard(() => { replace(blankProject(o)); setTab('topsheet'); flash('Blank budget ready. Open a category, then an account, and press + line.'); });
  const startSample = () => guard(() => { replace(sampleProject()); setTab('topsheet'); flash('Sample project loaded: SALT FLAT, an invented 12-day feature'); });
  const startImport = () => guard(() => { replace(blankProject({ chartOfAccounts: 'empty' })); void importBudget(); });
  const startOpen = () => guard(() => void openJson());
  const copyJson = async () => {
    const text = JSON.stringify(project);
    try { await navigator.clipboard.writeText(text); flash('Project JSON copied to the clipboard'); }
    catch { flash('Clipboard blocked here; use Save instead'); }
  };

  return (
    <div className="app">
      {dragging && <div className="dropzone"><div><b>Drop to import</b><span>Budgets (.xlsx, .csv), boards (.sex), scripts (.fdx), saved projects (.json). Several at once is fine.</span></div></div>}
      <header className="top">
        <h1>ProfitShare</h1>
        <span className="proj">
          <input value={project.name} onChange={e => setProject(p => ({ ...p, name: e.target.value }))} /> {' '}
          <input value={project.version} style={{ width: 90 }} onChange={e => setProject(p => ({ ...p, version: e.target.value }))} />
        </span>
        <span className="spacer" />
        <span className="kpi">
          <span>Cash budget<b>{money(ts.cashBudget)}</b></span>
          <span>Points value<b>{money(ts.pointsValue)}</b></span>
          <span>SAG<b>{sag.qualifying.id}{sag.dic ? '+DIC' : ''}</b></span>
        </span>
        <span className="btns">
          <button className="btn ghost" onClick={undo} disabled={!canUndo}>Undo</button>
          <button className="btn ghost" onClick={() => { setArmed(false); setTab('start'); }}>New…</button>
          <button className="btn ghost" onClick={openJson}>Open</button>
          <button className="btn ghost" onClick={() => downloadJson(project)}>Save</button>
          <button className="btn ghost" onClick={copyJson} title="Copy the project as JSON (for places where downloads are blocked)">Copy JSON</button>
          <button className="btn ghost" onClick={importBudget} title="Shamel Studio .xlsx, Movie Magic Budgeting Excel/CSV export, or any sheet with Account / Description / Amount / Rate / Total columns">Import budget (.xlsx / .csv)</button>
          <button className="btn ghost" onClick={importBoard}>Import board (.sex / .fdx)</button>
        </span>
      </header>
      <nav className="tabs">
        {([['start', 'Start'], ['topsheet', 'Top sheet & budget'], ['board', 'Stripboard'], ['points', 'Points & waterfall'], ['sag', 'SAG tier'], ['about', 'About']] as [Tab, string][]).map(([k, label]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </nav>
      <main>
        {msg && <div className="notice">{msg}</div>}
        {pendingProject && (
          <div className="notice row">
            <span>Replace the open project with <b>{pendingProject.name}</b>? Save the current one first if you want to keep it.</span>
            <button className="btn primary small" onClick={() => { replace(pendingProject.project); setPendingProject(null); setTab('topsheet'); flash(`Opened ${pendingProject.name}`); }}>Replace</button>
            <button className="btn small" onClick={() => setPendingProject(null)}>Cancel</button>
          </div>
        )}
        {tab === 'start' && <StartView onBlank={startBlank} onImportBudget={startImport} onOpen={startOpen} onSample={startSample} armed={armed} />}
        {tab === 'topsheet' && <TopSheetView project={project} setProject={setProject} />}
        {tab === 'board' && <BoardView project={project} setProject={setProject} />}
        {tab === 'points' && <PointsView project={project} setProject={setProject} />}
        {tab === 'sag' && <SagView project={project} setProject={setProject} />}
        {tab === 'about' && <About onStart={() => setTab('start')} />}
        <footer>ProfitShare · open source, MIT · your data stays in this browser until you press Save · not legal, tax or financial advice</footer>
      </main>
    </div>
  );
}

function About({ onStart }: { onStart: () => void }) {
  return (
    <div className="panel">
      <h2>About ProfitShare</h2>
      <div className="help">
        <p>Budgeting and scheduling software stops at the cash column. ProfitShare is built for films where part of everyone's pay is a share of the back end. Every budget line carries a pay type: <span className="tag cash">cash</span> is what you raise, <span className="tag deferred">deferred</span> is a fixed IOU, <span className="tag points">points</span> is contingent participation. The top sheet, the SAG tier check and the points schedule all update from the same lines.</p>
        <p>The stripboard feeds the same model: place day breaks, and the day-out-of-days tells you each actor's work days, which you can push straight into the cast lines and the points schedule.</p>
        <p><b>Local-first.</b> Nothing leaves your browser. Autosave keeps your work in this browser; press Save to download a .json you can open anywhere or share with a collaborator, and Open to load one.</p>
        <p><b>Imports.</b> Budgets from Shamel Studio (.xlsx) and Movie Magic Budgeting (Excel or CSV export), or any spreadsheet with account, description, amount, rate and total columns. Boards from Movie Magic Scheduling (.sex, which Shamel also exports) and Final Draft scripts (.fdx).</p>
        <p><b>Rates.</b> SAG-AFTRA low-budget scale effective 7/1/2026, California payroll fringes as of 2026. Check them before you rely on them.</p>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onStart}>Start a new budget, import one, or load the sample</button>
      </div>
    </div>
  );
}
