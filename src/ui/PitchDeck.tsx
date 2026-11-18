// The Pitch tab's deck builder: the slides in order, an editor for the one that is selected, the people the deck is
// sent to, and a live preview drawn by the deck's own runtime (the same code the file you send will run). Loaded on
// its own (React.lazy), so the runtime and its stylesheet are not in the app's first download.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LookImage, Project, Recipient, SlideCard, SlideLayout, SlideMilestone, SlideSpec, SlideStat } from '../engine/types';
import { withPitch } from '../engine/pitch';
import { ASK_NO_GRANTS, ASK_WITHOUT_GRANTS, ASK_WITH_GRANTS, MAX_CARDS, deckData, deckWarnings, defaultSlides, slugify, type DeckWarning } from '../engine/deckData';
import { deckChecks, type AiProblem } from '../engine/aiDeck';
import { PROMISE_TEXT, promiseOfReturns } from '../engine/promise';
import { pathFor } from '../engine/pathMath';
import { sponsorNet } from '../engine/waterfall';
import {
  FROM_BUDGET, LAYOUTS, PAPER_CHOICES, addCard, hasPaper, addSlide, deleteSlide, duplicateSlide, highlightChoices, layoutName, linkEndingProblem, linkProblemText, moveItem, moveSlide, moveSlideTo,
  neighbourId, newRecipient, nextItemId, patchSlide, readRecipients, readSlides, renameRecipient, setSlideHidden, slideLabel, validRecipients,
} from '../engine/deckEdit';
import type { DeckData } from '../deck-runtime/data';
import { fillAsk, mountDeck, type DeckHandle, type Lead } from '../deck-runtime/runtime';
import { money } from '../deck-runtime/format';
import deckCss from '../deck-runtime/deck.css?inline';
import { blobUrlOf } from './deckFiles';
import DeckSend from './DeckSend';
import { LESS_MOTION, Movement, PersonAssist, ReadMyDeck, SecondLine, kindLabel, type PersonContext, type ReadItem } from './DeckAssist';
import { fontsLeftOut } from '../engine/deckExport';
import { PANEL, UNDO_KEY, focusSoon, goToId, goToPanel, type PanelKey } from './jump';

type Pitch = NonNullable<Project['pitch']>;
type SetPitch = (f: (x: Pitch) => Pitch) => void;
/** Somewhere else in the app a note can send you: a panel on this tab, or another tab. */
type Place = { panel: PanelKey } | { tab: string };
type Go = (to: Place) => void;
interface Fit { id: string; words: number; fits: number | null }
interface Fix { slideId: string; message: string; where?: string }
interface Status { text: string; undo?: { reselect: string | null }; seq: number }

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** A slide's own label, unless it only repeats the layout's name ("The plan" on a Plan slide). */
const plain = (t: string) => t.trim().toLowerCase().replace(/^the\s+/, '');
const labelOf = (s: SlideSpec): string => { const l = slideLabel(s); return plain(l) === plain(layoutName(s.layout)) ? '' : l; };
const overflowText = (f: Fit | undefined): string =>
  `There is too much on this slide: it runs past the edge even at the smallest type size. ${f && f.fits ? `It has about ${f.words} words, and about ${f.fits} fit. Cut some` : 'Cut some text'}, or split it over two slides.`;

let remembered: string | null = null;   // the slide that was selected when the Pitch tab was last left (this session only)

