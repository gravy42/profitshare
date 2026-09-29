import { useState } from 'react';

export interface StartActions {
  onBlank: (opts: { name: string; shootDays: number; chartOfAccounts: 'standard' | 'empty' }) => void;
  onImportBudget: () => void;
  onOpen: () => void;
  onSample: () => void;
  armed: boolean;           // a second click is needed to replace the current project
}

export function StartView({ onBlank, onImportBudget, onOpen, onSample, armed }: StartActions) {
  const [name, setName] = useState('');
  const [days, setDays] = useState(20);
  const [coa, setCoa] = useState<'standard' | 'empty'>('standard');
  const confirm = armed ? 'Confirm: ' : '';
  return (
    <div>
      <div className="panel">
        <h2>Start a budget</h2>
        <p className="help">Three ways in. Whatever you pick, the project lives in this browser and in the .json you Save; nothing is uploaded anywhere.{armed && <b> You already have a project open: press a button twice to replace it (Save first if you want to keep it).</b>}</p>
        <div className="grid3 start">
          <div className="card">
            <h3>From scratch</h3>
            <p>An empty budget with a standard feature chart of accounts (1100 Story &amp; Screenplay through 5200 General Expenses) and California payroll fringes. Add lines as you go.</p>
            <div className="ctl"><label>Title</label><input value={name} placeholder="Working title" onChange={e => setName(e.target.value)} /></div>
            <div className="row">
              <div className="ctl"><label>Shoot days</label><input type="number" min={1} value={days} onChange={e => setDays(+e.target.value || 1)} style={{ width: 90 }} /></div>
              <div className="ctl"><label>Chart of accounts</label>
                <select value={coa} onChange={e => setCoa(e.target.value as any)}><option value="standard">Standard feature (272 accounts)</option><option value="empty">Empty, I'll build my own</option></select></div>
            </div>
            <button className={`btn ${armed ? 'primary' : ''}`} onClick={() => onBlank({ name, shootDays: days, chartOfAccounts: coa })}>{confirm}Start from scratch</button>
          </div>
          <div className="card">
            <h3>Import a budget</h3>
            <p>Drop what you already have onto the page, or pick it:</p>
            <ul>
              <li><b>Shamel Studio</b>: export as .xlsx. Everything comes in, fringes included.</li>
              <li><b>Movie Magic Budgeting</b>: export to Excel or CSV (File → Export). Columns are matched by their headers.</li>
              <li>Any spreadsheet with Account, Description, Amount, Units, X, Rate and Total columns.</li>
            </ul>
            <div className="droptarget"><b>Drop files anywhere on this page</b><span>or</span><button className={`btn ${armed ? 'primary' : ''}`} onClick={onImportBudget}>{confirm}Import .xlsx / .csv</button></div>
            <p className="small muted" style={{ marginTop: 8 }}>A .sex board, a script (.fdx, .pdf, .fountain or .txt) or a saved .json can be dropped too, together or one at a time. Movie Magic's native .mbd is a closed format; export first.</p>
          </div>
          <div className="card">
            <h3>Open or explore</h3>
            <p>Open a ProfitShare .json you saved earlier, or load the sample: <i>Salt Flat</i>, an invented 12-day, 26-scene SAG feature with a full budget and a board in shooting order. Every name and number in it is made up.</p>
            <div className="row">
              <button className={`btn ${armed ? 'primary' : ''}`} onClick={onOpen}>{confirm}Open .json</button>
              <button className={`btn ${armed ? 'primary' : ''}`} onClick={onSample}>{confirm}Load the sample</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
