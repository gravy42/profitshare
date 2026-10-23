// The Anthropic key and model, in one place for every tab that offers AI assist. Kept in this browser only.
import { useState } from 'react';
import { saveAiSettings, forgetAi, listModels, DEFAULT_MODEL, type AiSettings } from '../ai';

/** Key, model, Test and Forget. The owner keeps the settings; this saves them as they change. */
export function AiKeyFields({ settings: s, onChange }: { settings: AiSettings; onChange: (s: AiSettings) => void }) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState('');
  const save = (next: AiSettings) => { onChange(next); saveAiSettings(next); };
  const test = async () => {
    setStatus('Checking…');
    try { const ms = await listModels(s.key); setModels(ms); setStatus(`Key works. ${ms.length} models available.`); if (ms.length && !ms.some(m => m.id === s.model)) save({ ...s, model: ms[0].id }); }
    catch (e) { setStatus(`That key did not work: ${(e as Error).message}`); }
  };
  return (
    <>
      <div className="row">
        <div className="ctl" style={{ flex: 1, minWidth: 260 }}><label>Anthropic API key</label><input type="password" value={s.key} placeholder="sk-ant-…" autoComplete="off" onChange={e => save({ ...s, key: e.target.value.trim() })} /></div>
        <div className="ctl" style={{ minWidth: 220 }}><label>Model</label>
          {models.length
            ? <select value={s.model} onChange={e => save({ ...s, model: e.target.value })}>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            : <input value={s.model} placeholder={DEFAULT_MODEL} onChange={e => save({ ...s, model: e.target.value.trim() })} />}
        </div>
        <button className="btn small" disabled={!s.key} onClick={test}>Test the key</button>
        {s.key && <button className="btn small ghost" onClick={() => { forgetAi(); onChange({ key: '', model: DEFAULT_MODEL }); setModels([]); setStatus('Forgotten.'); }}>Forget the key</button>}
      </div>
      {status && <p className="small" style={{ marginTop: 6 }}>{status}</p>}
    </>
  );
}
