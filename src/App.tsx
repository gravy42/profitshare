import { useEffect, useRef, useState } from 'react';
import { useProject, downloadJson, pickFile, hadSavedProject } from './store';
import { topSheet } from './engine/budget';
import { sagReport } from './engine/sag';
import { parseBudgetFile } from './engine/importers/budget';
import { parseSex } from './engine/importers/sex';
import { parseFdx } from './engine/importers/fdx';
import { parseScreenplayLines, parseScreenplayText } from './engine/importers/screenplay';
import { sampleProject, blankProject, deriveParticipants, standardChartOfAccounts, type BlankOptions } from './data/seed';
import type { Project } from './engine/types';
import { TopSheetView } from './ui/TopSheetView';
import { PointsView } from './ui/PointsView';
import { SagView } from './ui/SagView';
import { BoardView } from './ui/BoardView';
import { DealView } from './ui/DealView';
import { applyDeal, dealControlledIds, withDeal } from './engine/deal';
import { StartView } from './ui/StartView';
import { money } from './ui/format';

type Tab = 'start' | 'deal' | 'topsheet' | 'board' | 'points' | 'sag' | 'about';

export default function App() {
  const { project, setProject, undo, replace, canUndo } = useProject();
  const [hadSaved] = useState(hadSavedProject);
  const [tab, setTab] = useState<Tab>(hadSaved ? 'topsheet' : 'start');
  const [msg, setMsg] = useState<string | null>(null);
  const eff = applyDeal(project);                 // the budget with the deal terms applied; every view reads this
  const controlled = dealControlledIds(project, eff);
  const ts = topSheet(eff);
  const sag = sagReport(eff);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };

  // ---- file intake: one path for the buttons and for drag-and-drop ----
  type Kind = 'project' | 'budget' | 'board' | 'script' | 'mbd' | 'unknown';
  const kindOf = (name: string): Kind =>
    /\.json$/i.test(name) ? 'project' : /\.(xlsx|xls|csv|tsv)$/i.test(name) ? 'budget' : /\.(sex|fdx)$/i.test(name) ? 'board'
      : /\.(pdf|fountain|txt|text)$/i.test(name) ? 'script' : /\.mbd$/i.test(name) ? 'mbd' : 'unknown';
  // a .txt is a script if it has scene headings, otherwise a tab-separated budget export
  const sniff = async (f: File): Promise<Kind> => {
    const k = kindOf(f.name);
    if (k !== 'script' || !/\.(txt|text)$/i.test(f.name)) return k;
    return /^\s*(\d+[A-Z]?\s+)?(INT|EXT|I\/E)[.\s]/m.test(await f.text()) ? 'script' : 'budget';
  };

  const [pendingProject, setPendingProject] = useState<{ project: Project; name: string } | null>(null);
  const loadProjectFile = async (f: File) => {
    const p = withDeal(JSON.parse(await f.text()));
    if (p?.schemaVersion !== 1) throw new Error(`${f.name} is not a ProfitShare project`);
    const current = project;
    const empty = current.lines.length === 0 && current.board.scenes.length === 0;
    if (fresh || empty) { replace(p); setFresh(false); setTab('deal'); return `Opened ${f.name}`; }
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
    setTab('deal');
    return `${imp.lines.length} budget lines from ${f.name} (${via}${imp.reportedTotal ? `, file total ${money(imp.reportedTotal)}` : ''})${imp.warnings.length ? `. ${imp.warnings.length} note${imp.warnings.length > 1 ? 's' : ''}: ${imp.warnings.slice(0, 3).join('; ')}` : ''}`;
  };
  const loadBoardFile = async (f: File) => {
    const board = /\.fdx$/i.test(f.name) ? parseFdx(await f.text()) : parseSex(await f.arrayBuffer());
    setProject(p => ({ ...p, board }));
    setFresh(false);
    setTab('board');
    return `${board.scenes.length} scenes from ${f.name}${/\.fdx$/i.test(f.name) ? ' (script order; drag strips to build the shooting order)' : ' (board order kept)'}`;
  };
  /** A screenplay (PDF, Fountain, plain text) broken down into scenes, eighths and cast. */
  const loadScriptFile = async (f: File) => {
    const imp = /\.pdf$/i.test(f.name)
      ? parseScreenplayLines(await (await import('./engine/importers/pdfScript')).pdfScriptLines(await f.arrayBuffer()), { cueIndent: 90 })
      : parseScreenplayText(await f.text());
    if (!imp.board.scenes.length) throw new Error(`no scene headings found in ${f.name}${/\.pdf$/i.test(f.name) ? ' (a scanned PDF has no text to read; export the PDF from your writing app instead)' : ''}`);
    setProject(p => ({ ...p, board: imp.board, name: imp.title && (!p.name || /^untitled/i.test(p.name)) ? imp.title : p.name }));
    setFresh(false);
    setTab('board');
    const c = imp.board.castList.length;
    return `${imp.board.scenes.length} scenes, ${c} speaking part${c === 1 ? '' : 's'}, ${imp.pages} page${imp.pages === 1 ? '' : 's'} from ${f.name} (script order; drag strips to build the shooting order, and check the cast: silent characters only show when the script names them)`;
  };
  /** Take any mix of files, work out what each one is, and load it. Budgets before boards so cast days can link. */
  const intake = async (files: File[]) => {
    const order: Record<Kind, number> = { budget: 0, board: 1, script: 1, project: 2, mbd: 3, unknown: 3 };
    const kinds = new Map(await Promise.all(files.map(async f => [f, await sniff(f)] as const)));
    const sorted = [...files].sort((x, y) => order[kinds.get(x)!] - order[kinds.get(y)!]);
    const out: string[] = [];
    for (const f of sorted) {
      try {
        const k = kinds.get(f)!;
        if (k === 'project') out.push(await loadProjectFile(f));
        else if (k === 'budget') out.push(await loadBudgetFile(f));
        else if (k === 'board') out.push(await loadBoardFile(f));
        else if (k === 'script') out.push(await loadScriptFile(f));
        else if (k === 'mbd') out.push(`${f.name}: Movie Magic's native .mbd is a closed format. In Movie Magic Budgeting use File → Export to Excel or CSV and drop that instead.`);
        else out.push(`${f.name}: not a file type I know. Budgets: .xlsx .csv (Shamel, Movie Magic export, any sheet). Boards: .sex (Movie Magic Scheduling). Scripts: .fdx .pdf .fountain .txt. Projects: .json.`);
      } catch (e: any) { out.push(`${f.name}: ${e.message}`); }
    }
    flash(out.join(' · '));
  };
  const pick = async (accept: string) => { const f = await pickFile(accept); if (f) await intake([f]); };
  const openJson = () => pick('.json');
  const importBudget = () => pick('.xlsx,.xls,.csv,.txt,.tsv');
  const importBoard = () => pick('.sex,.fdx,.pdf,.fountain,.txt');

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
  const startBlank = (o: BlankOptions) => guard(() => { replace(blankProject(o)); setTab('deal'); flash('Blank budget ready. Set the terms here, then build lines on the Top sheet.'); });
  const startSample = () => guard(() => { replace(sampleProject()); setTab('deal'); flash('Sample project loaded: SALT FLAT, an invented 12-day feature. These are its terms; change any of them.'); });
  const startImport = () => guard(() => { replace(blankProject({ chartOfAccounts: 'empty' })); void importBudget(); });
  const startOpen = () => guard(() => void openJson());
  const copyJson = async () => {
    const text = JSON.stringify(project);
    try { await navigator.clipboard.writeText(text); flash('Project JSON copied to the clipboard'); }
    catch { flash('Clipboard blocked here; use Save instead'); }
  };

  return (
    <div className="app">
      {dragging && <div className="dropzone"><div><b>Drop to import</b><span>Budgets (.xlsx, .csv), boards (.sex), scripts (.fdx, .pdf, .fountain, .txt), saved projects (.json). Several at once is fine.</span></div></div>}
      <header className="top">
        <h1>ProfitShare</h1>
        <span className="proj">
          <input value={project.name} onChange={e => setProject(p => ({ ...p, name: e.target.value }))} /> {' '}
          <input value={project.version} style={{ width: 90 }} onChange={e => setProject(p => ({ ...p, version: e.target.value }))} />
        </span>
        <span className="spacer" />
        <span className="kpi">
          <span>Budget to raise<b>{money(ts.cashBudget)}</b></span>
          <span>Deal<b>{project.deal?.pay.model === 'everyone-at-scale' ? 'everyone at scale' : 'as budgeted'}</b></span>
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
          <button className="btn ghost" onClick={importBoard}>Import board or script (.sex / .fdx / .pdf)</button>
        </span>
      </header>
      <nav className="tabs">
        {([['start', 'Start'], ['deal', 'Deal'], ['topsheet', 'Top sheet & budget'], ['board', 'Stripboard'], ['points', 'Points & waterfall'], ['sag', 'SAG tier'], ['about', 'About']] as [Tab, string][]).map(([k, label]) =>
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
        {tab === 'deal' && <DealView raw={project} eff={eff} setProject={setProject} fresh={!hadSaved} />}
        {tab === 'topsheet' && <>
          {controlled.size > 0 && <div className="notice">{controlled.size} line{controlled.size > 1 ? 's are' : ' is'} set by the deal (marked <span className="tag points">deal</span>): rates, hours or pay type come from the Deal tab. Days and descriptions are still yours to edit.</div>}
          <TopSheetView project={eff} raw={project} controlled={controlled} setProject={setProject} />
        </>}
        {tab === 'board' && <BoardView project={eff} setProject={setProject} />}
        {tab === 'points' && <PointsView project={eff} setProject={setProject} />}
        {tab === 'sag' && <SagView project={eff} />}
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
        <p>Budgeting and scheduling software stops at the cash column. ProfitShare is built for films where part of everyone's pay is a share of the back end. Every budget line carries a pay type: <span className="tag cash">up front</span> is what you raise, <span className="tag deferred">deferred</span> is a fixed IOU, <span className="tag points">points</span> is contingent participation. The top sheet, the SAG tier check and the points schedule all update from the same lines.</p>
        <p><b>The Deal tab</b> holds every term (day length, SAG tier, pay model, premiums, floor rate for non-shoot days, grants, waterfall) as a layer over the raw budget. Nothing you imported is rewritten; every tab recomputes from budget plus terms, live, and any term can change at any time.</p>
        <p>The stripboard feeds the same model: place day breaks, and the day-out-of-days tells you each actor's work days, which you can push straight into the cast lines and the points schedule.</p>
        <p><b>Local-first.</b> Nothing leaves your browser. Autosave keeps your work in this browser; press Save to download a .json you can open anywhere or share with a collaborator, and Open to load one.</p>
        <p><b>Imports.</b> Budgets from Shamel Studio (.xlsx) and Movie Magic Budgeting (Excel or CSV export), or any spreadsheet with account, description, amount, rate and total columns. Boards from Movie Magic Scheduling (.sex, which Shamel also exports). Scripts from Final Draft (.fdx), Highland, Celtx, WriterDuet or any app that saves Fountain or plain text, and any screenplay PDF with real text in it (not a scan): scenes, eighths and speaking cast are read straight off the page.</p>
        <p><b>Rates.</b> SAG-AFTRA low-budget scale effective 7/1/2026, California payroll fringes as of 2026. Check them before you rely on them.</p>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onStart}>Start a new budget, import one, or load the sample</button>
      </div>
    </div>
  );
}
