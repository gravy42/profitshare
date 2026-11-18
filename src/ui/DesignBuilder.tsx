// Additions to the Design system box on the Pitch tab: font files for the title and body faces, the card colour, the
// paper the deck's cards are drawn on, and a deck style built from the film's own pictures. No network, no AI: the pictures are sampled on a canvas in this
// browser and the palette rules are plain arithmetic (src/engine/palette.ts).
import { useEffect, useId, useRef, useState } from 'react';
import type { FontFile, LookImage, PitchDesign, Project } from '../engine/types';
import { defaultDesign, withPitch } from '../engine/pitch';
import { DEFAULT_CARD, cardInkFor } from '../engine/deckData';
import { PAPERS } from '../engine/deckEdit';
import type { DeckData } from '../deck-runtime/data';
import { cleanPaper } from '../deck-runtime/paper';
import { mountDeck } from '../deck-runtime/runtime';
import deckCss from '../deck-runtime/deck.css?inline';
import { FONT_WARN_BYTES, dataUrlBytes, fileSize, readFontFiles, setFontFile } from '../engine/deckEdit';
import { TYPE_PAIRINGS, checkTheme, proposeThemes, quantize, rgbOf, type Proposal, type RGB, type ThemeCheck, type ThemeColors } from '../engine/palette';
import { cleanFamily } from '../deck-runtime/fonts';
import { pixelsOf, readFontFile } from './deckFiles';
import { plainColor } from './color';
import { goToPanel } from './jump';
import { roleFont, type RoleFont } from '../engine/googleFonts';
import { GoogleFontDetail, withoutRoleFont } from './GoogleFonts';

type Pitch = NonNullable<Project['pitch']>;
type SetPitch = (f: (x: Pitch) => Pitch) => void;
type SetDesign = (f: (x: PitchDesign) => PitchDesign) => void;

