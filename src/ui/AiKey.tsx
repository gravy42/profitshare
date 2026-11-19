// The Anthropic key and model, in one place for every tab that offers AI assist. Kept in this browser only.
import { useState } from 'react';
import { longDate } from '../engine/sag';
import {
  aiSettings,
  saveAiSettings,
  forgetAi,
  listModels,
  knownModels,
  modelsFetchedOn,
  rememberModels,
  newestSuitable,
  resolveModel,
  DEFAULT_MODEL,
  type AiModel,
  type AiSettings,
} from '../ai';

/** Key, model, Test and Forget. The owner keeps the settings; this saves them as they change. */
export function AiKeyFields({ settings: s, onChange }: { settings: AiSettings; onChange: (s: AiSettings) => void }) {
  const [models, setModels] = useState<AiModel[]>(knownModels);
  const [status, setStatus] = useState('');
  const [fetchedOn, setFetchedOn] = useState(modelsFetchedOn);
  // Saving works out again which model a request will use, so every tab shows the same one.
  const save = (next: { key: string; picked: string }) => {
    if (next.key !== s.key) {
      setModels([]); // another key has another list
      setFetchedOn('');
    }
    saveAiSettings(next);
    onChange(aiSettings());
  };
  // Test and Refresh make the same request. The list is remembered so the choice survives a reload, which means it
  // only changes when one of these is pressed: Anthropic adds and retires models, so the list can go out of date.
  const fetchList = async (refresh: boolean) => {
    setStatus(refresh ? 'Fetching the list again…' : 'Checking…');
    try {
      const ms = await listModels(s.key);
      rememberModels(ms);
      setModels(ms);
      setFetchedOn(modelsFetchedOn());
      onChange(aiSettings());
      setStatus(
        refresh ? `List refreshed. ${ms.length} models available.` : `Key works. ${ms.length} models available.`,
      );
    } catch (e) {
      setStatus(
        refresh
          ? `The list could not be refreshed: ${(e as Error).message} The list you had is kept.`
          : `That key did not work: ${(e as Error).message}`,
      );
    }
  };
  const test = () => fetchList(false);
  const auto = models.length ? newestSuitable(models) : '';
  const { note } = resolveModel(s.picked, models);
  const kept = !!s.picked && models.some(m => m.id === s.picked);
  return (
    <>
      <div className="row">
        <div className="ctl" style={{ flex: 1, minWidth: 260 }}>
          <label>Anthropic API key</label>
          <input
            type="password"
            value={s.key}
            placeholder="sk-ant-…"
            autoComplete="off"
            onChange={e => save({ key: e.target.value.trim(), picked: s.picked })}
          />
        </div>
        <div className="ctl" style={{ minWidth: 220 }}>
          <label>Model</label>
          {models.length ? (
            <select value={kept ? s.picked : ''} onChange={e => save({ key: s.key, picked: e.target.value })}>
              <option value="">Newest for this key: {models.find(m => m.id === auto)?.name ?? auto}</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={s.picked}
              placeholder={DEFAULT_MODEL}
              onChange={e => save({ key: s.key, picked: e.target.value.trim() })}
            />
          )}
        </div>
        <button className="btn small" disabled={!s.key} onClick={test}>
          Test the key
        </button>
        {s.key && models.length > 0 && (
          <button
            className="btn small ghost"
            aria-label="Refresh the list of models from Anthropic"
            onClick={() => fetchList(true)}
          >
            Refresh the list
          </button>
        )}
        {s.key && (
          <button
            className="btn small ghost"
            onClick={() => {
              forgetAi();
              onChange(aiSettings());
              setModels([]);
              setStatus('Forgotten.');
            }}
          >
            Forget the key
          </button>
        )}
      </div>
      <p className="help small" style={{ marginTop: 6 }}>
        Your key is kept in this browser, not encrypted, and is sent only to Anthropic when you press an AI button. Use
        a key with a spending limit.
      </p>
      {models.length > 0 && (
        <p className="help small" style={{ marginTop: 6 }}>
          {fetchedOn ? `The model list is from ${longDate(fetchedOn)}.` : 'The model list is from an earlier visit.'}{' '}
          Refresh the list brings in models Anthropic has added since, and drops the ones it has retired.
        </p>
      )}
      {note && (
        <p className="small" role="status" style={{ marginTop: 6 }}>
          {note}
        </p>
      )}
      {status && (
        <p className="small" style={{ marginTop: 6 }}>
          {status}
        </p>
      )}
    </>
  );
}
