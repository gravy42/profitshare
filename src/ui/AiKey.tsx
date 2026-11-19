// The Anthropic key and model, in one place for every tab that offers AI assist. Kept in this browser only.
import { useState } from 'react';
import { aiSettings, saveAiSettings, forgetAi, listModels, knownModels, rememberModels, newestSuitable, resolveModel, DEFAULT_MODEL, type AiModel, type AiSettings } from '../ai';

/** Key, model, Test and Forget. The owner keeps the settings; this saves them as they change. */
export function AiKeyFields({ settings: s, onChange }: { settings: AiSettings; onChange: (s: AiSettings) => void }) {
  const [models, setModels] = useState<AiModel[]>(knownModels);
  const [status, setStatus] = useState('');
  // Saving works out again which model a request will use, so every tab shows the same one.
  const save = (next: { key: string; picked: string }) => {
    if (next.key !== s.key) setModels([]);   // another key has another list
    saveAiSettings(next); onChange(aiSettings());
  };
  const test = async () => {
    setStatus('Checking…');
    try { const ms = await listModels(s.key); rememberModels(ms); setModels(ms); onChange(aiSettings()); setStatus(`Key works. ${ms.length} models available.`); }
    catch (e) { setStatus(`That key did not work: ${(e as Error).message}`); }
  };
  const auto = models.length ? newestSuitable(models) : '';
  const { note } = resolveModel(s.picked, models);
  const kept = !!s.picked && models.some(m => m.id === s.picked);
  return (
    <>
      <div className="row">
        <div className="ctl" style={{ flex: 1, minWidth: 260 }}><label>Anthropic API key</label><input type="password" value={s.key} placeholder="sk-ant-…" autoComplete="off" onChange={e => save({ key: e.target.value.trim(), picked: s.picked })} /></div>
        <div className="ctl" style={{ minWidth: 220 }}><label>Model</label>
          {models.length
            ? <select value={kept ? s.picked : ''} onChange={e => save({ key: s.key, picked: e.target.value })}>
                <option value="">Newest for this key: {models.find(m => m.id === auto)?.name ?? auto}</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            : <input value={s.picked} placeholder={DEFAULT_MODEL} onChange={e => save({ key: s.key, picked: e.target.value.trim() })} />}
        </div>
        <button className="btn small" disabled={!s.key} onClick={test}>Test the key</button>
        {s.key && <button className="btn small ghost" onClick={() => { forgetAi(); onChange(aiSettings()); setModels([]); setStatus('Forgotten.'); }}>Forget the key</button>}
      </div>
      <p className="help small" style={{ marginTop: 6 }}>Your key is kept in this browser, not encrypted, and is sent only to Anthropic when you press an AI button. Use a key with a spending limit.</p>
      {note && <p className="small" role="status" style={{ marginTop: 6 }}>{note}</p>}
      {status && <p className="small" style={{ marginTop: 6 }}>{status}</p>}
    </>
  );
}
