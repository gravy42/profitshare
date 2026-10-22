// The parts of the Pitch tab that feed the investor deck: AI assist (opt-in, your own key), the look book, the design
// system, research, the team and the ask. PitchView composes them.
import { useEffect, useRef, useState } from 'react';
import type { LookImage, PitchDesign, Project, ResearchItem, TeamMember } from '../engine/types';
import { withPitch, defaultDesign, newLookImage, newResearch, newTeamMember, LOOK_SECTIONS, RESEARCH_KINDS, projectBytes } from '../engine/pitch';
import { aiSettings, saveAiSettings, forgetAi, listModels, ask, projectBrief, draftPrompt, SYSTEM, DEFAULT_MODEL, type DraftWhat } from '../ai';

type SetProject = (f: (p: Project) => Project) => void;
type Pitch = NonNullable<Project['pitch']>;
export type SetPitch = (f: (x: Pitch) => Pitch) => void;

// ---------- AI assist ----------

/** Key and model, kept in this browser only. */
export function AiPanel({ onChange }: { onChange: (ready: boolean) => void }) {
  const [s, setS] = useState(aiSettings());
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<string>('');
  const [open, setOpen] = useState(!s.key);
  useEffect(() => { onChange(!!s.key); }, [s.key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next: typeof s) => { setS(next); saveAiSettings(next); };
  const test = async () => {
    setStatus('Checking…');
    try { const ms = await listModels(s.key); setModels(ms); setStatus(`Key works. ${ms.length} models available.`); if (ms.length && !ms.some(m => m.id === s.model)) save({ ...s, model: ms[0].id }); }
    catch (e) { setStatus(`That key did not work: ${(e as Error).message}`); }
  };
  return (
    <details className="panel ai" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><h2>AI assist</h2><span className="small muted">{s.key ? `on · ${s.model}` : 'off: paste your own Anthropic key to turn it on'}</span></summary>
      <p className="help">Optional. With a key, every text box on this tab gets a <b>Draft</b> button that writes a first pass from what the project already knows: the logline and case so far, the budget figures, the schedule, the deal, the comps, the research. The key lives in this browser only, never in the project file. When you press Draft, a brief of the film (a few hundred words of your pitch and numbers, no images) is sent to Anthropic and nothing else leaves your machine. Keys are at console.anthropic.com; usage is billed to you.</p>
      <div className="row">
        <div className="ctl" style={{ flex: 1, minWidth: 260 }}><label>Anthropic API key</label><input type="password" value={s.key} placeholder="sk-ant-…" autoComplete="off" onChange={e => save({ ...s, key: e.target.value.trim() })} /></div>
        <div className="ctl" style={{ minWidth: 220 }}><label>Model</label>
          {models.length
            ? <select value={s.model} onChange={e => save({ ...s, model: e.target.value })}>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            : <input value={s.model} placeholder={DEFAULT_MODEL} onChange={e => save({ ...s, model: e.target.value.trim() })} />}
        </div>
        <button className="btn small" disabled={!s.key} onClick={test}>Test the key</button>
        {s.key && <button className="btn small ghost" onClick={() => { forgetAi(); setS({ key: '', model: DEFAULT_MODEL }); setModels([]); setStatus('Forgotten.'); }}>Forget the key</button>}
      </div>
      {status && <p className="small" style={{ marginTop: 6 }}>{status}</p>}
    </details>
  );
}

/** A Draft button for one text box: asks, shows the proposal, Use or Discard. */
export function Draft({ what, project, extra, onUse, ready, label = 'Draft' }: { what: DraftWhat; project: Project; extra?: string; onUse: (text: string) => void; ready: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState('');
  if (!ready) return null;
  const go = async () => {
    setBusy(true); setErr(''); setText(null);
    try { setText(await ask(SYSTEM, draftPrompt(what, projectBrief(project), extra))); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <span className="draft">
      <button type="button" className="btn small" disabled={busy} onClick={go} title="Write a first pass from what the project knows. You decide whether to use it.">{busy ? 'Drafting…' : label}</button>
      {err && <span className="small warn"> {err}</span>}
      {text != null && (
        <div className="proposal">
          <textarea rows={Math.min(14, Math.max(3, text.split('\n').length + 1))} value={text} onChange={e => setText(e.target.value)} />
          <div className="row"><button type="button" className="btn small primary" onClick={() => { onUse(text); setText(null); }}>Use it</button><button type="button" className="btn small" onClick={() => setText(null)}>Discard</button><span className="hint">A draft, not a fact. Edit before it goes anywhere.</span></div>
        </div>
      )}
    </span>
  );
}

// ---------- images ----------

/** Resize to at most `max` px on the long side and return a JPEG data URL, so twenty pictures stay a few MB, not fifty. */
export async function resizeImage(file: File, max = 1600, quality = 0.82): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c.toDataURL('image/jpeg', quality);
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

export function LookBookPanel({ project, setPitch }: { project: Project; setPitch: SetPitch }) {
  const pitch = withPitch(project).pitch!;
  const imgs = pitch.lookbook ?? [];
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<LookImage['section']>('tone');
  const bytes = projectBytes(project);
  const add = async (files: FileList | File[]) => {
    const list = [...files].filter(f => /^image\//.test(f.type));
    if (!list.length) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of list) urls.push(await resizeImage(f));
      setPitch(x => ({ ...x, lookbook: [...(x.lookbook ?? []), ...urls.map(u => newLookImage(u, section))] }));
    } finally { setBusy(false); }
  };
  const patch = (id: string, f: Partial<LookImage>) => setPitch(x => ({ ...x, lookbook: (x.lookbook ?? []).map(i => i.id === id ? { ...i, ...f } : i) }));
  const move = (id: string, dir: -1 | 1) => setPitch(x => { const a = [...(x.lookbook ?? [])]; const i = a.findIndex(y => y.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, lookbook: a }; });
  return (
    <div className="panel lookbook" onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file' && /^image\//.test(i.type))) { e.preventDefault(); e.stopPropagation(); } }} onDrop={e => { const fs = [...e.dataTransfer.files].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); e.stopPropagation(); void add(fs); } }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Look book</h2>
        <span className="row" style={{ gap: 8 }}>
          <select value={section} onChange={e => setSection(e.target.value as LookImage['section'])} title="Which part of the deck new pictures go to">{LOOK_SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Adding…' : 'Add pictures'}</button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files) void add(e.target.files); e.target.value = ''; }} />
        </span>
      </div>
      <p className="help">Stills, references, frames, the poster comp: the film in pictures. Drop images here (or Add pictures); each is resized to 1600 px and kept inside the project, so the .json carries the whole pitch. The deck gives each section a slide of up to four pictures with their captions. {bytes > 3_500_000 && <b className="warn">The project is {mb(bytes)}; the browser keeps about 5 MB a site, so Save the .json and keep the look book under twenty pictures.</b>}</p>
      {imgs.length === 0 && <div className="droptarget"><b>Drop pictures here</b></div>}
      <div className="lookgrid">
        {imgs.map((img, i) => (
          <figure key={img.id}>
            <img src={img.dataUrl} alt={img.caption} />
            <input value={img.caption} placeholder="caption" onChange={e => patch(img.id, { caption: e.target.value })} />
            <div className="row" style={{ gap: 4 }}>
              <select value={img.section} onChange={e => patch(img.id, { section: e.target.value as LookImage['section'] })}>{LOOK_SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              <input value={img.credit ?? ''} placeholder="credit" style={{ width: 90 }} onChange={e => patch(img.id, { credit: e.target.value })} />
              <button className="btn small" disabled={i === 0} onClick={() => move(img.id, -1)} aria-label="earlier">←</button>
              <button className="btn small" disabled={i === imgs.length - 1} onClick={() => move(img.id, 1)} aria-label="later">→</button>
              <button className="x" aria-label="remove picture" onClick={() => setPitch(x => ({ ...x, lookbook: (x.lookbook ?? []).filter(y => y.id !== img.id) }))}>×</button>
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

// ---------- design system ----------

export function DesignPanel({ project, setPitch }: { project: Project; setPitch: SetPitch }) {
  const d = withPitch(project).pitch!.design ?? defaultDesign();
  const set = (f: (x: PitchDesign) => PitchDesign) => setPitch(x => ({ ...x, design: f(x.design ?? defaultDesign()) }));
  const logoRef = useRef<HTMLInputElement>(null);
  const colors: { k: keyof PitchDesign['colors']; label: string }[] = [{ k: 'bg', label: 'Background' }, { k: 'ink', label: 'Text' }, { k: 'accent', label: 'Accent' }, { k: 'accent2', label: 'Second accent' }, { k: 'muted', label: 'Muted' }];
  return (
    <div className="panel design">
      <h2>Design system</h2>
      <p className="help">The look of the deck: your colours, your type, your mark. Fonts are CSS family names (a font has to be installed on the machine that prints the deck, or the deck's own fallback is used). The preview on the right is a slide corner.</p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        <div style={{ flex: '1 1 420px' }}>
          <div className="row">
            <div className="ctl" style={{ flex: 1 }}><label>System name</label><input value={d.name} placeholder="Alone Girl Universe" onChange={e => set(x => ({ ...x, name: e.target.value }))} /></div>
          </div>
          <div className="row">
            {colors.map(c => <div className="ctl" key={c.k}><label>{c.label}</label><span className="row" style={{ gap: 4 }}><input type="color" value={d.colors[c.k]} onChange={e => set(x => ({ ...x, colors: { ...x.colors, [c.k]: e.target.value } }))} /><input value={d.colors[c.k]} style={{ width: 84 }} onChange={e => set(x => ({ ...x, colors: { ...x.colors, [c.k]: e.target.value } }))} /></span></div>)}
          </div>
          <div className="row">
            <div className="ctl" style={{ flex: 1 }}><label>Title font</label><input value={d.fonts.title} placeholder='"Special Elite", monospace' onChange={e => set(x => ({ ...x, fonts: { ...x.fonts, title: e.target.value } }))} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Body font</label><input value={d.fonts.body} placeholder='"Work Sans", sans-serif' onChange={e => set(x => ({ ...x, fonts: { ...x.fonts, body: e.target.value } }))} /></div>
          </div>
          <div className="row">
            <div className="ctl"><label>Logo</label><span className="row" style={{ gap: 6 }}><button className="btn small" onClick={() => logoRef.current?.click()}>{d.logoDataUrl ? 'Replace' : 'Add a logo'}</button>{d.logoDataUrl && <button className="btn small ghost" onClick={() => set(x => { const { logoDataUrl: _l, ...rest } = x; return rest; })}>Remove</button>}</span>
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) { const u = await resizeImage(f, 600, 0.9); set(x => ({ ...x, logoDataUrl: u })); } e.target.value = ''; }} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Rules, in a sentence or two</label><input value={d.notes} placeholder="Night palette for the deck; gold only for numbers; the typewriter face for titles." onChange={e => set(x => ({ ...x, notes: e.target.value }))} /></div>
          </div>
        </div>
        <div className="swatch" style={{ background: d.colors.bg, color: d.colors.ink, fontFamily: d.fonts.body || undefined }}>
          {d.logoDataUrl && <img src={d.logoDataUrl} alt="" />}
          <div className="t" style={{ fontFamily: d.fonts.title || 'var(--font-title)', color: d.colors.accent }}>{project.name || 'The film'}</div>
          <div style={{ color: d.colors.accent2 }}>Why this film, why now</div>
          <div style={{ color: d.colors.muted }} className="small">{d.name || 'your design system'}</div>
        </div>
      </div>
    </div>
  );
}

// ---------- research, team, the ask ----------

export function ResearchPanel({ project, setPitch }: { project: Project; setPitch: SetPitch }) {
  const items = withPitch(project).pitch!.research ?? [];
  const patch = (id: string, f: Partial<ResearchItem>) => setPitch(x => ({ ...x, research: (x.research ?? []).map(r => r.id === id ? { ...r, ...f } : r) }));
  return (
    <div className="panel research">
      <h2>Research</h2>
      <p className="help">Market size, audience data, what a comp did and where, a press quote: anything you've found that an investor should see. Paste it in with where it came from; the deck gives research its own slides and the AI assist reads it when it drafts.</p>
      {items.map(r => (
        <div className="item" key={r.id}>
          <div className="row">
            <select value={r.kind} onChange={e => patch(r.id, { kind: e.target.value as ResearchItem['kind'] })}>{RESEARCH_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
            <input className="l" style={{ flex: 1 }} value={r.title} placeholder="Finding, in one line" onChange={e => patch(r.id, { title: e.target.value })} />
            <input value={r.url ?? ''} placeholder="source url" style={{ width: 200 }} onChange={e => patch(r.id, { url: e.target.value })} />
            <button className="x" aria-label="remove" onClick={() => setPitch(x => ({ ...x, research: (x.research ?? []).filter(y => y.id !== r.id) }))}>×</button>
          </div>
          <textarea rows={3} value={r.body} placeholder="The detail: the number, the quote, what it means for this film." onChange={e => patch(r.id, { body: e.target.value })} />
        </div>
      ))}
      <button className="btn small" onClick={() => setPitch(x => ({ ...x, research: [...(x.research ?? []), newResearch()] }))}>Add a finding</button>
    </div>
  );
}

export function TeamPanel({ project, setPitch }: { project: Project; setPitch: SetPitch }) {
  const team = withPitch(project).pitch!.team ?? [];
  const patch = (id: string, f: Partial<TeamMember>) => setPitch(x => ({ ...x, team: (x.team ?? []).map(t => t.id === id ? { ...t, ...f } : t) }));
  return (
    <div className="panel team">
      <h2>The team</h2>
      {team.map(t => (
        <div className="item" key={t.id}>
          <div className="row">
            <input className="l" value={t.name} placeholder="Name" style={{ width: 200 }} onChange={e => patch(t.id, { name: e.target.value })} />
            <input className="l" value={t.role} placeholder="Role" style={{ width: 200 }} onChange={e => patch(t.id, { role: e.target.value })} />
            <button className="x" aria-label="remove" onClick={() => setPitch(x => ({ ...x, team: (x.team ?? []).filter(y => y.id !== t.id) }))}>×</button>
          </div>
          <textarea rows={2} value={t.bio} placeholder="Two or three sentences an investor needs." onChange={e => patch(t.id, { bio: e.target.value })} />
        </div>
      ))}
      <button className="btn small" onClick={() => setPitch(x => ({ ...x, team: [...(x.team ?? []), newTeamMember()] }))}>Add a person</button>
    </div>
  );
}