/** The colour of the pitch deck's cards, beside the design system's other colours. */
export function CardColor({ design: d, set }: { design: PitchDesign; set: SetDesign }) {
  const id = useId(), hint = useId();
  const card = typeof d.card === 'string' ? d.card : '';
  return (
    <div className="ctl"><label htmlFor={id}>Card</label>
      <span className="row" style={{ gap: 4 }}>
        <input id={id} type="color" aria-describedby={hint} value={/^#[0-9a-f]{6}$/i.test(card) ? card : DEFAULT_CARD} onChange={e => set(x => ({ ...x, card: e.target.value }))} />
        <input aria-label="Card, as a hex colour" value={card} placeholder={DEFAULT_CARD} style={{ width: 84 }} onChange={e => set(x => { const { card: _c, ...rest } = x; return e.target.value.trim() ? { ...rest, card: e.target.value.trim() } : rest; })} />
      </span>
      <div className="hint" id={hint}>the paper of the cards on the pitch deck</div>
    </div>
  );
}

// ---------- the paper the cards are drawn on ----------

type PaperName = NonNullable<PitchDesign['paper']>;
interface PaperLook { colors: { bg: string; ink: string; accent: string; accent2: string; muted: string }; card: string; title: string; body: string; hand: boolean; tilt: boolean }
/** One card on one paper, drawn by the deck's own runtime (the same code that draws the deck), so what is shown here
 *  is what a slide will show. A picture only: the name beside it says which paper it is. */
export function PaperThumb({ paper, look, title = 'A card', text = 'A line or two of text.' }: { paper: PaperName; look: PaperLook; title?: string; text?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const key = JSON.stringify([paper, look, title, text]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const card = plainColor(look.card, DEFAULT_CARD);
    const data: DeckData = {
      version: 1, film: '', coverLine: '', images: [], recipients: [], currency: 'USD', legal: ' ',
      theme: { name: '', colors: { ...look.colors, card, cardInk: cardInkFor(card), line: look.colors.muted }, fonts: { title: look.title, body: look.body }, signoff: '', paper, ...(look.hand ? { hand: true } : {}), ...(look.tilt ? { tilt: true } : {}) },
      slides: [{ id: 'sample', layout: 'cards', cards: [{ id: 'sample', title, body: text }] }],
      paths: { cashBudget: 0, deferred: 0, sources: [], waterfall: { model: 'off-the-gross', recoupPct: 0, poolPct: 0, grossSharePct: 0 }, cases: [], feePct: 0 },
    };
    try { const h = mountDeck(el, data, { css: deckCss, stacked: false, motion: false, swatch: true }); return () => h.destroy(); }
    catch { return undefined; }   // a sample that cannot be drawn is an empty box, never a broken page
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="paperthumb" ref={host} aria-hidden="true" />;
}

const lookOf = (d: PitchDesign): PaperLook => {
  const base = defaultDesign(); const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const col = (k: keyof PaperLook['colors']) => plainColor(text(d.colors?.[k]), base.colors[k]);
  return { colors: { bg: col('bg'), ink: col('ink'), accent: col('accent'), accent2: col('accent2'), muted: col('muted') }, card: text(d.card) || DEFAULT_CARD, title: text(d.fonts?.title), body: text(d.fonts?.body), hand: d.hand === true, tilt: d.tilt === true };
};

/** The paper every card on the pitch deck is drawn on (a slide can still choose its own), whether titles on the
 *  papers are handwritten, and whether the cards sit a little off straight. */
export function PaperChooser({ design: d, set }: { design: PitchDesign; set: SetDesign }) {
  const name = useId(), hint = useId();
  const chosen = cleanPaper(d.paper), look = lookOf(d);
  const flag = (k: 'hand' | 'tilt', on: boolean) => set(x => { const { [k]: _old, ...rest } = x; return (on ? { ...rest, [k]: true } : rest) as PitchDesign; });
  return (
    <div className="paperpick">
      <fieldset aria-describedby={hint}>
        <legend className="ctl-label">Paper for cards</legend>
        <div className="paperpick-row" style={{ backgroundColor: look.colors.bg }}>
          {PAPERS.map(p => (
            <label key={p.id} className="paperopt" title={p.about} style={{ color: look.colors.ink }}>
              <input type="radio" name={name} value={p.id} checked={chosen === p.id} onChange={() => set(x => { const { paper: _p, ...rest } = x; return (p.id === 'plain' ? rest : { ...rest, paper: p.id }) as PitchDesign; })} />
              <PaperThumb paper={p.id} look={look} />
              <span className="paperopt-name">{p.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="hint" id={hint}>What the cards on the pitch deck are drawn on: the cover's title, rows of cards, a quote, the card beside the team. Any slide can choose a paper of its own, or a mix.</p>
      <div className="pd-checks">
        <label><input type="checkbox" checked={d.hand === true} onChange={e => flag('hand', e.target.checked)} /> Handwriting on the papers</label>
        <label><input type="checkbox" checked={d.tilt === true} onChange={e => flag('tilt', e.target.checked)} /> Tilt the cards a little</label>
      </div>
      <p className="hint">Handwriting sets card titles, their small labels and quotes in a handwriting font (Caveat, which the deck carries). Longer text, numbers and small print stay as they are.</p>
    </div>
  );
}

// ---------- font files ----------

const ROLES: { role: FontFile['role']; label: string }[] = [{ role: 'title', label: 'Title font file' }, { role: 'body', label: 'Body font file' }];

/** One font file a role, attached from the filmmaker's own machine. */
export function FontFiles({ design, set }: { design: PitchDesign; set: SetDesign }) {
  const files = readFontFiles(design.fontFiles);
  const [problem, setProblem] = useState('');
  const patch = (id: string, f: Partial<FontFile>) => set(x => ({ ...x, fontFiles: readFontFiles(x.fontFiles).map(y => (y.id === id ? { ...y, ...f } : y)) }));
  const remove = (role: FontFile['role']) => set(x => withoutRoleFont(x, role));   // a role's font is one attached file, or every file of a family picked from Google Fonts
  const attach = async (role: FontFile['role'], file: File) => {
    setProblem('');
    try { const read = await readFontFile(file, role); set(x => ({ ...x, fontFiles: setFontFile(x.fontFiles, read) })); }
    catch (e) { setProblem((e as Error).message); }
  };
  return (
    <div className="fontfiles">
      <h3>Font files</h3>
      <p className="help">If your title or body font is not on every computer, attach the file and the pitch deck carries it. It takes .woff2, .woff, .ttf and .otf, one file for each. A font picked from Google Fonts (the buttons under the font names above) is listed here too. The font is saved with your project file.</p>
      {ROLES.map(({ role, label }) => { const font = roleFont(files, role); return <FontRow key={role} role={role} label={label} file={files.find(f => f.role === role)} google={font?.google ? font : undefined} onAttach={attach} onPatch={patch} onRemove={remove} />; })}
      <div role="status" aria-live="polite">{problem && <p className="pd-bad small">✕ {problem}</p>}</div>
    </div>
  );
}

function FontRow({ role, label, file, google, onAttach, onPatch, onRemove }: { role: FontFile['role']; label: string; file?: FontFile; google?: RoleFont; onAttach: (role: FontFile['role'], f: File) => void; onPatch: (id: string, f: Partial<FontFile>) => void; onRemove: (role: FontFile['role']) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const nameId = useId(), tickId = useId(), nameNote = useId();
  const bytes = file ? dataUrlBytes(file.dataUrl) : 0;
  const missing = !!file && !file.dataUrl.startsWith('data:');
  const unnamed = !!file && !cleanFamily(file.family);
  return (
    <div className="fontrow" data-role={role}>
      <div className="row">
        <b className="fontrow-label">{google ? label.replace(/ file$/, '') : label}</b>
        <button type="button" className="btn small" onClick={() => input.current?.click()}>{google ? 'Use a file of my own instead' : file ? 'Replace the file' : 'Attach a font file'}</button>
        <input ref={input} type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" hidden aria-label={label} onChange={e => { const f = e.target.files?.[0]; if (f) onAttach(role, f); e.target.value = ''; }} />
        {file && <button type="button" className="btn small" aria-label={google ? `Remove ${google.family}` : undefined} onClick={() => onRemove(role)}>Remove</button>}
        {!file && <span className="hint">None attached: the deck uses the font typed above.</span>}
      </div>
      {google && <GoogleFontDetail font={google} />}
      {file && !google && (
        <div className="fontrow-detail">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="ctl fontrow-name"><label htmlFor={nameId}>Name of the font</label>
              <input id={nameId} value={file.family} aria-invalid={unnamed || undefined} aria-describedby={unnamed ? nameNote : undefined} onChange={e => onPatch(file.id, { family: e.target.value })} onBlur={e => onPatch(file.id, { family: cleanFamily(e.target.value) })} /></div>
            <span className="small">{missing ? 'The file is missing from this browser. Attach it again.' : fileSize(bytes)}</span>
          </div>
          {unnamed && <p className="pd-bad small" id={nameNote}>✕ Give the font a name (letters, digits, spaces and hyphens), or the deck cannot use it.</p>}
          {bytes > FONT_WARN_BYTES && <p className="pd-bad small">This file is {fileSize(bytes)}. A deck that carries it will be slow to send and to open; a .woff2 of the same font is usually much smaller.</p>}
          <label className="small fontrow-tick" htmlFor={tickId}><input id={tickId} type="checkbox" checked={file.embedOk === true} onChange={e => onPatch(file.id, { embedOk: e.target.checked })} />
            <span>I am allowed to send this font inside the deck (free fonts such as open-licence ones: yes; fonts bought for one computer: check the licence). Unticked, people you send it to see the standard font instead.</span></label>
          <p className="hint">{file.embedOk ? 'The deck you send will carry this font.' : 'Not ticked: you see the font in the preview on this page, and nobody else does.'}</p>
        </div>
      )}
    </div>
  );
}

// ---------- a deck style from pictures ----------

const COLOR_FIELDS: { k: keyof ThemeColors; label: string; word: string }[] = [
  { k: 'bg', label: 'Background', word: 'Ground' }, { k: 'ink', label: 'Text', word: 'Text' }, { k: 'accent', label: 'Accent', word: 'Accent' },
  { k: 'accent2', label: 'Second accent', word: 'Second' }, { k: 'muted', label: 'Muted', word: 'Muted' }, { k: 'card', label: 'Card', word: 'Card' },
];
const MAX_PICKED = 6;
const one = (n: number) => `${n.toFixed(1)} to 1`;

/** What a colour's check says, in words: the ratio when it passes; what is wrong and which way to move it when it does not. */
function checkWords(row: ThemeCheck): string {
  const figures = `${one(row.ratio)}; it needs ${row.min} to 1`;
  if (row.pass) return `${row.on}: ${one(row.ratio)}. Passes (needs ${row.min} to 1).`;
  if (row.key === 'bg') return `The card and the background are too alike to tell apart: change one of them (${figures}).`;
  if (row.key === 'card') return `The card's own text is too faint on it: make the card ${row.fix || 'lighter'} (${figures}).`;
  return `Too faint against the background: make it ${row.fix || 'lighter'} (${figures}).`;
}

/** A small picture of a slide in a palette: a headline, a line in each accent, a card on the deck's paper. Decoration; the swatches under it carry the names. */
function MiniSlide({ c, title, body, film, paper, hand }: { c: ThemeColors; title: string; body: string; film: string; paper: PaperName; hand: boolean }) {
  return (
    <div className="minislide" aria-hidden="true" style={{ backgroundColor: plainColor(c.bg, '#000000'), color: plainColor(c.ink, '#ffffff'), fontFamily: body }}>
      <div className="ms-eyebrow" style={{ color: plainColor(c.accent2, 'inherit') }}>The opportunity</div>
      <div className="ms-title" style={{ fontFamily: title }}>{film || 'The film'}</div>
      <div className="ms-punch" style={{ fontFamily: title, color: plainColor(c.accent, 'inherit') }}>and why now.</div>
      <div className="ms-row">
        <div className="ms-paper"><PaperThumb paper={paper} title="A card" text="On your paper." look={{ colors: { bg: plainColor(c.bg, '#000000'), ink: plainColor(c.ink, '#ffffff'), accent: plainColor(c.accent, '#ffffff'), accent2: plainColor(c.accent2, '#ffffff'), muted: plainColor(c.muted, '#ffffff') }, card: plainColor(c.card, DEFAULT_CARD), title, body, hand, tilt: false }} /></div>
        <div className="ms-note" style={{ color: plainColor(c.muted, 'inherit') }}>A source, in small print</div>
      </div>
    </div>
  );
}

export function PaletteBuilder({ project, setPitch, onClose }: { project: Project; setPitch: SetPitch; onClose: () => void }) {
  const pitch = withPitch(project).pitch!;
  const pictures = (Array.isArray(pitch.lookbook) ? pitch.lookbook : []).filter((i): i is LookImage => !!i && typeof i === 'object' && typeof i.id === 'string' && typeof i.dataUrl === 'string' && i.dataUrl.startsWith('data:'));
  const [pickedAll, setPicked] = useState<string[]>([]);
  const picked = pickedAll.filter(id => pictures.some(i => i.id === id));   // a picture deleted from the look book is no longer chosen
  const [photo, setPhoto] = useState<{ name: string; pixels: RGB[] } | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [choice, setChoice] = useState<Proposal['id'] | null>(null);
  const [colors, setColors] = useState<ThemeColors | null>(null);
  const [pairing, setPairing] = useState(TYPE_PAIRINGS[0].id);
  const [name, setName] = useState('');
  const [inUse, setInUse] = useState<Proposal['id'] | null>(null);
  const [before, setBefore] = useState<{ design: PitchDesign | undefined } | null>(null);   // the look that was there before the last save, to put back
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId(), pairId = useId();
  const pair = TYPE_PAIRINGS.find(t => t.id === pairing) ?? TYPE_PAIRINGS[0];

  // sample whatever is chosen, a moment after the last change
  const pickedKey = picked.join('|');
  useEffect(() => {
    if (pickedAll.length !== picked.length) setPicked(picked);
    const chosen = pictures.filter(i => picked.includes(i.id));
    if (!chosen.length && !photo) { setProposals([]); setChoice(null); setColors(null); setInUse(null); setStatus(''); return; }
    let gone = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const px: RGB[] = photo ? [...photo.pixels] : [];
        for (const img of chosen) px.push(...await pixelsOf(img.dataUrl));
        if (gone) return;
        const found = proposeThemes(quantize(px, 8));
        const n = chosen.length + (photo ? 1 : 0);
        setProposals(found);
        setChoice(null); setColors(null); setInUse(null);
        setStatus(!found.length ? 'Nothing could be read from those pictures.'
          : `${found.length} looks from ${n} picture${n === 1 ? '' : 's'}. Pick one to adjust it.${found[0].suggestedAccent ? ' These pictures have almost no colour, so the accent is a suggestion of ours: change it to any colour you like.' : ''}`);
      } catch { if (!gone) { setProposals([]); setStatus('Those pictures could not be read.'); } }
      finally { if (!gone) setBusy(false); }
    }, 150);
    return () => { gone = true; clearTimeout(t); };
  }, [pickedKey, photo]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (img: LookImage) => setPicked(picked.includes(img.id) ? picked.filter(x => x !== img.id) : picked.length >= MAX_PICKED ? picked : [...picked, img.id]);
  const takePhoto = async (f: File) => {
    setStatus('');
    if (!/^image\//.test(f.type)) { setStatus(`${f.name} is not a picture.`); return; }
    try { const pixels = await pixelsOf(f); if (!pixels.length) throw new Error('empty'); setPhoto({ name: f.name, pixels }); }
    catch { setStatus(`${f.name} could not be read. Try a JPEG or a PNG.`); }
  };
  const choose = (p: Proposal) => { setChoice(p.id); setColors({ ...p.colors }); if (!name.trim()) setName(`${project.name || 'My film'} ${p.label.toLowerCase()}`); };
  const checks = colors ? checkTheme(colors) : [];
  const failing = checks.filter(r => !r.pass).length;
  const save = () => {
    if (!colors || !choice) return;
    const had = pitch.design; const base = defaultDesign();
    const changed = !!had && ((had.name ?? '').trim() !== '' || JSON.stringify(had.colors) !== JSON.stringify(base.colors) || !!had.card || !!had.fonts?.title || !!had.fonts?.body);
    if (changed && !window.confirm('Change the deck\'s colours and fonts to this look? Your logo and font files are kept.')) return;
    setBefore({ design: had });
    setPitch(x => {
      const d = x.design ?? defaultDesign();
      const { line: _line, ...rest } = d;   // the old hairline colour belonged to the old palette
      return { ...x, design: { ...rest, name: name.trim() || `${project.name || 'My film'} look`, colors: { bg: colors.bg, ink: colors.ink, accent: colors.accent, accent2: colors.accent2, muted: colors.muted }, card: colors.card, fonts: { title: pair.title, body: pair.body } } };
    });
    setInUse(choice);
    setStatus('Saved. The pitch deck is now drawn in this look.');
  };
  const putBack = () => {
    if (!before) return;
    const old = before.design;
    setPitch(x => { const { design: _d, ...rest } = x; return old ? { ...rest, design: old } : (rest as Pitch); });
    setBefore(null); setInUse(null);
    setStatus('The old look is back.');
  };

  return (
    <div className="palette" id="palette-builder"
      onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={e => { const f = [...e.dataTransfer.files].find(x => /^image\//.test(x.type)); if (f) { e.preventDefault(); e.stopPropagation(); void takePhoto(f); } }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>Build one from my pictures</h3><button type="button" className="btn small" onClick={onClose}>Close</button></div>
      <p className="help">No brand book? Choose up to {MAX_PICKED} look book pictures, or drop one photo here: we pick deck colours from them and make sure the words stay readable. Your pictures stay on this computer.</p>
      {pictures.length > 0 ? (
        <ul className="thumbs" aria-label="Look book pictures to take colours from">
          {pictures.map((img, n) => {
            const on = picked.includes(img.id);
            return (
              <li key={img.id}>
                <button type="button" className="thumb" aria-pressed={on} disabled={!on && picked.length >= MAX_PICKED} onClick={() => toggle(img)}>
                  <img src={img.dataUrl} alt={(typeof img.caption === 'string' ? img.caption.trim() : '') || `Look book picture ${n + 1}`} />
                  <span className="thumb-mark">{on ? '✓ Chosen' : 'Choose'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="hint">The look book has no pictures yet. Add some above, or use one photo from your computer.</p>}
      <div className="row">
        <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>{photo ? 'Use another photo' : 'Use one photo from my computer'}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden aria-label="A photo to take colours from" onChange={e => { const f = e.target.files?.[0]; if (f) void takePhoto(f); e.target.value = ''; }} />
        {photo && <span className="chip">{photo.name}<button type="button" aria-label={`Leave out ${photo.name}`} onClick={() => setPhoto(null)}>×</button></span>}
        <span className="hint">The photo is only read for its colours; it is not added to the look book.</span>
      </div>
      <div role="status" aria-live="polite" className="small palette-status">{busy ? 'Reading the colours…' : status}</div>
      {(inUse || before) && (
        <div className="row palette-after">
          {inUse && <button type="button" className="btn small primary" onClick={() => goToPanel('deck')}>See it on the deck</button>}
          {before && <button type="button" className="btn small" onClick={putBack}>Put the old look back</button>}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="proposals" role="group" aria-label="Looks to choose from">
          {proposals.map(p => {
            const shown = choice === p.id && colors ? colors : p.colors;
            return (
              <button type="button" key={p.id} className="proposalcard" aria-pressed={choice === p.id} onClick={() => choose(p)}>
                <span className="proposal-name">{p.label}{inUse === p.id ? <span className="proposal-inuse">In use</span> : choice === p.id ? ' ✓' : ''}</span>
                <MiniSlide c={shown} title={pair.title} body={pair.body} film={project.name} paper={cleanPaper(pitch.design?.paper)} hand={pitch.design?.hand === true} />
                <span className="chips">{COLOR_FIELDS.map(f => <span className="chip-col" key={f.k}><i style={{ backgroundColor: plainColor(shown[f.k]) }} /><span>{f.word}</span></span>)}</span>
                <span className="pd-vh">{COLOR_FIELDS.map(f => `${f.label} ${shown[f.k]}`).join(', ')}</span>
              </button>
            );
          })}
        </div>
      )}

      {colors && (
        <div className="palette-edit">
          <h3>Adjust it</h3>
          <div className="palette-grid">
            {COLOR_FIELDS.map(f => {
              const row = checks.find(r => r.key === f.k)!;
              return <ColorField key={f.k} label={f.label} value={colors[f.k]} onChange={v => setColors(c => (c ? { ...c, [f.k]: v } : c))} note={checkWords(row)} pass={row.pass} />;
            })}
          </div>
          <p className="small" role="status" aria-live="polite">{failing === 0 ? 'Every colour passes: the deck shows them exactly as set.' : failing === 1 ? 'The deck will adjust this colour so it can be read, so it will not look exactly like this.' : 'The deck will adjust these colours so they can be read, so it will not look exactly like this.'}</p>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="ctl" style={{ flex: '1 1 260px' }}><label htmlFor={pairId}>Type</label>
              <select id={pairId} value={pairing} onChange={e => setPairing(e.target.value)}>{TYPE_PAIRINGS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              <div className="hint">These fonts work on every computer.</div></div>
            <div className="ctl" style={{ flex: '1 1 220px' }}><label htmlFor={nameId}>Name it</label><input id={nameId} value={name} placeholder={`${project.name || 'My film'} look`} onChange={e => setName(e.target.value)} /></div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn small primary" onClick={save}>Save as my deck style</button>
            <button type="button" className="btn small" onClick={() => { setChoice(null); setColors(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ColorField({ label, value, onChange, note, pass }: { label: string; value: string; onChange: (v: string) => void; note: string; pass: boolean }) {
  const id = useId(), noteId = useId();
  const real = !!rgbOf(value);
  const hex = real ? (value.replace('#', '').length === 3 ? `#${value.replace('#', '').split('').map(c => c + c).join('')}` : `#${value.replace('#', '')}`) : '#000000';
  return (
    <div className="ctl colorfield">
      <label htmlFor={id}>{label}</label>
      <span className="row" style={{ gap: 6 }}>
        <input id={id} type="color" value={hex.toLowerCase()} aria-describedby={noteId} onChange={e => onChange(e.target.value)} />
        <input value={value} aria-label={`${label}, as a hex colour`} aria-invalid={!real || !pass || undefined} aria-describedby={noteId} style={{ width: 92 }} onChange={e => onChange(e.target.value.trim())} />
      </span>
      <span id={noteId} className={`small ${pass && real ? '' : 'pd-bad'}`}>{!real ? '✕ That is not a colour (try #f0ebe6).' : `${pass ? '' : '✕ '}${note}`}</span>
    </div>
  );
}
