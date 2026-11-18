// The parts of the deck builder that came last: a slide's movement (choices in plain words, and, with the person's
// own key, movement described in a sentence), and AI assist for the deck (a second line for a headline, a cover line
// and note for one person, a read of the whole deck). Every AI answer is shown as a proposal first; nothing is
// applied until the person presses Apply, and each says what it sends before it sends it.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { LookImage, Recipient, SlideLayout, SlideMotion, SlideSpec } from '../engine/types';
import type { DeckData } from '../deck-runtime/data';
import { cleanMotion, markerPathOf, STAGGER_MAX } from '../deck-runtime/motion';
import { aiProblem, motionPictures, motionSends, motionWords, NO_MOVEMENT, REQUEST_MAX, TIMEOUT_MS, type MotionProposal } from '../engine/aiMotion';
import { ABOUT_MAX, COVER_MAX, CRITIQUE_SENDS, KIND_WORDS, NOTE_MAX, PUNCH_SENDS, personSends, type AiProblem, type PersonSuggestion } from '../engine/aiDeck';
import { PROMISE_TEXT, promiseOfReturns } from '../engine/promise';
import { motionOnRequest, readTheDeck, suggestForPerson, suggestSecondLines } from '../ai';

export const LESS_MOTION = 'People who have asked their computer for less motion, and PDFs, see everything at once.';

/** One request at a time: busy, then an answer or a problem in plain words. Stop ends it at once; with no answer in
 *  sixty seconds it is ended for the person, and told so. A request still out when the part goes away is dropped. */
function useAsk<T>() {
  const [state, setState] = useState<{ busy: boolean; error: string; note: string; result: T | null }>({ busy: false, error: '', note: '', result: null });
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = async (fn: (signal: AbortSignal) => Promise<T>) => {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    let late = false;
    const timer = window.setTimeout(() => { late = true; c.abort(); }, TIMEOUT_MS);
    setState({ busy: true, error: '', note: '', result: null });
    try { const r = await fn(c.signal); if (!c.signal.aborted) setState({ busy: false, error: '', note: '', result: r }); }
    catch (e) {
      if (late && ctl.current === c) setState({ busy: false, error: aiProblem({ name: 'TimeoutError' }), note: '', result: null });
      else if (!c.signal.aborted) setState({ busy: false, error: aiProblem(e), note: '', result: null });
    } finally { window.clearTimeout(timer); }
  };
  const clear = () => { ctl.current?.abort(); setState({ busy: false, error: '', note: '', result: null }); };
  const stop = () => { ctl.current?.abort(); setState({ busy: false, error: '', note: 'Stopped. Nothing was sent back and nothing was changed.', result: null }); };
  return { ...state, run, clear, stop };
}
/** The button that sends, and beside it, while the answer is awaited, the one that stops. */
function Send({ ask, label, busyLabel = 'Asking…', disabled, onSend, buttonRef }: { ask: { busy: boolean; stop: () => void }; label: string; busyLabel?: string; disabled?: boolean; onSend: () => void; buttonRef?: RefObject<HTMLButtonElement> }) {
  return <><button ref={buttonRef} type="button" className="btn small" disabled={ask.busy || disabled} onClick={onSend}>{ask.busy ? busyLabel : label}</button>{ask.busy && <button type="button" className="btn small" onClick={ask.stop}>Stop</button>}</>;
}
const focusOn = (ref: RefObject<HTMLElement>) => window.setTimeout(() => ref.current?.focus(), 0);
/** What a screen reader is told as a request goes out, comes back or fails. Always in the page, so it is heard. */
function Said({ busy, error, note = '', ready, waiting = 'Asking. This takes a few seconds. Stop ends it.' }: { busy: boolean; error: string; note?: string; ready: string; waiting?: string }) {
  return <div className={`pd-said${error ? ' pd-bad' : ''}`} role="status" aria-live="polite">{busy ? waiting : error ? `✕ ${error}` : note || ready}</div>;
}
const NoKey = ({ what, goAi }: { what: string; goAi: () => void }) => (
  <p className="hint pd-nokey">With your own Anthropic key you can also {what}: turn it on under <button type="button" className="pd-link" onClick={goAi}>AI assist</button>.</p>
);

// ---------- a slide's movement ----------

