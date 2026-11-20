import { useState } from 'react';
import type { ProjectMeta } from '../store';
import { copyState, copyWords, type FileCopies } from '../fileCopies';
import { downloadAllProjects } from '../backups';
import { money } from './format';
import { StarterForm, type StarterSettings } from './StarterForm';

const FOLDED_KEY = 'profitshare.startFolded';
export type { StarterSettings } from './StarterForm';

interface StartActions {
  onBlank: (opts: { name: string; version: string; shootDays: number; chartOfAccounts: 'standard' | 'empty' }) => void;
  onImportBudget: () => void;
  onOpen: () => void;
  onSample: () => void;
  onScript: () => void; // pick a script and build a first budget around it
  starter: StarterSettings;
  setStarter: (s: StarterSettings) => void;
  fresh?: boolean; // nothing is open: the bare start screen
  projects: ProjectMeta[]; // every project this browser holds, newest save first
  activeId: string | null;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  copies?: FileCopies; // what is known about each project's copies in files
  onCopiesChanged?: () => void; // a download has just been noted
  now?: () => number; // the clock, for tests
}

const when = (iso: string) => {
  const d = new Date(iso);
  const now = Date.now();
  const mins = Math.round((now - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '')
  );
};

export function StartView({
  onBlank,
  onImportBudget,
  onOpen,
  onSample,
  onScript,
  starter,
  setStarter,
  fresh,
  projects,
  activeId,
  onOpenProject,
  onDeleteProject,
  copies = {},
  onCopiesChanged,
  now = Date.now,
}: StartActions) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('Draft 1');
  const [days, setDays] = useState(20);
  const [coa, setCoa] = useState<'standard' | 'empty'>('standard');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null); // the row whose × was pressed once
  // Folded or not is this browser's habit, not part of any project.
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLDED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const fold = (now: boolean) => {
    setFolded(now);
    try {
      if (now) localStorage.setItem(FOLDED_KEY, '1');
      else localStorage.removeItem(FOLDED_KEY);
    } catch {
      /* it still folds for this visit */
    }
  };
  const current = projects.find(m => m.id === activeId);
  // "Download all my projects": one press, one file, and a sentence saying where it went
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const downloadAll = async () => {
    setBusy(true);
    setSaid('');
    try {
      setSaid((await downloadAllProjects()).said);
    } catch (e) {
      console.error('The projects could not be downloaded', e);
      setSaid('The download did not go through. Open each project and press Save instead.');
    }
    setBusy(false);
    onCopiesChanged?.();
  };
  return (
    <div>
      {projects.length > 0 && (
        <details
          className="panel fold projects"
          open={!folded}
          onToggle={e => fold(!(e.target as HTMLDetailsElement).open)}
        >
          <summary>
            <h2>
              Projects in this browser{' '}
              <span className="hint">
                {projects.length === 1 ? '1 project' : `${projects.length} projects`}
                {folded && current ? ` · ${current.name || 'Untitled'} is open` : ''}
              </span>
            </h2>
          </summary>
          <p className="help">
            Every project you start or open is kept here, each one autosaved on its own. Open one to switch; the one you
            leave stays as it was. Each browser tab keeps to the project it opened, so two tabs on two projects don't
            write over each other. Projects are kept by this browser on this device, so clearing its site data or moving
            to another computer leaves them behind: a file you save is the copy that is safe.
          </p>
          <div className="row backup-all">
            <button type="button" className="btn" disabled={busy} onClick={() => void downloadAll()}>
              Download all my projects
            </button>
            <span className="help">
              {projects.length === 1
                ? 'Downloads this project as a .json file, the same file Save makes.'
                : 'Downloads one .zip with every project inside as its own .json file.'}{' '}
              To bring projects back, here or in another browser, press Open and pick the .zip or the files.
            </span>
          </div>
          <p className="backup-said" role="status" aria-live="polite">
            {said}
          </p>
          <table className="projlist">
            <thead>
              <tr>
                <th className="l">Project</th>
                <th className="l">Version</th>
                <th>Shoot days</th>
                <th>Lines</th>
                <th>Scenes</th>
                <th>Budget to raise</th>
                <th>Saved</th>
                <th className="l">Copy in a file</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {projects.map(m => {
                const open = m.id === activeId;
                return (
                  <tr key={m.id} className={open ? 'hl' : ''}>
                    <td className="l">
                      <b>{m.name || 'Untitled'}</b>
                      {open && <span className="muted small"> · open now</span>}
                    </td>
                    <td className="l">{m.version}</td>
                    <td className="num">{m.shootDays}</td>
                    <td className="num">{m.lines}</td>
                    <td className="num">{m.scenes}</td>
                    <td className="num">{m.cashBudget ? money(m.cashBudget) : ''}</td>
                    <td className="num" title={new Date(m.savedAt).toLocaleString()}>
                      {when(m.savedAt)}
                    </td>
                    <td
                      className={`l filecopy ${copyState(copies[m.id])}`}
                      title={copies[m.id]?.fileAt ? new Date(copies[m.id].fileAt!).toLocaleString() : undefined}
                    >
                      {copyWords(copies[m.id], now())}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!open && (
                        <button className="btn small primary" onClick={() => onOpenProject(m.id)}>
                          Open
                        </button>
                      )}{' '}
                      {confirmDelete === m.id ? (
                        <>
                          <button
                            className="btn small"
                            style={{ color: 'var(--bad)' }}
                            onClick={() => {
                              onDeleteProject(m.id);
                              setConfirmDelete(null);
                            }}
                          >
                            Delete for good
                          </button>{' '}
                          <button className="btn small" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn small ghost"
                          title="Remove this project from the browser (a .json you saved is unaffected)"
                          aria-label={`Delete ${m.name || 'Untitled'}`}
                          onClick={() => setConfirmDelete(m.id)}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
      <div className="panel">
        <h2>{projects.length ? 'Start another' : 'Start a budget'}</h2>
        <p className="help">
          Four ways in. Whatever you pick becomes a new project in this browser
          {!fresh && (
            <>
              ; <b>the one you have open stays saved</b> and is listed above
            </>
          )}
          . Nothing is uploaded anywhere.
        </p>
        <div className="grid3 start">
          <div className="card script">
            <h3>From a script</h3>
            <p>
              Only have the screenplay? Drop it here and ProfitShare breaks it down (scenes, eighths, cast, a first pass
              of tags), schedules it, and draws a first budget around it: a generic indie crew with prep and wrap, cast
              at SAG scale, department allowances, post, insurance and legal. Every line says how it was sized. It's a
              starting place, not a quote.
            </p>
            <StarterForm starter={starter} setStarter={setStarter} />
            <div className="droptarget">
              <b>Drop the script anywhere on this page</b>
              <span>or</span>
              <button className="btn primary" onClick={onScript}>
                Pick a script (.fdx / .pdf / .fountain / .txt)
              </button>
            </div>
          </div>
          <div className="card">
            <h3>From scratch</h3>
            <p>
              An empty budget with a standard feature chart of accounts (1100 Story &amp; Screenplay through 5200
              General Expenses) and California payroll fringes. Add lines as you go.
            </p>
            <div className="row">
              <div className="ctl" style={{ flex: 1 }}>
                <label>Title</label>
                <input value={name} placeholder="Working title" onChange={e => setName(e.target.value)} />
              </div>
              <div className="ctl" style={{ minWidth: 90 }}>
                <label>Version</label>
                <input value={version} onChange={e => setVersion(e.target.value)} style={{ width: 90 }} />
              </div>
            </div>
            <div className="row">
              <div className="ctl">
                <label>Shoot days</label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={e => setDays(+e.target.value || 1)}
                  style={{ width: 90 }}
                />
              </div>
              <div className="ctl">
                <label>Chart of accounts</label>
                <select value={coa} onChange={e => setCoa(e.target.value as any)}>
                  <option value="standard">Standard feature (274 accounts)</option>
                  <option value="empty">Empty, I'll build my own</option>
                </select>
              </div>
            </div>
            <button className="btn" onClick={() => onBlank({ name, version, shootDays: days, chartOfAccounts: coa })}>
              Start from scratch
            </button>
          </div>
          <div className="card">
            <h3>Import a budget</h3>
            <p>Drop what you already have onto the page, or pick it:</p>
            <ul>
              <li>
                <b>Shamel Studio</b>: export as .xlsx. Everything comes in, fringes included.
              </li>
              <li>
                <b>Movie Magic Budgeting</b>: export to Excel or CSV (File → Export). Columns are matched by their
                headers.
              </li>
              <li>Any spreadsheet with Account, Description, Amount, Units, X, Rate and Total columns.</li>
            </ul>
            <div className="droptarget">
              <b>Drop files anywhere on this page</b>
              <span>or</span>
              <button className="btn" onClick={onImportBudget}>
                Import .xlsx / .csv
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              A .sex board, a script (.fdx, .pdf, .fountain or .txt) or a saved .json can be dropped too, together or
              one at a time. Movie Magic Budgeting's own .mbd and .mmbx files cannot be read: export the budget as Tab
              Delimited first.
            </p>
          </div>
          <div className="card">
            <h3>Open or explore</h3>
            <p>
              Open a ProfitShare .json you saved earlier, or load the sample: <i>Salt Flat</i>, an invented 12-day,
              26-scene SAG feature with a full budget and a board in shooting order. Every name and number in it is made
              up.
            </p>
            <div className="row">
              <button className="btn" onClick={onOpen}>
                Open .json
              </button>
              <button className="btn" onClick={onSample}>
                Load the sample
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
