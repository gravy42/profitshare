import { useState } from 'react';
import type { ProjectMeta } from '../store';
import { money } from './format';

export interface StartActions {
  onBlank: (opts: { name: string; version: string; shootDays: number; chartOfAccounts: 'standard' | 'empty' }) => void;
  onImportBudget: () => void;
  onOpen: () => void;
  onSample: () => void;
  fresh?: boolean;          // nothing is open: the bare start screen
  projects: ProjectMeta[];  // every project this browser holds, newest save first
  activeId: string | null;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

const when = (iso: string) => {
  const d = new Date(iso); const now = Date.now(); const mins = Math.round((now - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '');
};

export function StartView({ onBlank, onImportBudget, onOpen, onSample, fresh, projects, activeId, onOpenProject, onDeleteProject }: StartActions) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('Draft 1');
  const [days, setDays] = useState(20);
  const [coa, setCoa] = useState<'standard' | 'empty'>('standard');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);   // the row whose × was pressed once
  return (
    <div>
      {projects.length > 0 && (
        <div className="panel projects">
          <h2>Projects in this browser</h2>
          <p className="help">Every project you start or open is kept here, each one autosaved on its own. Open one to switch; the one you leave stays as it was. Each browser tab keeps to the project it opened, so two tabs on two projects don't write over each other. A .json you Save is the copy that leaves this browser.</p>
          <table className="projlist">
            <thead><tr><th className="l">Project</th><th className="l">Version</th><th>Shoot days</th><th>Lines</th><th>Scenes</th><th>Budget to raise</th><th>Saved</th><th /></tr></thead>
            <tbody>
              {projects.map(m => {
                const open = m.id === activeId;
                return (
                  <tr key={m.id} className={open ? 'hl' : ''}>
                    <td className="l"><b>{m.name || 'Untitled'}</b>{open && <span className="muted small"> · open now</span>}</td>
                    <td className="l">{m.version}</td>
                    <td className="num">{m.shootDays}</td>
                    <td className="num">{m.lines}</td>
                    <td className="num">{m.scenes}</td>
                    <td className="num">{m.cashBudget ? money(m.cashBudget) : ''}</td>
                    <td className="num" title={new Date(m.savedAt).toLocaleString()}>{when(m.savedAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!open && <button className="btn small primary" onClick={() => onOpenProject(m.id)}>Open</button>}{' '}
                      {confirmDelete === m.id
                        ? <><button className="btn small" style={{ color: 'var(--bad)' }} onClick={() => { onDeleteProject(m.id); setConfirmDelete(null); }}>Delete for good</button> <button className="btn small" onClick={() => setConfirmDelete(null)}>Keep</button></>
                        : <button className="btn small ghost" title="Remove this project from the browser (a .json you saved is unaffected)" aria-label={`Delete ${m.name || 'Untitled'}`} onClick={() => setConfirmDelete(m.id)}>×</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel">
        <h2>{projects.length ? 'Start another' : 'Start a budget'}</h2>
        <p className="help">Three ways in. Whatever you pick becomes a new project in this browser{!fresh && <>; <b>the one you have open stays saved</b> and is listed above</>}. Nothing is uploaded anywhere.</p>
        <div className="grid3 start">
          <div className="card">
            <h3>From scratch</h3>
            <p>An empty budget with a standard feature chart of accounts (1100 Story &amp; Screenplay through 5200 General Expenses) and California payroll fringes. Add lines as you go.</p>
            <div className="row">
              <div className="ctl" style={{ flex: 1 }}><label>Title</label><input value={name} placeholder="Working title" onChange={e => setName(e.target.value)} /></div>
              <div className="ctl" style={{ minWidth: 90 }}><label>Version</label><input value={version} onChange={e => setVersion(e.target.value)} style={{ width: 90 }} /></div>
            </div>
            <div className="row">
              <div className="ctl"><label>Shoot days</label><input type="number" min={1} value={days} onChange={e => setDays(+e.target.value || 1)} style={{ width: 90 }} /></div>
              <div className="ctl"><label>Chart of accounts</label>
                <select value={coa} onChange={e => setCoa(e.target.value as any)}><option value="standard">Standard feature (274 accounts)</option><option value="empty">Empty, I'll build my own</option></select></div>
            </div>
            <button className="btn" onClick={() => onBlank({ name, version, shootDays: days, chartOfAccounts: coa })}>Start from scratch</button>
          </div>
          <div className="card">
            <h3>Import a budget</h3>
            <p>Drop what you already have onto the page, or pick it:</p>
            <ul>
              <li><b>Shamel Studio</b>: export as .xlsx. Everything comes in, fringes included.</li>
              <li><b>Movie Magic Budgeting</b>: export to Excel or CSV (File → Export). Columns are matched by their headers.</li>
              <li>Any spreadsheet with Account, Description, Amount, Units, X, Rate and Total columns.</li>
            </ul>
            <div className="droptarget"><b>Drop files anywhere on this page</b><span>or</span><button className="btn" onClick={onImportBudget}>Import .xlsx / .csv</button></div>
            <p className="small muted" style={{ marginTop: 8 }}>A .sex board, a script (.fdx, .pdf, .fountain or .txt) or a saved .json can be dropped too, together or one at a time. Movie Magic's native .mbd is a closed format; export first.</p>
          </div>
          <div className="card">
            <h3>Open or explore</h3>
            <p>Open a ProfitShare .json you saved earlier, or load the sample: <i>Salt Flat</i>, an invented 12-day, 26-scene SAG feature with a full budget and a board in shooting order. Every name and number in it is made up.</p>
            <div className="row">
              <button className="btn" onClick={onOpen}>Open .json</button>
              <button className="btn" onClick={onSample}>Load the sample</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