const ENTRANCE_CHOICES: [NonNullable<SlideMotion['entrance']> | '', string][] = [['', 'Like the rest of the deck'], ['rise', 'Rises into place'], ['fade', 'Fades in'], ['drop', 'Drops in'], ['slide-left', 'Slides in from the right'], ['slide-right', 'Slides in from the left'], ['none', 'Simply there (no movement)']];
const ORDER_CHOICES: [NonNullable<SlideMotion['order']> | '', string][] = [['', 'Close together, first to last'], ['together', 'All together'], ['one-by-one', 'One at a time'], ['reverse', 'One at a time, last first']];
const COUNTS: ReadonlySet<SlideLayout> = new Set<SlideLayout>(['stats', 'timeline', 'numbers']);
const NO_HEADLINE: ReadonlySet<SlideLayout> = new Set<SlideLayout>(['cover']);

export function Movement({ slide: s, pictures, ai, patch, onApplied, goAi, goLookbook }: {
  slide: SlideSpec; pictures: LookImage[]; ai: boolean; patch: (f: Partial<SlideSpec>) => void; onApplied: (text: string) => void; goAi: () => void; goLookbook: () => void;
}) {
  const m: SlideMotion = cleanMotion(s.motion, s.layout) ?? {};
  const [open, setOpen] = useState(!!s.motion);
  const box = useRef<HTMLFieldSetElement>(null);
  const opened = useRef(false);
  useEffect(() => { if (open && opened.current) { opened.current = false; box.current?.querySelector<HTMLElement>('select, input, button')?.focus(); } }, [open]);
  const set = (f: Partial<SlideMotion>) => {
    const next: Record<string, unknown> = { ...m, ...f };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    patch({ motion: cleanMotion(next, s.layout) });
  };
  const enterId = useId(), orderId = useId(), gapId = useId(), endId = useId(), sizeId = useId();
  const path = markerPathOf(s.layout);   // a picture travels only along a plan's timeline
  const paced = (m.order === 'one-by-one' || m.order === 'reverse') && m.entrance !== 'none';
  const lost = !!m.marker && !pictures.some(i => i.id === m.marker!.imageId);
  if (!open) return <div className="pd-optional"><button type="button" className="btn small" onClick={() => { opened.current = true; setOpen(true); }}>Add movement</button></div>;
  return (
    <fieldset className="pd-set pd-move" ref={box}>
      <legend>Movement</legend>
      <p className="hint">How this slide arrives when it comes into view. {LESS_MOTION}</p>
      <div className="pd-fields">
        <div className="ctl"><label htmlFor={enterId}>How it arrives</label>
          <select id={enterId} value={m.entrance ?? ''} onChange={e => set({ entrance: (e.target.value || undefined) as SlideMotion['entrance'] })}>{ENTRANCE_CHOICES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <div className="ctl"><label htmlFor={orderId}>One at a time or together</label>
          <select id={orderId} value={m.order ?? ''} disabled={m.entrance === 'none'} onChange={e => { const order = (e.target.value || undefined) as SlideMotion['order']; set(order === 'one-by-one' || order === 'reverse' ? { order } : { order, stagger: undefined }); }}>{ORDER_CHOICES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        {paced && <div className="ctl pd-scrim"><label htmlFor={gapId}>Gap between one part and the next: {m.stagger ?? 140} ms</label>
          <input id={gapId} type="range" min={40} max={STAGGER_MAX} step={20} value={m.stagger ?? 140} onChange={e => set({ stagger: +e.target.value })} /></div>}
      </div>
      <div className="pd-checks">
        {!NO_HEADLINE.has(s.layout) && <label><input type="checkbox" checked={m.headline === 'type'} onChange={e => set({ headline: e.target.checked ? 'type' : undefined })} /> Type out the headline</label>}
        {COUNTS.has(s.layout) && <label><input type="checkbox" checked={!!m.count} onChange={e => set({ count: e.target.checked ? true : undefined })} /> Count up the numbers</label>}
      </div>
      {path && (
        <div className="pd-marker">
          <p className="pd-sub" id={`${endId}-h`}>A picture that travels along the timeline</p>
          <p className="hint">A small picture from your look book (a logo or a mark works best) crosses the slide once, left to right, along the timeline, and comes to rest at the last milestone.</p>
          {lost && <p className="pd-bad small">The picture chosen here is no longer in the look book. Pick another, or No picture.</p>}
          {pictures.length === 0 && !lost ? <p className="hint">No pictures to choose from yet: add one to the <button type="button" className="pd-link" onClick={goLookbook}>Look book</button>.</p> : (
            <ul className="thumbs" aria-labelledby={`${endId}-h`}>
              <li><button type="button" className="thumb none" data-field="marker" aria-pressed={!m.marker} onClick={() => set({ marker: undefined })}><span className="thumb-none">No picture</span><span className="thumb-mark">{!m.marker ? '✓ Chosen' : 'Choose'}</span></button></li>
              {pictures.map((img, n) => (
                <li key={img.id}><button type="button" className="thumb" aria-pressed={m.marker?.imageId === img.id} onClick={() => set({ marker: { imageId: img.id, path, end: m.marker?.end ?? 'stop', ...(m.marker?.size != null ? { size: m.marker.size } : {}) } })}>
                  <img src={img.dataUrl} alt={(typeof img.caption === 'string' ? img.caption.trim() : '') || `Look book picture ${n + 1}`} loading="lazy" />
                  <span className="thumb-mark">{m.marker?.imageId === img.id ? '✓ Chosen' : 'Choose'}</span>
                </button></li>
              ))}
            </ul>
          )}
          {m.marker && !lost && (
            <div className="pd-fields">
              <div className="ctl"><label htmlFor={endId}>Where it ends</label>
                <select id={endId} value={m.marker.end} onChange={e => set({ marker: { ...m.marker!, end: e.target.value === 'settle' ? 'settle' : 'stop' } })}>
                  <option value="stop">It stops at the last milestone</option>
                  <option value="settle">It rocks once and settles there</option>
                </select></div>
              <div className="ctl pd-scrim wide"><label htmlFor={sizeId}>Its size: {Math.round((m.marker.size ?? 1) * 100)}%</label>
                <input id={sizeId} type="range" min={50} max={200} step={10} value={Math.round((m.marker.size ?? 1) * 100)} onChange={e => set({ marker: { ...m.marker!, size: +e.target.value / 100 } })} /></div>
            </div>
          )}
        </div>
      )}
      {ai ? <MotionOnRequest slide={s} pictures={pictures} patch={patch} onApplied={onApplied} /> : <NoKey what="describe the movement you want in words" goAi={goAi} />}
      {!!s.motion && <div className="row"><button type="button" className="btn small" onClick={() => { patch({ motion: undefined }); onApplied('Movement taken off this slide.'); }}>Remove this slide's movement</button></div>}
    </fieldset>
  );
}

function MotionOnRequest({ slide: s, pictures, patch, onApplied }: { slide: SlideSpec; pictures: LookImage[]; patch: (f: Partial<SlideSpec>) => void; onApplied: (text: string) => void }) {
  const [text, setText] = useState('');
  const ask = useAsk<MotionProposal>();
  const id = useId(), sendsId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const offered = motionPictures(pictures);
  const got = ask.result;
  const words = got ? motionWords(got.motion, s.layout, offered) : [];
  const usable = !!got?.motion && words.length > 0;   // never an Apply that would quietly clear what the slide has
  const whyId = useId();
  const done = (applied: boolean) => { if (applied && got && usable) { patch({ motion: got.motion }); onApplied('Movement applied to this slide.'); } ask.clear(); focusOn(field); };
  return (
    <div className="pd-request">
      <div className="ctl"><label htmlFor={id}>Describe the movement you want</label>
        <textarea id={id} ref={field} rows={2} maxLength={REQUEST_MAX} value={text} aria-describedby={sendsId} placeholder="Have the cards drop in one at a time" onChange={e => setText(e.target.value)} /></div>
      <p className="hint pd-sends" id={sendsId}>{motionSends(s.layout)}</p>
      <div className="row"><Send ask={ask} label="Suggest movement" disabled={!text.trim()} onSend={() => void ask.run(signal => motionOnRequest(text, s.layout, offered, signal))} /></div>
      <Said busy={ask.busy} error={ask.error} note={ask.note} ready={got ? (usable ? 'A suggestion is ready. Nothing changes until you press Apply.' : `${NO_MOVEMENT} Nothing was changed.`) : ''} />
      {got && (
        <div className="pd-proposal" role="group" aria-label={usable ? 'Suggested movement' : 'No movement to suggest'}>
          <p className="pd-sub">{usable ? 'Suggested movement' : NO_MOVEMENT}</p>
          {usable ? <ul>{words.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p id={whyId}>Nothing in the answer was a movement this deck can do, so there is nothing to apply. This slide's movement is as it was. Try other words.</p>}
          {got.note && <p className="pd-note"><b>Note from the model:</b> {got.note}</p>}
          {usable && <p className="hint">Apply replaces this slide's movement with these settings. Undo takes it back.</p>}
          <div className="row"><button type="button" className="btn small primary" disabled={!usable} aria-describedby={usable ? undefined : whyId} onClick={() => done(true)}>Apply</button><button type="button" className="btn small" onClick={() => done(false)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

// ---------- a second line for a headline ----------

export function SecondLine({ headline, body, ai, onUse }: { headline: string; body: string; ai: boolean; onUse: (line: string) => void }) {
  const ask = useAsk<string[]>();
  const button = useRef<HTMLButtonElement>(null);
  const optId = useId();
  if (!ai) return null;
  const empty = !headline.trim() && !body.trim();
  const done = (line?: string) => { if (line) onUse(line); ask.clear(); focusOn(button); };
  return (
    <div className="full pd-assist">
      <div className="row">
        <Send ask={ask} buttonRef={button} label="Suggest a second line" disabled={empty} onSend={() => void ask.run(signal => suggestSecondLines(headline, body, signal))} />
        <span className="hint pd-sends">{empty ? 'Write a headline or some text on this slide first.' : PUNCH_SENDS}</span>
      </div>
      <Said busy={ask.busy} error={ask.error} note={ask.note} ready={ask.result ? `${ask.result.length} suggestion${ask.result.length === 1 ? '' : 's'} ready. Choose one, or discard them.${ask.result.some(l => promiseOfReturns(l).flagged) ? ' One or more cannot be used: it reads like a promise of returns.' : ''}` : ''} />
      {ask.result && (
        <div className="pd-proposal" role="group" aria-label="Suggested second lines">
          <p className="pd-sub">Suggested second lines</p>
          <ul className="pd-options">{ask.result.map((line, i) => {
            const bad = promiseOfReturns(line).flagged; const why = `${optId}-${i}`;
            return <li key={i}><span>{line}{bad && <span className="pd-bad small" id={why}> ✕ {PROMISE_TEXT}</span>}</span><button type="button" className="btn small" aria-label={`Use: ${line}`} disabled={bad} aria-describedby={bad ? why : undefined} onClick={() => done(line)}>Use this one</button></li>;
          })}</ul>
          <div className="row"><button type="button" className="btn small" onClick={() => done()}>Discard them</button><span className="hint">A suggestion, not a fact. Using one fills in the second line; you can still edit it.</span></div>
        </div>
      )}
    </div>
  );
}

// ---------- for one person ----------

export interface PersonContext { film: string; logline: string; askWith: string; askWithout: string; hasGrants: boolean }

export function PersonAssist({ r, ai, hasGrants: grants, context, onApply, goAi }: { r: Recipient; ai: boolean; hasGrants: boolean; context: () => PersonContext; onApply: (s: { coverLine: string; note: string; lead: Recipient['lead'] }) => void; goAi: () => void }) {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState('');   // kept here only: never in the project
  const [draft, setDraft] = useState<PersonSuggestion | null>(null);
  const ask = useAsk<PersonSuggestion>();
  const aboutId = useId(), sendsId = useId(), coverId = useId(), noteId = useId(), leadId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (ask.result) setDraft(ask.result); }, [ask.result]);
  const name = r.name.trim() || 'this person';
  const send = () => { const c = context(); setDraft(null); void ask.run(signal => suggestForPerson({ about, ...c }, signal)); };
  const done = (applied: boolean) => { if (applied && draft) onApply({ coverLine: draft.coverLine, note: draft.note, lead: draft.lead }); setDraft(null); ask.clear(); focusOn(toggle); };
  const verdict = draft ? [promiseOfReturns(draft.note), promiseOfReturns(draft.coverLine)].find(v => v.flagged) : undefined;
  const flagged = !!verdict;
  const whyId = useId();
  if (!ai) return <NoKey what={`get a cover line and a note suggested for ${name}`} goAi={goAi} />;
  return (
    <div className="pd-assist">
      <button ref={toggle} type="button" className="btn small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close the suggestion box' : `Suggest a cover line and note for ${name}`}</button>
      {open && (
        <div className="pd-request">
          <div className="ctl"><label htmlFor={aboutId}>A few lines about {name}, in your words</label>
            <textarea id={aboutId} rows={3} maxLength={ABOUT_MAX} value={about} aria-describedby={sendsId} placeholder="What they back, what they have said they look for, how you know them." onChange={e => setAbout(e.target.value)} /></div>
          <p className="hint pd-sends" id={sendsId}>{personSends(grants)}</p>
          <div className="row"><Send ask={ask} label="Suggest" disabled={!about.trim()} onSend={send} /></div>
          <Said busy={ask.busy} error={ask.error} note={ask.note} ready={draft ? (flagged ? `A suggestion is ready, but it cannot be applied as it is. ${PROMISE_TEXT}` : 'A suggestion is ready. Edit it if you like; nothing changes until you press Apply.') : ''} />
          {draft && (
            <div className="pd-proposal" role="group" aria-label={`Suggestion for ${name}`}>
              <p className="pd-sub">Suggested for {name}</p>
              <div className="pd-fields">
                <div className="ctl full"><label htmlFor={coverId}>Cover line</label><input id={coverId} value={draft.coverLine} maxLength={COVER_MAX} onChange={e => setDraft({ ...draft, coverLine: e.target.value })} /></div>
                <div className="ctl full"><label htmlFor={noteId}>Note to them ({draft.note.length} of {NOTE_MAX} characters)</label><textarea id={noteId} rows={3} value={draft.note} maxLength={NOTE_MAX} onChange={e => setDraft({ ...draft, note: e.target.value })} /></div>
                {grants && <div className="ctl wide"><label htmlFor={leadId}>Ask shown first</label>
                  <select id={leadId} value={draft.lead} onChange={e => setDraft({ ...draft, lead: e.target.value === 'without-grants' ? 'without-grants' : 'with-grants' })}>
                    <option value="with-grants">With grants: the smaller raise</option>
                    <option value="without-grants">Without grants: the whole raise</option>
                  </select></div>}
              </div>
              {flagged && <p className="pd-bad small" id={whyId}>✕ {PROMISE_TEXT} The words that read that way: “{verdict!.phrase}”.</p>}
              <p className="hint">A suggestion, not a fact: check every word against what you know about them. Apply replaces their cover line, note and which ask comes first. Undo takes it back.</p>
              <div className="row"><button type="button" className="btn small primary" disabled={flagged} aria-describedby={flagged ? whyId : undefined} onClick={() => done(true)}>Apply</button><button type="button" className="btn small" onClick={() => done(false)}>Discard</button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- a read of the whole deck ----------

export interface ReadItem { slideId: string; where?: string; message: string; label?: string }

export function ReadMyDeck({ ai, checks, deck, link, toItem, goAi }: {
  ai: boolean; checks: () => ReadItem[]; deck: () => DeckData; link: (item: ReadItem) => ReactNode; toItem: (p: AiProblem) => ReadItem; goAi: () => void;
}) {
  const [found, setFound] = useState<ReadItem[] | null>(null);
  const ask = useAsk<AiProblem[]>();
  const button = useRef<HTMLButtonElement>(null);
  const read = () => { ask.clear(); setFound(checks()); };
  const close = () => { ask.clear(); setFound(null); focusOn(button); };
  const list = (items: ReadItem[]) => <ul className="pd-fixes">{items.map((it, i) => <li key={i}>{link(it)}{it.label ? <b>{it.label}. </b> : null}{it.message}</li>)}</ul>;
  return (
    <div className="pd-read">
      <h3 id="pd-read-h">Read my deck</h3>
      <div className="row"><button ref={button} type="button" className="btn small" onClick={read}>{found ? 'Read it again' : 'Read my deck'}</button>{found && <button type="button" className="btn small" onClick={close}>Close</button>}</div>
      <div className="pd-said" role="status" aria-live="polite">{found ? (found.length ? `${found.length} thing${found.length === 1 ? '' : 's'} found without AI.` : 'The checks that need no AI found nothing.') : ''}</div>
      {found && (
        <>
          <p className="pd-sub">Found without AI</p>
          {found.length ? list(found) : <p className="hint">Nothing: every number has a source, nothing runs off a slide, nothing reads as a promise of returns, and the ask says how to answer it.</p>}
          <p className="pd-sub">A closer read, with AI</p>
          {ai ? (
            <>
              <p className="hint pd-sends">{CRITIQUE_SENDS}</p>
              <div className="row"><Send ask={ask} label="Ask the AI to read it too" busyLabel="Reading…" onSend={() => void ask.run(signal => readTheDeck(deck(), signal))} /></div>
              <Said busy={ask.busy} error={ask.error} note={ask.note} waiting="Reading the deck. This takes a little while. Stop ends it." ready={ask.result ? (ask.result.length ? `${ask.result.length} thing${ask.result.length === 1 ? '' : 's'} to look at.` : 'The AI read found nothing to report.') : ''} />
              {ask.result && (ask.result.length ? list(ask.result.map(toItem)) : <p className="hint">Nothing to report. That is not a promise the deck is right: read it once more yourself.</p>)}
              {ask.result && ask.result.length > 0 && <p className="hint">Suggestions, not rules. Nothing on your deck was changed.</p>}
            </>
          ) : <NoKey what="have the deck read for vague claims, weak headlines and an unclear ask" goAi={goAi} />}
        </>
      )}
    </div>
  );
}
export const kindLabel = (p: AiProblem): string => KIND_WORDS[p.kind];
