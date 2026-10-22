// The parts of the Pitch tab that feed the investor deck: AI assist (opt-in, your own key), the look book, the design
// system, research, the team and the ask. PitchView composes them.
import { useEffect, useRef, useState } from 'react';
import type { LookImage, PitchDesign, Project, ResearchItem, TeamMember } from '../engine/types';
import { withPitch, defaultDesign, defaultDeckRules, newLookImage, newResearch, newTeamMember, LOOK_SECTIONS, RESEARCH_KINDS, projectBytes } from '../engine/pitch';
import { parseBrandText, applyBrand } from '../engine/brand';
import { pdfText, pdfPages } from './brandPdf';
import { aiSettings, saveAiSettings, forgetAi, listModels, ask, projectBrief, draftPrompt, SYSTEM, DEFAULT_MODEL, aiDocs, addAiDoc, removeAiDoc, draftWholePitch, type AiDoc, type DraftWhat, type WholePitch } from '../ai';
import { newSection } from '../engine/pitch';

type SetProject = (f: (p: Project) => Project) => void;
type Pitch = NonNullable<Project['pitch']>;
export type SetPitch = (f: (x: Pitch) => Pitch) => void;

// ---------- AI assist ----------

/** Key and model, kept in this browser only. */
export function AiPanel({ onChange, project, setPitch }: { onChange: (ready: boolean) => void; project: Project; setPitch: SetPitch }) {
  const [s, setS] = useState(aiSettings());
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<string>('');
  const [open, setOpen] = useState(!s.key);
  const [docs, setDocs] = useState<AiDoc[]>([]);
  const [docStatus, setDocStatus] = useState('');
  const docRef = useRef<HTMLInputElement>(null);
  const [whole, setWhole] = useState<WholePitch | null>(null);
  const [drafting, setDrafting] = useState(false);
  useEffect(() => { void aiDocs().then(setDocs); }, []);
  useEffect(() => { onChange(!!s.key); }, [s.key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const addDoc = async (f: File) => { setDocStatus('Keeping…'); try { await addAiDoc(f); setDocs(await aiDocs()); setDocStatus(''); } catch (e) { setDocStatus((e as Error).message); } };
  const draftAll = async () => {
    setDrafting(true); setStatus('');
    try { setWhole(await draftWholePitch(project)); }
    catch (e) { setStatus(`Could not draft: ${(e as Error).message}`); }
    finally { setDrafting(false); }
  };
  const useWhole = (w: WholePitch) => {
    setPitch(x => ({ ...x,
      logline: w.logline || x.logline, why: w.why || x.why,
      audience: { primary: w.audience[0] || x.audience.primary, secondary: w.audience[1] || x.audience.secondary, notes: w.audience[2] || x.audience.notes },
      sections: w.sections.length ? w.sections.map(sec => ({ ...newSection(sec.heading), body: sec.body })) : x.sections,
      ask: w.ask || x.ask }));
    setWhole(null);
  };
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
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
      <h3 style={{ margin: '14px 0 4px' }}>Documents the AI reads</h3>
      <p className="help">Your look book, a treatment, an old deck: PDFs the model reads alongside the brief every time it drafts, so the logline, the story and the style come from your own pages. They stay in this browser only (not in the project file) and go to Anthropic with each Draft, so keep them to what you'd hand an investor. Up to about 30 MB and 100 pages each.</p>
      <div className="row" style={{ alignItems: 'center' }}>
        {docs.map(d => <span className="chip" key={d.id}>{d.name} <span className="muted small">{mb(d.size)}</span><button title="forget this document" aria-label={`Forget ${d.name}`} onClick={async () => { await removeAiDoc(d.id); setDocs(await aiDocs()); }}>×</button></span>)}
        <button className="btn small" onClick={() => docRef.current?.click()}>Add a PDF</button>
        <input ref={docRef} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void addDoc(f); e.target.value = ''; }} />
        {docStatus && <span className="small warn">{docStatus}</span>}
      </div>
      <h3 style={{ margin: '14px 0 4px' }}>Draft the whole pitch</h3>
      <p className="help">One pass over everything written on this tab: the logline, why this film, the three audience boxes, three to five sections of the case, and the ask, from the brief and the documents above. You see it all before any of it lands.</p>
      <div className="row"><button className="btn small primary" disabled={!s.key || drafting} onClick={draftAll}>{drafting ? 'Drafting…' : 'Draft the whole pitch'}</button></div>
      {whole && (
        <div className="proposal whole">
          <h4>Logline</h4><p>{whole.logline}</p>
          <h4>Why this film, why now</h4>{whole.why.split(/\n{2,}/).map((x, i) => <p key={i}>{x}</p>)}
          <h4>Who it's for</h4><p><b>Primary.</b> {whole.audience[0]}</p><p><b>Secondary.</b> {whole.audience[1]}</p><p><b>How we reach them.</b> {whole.audience[2]}</p>
          {whole.sections.map((sec, i) => <div key={i}><h4>{sec.heading}</h4>{sec.body.split(/\n{2,}/).map((x, j) => <p key={j}>{x}</p>)}</div>)}
          <h4>The ask</h4><p>{whole.ask}</p>
          <div className="row"><button className="btn small primary" onClick={() => useWhole(whole)}>Use all of it</button><button className="btn small" onClick={() => setWhole(null)}>Discard</button><span className="hint">It replaces what is in those boxes (the sections too, when it wrote any). Undo (⌘Z) brings the old text back; edit everything before it goes anywhere.</span></div>
        </div>
      )}
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
  const [bad, setBad] = useState('');
  const add = async (files: FileList | File[]) => {
    const list = [...files].filter(f => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return;
    setBusy(true); setBad('');
    const failed: string[] = [];
    try {
      const urls: string[] = [];
      for (const f of list) {
        if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)) { failed.push(`${f.name} (HEIC: export it as JPEG from Photos first)`); continue; }
        try { urls.push(await resizeImage(f)); } catch { failed.push(f.name); }
      }
      if (urls.length) setPitch(x => ({ ...x, lookbook: [...(x.lookbook ?? []), ...urls.map(u => newLookImage(u, section))] }));
      if (failed.length) setBad(`Could not read ${failed.join(', ')}.`);
    } finally { setBusy(false); }
  };
  const pdfRef = useRef<HTMLInputElement>(null);
  const addPdf = async (f: File) => {
    setBusy(true); setBad('');
    try {
      const urls = await pdfPages(await f.arrayBuffer(), 1600, 40);
      setPitch(x => ({ ...x, lookbook: [...(x.lookbook ?? []), ...urls.map((u, i) => ({ ...newLookImage(u, section), caption: `${f.name.replace(/\.pdf$/i, '')} · page ${i + 1}` }))] }));
    } catch (e) { setBad(`Could not read ${f.name}: ${(e as Error).message}`); }
    finally { setBusy(false); }
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
          <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={e => { if (e.target.files) void add(e.target.files); e.target.value = ''; }} />
          <button className="btn small" disabled={busy} title="Every page of a PDF (a look book, a deck) as a picture" onClick={() => pdfRef.current?.click()}>Add the pages of a PDF</button>
          <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void addPdf(f); e.target.value = ''; }} />
        </span>
      </div>
      <p className="help">Stills, references, frames, the poster comp: the film in pictures. Drop images here (or Add pictures); each is resized to 1600 px. Pictures are kept in the browser's big store (as many as you like) and go inside the .json when you Save, so the file carries the whole pitch. The deck gives tone, the world and characters a slide of up to four pictures each with their captions; references stay with you. {bytes > 3_500_000 && <b className="warn">The project text alone is {mb(bytes)}; the browser keeps about 5 MB of it a site, so Save the .json.</b>}{bad && <b className="warn"> {bad}</b>}</p>
      {imgs.length === 0 && <div className="droptarget"><b>Drop pictures here</b></div>}
      <div className="lookgrid">
        {imgs.map((img, i) => (
          <figure key={img.id}>
            {img.dataUrl.startsWith('data:') ? <img src={img.dataUrl} alt={img.caption} /> : <div className="missing">{img.dataUrl ? 'loading…' : 'picture missing from this browser; it is still in any .json you saved'}</div>}
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
  const rules = d.deck ?? defaultDeckRules();
  const set = (f: (x: PitchDesign) => PitchDesign) => setPitch(x => ({ ...x, design: f(x.design ?? defaultDesign()) }));
  const setRules = (f: (r: NonNullable<PitchDesign['deck']>) => NonNullable<PitchDesign['deck']>) => set(x => ({ ...x, deck: f(x.deck ?? defaultDeckRules()) }));
  const logoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [withPages, setWithPages] = useState(false);
  const [status, setStatus] = useState('');
  const lookbook = withPitch(project).pitch!.lookbook ?? [];
  const loadPdf = async (f: File) => {
    setStatus('Reading…');
    try {
      const data = await f.arrayBuffer();
      const text = await pdfText(data.slice(0));
      const found = parseBrandText(text, f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '));
      set(x => applyBrand(x, found));
      let pages = 0;
      if (withPages) {
        const urls = await pdfPages(data.slice(0));
        pages = urls.length;
        setPitch(x => ({ ...x, lookbook: [...(x.lookbook ?? []), ...urls.map((u, i) => ({ ...newLookImage(u, 'reference'), caption: `${found.name || 'Brand system'} · page ${i + 1}` }))] }));
      }
      const roles = Object.entries(found.colors).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
      setStatus(`Read "${found.name}": ${found.swatches.length} named colours (${roles || 'no roles recognised, darkest as ground and lightest as ink'})${found.night && found.day ? '; night and day sets found, the deck takes night' : ''}${found.faces.length ? `; faces: ${found.faces.join(', ')}` : '; no type face recognised'}${pages ? `; ${pages} pages added to the look book as references` : ''}. Check the swatch and change anything it got wrong.`);
    } catch (e) { setStatus(`Could not read that PDF: ${(e as Error).message}`); }
  };
  const colors: { k: keyof PitchDesign['colors']; label: string }[] = [{ k: 'bg', label: 'Background' }, { k: 'ink', label: 'Text' }, { k: 'accent', label: 'Accent' }, { k: 'accent2', label: 'Second accent' }, { k: 'muted', label: 'Muted' }];
  return (
    <div className="panel design">
      <h2>Design system</h2>
      <p className="help">The look of the deck: your colours, your type, your mark, and how the slides are built. Fonts are CSS family names (a font has to be installed on the machine that prints the deck, or the deck's own fallback is used). The preview on the right is a slide corner.</p>
      <div className="row brandpdf">
        <button className="btn small" onClick={() => pdfRef.current?.click()}>Load a brand system PDF</button>
        <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void loadPdf(f); e.target.value = ''; }} />
        <label className="small"><input type="checkbox" checked={withPages} onChange={e => setWithPages(e.target.checked)} /> also add its pages to the look book as references</label>
        <span className="hint">Reads the colours by the role the page gives them (surface, ink, accent, signal, muted, line), a night set and a day set when there are both, and the type faces it names.</span>
      </div>
      {status && <p className="small" style={{ marginTop: 6 }}>{status}</p>}
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
          <h3 style={{ margin: '12px 0 4px' }}>Slides</h3>
          <div className="row">
            <div className="ctl"><label>Layout</label>
              <select value={rules.layout} onChange={e => setRules(r => ({ ...r, layout: e.target.value as 'split' | 'plain' }))}><option value="plain">Plain: text on the ground</option><option value="split">Split: a photo bleeds the left, text column right</option></select></div>
            {rules.layout === 'split' && <div className="ctl"><label>Photo takes</label><select value={rules.bleed} onChange={e => setRules(r => ({ ...r, bleed: +e.target.value }))}><option value={0.4}>40%</option><option value={0.5}>50%</option><option value={0.55}>55%</option><option value={0.6}>60%</option></select></div>}
            <div className="ctl"><label>Headings</label>
              <select value={rules.eyebrow ? 'eyebrow' : 'big'} onChange={e => setRules(r => ({ ...r, eyebrow: e.target.value === 'eyebrow' }))}><option value="big">Big title in the title face</option><option value="eyebrow">Eyebrow: small caps label ending in a colon</option></select></div>
          </div>
          <div className="row">
            <div className="ctl"><label>Cover picture</label><select value={rules.coverImageId ?? ''} onChange={e => setRules(r => ({ ...r, coverImageId: e.target.value || undefined }))}><option value="">none (title on the ground)</option>{lookbook.map((i, n) => <option key={i.id} value={i.id}>{i.caption || `picture ${n + 1}`}</option>)}</select></div>
            <div className="ctl"><label>Closing picture</label><select value={rules.closingImageId ?? ''} onChange={e => setRules(r => ({ ...r, closingImageId: e.target.value || undefined }))}><option value="">none</option>{lookbook.map((i, n) => <option key={i.id} value={i.id}>{i.caption || `picture ${n + 1}`}</option>)}</select></div>
            <div className="ctl" style={{ flex: 1 }}><label>Sign-off on the closing slide</label><input value={rules.signoff} placeholder={`from the world of ${project.name || 'the film'}`} onChange={e => setRules(r => ({ ...r, signoff: e.target.value }))} /></div>
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