export default function PitchDeck({ project, setPitch, onTab, onUndo, undoDepth = 0, ai = false }: { project: Project; setPitch: SetPitch; onTab?: (tab: string) => void; onUndo?: () => void; undoDepth?: number; ai?: boolean }) {
  const p = withPitch(project); const pitch = p.pitch!;
  const authored = readSlides(pitch.slides);
  const own = authored.length > 0;
  const slides = own ? authored : readSlides(defaultSlides(p));
  const today = useMemo(localDate, []);
  const [selectedId, setSelectedId] = useState<string | null>(() => remembered);
  const lastIndex = useRef(0);
  const found = slides.findIndex(s => s.id === selectedId);
  const selected: SlideSpec | undefined = found >= 0 ? slides[found] : slides[Math.min(lastIndex.current, slides.length - 1)];   // a slide that has gone (an undo, a delete): the one now in its place
  useEffect(() => { if (found >= 0) lastIndex.current = found; }, [found]);
  useEffect(() => { remembered = selected?.id ?? null; }, [selected?.id]);
  const [fits, setFits] = useState<Fit[]>([]);
  const [adding, setAdding] = useState(false);
  const warnings: DeckWarning[] = deckWarnings(p);
  const people = readRecipients(pitch.recipients);
  const sendable = validRecipients(pitch.recipients);
  const setSlides = (f: (s: SlideSpec[]) => SlideSpec[]) => setPitch(x => ({ ...x, slides: f(Array.isArray(x.slides) ? x.slides : []) }));
  const visible = slides.filter(s => !s.hidden);
  const numberOf = (id: string) => { const i = visible.findIndex(s => s.id === id); return i < 0 ? null : i + 1; };
  const nameOf = (s: SlideSpec) => `${layoutName(s.layout)}${labelOf(s) ? `, ${labelOf(s)}` : ''}`;
  const go: Go = to => { if ('panel' in to) goToPanel(to.panel); else onTab?.(to.tab); };

  // ---- what just happened, with a way back ----
  const [status, setStatus] = useState<Status | null>(null);
  const seq = useRef(0);
  const say = (text: string, undo?: { reselect: string | null }) => setStatus({ text, undo, seq: ++seq.current });
  // the Undo button takes back the last change to the project: it is offered only while that is still the thing the message is about
  const stamp = useRef<{ seq: number; depth: number; slides: unknown; recipients: unknown } | null>(null);
  useEffect(() => { if (status && stamp.current?.seq !== status.seq) stamp.current = { seq: status.seq, depth: undoDepth, slides: pitch.slides, recipients: pitch.recipients }; });
  const canUndoIt = !!status?.undo && !!onUndo && (stamp.current?.seq !== status.seq || (stamp.current.depth === undoDepth && stamp.current.slides === pitch.slides && stamp.current.recipients === pitch.recipients));
  useEffect(() => { if (!status) return; const t = window.setTimeout(() => setStatus(s => (s && s.seq === status.seq ? null : s)), status.undo ? 15000 : 8000); return () => window.clearTimeout(t); }, [status]);
  const undoIt = () => { if (!status?.undo || !onUndo) return; const back = status.undo.reselect; onUndo(); if (back) setSelectedId(back); say('Undone.'); };

  const build = () => {
    if (own && !window.confirm(`Rebuild the deck from what is on the Pitch tab? The ${slides.length} slide${slides.length === 1 ? '' : 's'} you have ${slides.length === 1 ? 'is' : 'are'} replaced. Undo (${UNDO_KEY}) brings ${slides.length === 1 ? 'it' : 'them'} back.`)) return;
    const built = defaultSlides(p);
    setPitch(x => ({ ...x, slides: built }));
    setSelectedId(built[0]?.id ?? null);
    say(`Your deck has ${built.length} slides. Every one of them is yours to edit.`, own ? { reselect: selected?.id ?? null } : undefined);
  };
  const move = (s: SlideSpec, dir: -1 | 1) => {
    const at = slides.findIndex(x => x.id === s.id), to = at + dir;
    if (to < 0 || to >= slides.length) return;
    setSlides(x => moveSlide(x, s.id, dir));
    say(`${nameOf(s)} moved ${dir < 0 ? 'up' : 'down'}, to place ${to + 1} of ${slides.length}.`, { reselect: s.id });
  };
  const drop = (id: string, overId: string, after: boolean) => {
    const from = slides.findIndex(x => x.id === id), t = slides.findIndex(x => x.id === overId);
    if (from < 0 || t < 0) return;
    const pos = t + (after ? 1 : 0), to = pos > from ? pos - 1 : pos;
    if (to === from) return;
    const target = slides[to].id;   // the slide whose place it takes, found again in the list as stored
    setSlides(x => moveSlideTo(x, id, x.findIndex(y => !!y && y.id === target)));
    say(`${nameOf(slides[from])} moved to place ${to + 1} of ${slides.length}.`, { reselect: id });
  };
  const add = (layout: SlideLayout) => {
    const before = selected?.id ?? null;
    const id = addSlide(pitch.slides, layout, before ?? undefined).id;   // the id the update below gives it: both read the same list
    setSlides(x => addSlide(x, layout, before ?? undefined).slides);
    setSelectedId(id); setAdding(false);
    say(`Added: ${layoutName(layout)}.`, { reselect: before });
    focusSoon('.pd-editor input:not([type="file"]):not([type="range"]), .pd-editor textarea');
  };
  const copy = (s: SlideSpec) => { const made = duplicateSlide(pitch.slides, s.id); if (!made.id) return; setSlides(x => duplicateSlide(x, s.id).slides); setSelectedId(made.id); say(`Copied ${nameOf(s)}. The copy is selected.`, { reselect: s.id }); };
  const remove = (s: SlideSpec) => { if (slides.length <= 1) return; const next = neighbourId(slides, s.id); setSlides(x => deleteSlide(x, s.id)); setSelectedId(next); say(`Deleted ${nameOf(s)}.`, { reselect: s.id }); };
  const hide = (s: SlideSpec) => { setSlides(x => setSlideHidden(x, s.id, !s.hidden)); say(s.hidden ? `${nameOf(s)} is back on the deck.` : `${nameOf(s)} is hidden: it stays in the list and is left off the deck.`, { reselect: s.id }); };

  const fixes: Fix[] = [
    ...warnings,
    ...fits.filter(f => visible.some(s => s.id === f.id)).map(f => ({ slideId: f.id, message: overflowText(f), where: 'overflow' })),
  ];
  const flagged = new Set(fixes.map(f => f.slideId));
  const openFix = (f: Fix) => {
    if (f.where?.startsWith('recipient:')) { goToId(PANEL.people); focusSoon(`#pd-slug-${f.where.slice(10)}`); return; }
    const s = slides.find(x => x.id === f.slideId);
    if (!s) { if (f.where === 'design') go({ panel: 'design' }); return; }
    setSelectedId(s.id);
    // the field the note is about, when the editor has it on show; else the top of the editor
    const field = !f.where || ['overflow', 'revenue', 'deal', 'other'].includes(f.where) ? '' : f.where === 'numbers' ? '[data-field="lead"], .pd-editor [data-field^="stat:"]' : `[data-field="${f.where.replace(/["\\]/g, '')}"]`;
    window.setTimeout(() => {
      const el = (field ? document.querySelector<HTMLElement>(`.pd-editor ${field}`) : null) ?? document.querySelector<HTMLElement>('.pd-editor h3');
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, 80);
  };
  /** The link a note starts with: the slide it is about (or the list of people), which opens it. */
  const fixLink = (f: Fix): ReactNode => {
    const s = slides.find(x => x.id === f.slideId); const n = s ? numberOf(s.id) : null;
    if (s) return <><button type="button" className="pd-link" onClick={() => openFix(f)}>{n ? `Slide ${n}` : 'Hidden slide'}, {nameOf(s)}</button>: </>;
    if (f.where?.startsWith('recipient:')) return <><button type="button" className="pd-link" onClick={() => openFix(f)}>People you send it to</button>: </>;
    return null;
  };

  // ---- AI assist and the checks behind Read my deck: the deck's words only, worked out when asked for ----
  const goAi = () => goToPanel('ai', 'summary');
  const hasGrants = sponsorNet(p.waterfall) > 0;
  const wordsOnly = () => deckData({ ...p, pitch: { ...pitch, lookbook: [] } }, { today });   // no picture is read to get at the words
  const personContext = (): PersonContext => {
    const d = wordsOnly();
    const ask = d.slides.find(s => s.layout === 'ask') as Extract<DeckData['slides'][number], { layout: 'ask' }> | undefined;
    const grants = d.paths.sources.find(s => s.key === 'grants');
    const filled = (template: string, on: boolean) => fillAsk(template, money(pathFor(d.paths, grants ? { grants: on } : {}).investors, d.currency), grants ? money(Math.min(grants.amount, d.paths.cashBudget), d.currency) : null).map(x => x.text).join('');
    return { film: d.film, logline: pitch.logline, hasGrants: !!grants,
      askWith: filled(ask?.withGrants ?? (grants ? ASK_WITH_GRANTS : ASK_NO_GRANTS), true), askWithout: filled(ask?.withoutGrants ?? (grants ? ASK_WITHOUT_GRANTS : ASK_NO_GRANTS), false) };
  };
  const FIELD: Record<string, string> = { ask: 'body', tagline: 'byline', numbers: 'numbers' };
  const checks = (): ReadItem[] => [
    ...fixes.map(f => ({ slideId: f.slideId, where: f.where, message: f.message })),
    ...deckChecks(wordsOnly()).map(c => (c.slideId.startsWith('recipient:')
      ? { slideId: c.slideId, where: `recipient:${Math.max(0, people.findIndex(r => slugify(r.slug) === c.slideId.slice(10)))}`, message: c.message }
      : { slideId: c.slideId, where: FIELD[c.field] ?? c.field, message: c.message })),
  ];
  const aiItem = (x: AiProblem): ReadItem => ({ slideId: x.slideId, where: FIELD[x.field] ?? x.field, message: x.message, label: kindLabel(x) });
  const elsewhere = (f: Fix): { label: string; to: Place } | null =>
    f.where === 'revenue' ? { label: 'Go to What it could make', to: { panel: 'revenue' } } : f.where === 'deal' ? { label: 'Open the Deal tab', to: { tab: 'deal' } }
      : f.where === 'picture' ? { label: 'Go to Look book', to: { panel: 'lookbook' } } : f.where === 'design' ? { label: 'Go to Design system', to: { panel: 'design' } } : null;

  // a hidden slide that is selected is shown in the preview (and only there: the deck that is sent never has it), so it can be edited by eye
  const hiddenId = own && selected?.hidden ? selected.id : null;
  const previewProject = useMemo(() => (hiddenId ? { ...p, pitch: { ...pitch, slides: setSlideHidden(pitch.slides, hiddenId, false) } } : p), [project, hiddenId]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="panel pd" id={PANEL.deck}>
      <div className="pd-top">
        <h2>Pitch deck</h2>
        {own && <button type="button" className="pd-link pd-quiet" onClick={build}>Rebuild from scratch</button>}
      </div>
      <p className="help"><b>Pitch deck: the one you edit and send.</b> This is the deck you send to investors. You write the words; the money figures come from your budget and update by themselves.</p>
      {!own && (
        <div className="row">
          <button type="button" className="btn small primary" onClick={build}>Build my deck</button>
          <span className="hint">Until you press it, this is only a draft that updates as you fill in the page above.</span>
        </div>
      )}
      <div className={`pd-status${status ? ' on' : ''}`} role="status" aria-live="polite">
        {status && <><span>{status.text}</span>{canUndoIt && <button type="button" className="btn small" onClick={undoIt}>Undo <span className="pd-key">{UNDO_KEY}</span></button>}<button type="button" className="pd-mini" aria-label="Dismiss this message" onClick={() => setStatus(null)}>×</button></>}
      </div>

      <div className="pd-grid">
        <div className="pd-side">
          <h3 id="pd-slides-h">{own ? 'Slides' : 'Slides in the draft'}</h3>
          <SlideList slides={slides} own={own} selectedId={selected?.id ?? null} flagged={flagged} numberOf={numberOf} nameOf={nameOf} onSelect={setSelectedId} onMove={move} onDrop={drop} />
          {own && <p className="hint">Drag a slide to move it. With the keyboard: the arrow keys choose a slide, and Alt with an arrow moves it.</p>}
          {own && <AddSlide open={adding} setOpen={setAdding} onAdd={add} />}
          <h3 id="pd-fixes-h" tabIndex={-1}>Things to fix</h3>
          {fixes.length === 0 ? <p className="hint">Nothing to fix.</p> : (
            <ul className="pd-fixes">
              {fixes.map((f, i) => {
                const s = slides.find(x => x.id === f.slideId); const more = elsewhere(f); const person = f.where?.startsWith('recipient:');
                return (
                  <li key={i}>
                    {s && fixLink(f)}
                    {f.message}
                    {person && <> <button type="button" className="pd-link" onClick={() => openFix(f)}>Go to their link ending</button></>}
                    {more && <> <button type="button" className="pd-link" onClick={() => go(more.to)}>{more.label}</button></>}
                  </li>
                );
              })}
            </ul>
          )}
          <ReadMyDeck ai={ai} checks={checks} deck={wordsOnly} link={fixLink} toItem={aiItem} goAi={goAi} />
        </div>

        <div className={`pd-main${own ? '' : ' draft'}`}>
          {selected && own && <SlideEditor key={selected.id} slide={selected} number={numberOf(selected.id)} pictures={Array.isArray(pitch.lookbook) ? pitch.lookbook : []} film={p.name} go={go}
            patch={f => setSlides(x => patchSlide(x, selected.id, f))} onAddCard={() => setSlides(x => addCard(x, selected.id))}
            onHide={() => hide(selected)} onCopy={() => copy(selected)} onDelete={() => remove(selected)} only={slides.length <= 1} overflow={fits.find(f => f.id === selected.id)}
            ai={ai} goAi={goAi} onSaid={text => say(text, { reselect: selected.id })} />}
          {selected && !own && <p className="hint pd-draftnote">This is slide {numberOf(selected.id)} of the draft: {nameOf(selected)}. Press Build my deck to edit it.</p>}
          <DeckPreview project={previewProject} today={today} selectedId={selected?.id ?? null} hiddenId={hiddenId} people={sendable} onSlide={setSelectedId} onFit={setFits} draft={!own} leftOut={fontsLeftOut(p).map(f => f.family)} go={go}
            movement={pitch.deckMotion?.entrance === 'none' ? 'none' : pitch.deckMotion?.pace === 'brisk' ? 'brisk' : 'calm'}
            onMovement={v => { setPitch(x => { const { deckMotion: _m, ...rest } = x; return v === 'calm' ? rest : { ...rest, deckMotion: v === 'brisk' ? { pace: 'brisk', entrance: 'rise' } : { pace: 'calm', entrance: 'none' } }; }); say(v === 'none' ? 'The deck has no movement of its own now. A slide you gave movement keeps it.' : `The whole deck is ${v} now.`, { reselect: selected?.id ?? null }); }} />
        </div>
      </div>

      <People list={people} choices={highlightChoices(slides)} say={say} ai={ai} hasGrants={hasGrants} context={personContext} goAi={goAi}
        set={f => setPitch(x => ({ ...x, recipients: f(readRecipients(x.recipients)) }))} />

      <DeckSend project={project} today={today} people={people} sendable={sendable} fixes={fixes.map(f => `${f.slideId}: ${f.message}`)} fixesId="pd-fixes-h" />
    </div>
  );
}

// ---------- the list ----------

function SlideList({ slides, own, selectedId, flagged, numberOf, nameOf, onSelect, onMove, onDrop }: {
  slides: SlideSpec[]; own: boolean; selectedId: string | null; flagged: Set<string>; numberOf: (id: string) => number | null; nameOf: (s: SlideSpec) => string;
  onSelect: (id: string) => void; onMove: (s: SlideSpec, dir: -1 | 1) => void; onDrop: (id: string, overId: string, after: boolean) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const focusRow = (id: string) => window.setTimeout(() => { for (const el of list.current?.querySelectorAll<HTMLElement>('.pd-row') ?? []) if (el.dataset.slide === id) el.querySelector<HTMLElement>('.pd-pick')?.focus(); }, 0);
  // one tab stop: the arrow keys choose a slide, Alt with an arrow moves the one that is chosen
  const onKey = (e: KeyboardEvent, s: SlideSpec, i: number) => {
    const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (dir && e.altKey && own) { e.preventDefault(); onMove(s, dir); focusRow(s.id); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = dir ? i + dir : e.key === 'Home' ? 0 : e.key === 'End' ? slides.length - 1 : -1;
    if (to < 0 || to >= slides.length || to === i) return;
    e.preventDefault();
    onSelect(slides[to].id); focusRow(slides[to].id);
  };
  return (
    <ol className="pd-list" aria-labelledby="pd-slides-h" ref={list}>
      {slides.map((s, i) => {
        const n = numberOf(s.id); const label = labelOf(s); const on = s.id === selectedId; const bad = flagged.has(s.id);
        return (
          <li key={s.id} data-slide={s.id} className={`pd-row${on ? ' on' : ''}${s.hidden ? ' off' : ''}${own ? ' can-drag' : ''}${drag === s.id ? ' dragging' : ''}${over?.id === s.id && drag && drag !== s.id ? (over.after ? ' drop-after' : ' drop-before') : ''}`}
            draggable={own}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); setDrag(s.id); }}
            onDragOver={e => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = e.currentTarget.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; if (over?.id !== s.id || over.after !== after) setOver({ id: s.id, after }); }}
            onDrop={e => { if (!drag) return; e.preventDefault(); e.stopPropagation(); if (over) onDrop(drag, over.id, over.after); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}>
            {own && <span className="pd-grip" aria-hidden="true" title="Drag to move this slide">⠿</span>}
            <span className="pd-n" aria-hidden="true">{n ?? '–'}</span>
            <button type="button" className="pd-pick" tabIndex={on ? 0 : -1} aria-current={on ? 'true' : undefined} onClick={() => onSelect(s.id)} onKeyDown={e => onKey(e, s, i)}>
              <span className="pd-vh">{n ? `Slide ${n}: ` : 'Hidden slide: '}</span>
              <b>{layoutName(s.layout)}</b>
              {on && <span className="pd-vh"> (selected)</span>}
              {label && <span className="pd-label">{label}</span>}
              {(s.hidden || FROM_BUDGET.has(s.layout)) && <span className="pd-tags">{s.hidden && <span className="pd-tag">hidden</span>}{FROM_BUDGET.has(s.layout) && <span className="pd-tag">from your budget</span>}</span>}
            </button>
            {bad && <span className="pd-flag" title="Something to fix on this slide: see Things to fix"><span aria-hidden="true">!</span><span className="pd-vh">Something to fix</span></span>}
            {own && (
              <span className="pd-moves">
                <button type="button" className="pd-mini" tabIndex={on ? 0 : -1} aria-label={`Move ${nameOf(s)} up`} aria-disabled={i === 0} title="Move up" onClick={() => onMove(s, -1)}>↑</button>
                <button type="button" className="pd-mini" tabIndex={on ? 0 : -1} aria-label={`Move ${nameOf(s)} down`} aria-disabled={i === slides.length - 1} title="Move down" onClick={() => onMove(s, 1)}>↓</button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function AddSlide({ open, setOpen, onAdd }: { open: boolean; setOpen: (open: boolean) => void; onAdd: (l: SlideLayout) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <div className="pd-add" onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
      <button ref={button} type="button" className="btn small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Add a slide'}</button>
      {open && (
        <ul className="pd-layouts" aria-label="Kinds of slide. Escape closes this.">
          {LAYOUTS.map((l, i) => <li key={l.id}><button type="button" autoFocus={i === 0} onClick={() => onAdd(l.id)}><b>{l.name}</b><span>{l.about}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

// ---------- the preview ----------

const signature = (d: DeckData): string => JSON.stringify({
  ...d, images: d.images.map(i => [i.id, i.alt, i.src.length, i.src.slice(-32)]),
  theme: { ...d.theme, fontFaces: (d.theme.fontFaces ?? []).map(f => [f.family, f.role, f.src.length, f.src.slice(-32)]) },
});
type Person = { id: string; slug: string; name: string; lead: Lead };

type DeckPace = 'calm' | 'brisk' | 'none';
function DeckPreview({ project, today, selectedId, hiddenId, people, onSlide, onFit, draft, leftOut, go, movement, onMovement }: {
  project: Project; today: string; selectedId: string | null; hiddenId: string | null; people: Person[]; onSlide: (id: string) => void; onFit: (fits: Fit[]) => void; draft: boolean;
  leftOut: string[]; go: Go;   // font files the preview draws with and a sent file leaves behind
  movement: DeckPace; onMovement: (v: DeckPace) => void;
}) {
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null);
  const handle = useRef<DeckHandle | null>(null);
  const sig = useRef('');
  const urls = useRef(new Map<string, string>());
  const [ids, setIds] = useState<string[]>([]);
  const [hasGrants, setHasGrants] = useState(false);
  const [who, setWho] = useState('');                 // a person's id (not their link ending: that can be edited while they are on show)
  const [lead, setLead] = useState<Lead | null>(null);
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const [broken, setBroken] = useState(false);
  const person = people.find(x => x.id === who);
  const latest = useRef({ selectedId, slug: person?.slug ?? '', lead, index, full, onSlide, onFit });
  latest.current = { selectedId, slug: person?.slug ?? '', lead, index, full, onSlide, onFit };
  const fitToken = useRef(0);
  const whoId = useId(), askName = useId(), paceId = useId();
  const [played, setPlayed] = useState('');
  const play = () => {
    const how = handle.current?.play(index) ?? 'still';
    setPlayed(how === 'played' ? `Playing the movement on slide ${index + 1}.`
      : how === 'reduced' ? 'This computer is set to show less motion, so there is nothing to play: you are seeing what readers with that setting see, everything at once.'
        : 'There is nothing to play here.');
  };
  useEffect(() => { if (!played) return; const t = window.setTimeout(() => setPlayed(''), 7000); return () => window.clearTimeout(t); }, [played]);

  // draw the deck a moment after the last change; a render that changes nothing the deck shows draws nothing
  useEffect(() => {
    const draw = () => {
      const el = host.current; if (!el) return;
      const d = deckData(project, { today, fonts: 'all' });   // the preview shows every attached font; a deck that is sent carries only those cleared to travel
      const now = latest.current;
      const slug = d.recipients.some(r => r.slug === now.slug) ? now.slug : '';
      const s = `${now.full ? 'm' : 's'}|${slug}|${signature(d)}`;
      if (s === sig.current) return;
      sig.current = s;
      const used = new Set<string>();
      const images = d.images.map(i => {
        let u = urls.current.get(i.src);
        if (!u) { u = blobUrlOf(i.src) ?? undefined; if (u) urls.current.set(i.src, u); }
        if (!u) return i;
        used.add(i.src);
        return { ...i, src: u };
      });
      const slideIds = d.slides.map(x => x.id);
      let startAt = now.selectedId ? slideIds.indexOf(now.selectedId) : -1;
      if (startAt < 0) startAt = Math.max(0, Math.min(now.index, slideIds.length - 1));
      const h = mountDeck(el, { ...d, images }, {
        css: deckCss, stacked: false, pageKeys: false, motion: now.full, startAt, recipient: slug || undefined, lead: now.lead ?? undefined,
        onSlide: i => { setIndex(i); const id = slideIds[i]; if (id) latest.current.onSlide(id); },
      });
      handle.current = h;
      for (const [k, u] of [...urls.current]) if (!used.has(k)) { URL.revokeObjectURL(u); urls.current.delete(k); }   // the deck that used them has gone
      setIds(slideIds); setIndex(startAt);
      setHasGrants(d.paths.sources.some(x => x.key === 'grants'));
      if (now.full) el.shadowRoot?.querySelector<HTMLElement>('.psd')?.focus();
      // the fit check, once the deck has settled and the typefaces are in; with a rough count of what would fit
      const token = ++fitToken.current;
      const check = () => {
        if (token !== fitToken.current || handle.current !== h) return;
        const sections = el.shadowRoot?.querySelectorAll<HTMLElement>('section.psd-slide');
        latest.current.onFit(h.checkOverflow().map(i => {
          const box = sections?.[i]?.querySelector<HTMLElement>('.psd-box');
          const words = (box?.textContent ?? '').split(/\s+/).filter(Boolean).length;
          const share = box && box.scrollHeight > box.clientHeight + 2 ? box.clientHeight / box.scrollHeight : 1;
          return { id: slideIds[i], words, fits: share < 0.98 && words > 20 ? Math.max(10, Math.floor(words * share / 10) * 10) : null };
        }).filter(f => !!f.id));
      };
      window.setTimeout(check, 350);
      void document.fonts?.ready.then(() => window.setTimeout(check, 50));
    };
    // drawn on a timer, where the page's error boundary cannot see: a failure here is caught and said in the frame
    const safe = () => { try { draw(); setBroken(false); } catch (err) { console.error('The preview could not be drawn', err); sig.current = ''; setBroken(true); } };
    const t = window.setTimeout(safe, sig.current ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [project, today, full, person?.slug]);
  useEffect(() => {
    const live = urls.current;
    return () => { fitToken.current++; handle.current?.destroy(); handle.current = null; sig.current = ''; for (const u of live.values()) URL.revokeObjectURL(u); live.clear(); };
  }, []);

  // the list picks a slide: the preview goes there
  useEffect(() => {
    const i = selectedId ? ids.indexOf(selectedId) : -1;
    if (i >= 0 && i !== latest.current.index) handle.current?.goTo(i);
  }, [selectedId, ids]);

  useEffect(() => {
    const on = () => setFull(!!frame.current && document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const shownLead: Lead = lead ?? person?.lead ?? 'with-grants';
  const pickWho = (id: string) => { setWho(id); setLead(null); };   // the draw above follows: another person is another deck
  const pickLead = (l: Lead) => { setLead(l); handle.current?.setLead(l); };
  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const count = ids.length;
  const onHidden = !!hiddenId && ids[index] === hiddenId;

  return (
    <div className="pd-preview">
      <div className="pd-controls">
        <div className="ctl"><label htmlFor={whoId}>See it as</label>
          <select id={whoId} value={person ? who : ''} onChange={e => pickWho(e.target.value)}>
            <option value="">Anyone (no name on it)</option>
            {people.map(r => <option key={r.id} value={r.id}>{r.name || r.slug}</option>)}
          </select></div>
        {hasGrants && (
          <fieldset className="pd-ask">
            <legend>Ask shown first</legend>
            <div className="pd-ask-row">
              {(['with-grants', 'without-grants'] as Lead[]).map(l => (
                <label key={l}><input type="radio" name={askName} checked={shownLead === l} onChange={() => pickLead(l)} /> {l === 'with-grants' ? 'With grants' : <>Without<span className="pd-vh"> grants</span></>}</label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="ctl"><label htmlFor={paceId}>Movement for the whole deck</label>
          <select id={paceId} value={movement} onChange={e => onMovement(e.target.value === 'brisk' ? 'brisk' : e.target.value === 'none' ? 'none' : 'calm')}>
            <option value="calm">Calm</option><option value="brisk">Brisk</option><option value="none">None</option>
          </select></div>
        <div className="pd-pager">
          <button type="button" className="pd-mini" aria-label="Previous slide" title="Previous slide" disabled={index <= 0} onClick={() => handle.current?.goTo(index - 1)}>‹</button>
          <span className="pd-count" aria-live="polite" aria-atomic="true"><span className="pd-vh">Slide </span>{count ? `${index + 1} / ${count}` : 'No slides'}</span>
          <button type="button" className="pd-mini" aria-label="Next slide" title="Next slide" disabled={index >= count - 1} onClick={() => handle.current?.goTo(index + 1)}>›</button>
          <button type="button" className="btn small" disabled={!count} title="Play this slide's movement here, once" onClick={play}>Play<span className="pd-vh"> this slide's movement</span></button>
          {canFull && <button type="button" className="btn small" onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}>Full screen</button>}
        </div>
      </div>
      <div className={`pd-frame${onHidden ? ' is-hidden' : ''}`} ref={frame}>
        <div className="pd-host" ref={host} />
        {onHidden && <div className="pd-hiddenbanner">Hidden. Not on the deck.</div>}
        {broken && <div className="pd-hiddenbanner" role="alert">The preview could not be drawn: something in this project is not in a form it can read. Your slides are still here and can still be edited.</div>}
      </div>
      {leftOut.length > 0 && <p className="hint pd-fontnote">The preview uses {leftOut.join(' and ')}; the files you send will not, because {leftOut.length > 1 ? 'their boxes under Design system are' : 'its box under Design system is'} not ticked. <button type="button" className="pd-link" onClick={() => go({ panel: 'design' })}>Go to Design system</button></p>}
      <p className="hint pd-played" role="status" aria-live="polite">{played}</p>
      <p className="hint pd-caption">The preview holds still while you edit; Play shows the slide's movement. {LESS_MOTION}</p>
      <p className="hint pd-caption">{person ? <b>As {person.name || person.slug} sees it. </b> : null}{draft ? 'A draft, not saved as slides yet. ' : ''}Click the slide, then use the arrow keys. Buttons on the slide work as they will for your reader. Paging here also selects the slide in the list.</p>
    </div>
  );
}

// ---------- the editor ----------

type Part = string | { label: string; to: Place };
interface Spec {
  head: boolean;                      // the small label, the headline, the second line
  body?: [label: string, hint?: string];
  closing?: [label: string, hint?: string];
  from?: Part[];                      // where the rest of the slide comes from, with links to it
}
const SPEC: Record<SlideLayout, Spec> = {
  cover: { head: false, from: ['The title is the film\'s name, at the top of the page. The line under it is the first sentence of the ', { label: 'logline', to: { panel: 'write' } }, '. The line above the title says who the deck is for: the month you send it, or a person\'s own cover line (', { label: 'People you send it to', to: { panel: 'people' } }, ').'] },
  photo: { head: true, body: ['Paragraph', 'A short one. It sits under the headline, over the picture.'] },
  text: { head: true, body: ['Paragraphs', 'Leave an empty line between paragraphs.'], closing: ['Last line'] },
  cards: { head: true },
  ways: { head: true, from: ['Each person you send it to can have one of these cards highlighted: choose it under ', { label: 'People you send it to', to: { panel: 'people' } }, '.'] },
  stats: { head: true, body: ['Paragraph beside the numbers'], closing: ['Note under the numbers'] },
  timeline: { head: true, closing: ['Note under the milestones'], from: ['Shoot days, scenes, sets and speaking parts come from the ', { label: 'Stripboard tab', to: { tab: 'board' } }, '; the cash budget comes from the ', { label: 'Top sheet & budget tab', to: { tab: 'topsheet' } }, '.'] },
  comps: { head: true, closing: ['Highlighted line', 'One sentence on what the films have in common.'], from: ['The bars and the table come from ', { label: 'Comparable films', to: { panel: 'comps' } }, '.'] },
  team: { head: true, from: ['Team members come from ', { label: 'The team', to: { panel: 'team' } }, '.'] },
  model: { head: true, body: ['Paragraph above the steps'], closing: ['Last line'], from: ['Who gets paid, and in what order, comes from the ', { label: 'Deal tab', to: { tab: 'deal' } }, '.'] },
  numbers: { head: true, body: ['Paragraph beside the figures'], closing: ['Note under the cases', 'Leave empty for the standard note about fees.'], from: ['The figures come from your budget (the ', { label: 'Top sheet & budget tab', to: { tab: 'topsheet' } }, '), the funding sources on the ', { label: 'Deal tab', to: { tab: 'deal' } }, ' and ', { label: 'What it could make', to: { panel: 'revenue' } }, '. The line at the foot saying the figures are illustrative is always shown.'] },
  ask: { head: true },
  closing: { head: true, from: ['The title is the film\'s name. The sign-off under it comes from the ', { label: 'Design system', to: { panel: 'design' } }, '.'] },
};

function Field({ label, value, onChange, hint, placeholder, rows, className, field, invalid, problem }: {
  label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; placeholder?: string; rows?: number; className?: string; field?: string; invalid?: boolean; problem?: string;
}) {
  const id = useId(), hid = useId();
  const described = hint || problem ? hid : undefined;
  return (
    <div className={`ctl ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {rows ? <textarea id={id} rows={rows} value={value} placeholder={placeholder} data-field={field} aria-invalid={invalid || undefined} aria-describedby={described} onChange={e => onChange(e.target.value)} />
        : <input id={id} value={value} placeholder={placeholder} data-field={field} aria-invalid={invalid || undefined} aria-describedby={described} onChange={e => onChange(e.target.value)} />}
      {(hint || problem) && <div className={problem ? 'pd-bad small' : 'hint'} id={hid}>{problem ? `✕ ${problem}` : hint}</div>}
    </div>
  );
}

/** The up, down and remove buttons every item in a slide's lists has. */
function ItemTools({ what, index, count, onMove, onRemove }: { what: string; index: number; count: number; onMove: (dir: -1 | 1) => void; onRemove: () => void }) {
  return (
    <span className="pd-tools">
      <button type="button" className="pd-mini" aria-label={`Move ${what} earlier`} aria-disabled={index === 0} title="Earlier" onClick={() => { if (index > 0) onMove(-1); }}>↑</button>
      <button type="button" className="pd-mini" aria-label={`Move ${what} later`} aria-disabled={index === count - 1} title="Later" onClick={() => { if (index < count - 1) onMove(1); }}>↓</button>
      <button type="button" className="pd-mini" aria-label={`Remove ${what}`} title="Remove" onClick={onRemove}>×</button>
    </span>
  );
}

/** A part of a slide most slides do without: a button until it is asked for or has something in it. */
function Optional({ add, legend, filled, children }: { add: string; legend: string; filled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(filled);
  const box = useRef<HTMLFieldSetElement>(null);
  const opened = useRef(false);
  useEffect(() => { if (open && opened.current) { opened.current = false; box.current?.querySelector<HTMLElement>('input, textarea, button')?.focus(); } }, [open]);
  if (!open && !filled) return <div className="pd-optional"><button type="button" className="btn small" onClick={() => { opened.current = true; setOpen(true); }}>{add}</button></div>;
  return <fieldset className="pd-set" ref={box}><legend>{legend}</legend>{children}</fieldset>;
}

function SlideEditor({ slide: s, number, pictures, film, go, patch, onAddCard, onHide, onCopy, onDelete, only, overflow, ai, goAi, onSaid }: {
  slide: SlideSpec; number: number | null; pictures: LookImage[]; film: string; go: Go; patch: (f: Partial<SlideSpec>) => void; onAddCard: () => void;
  onHide: () => void; onCopy: () => void; onDelete: () => void; only: boolean; overflow?: Fit; ai: boolean; goAi: () => void; onSaid: (text: string) => void;
}) {
  const spec = SPEC[s.layout] ?? { head: true };
  const cards = s.cards ?? [], stats = s.stats ?? [], miles = s.milestones ?? [], cols = s.columns ?? [];
  const setCard = (i: number, f: Partial<SlideCard>) => patch({ cards: cards.map((c, j) => (j === i ? { ...c, ...f } : c)) });
  const setStat = (i: number, f: Partial<SlideStat>) => patch({ stats: stats.map((c, j) => (j === i ? { ...c, ...f } : c)) });
  const setMile = (i: number, f: Partial<SlideMilestone>) => patch({ milestones: miles.map((c, j) => (j === i ? { ...c, ...f } : c)) });
  const lead = s.lead ?? { value: '', text: '', source: '' };
  const setLead = (f: Partial<typeof lead>) => { const next = { ...lead, ...f }; patch({ lead: next.value || next.text || next.source ? next : undefined }); };
  const quote = s.quote ?? { text: '', by: '' };
  const setQuote = (f: Partial<typeof quote>) => { const next = { ...quote, ...f }; patch({ quote: next.text || next.by ? next : undefined }); };
  const aside = s.aside ?? { title: '', lines: [] as string[] };
  const setAside = (f: Partial<{ title: string; lines: string[]; footnote: string }>) => {
    const next = { ...aside, ...f };
    patch({ aside: next.title || next.lines.length || next.footnote ? { title: next.title, lines: next.lines, ...(next.footnote ? { footnote: next.footnote } : {}) } : undefined });
  };
  const linesOf = (v: string) => v.split('\n');
  const shown = pictures.filter(i => !!i && typeof i === 'object' && typeof i.id === 'string' && typeof i.dataUrl === 'string' && i.dataUrl.startsWith('data:'));
  const scrim = typeof s.scrim === 'number' ? s.scrim : 0.7;
  const scrimId = useId(), paperId = useId();
  const lostPicture = !!s.imageId && !pictures.some(i => !!i && i.id === s.imageId);
  const askBox = useRef<HTMLDivElement>(null);
  const insert = (token: string) => {
    const ta = askBox.current?.querySelector('textarea'); const text = s.body ?? '';
    const a = ta ? ta.selectionStart : text.length, b = ta ? ta.selectionEnd : text.length;
    patch({ body: text.slice(0, a) + token + text.slice(b) });
    window.setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(a + token.length, a + token.length); } }, 0);
  };

  return (
    <section className="pd-editor" aria-label={`Edit ${number ? `slide ${number}` : 'the hidden slide'}: ${layoutName(s.layout)}`}>
      <h3 tabIndex={-1}>{number ? `Slide ${number}` : 'Hidden slide'} · {layoutName(s.layout)}</h3>
      <div className="pd-actions">
        <button type="button" className="btn small" aria-pressed={!!s.hidden} onClick={onHide}>{s.hidden ? 'Show on the deck' : 'Hide'}</button>
        <button type="button" className="btn small" onClick={onCopy}>Duplicate</button>
        <button type="button" className="btn small" disabled={only} onClick={onDelete}>Delete</button>
        {only && <span className="hint">A deck needs one slide: add another before deleting this one.</span>}
      </div>
      <p className="hint">{LAYOUTS.find(l => l.id === s.layout)?.about}{s.hidden ? ' This slide is hidden: it is left off the deck until you show it.' : ''}</p>
      {overflow && <p className="pd-bad small">{overflowText(overflow)}</p>}
      {spec.from && <p className="pd-from">{spec.from.map((part, i) => (typeof part === 'string' ? part : <button key={i} type="button" className="pd-link" onClick={() => go(part.to)}>{part.label}</button>))}</p>}

      {spec.head && (
        <div className="pd-fields">
          <Field label="Small label above" value={s.eyebrow ?? ''} onChange={v => patch({ eyebrow: v })} className="full" field="eyebrow" />
          <Field label={s.layout === 'ask' ? 'Line above the ask' : 'Headline'} value={s.headline ?? ''} onChange={v => patch({ headline: v })} className="full" field="headline" />
          <Field label="Second line" value={s.punch ?? ''} onChange={v => patch({ punch: v })} className="full" hint="Shown under the headline, in colour." field="punch" problem={promiseOfReturns(s.punch).flagged ? PROMISE_TEXT : undefined} />
          <SecondLine ai={ai} headline={s.headline ?? ''} onUse={v => { patch({ punch: v }); onSaid('Second line filled in.'); }}
            body={[s.body, ...cards.map(c => [c.title, c.body].filter(Boolean).join(': ')), lead.text && `${lead.value} ${lead.text}`, ...stats.map(x => `${x.value} ${x.label}`), quote.text, s.closing].filter(Boolean).join('\n')} />
        </div>
      )}
      {s.layout === 'cover' && <div className="pd-fields"><Field label="Who made it" value={s.byline ?? ''} onChange={v => patch({ byline: v })} placeholder="Written and directed by Ada Example" className="full" field="byline" hint={`Beside ${film || 'the title'}.`} /></div>}

      {s.layout === 'stats' && (
        <Optional add="Add a big number" legend="The big number" filled={!!(lead.value || lead.text || lead.source)}>
          <div className="pd-fields">
            <Field label="Number" value={lead.value} onChange={v => setLead({ value: v })} placeholder="7 in 10" />
            <Field label="What it counts" value={lead.text} onChange={v => setLead({ text: v })} className="wide" />
            <Field label="Source" value={lead.source} onChange={v => setLead({ source: v })} className="full" field="lead" invalid={!!(lead.value || lead.text) && !lead.source.trim()}
              hint="Where the number comes from." problem={(lead.value || lead.text) && !lead.source.trim() ? 'No source yet, so this number is left off the deck.' : undefined} />
          </div>
        </Optional>
      )}

      {s.layout === 'ask' && (
        <div className="pd-fields" ref={askBox}>
          <Field label="The ask, in your words" value={s.body ?? ''} onChange={v => patch({ body: v })} rows={3} className="full" field="body" hint="Leave it empty for the standard wording." />
          <div className="full pd-insert">
            <button type="button" className="btn small" onClick={() => insert('{investors}')}>Insert the amount investors fund</button>
            <button type="button" className="btn small" onClick={() => insert('{grants}')}>Insert the grants amount</button>
            <span className="hint">These put {'{investors}'} and {'{grants}'} in your text; the deck shows the live amounts in their place and keeps them right when a switch changes.</span>
          </div>
        </div>
      )}
      {spec.body && <div className="pd-fields"><Field label={spec.body[0]} value={s.body ?? ''} onChange={v => patch({ body: v })} rows={s.layout === 'text' ? 6 : 3} className="full" hint={spec.body[1]} field="body" /></div>}

      {s.layout === 'stats' && (
        <Optional add="Add a quote" legend="Quote" filled={!!(quote.text || quote.by)}>
          <div className="pd-fields">
            <Field label="What was said" value={quote.text} onChange={v => setQuote({ text: v })} rows={2} className="full" />
            <Field label="Who said it" value={quote.by} onChange={v => setQuote({ by: v })} className="full" />
          </div>
        </Optional>
      )}

      {(s.layout === 'cards' || s.layout === 'ways') && (
        <fieldset className="pd-set"><legend>Cards</legend>
          {cards.map((c, i) => (
            <div className="pd-item" key={c.id || i}>
              <div className="pd-itemhead"><b>Card {i + 1}</b>{i >= MAX_CARDS && <span className="pd-bad small">Left off: a slide holds {MAX_CARDS}.</span>}<ItemTools what={`card ${i + 1}`} index={i} count={cards.length} onMove={d => patch({ cards: moveItem(cards, i, d) })} onRemove={() => patch({ cards: cards.filter((_, j) => j !== i) })} /></div>
              <div className="pd-fields">
                <Field label="Small label above" value={c.kicker ?? ''} onChange={v => setCard(i, { kicker: v })} />
                <Field label="Title" value={c.title ?? ''} onChange={v => setCard(i, { title: v })} className="wide" field={i === 0 ? 'cards' : undefined} />
                <Field label="Text" value={c.body ?? ''} onChange={v => setCard(i, { body: v })} rows={2} className="full" />
                <Field label="Small print" value={c.footnote ?? ''} onChange={v => setCard(i, { footnote: v })} className="full" />
              </div>
            </div>
          ))}
          <div className="row"><button type="button" className="btn small" disabled={cards.length >= MAX_CARDS} onClick={onAddCard}>Add a card</button>{cards.length >= MAX_CARDS && <span className="hint">A slide holds {MAX_CARDS} cards.</span>}</div>
        </fieldset>
      )}

      {s.layout === 'stats' && (
        <fieldset className="pd-set"><legend>Numbers</legend>
          {stats.map((x, i) => {
            const begun = !!(x.value || x.label), missing = begun && !x.source.trim();
            return (
              <div className="pd-item" key={x.id || i}>
                <div className="pd-itemhead"><b>Number {i + 1}</b><ItemTools what={`number ${i + 1}`} index={i} count={stats.length} onMove={d => patch({ stats: moveItem(stats, i, d) })} onRemove={() => patch({ stats: stats.filter((_, j) => j !== i) })} /></div>
                <div className="pd-fields">
                  <Field label="Number" value={x.value} onChange={v => setStat(i, { value: v })} placeholder="41%" />
                  <Field label="What it counts" value={x.label} onChange={v => setStat(i, { label: v })} className="wide" />
                  <Field label="Source" value={x.source} onChange={v => setStat(i, { source: v })} className="full" field={`stat:${x.id}`} invalid={missing}
                    hint="A number with no source is left off the deck." problem={missing ? 'No source yet, so this number is left off the deck.' : undefined} />
                </div>
              </div>
            );
          })}
          <button type="button" className="btn small" onClick={() => patch({ stats: [...stats, { id: nextItemId('stat', stats), value: '', label: '', source: '' }] })}>Add a number</button>
        </fieldset>
      )}

      {s.layout === 'timeline' && (
        <fieldset className="pd-set"><legend>Milestones</legend>
          <p className="hint">Leave empty to show your shoot dates (and the California credit window, if you use it).</p>
          {miles.map((m, i) => (
            <div className="pd-item" key={m.id || i}>
              <div className="pd-itemhead"><b>Milestone {i + 1}</b><ItemTools what={`milestone ${i + 1}`} index={i} count={miles.length} onMove={d => patch({ milestones: moveItem(miles, i, d) })} onRemove={() => patch({ milestones: miles.filter((_, j) => j !== i) })} /></div>
              <div className="pd-fields">
                <Field label="When" value={m.when} onChange={v => setMile(i, { when: v })} placeholder="Spring 2031" />
                <Field label="What" value={m.what} onChange={v => setMile(i, { what: v })} className="wide" />
              </div>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => patch({ milestones: [...miles, { id: nextItemId('ms', miles), when: '', what: '' }] })}>Add a milestone</button>
        </fieldset>
      )}

      {s.layout === 'text' && (
        <Optional add="Add small columns" legend="Small columns under the text" filled={cols.length > 0}>
          {cols.map((c, i) => (
            <div className="pd-item" key={i}>
              <div className="pd-itemhead"><b>Column {i + 1}</b><ItemTools what={`column ${i + 1}`} index={i} count={cols.length} onMove={d => patch({ columns: moveItem(cols, i, d) })} onRemove={() => patch({ columns: cols.filter((_, j) => j !== i) })} /></div>
              <div className="pd-fields">
                <Field label="Label" value={c.label} onChange={v => patch({ columns: cols.map((x, j) => (j === i ? { ...x, label: v } : x)) })} placeholder="Where" />
                <Field label="Lines, one on each line" value={c.lines.join('\n')} onChange={v => patch({ columns: cols.map((x, j) => (j === i ? { ...x, lines: linesOf(v) } : x)) })} rows={2} className="wide" />
              </div>
            </div>
          ))}
          <button type="button" className="btn small" disabled={cols.length >= 4} onClick={() => patch({ columns: [...cols, { label: '', lines: [] }] })}>Add a column</button>
        </Optional>
      )}

      {s.layout === 'team' && (
        <Optional add="Add a card beside the team" legend="Card beside the team" filled={!!(aside.title || aside.lines.length || aside.footnote)}>
          <div className="pd-fields">
            <Field label="Title" value={aside.title} onChange={v => setAside({ title: v })} placeholder="Also attached" className="full" />
            <Field label="Lines, one on each line" value={aside.lines.join('\n')} onChange={v => setAside({ lines: v ? linesOf(v) : [] })} rows={3} className="full" hint="Who you hope to cast, who has said yes." />
            <Field label="Small print" value={aside.footnote ?? ''} onChange={v => setAside({ footnote: v })} className="full" />
          </div>
        </Optional>
      )}

      {s.layout === 'ask' && (
        <div className="pd-fields">
          <Field label="Next step" value={s.nextStep ?? ''} onChange={v => patch({ nextStep: v })} className="full" field="nextStep" placeholder="A twenty-minute call this month." hint="What you want the reader to do next." />
          <Field label="How to reach you" value={s.contact ?? ''} onChange={v => patch({ contact: v })} className="full" field="contact" placeholder="ada@example.com" />
        </div>
      )}

      {spec.closing && <div className="pd-fields"><Field label={spec.closing[0]} value={s.closing ?? ''} onChange={v => patch({ closing: v })} className="full" hint={spec.closing[1]} field="closing" /></div>}

      <Optional add="Add small print" legend="Small print" filled={!!s.footnote}>
        <div className="pd-fields"><Field label="Small print, at the foot of the slide" value={s.footnote ?? ''} onChange={v => patch({ footnote: v })} className="full" field="footnote" /></div>
      </Optional>

      {shown.length === 0 && !lostPicture ? (
        <p className="hint pd-optional">No pictures to put behind this slide yet: add some to the <button type="button" className="pd-link" onClick={() => go({ panel: 'lookbook' })}>Look book</button>.</p>
      ) : (
        <Optional add="Add a picture" legend="Picture" filled={!!s.imageId}>
          {lostPicture && <p className="pd-bad small">The picture chosen for this slide is no longer in the look book. Pick another, or No picture.</p>}
          <ul className="thumbs" aria-label="Picture for this slide">
            <li><button type="button" className="thumb none" data-field="picture" aria-pressed={!s.imageId} onClick={() => patch({ imageId: undefined, scrim: undefined })}><span className="thumb-none">No picture</span><span className="thumb-mark">{!s.imageId ? '✓ Chosen' : 'Choose'}</span></button></li>
            {shown.map((img, n) => (
              <li key={img.id}><button type="button" className="thumb" aria-pressed={s.imageId === img.id} onClick={() => patch({ imageId: img.id })}>
                <img src={img.dataUrl} alt={(typeof img.caption === 'string' ? img.caption.trim() : '') || `Look book picture ${n + 1}`} loading="lazy" />
                <span className="thumb-mark">{s.imageId === img.id ? '✓ Chosen' : 'Choose'}</span>
              </button></li>
            ))}
          </ul>
          {s.imageId && !lostPicture && (
            <div className="ctl pd-scrim">
              <label htmlFor={scrimId}>How much the picture is faded behind the text: {Math.round(scrim * 100)}%</label>
              <input id={scrimId} type="range" min={0} max={100} step={5} value={Math.round(scrim * 100)} onChange={e => patch({ scrim: +e.target.value / 100 })} />
              <div className="hint">Higher fades it more. Where the text sits, the deck always fades it enough to keep the words readable.</div>
            </div>
          )}
        </Optional>
      )}

      {hasPaper(s.layout) && (
        <div className="pd-fields pd-optional">
          <div className="ctl full"><label htmlFor={paperId}>Paper</label>
            <select id={paperId} data-field="paper" style={{ maxWidth: 220 }} value={s.paper ?? ''} onChange={e => patch({ paper: (e.target.value || undefined) as SlideSpec['paper'] })}>{PAPER_CHOICES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="hint">{s.layout === 'cards' || s.layout === 'ways' ? 'What this slide\'s cards are drawn on. A mix gives each card a different paper.' : s.layout === 'cover' ? 'What the title\'s card is drawn on.' : s.layout === 'stats' ? 'What the quote is drawn on.' : 'What the card beside the team is drawn on.'} Deck default is the paper chosen under Design system.</div></div>
        </div>
      )}

      <Movement slide={s} pictures={shown} ai={ai} patch={patch} onApplied={onSaid} goAi={goAi} goLookbook={() => go({ panel: 'lookbook' })} />
    </section>
  );
}

// ---------- the people the deck is sent to ----------

function People({ list, choices, set, say, ai, hasGrants, context, goAi }: { list: Recipient[]; choices: { id: string; label: string }[]; set: (f: (r: Recipient[]) => Recipient[]) => void; say: (t: string, undo?: { reselect: string | null }) => void;
  ai: boolean; hasGrants: boolean; context: () => PersonContext; goAi: () => void }) {
  const patch = (at: number, f: (r: Recipient) => Recipient) => set(all => all.map((r, i) => (i === at ? f(r) : r)));
  return (
    <div className="pd-people" id={PANEL.people}>
      <h3>People you send it to</h3>
      <p className="help">Add each person or fund you send the deck to. Each one gets a link and a file of their own, and never sees anyone else's name, note or cover line.</p>
      {list.map((r, i) => <PersonRow key={r.id} at={i} r={r} others={list.filter((_, j) => j !== i).map(x => x.slug)} choices={choices} patch={f => patch(i, f)}
        assist={<PersonAssist r={r} ai={ai} hasGrants={hasGrants} context={context} goAi={goAi} onApply={sug => {
          patch(i, x => { const { note: _n, ...rest } = x; return { ...rest, coverLine: sug.coverLine, lead: sug.lead, ...(sug.note ? { note: sug.note } : {}) }; });
          say(`Applied to ${r.name.trim() || 'this person'}: the cover line, the note and which ask comes first.`, { reselect: null });
        }} />}
        onRemove={() => { set(all => all.filter((_, j) => j !== i)); say(`Removed ${r.name.trim() || 'the person'}.`, { reselect: null }); }} />)}
      <button type="button" className="btn small" onClick={() => { set(all => [...all, newRecipient(all)]); focusSoon(`#pd-name-${list.length}`); }}>Add a person</button>
    </div>
  );
}

function PersonRow({ at, r, others, choices, patch, onRemove, assist }: { at: number; r: Recipient; others: string[]; choices: { id: string; label: string }[]; patch: (f: (r: Recipient) => Recipient) => void; onRemove: () => void; assist: ReactNode }) {
  const problemId = useId(), coverId = useId(), noteId = useId(), leadId = useId(), cardId = useId();
  const [touched, setTouched] = useState(() => !!(r.name || r.slug));
  const found = linkEndingProblem(r.slug, others);
  const problem = found === 'empty' && !touched ? '' : found;   // a new, blank person is not wrong yet
  const ending = slugify(r.slug);
  const known = !r.highlightCardId || choices.some(c => c.id === r.highlightCardId);
  return (
    <fieldset className="pd-person">
      <legend>{r.name.trim() || 'Someone new'}</legend>
      <div className="pd-fields">
        <div className="ctl"><label htmlFor={`pd-name-${at}`}>Name</label><input id={`pd-name-${at}`} value={r.name} placeholder="Ada Example" onChange={e => { setTouched(true); patch(x => renameRecipient(x, e.target.value)); }} /></div>
        <div className="ctl">
          <label htmlFor={`pd-slug-${at}`}>Link ending</label>
          <input id={`pd-slug-${at}`} value={r.slug} placeholder="ada-example" aria-invalid={problem ? true : undefined} aria-describedby={problemId} onChange={e => patch(x => ({ ...x, slug: e.target.value }))}
            onBlur={() => { setTouched(true); if (ending && ending !== r.slug) patch(x => ({ ...x, slug: ending })); }} />
          <div id={problemId} className={`small ${problem ? 'pd-bad' : 'hint'}`} role="status" aria-live="polite">{problem ? `✕ ${linkProblemText(problem, r.slug)}` : ending ? `Their link ends in #${ending}` : 'Suggested from the name; change it if you like.'}</div>
        </div>
        <div className="ctl full"><label htmlFor={coverId}>Cover line</label><input id={coverId} value={r.coverLine} placeholder={`Prepared for ${r.name.trim() || 'Ada Example'}.`} onChange={e => patch(x => ({ ...x, coverLine: e.target.value }))} /><div className="hint">On the cover, above the title. Leave empty to show the general line.</div></div>
        <div className="ctl full"><label htmlFor={noteId}>Note to them</label><textarea id={noteId} rows={2} value={r.note ?? ''} onChange={e => patch(x => { const { note: _n, ...rest } = x; return e.target.value ? { ...rest, note: e.target.value } : rest; })} /><div className="hint">Shown on the ask slide, in their copy only.</div></div>
        <div className="ctl"><label htmlFor={leadId}>Ask shown first</label>
          <select id={leadId} value={r.lead} onChange={e => patch(x => ({ ...x, lead: e.target.value === 'without-grants' ? 'without-grants' : 'with-grants' }))}>
            <option value="with-grants">With grants: the smaller raise</option>
            <option value="without-grants">Without grants: the whole raise</option>
          </select></div>
        <div className="ctl wide"><label htmlFor={cardId}>Highlight a card for them</label>
          <select id={cardId} value={r.highlightCardId ?? ''} onChange={e => patch(x => { const { highlightCardId: _h, ...rest } = x; return e.target.value ? { ...rest, highlightCardId: e.target.value } : rest; })}>
            <option value="">None</option>
            {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            {!known && <option value={r.highlightCardId}>A card that is no longer on the deck</option>}
          </select>
          <div className="hint">{choices.length ? 'Outlined in their copy only.' : 'There are no cards to highlight yet: a Cards or Ways to take part slide has them.'}</div></div>
      </div>
      {assist}
      <button type="button" className="btn small" onClick={onRemove}>Remove {r.name.trim() || 'this person'}</button>
    </fieldset>
  );
}
