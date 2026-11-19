// The Google Fonts picker: a dialog that lists the bundled catalogue, shows each family in the film's own title (or a
// sentence, for body text) once the person has agreed to previews from Google, and downloads the family they pick
// into the project. Loaded only when the picker is opened. Nothing here asks Google for anything itself: that is
// googleFontsNet.ts, and it refuses until the answer is yes.
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FontFile } from '../engine/types';
import {
  CATEGORY_NAMES, FONT_CATEGORIES, GOOGLE_DISCLOSURE, LICENCE_NAMES, planInWords, searchCatalogue, weightsFor, weightsInWords,
  type Catalogue, type CatalogueFamily, type FontCategory, type FontRole, type FontSort,
} from '../engine/googleFonts';
import { GoogleFontsError, OFFLINE_WORDS, PreviewLoader, UNREACHABLE_WORDS, allowGoogleFonts, fetchGoogleFamily, googleFontsAllowed, loadCatalogue, type PreviewState } from './googleFontsNet';

const ROW_WITH_PREVIEW = 84, ROW_PLAIN = 46, OVERSCAN = 4;
const LOOK_MS = 140;   // a row has to stay in view this long before its preview is asked for: scrolling past asks for nothing
const FALLBACK: Record<FontCategory, string> = { 'sans-serif': 'sans-serif', serif: 'serif', display: 'sans-serif', handwriting: 'cursive', monospace: 'monospace' };
const BODY_SAMPLE = 'A story worth telling, set in this font. 0123456789';
const ROLE_WORD: Record<FontRole, string> = { title: 'title', body: 'body' };

export interface GoogleFontsDialogProps {
  role: FontRole;
  film: string;                 // the film's title: what a title font is shown in
  current?: string;             // the family the role has now, if it came from here
  onPick: (family: CatalogueFamily, files: FontFile[]) => void;
  onClose: () => void;
}

export default function GoogleFontsDialog({ role, film, current, onPick, onClose }: GoogleFontsDialogProps) {
  const titleId = useId(), aboutId = useId(), listId = useId(), hintId = useId(), searchId = useId(), sortId = useId();
  const card = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), yes = useRef<HTMLButtonElement>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [failed, setFailed] = useState(false);
  const [previews, setPreviews] = useState(googleFontsAllowed);          // the person has said yes to Google, now or earlier in this session
  const [asked, setAsked] = useState(googleFontsAllowed);                 // the question has been answered (either way) since the dialog opened
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | ''>('');
  const [sort, setSort] = useState<FontSort>('popular');
  const [active, setActive] = useState(0);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(480);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [confirm, setConfirm] = useState<CatalogueFamily | null>(null);   // a font chosen before any yes: the question is asked again, for the download
  const [isOffline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [, redraw] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const loader = useMemo(() => new PreviewLoader(() => redraw(n => n + 1)), []);
  const sample = role === 'title' ? (film.trim() || 'The title of your film') : BODY_SAMPLE;

  useEffect(() => { let gone = false; loadCatalogue().then(c => { if (!gone) setCatalogue(c); }, () => { if (!gone) setFailed(true); }); return () => { gone = true; }; }, []);
  useEffect(() => () => { loader.close(); abort.current?.abort(); }, [loader]);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const before = document.body.style.overflow; document.body.style.overflow = 'hidden';   // the page behind does not scroll under the dialog
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.body.style.overflow = before; };
  }, []);
  // the keyboard starts on the answer when there is a question, and in the search box when there is not
  const listed = !!catalogue;
  useEffect(() => { if (!asked) yes.current?.focus(); else search.current?.focus(); }, [asked, listed]);

  const blocked = previews && (isOffline || loader.unreachable);     // a yes, and Google out of reach: the list goes back to names
  const rowH = previews && !blocked ? ROW_WITH_PREVIEW : ROW_PLAIN;
  const rows = useMemo(() => (catalogue ? searchCatalogue(catalogue.families, { query, category, sort }) : []), [catalogue, query, category, sort]);
  const at = Math.min(active, Math.max(0, rows.length - 1));
  const chosen: CatalogueFamily | undefined = rows[at];
  useEffect(() => { setActive(0); setTop(0); if (scroller.current) scroller.current.scrollTop = 0; }, [query, category, sort]);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const measure = () => setHeight(el.clientHeight || 480);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [asked, catalogue]);

  /** Moves the highlight and brings its row into view. */
  const go = useCallback((to: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, to));
    setActive(n);
    const el = scroller.current; if (!el) return;
    const y = n * rowH;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + rowH > el.scrollTop + el.clientHeight) el.scrollTop = y + rowH - el.clientHeight;
  }, [rows.length, rowH]);

  const use = useCallback(async (f: CatalogueFamily | undefined) => {
    if (!f || busy) return;
    setProblem('');
    if (!googleFontsAllowed()) { setConfirm(f); return; }
    const ctl = new AbortController(); abort.current = ctl;
    setBusy(f.family);
    try { onPick(f, await fetchGoogleFamily(f, role, ctl.signal)); }
    catch (e) {
      if (ctl.signal.aborted) return;
      setProblem(e instanceof GoogleFontsError ? e.message : `${f.family} could not be saved: ${(e as Error)?.message ?? 'something went wrong'}. Nothing in your project was changed.`);
    }
    finally { if (abort.current === ctl) { abort.current = null; setBusy(''); } }
  }, [busy, onPick, role]);

  const sayYes = () => { allowGoogleFonts(); setPreviews(true); setAsked(true); };
  const close = () => { abort.current?.abort(); onClose(); };

  const listKeys = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor(height / rowH) - 1);
    const move: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, PageDown: at + page, PageUp: at - page };
    if (e.key in move) { e.preventDefault(); go(move[e.key]); }
    else if (e.key === 'Home' && e.currentTarget !== search.current) { e.preventDefault(); go(0); }
    else if (e.key === 'End' && e.currentTarget !== search.current) { e.preventDefault(); go(rows.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); void use(chosen); }
  };
  // Escape and Tab are heard on the whole page while the dialog is open, so they work wherever the keyboard is (a
  // control that has just gone away leaves it on the page itself).
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (confirm) setConfirm(null); else close(); return; }
    if (e.key !== 'Tab') return;
    // the keyboard stays in the dialog: Tab from the last control goes to the first, and back
    const stops = [...(card.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? [])];
    if (!stops.length) { e.preventDefault(); return; }
    const first = stops[0], last = stops[stops.length - 1], here = document.activeElement;
    const outside = !card.current?.contains(here);
    if (e.shiftKey && (here === first || outside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (here === last || outside)) { e.preventDefault(); first.focus(); }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', on, true);
    return () => document.removeEventListener('keydown', on, true);
  }, []);

  const total = catalogue?.families.length ?? 0;
  const count = !catalogue ? '' : rows.length === 0 ? 'No font matches. Try fewer letters, or another kind.' : rows.length === total ? `${total.toLocaleString('en-US')} fonts` : `${rows.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} fonts`;
  const from = Math.max(0, Math.floor(top / rowH) - OVERSCAN), to = Math.min(rows.length, Math.ceil((top + height) / rowH) + OVERSCAN);
  const plan = chosen ? weightsFor(role, chosen) : null;
  return createPortal(
    <div className="modal gf-modal" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-card gf" ref={card} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={!asked ? aboutId : undefined}>
        <div className="row gf-head">
          <h2 id={titleId}>Pick a {ROLE_WORD[role]} font from Google Fonts</h2>
          <button type="button" className="btn small" onClick={close}>Close (Esc)</button>
        </div>

        {!asked ? (
          <div className="gf-ask">
            <p id={aboutId}>{GOOGLE_DISCLOSURE}</p>
            <div className="row">
              <button type="button" className="btn primary" ref={yes} onClick={sayYes}>Show the fonts</button>
              <button type="button" className="btn" onClick={() => setAsked(true)}>Not now</button>
            </div>
            <p className="hint">Not now still lists every font by name, with no previews, and asks Google for nothing.</p>
          </div>
        ) : failed ? (
          <p className="notice bad" role="alert">The list of fonts could not be loaded. Close this and try again; if the app was opened without a connection, reload the page when you have one.</p>
        ) : !catalogue ? (
          <p className="help" role="status">Loading the list…</p>
        ) : (
          <>
            <div className="gf-tools">
              <div className="ctl gf-search"><label htmlFor={searchId}>Search fonts</label>
                <input id={searchId} ref={search} type="search" value={query} placeholder="Type part of a name" autoComplete="off" spellCheck={false} aria-controls={listId} aria-describedby={hintId} onChange={e => setQuery(e.target.value)} onKeyDown={listKeys} /></div>
              <div className="ctl gf-sort"><label htmlFor={sortId}>Order</label>
                <select id={sortId} value={sort} onChange={e => setSort(e.target.value as FontSort)}>
                  <option value="popular">{catalogue.rank === 'google' ? 'Most used first' : 'Well known first'}</option>
                  <option value="az">A to Z</option>
                </select></div>
              <div className="gf-kinds" role="group" aria-label="Kind of font">
                <button type="button" className="gf-chip" aria-pressed={category === ''} onClick={() => setCategory('')}>All</button>
                {FONT_CATEGORIES.map(c => <button type="button" key={c} className="gf-chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>{CATEGORY_NAMES[c]}</button>)}
              </div>
            </div>
            <div className="gf-count small" role="status" aria-live="polite" aria-atomic="true">{count}</div>

            {!previews && (
              <div className="gf-banner">
                <p className="small"><b>Previews are off.</b> {GOOGLE_DISCLOSURE}</p>
                <button type="button" className="btn small primary" onClick={sayYes}>Show the fonts</button>
              </div>
            )}
            {blocked && (
              <div className="gf-banner bad" role="alert">
                <p className="small">{isOffline ? OFFLINE_WORDS : UNREACHABLE_WORDS}</p>
                {!isOffline && <button type="button" className="btn small" onClick={() => loader.retry()}>Try again</button>}
              </div>
            )}

            <div className="gf-list" ref={scroller} id={listId} role="listbox" tabIndex={0} aria-label={`Fonts for the ${ROLE_WORD[role]}`} aria-describedby={hintId}
              aria-activedescendant={chosen ? `${listId}-${at}` : undefined} onScroll={e => setTop(e.currentTarget.scrollTop)} onKeyDown={listKeys}>
              <FontRows rows={rows} from={from} to={to} rowH={rowH} active={at} listId={listId} current={current} previews={previews && !blocked} loader={loader} root={scroller}
                sample={sample} big={role === 'title'} onActive={setActive} onUse={f => void use(f)} />
            </div>
            <p className="pd-vh" id={hintId}>Arrow keys move through the list. Enter uses the font. Escape closes.</p>

            <div className="gf-foot">
              {confirm ? (
                <div className="gf-confirm" role="group" aria-label={`Download ${confirm.family} from Google Fonts?`}>
                  <p className="small"><b>To use {confirm.family}, its files are downloaded from Google Fonts.</b> {GOOGLE_DISCLOSURE}</p>
                  <div className="row">
                    <button type="button" className="btn small primary" autoFocus onClick={() => { const f = confirm; setConfirm(null); sayYes(); void use(f); }}>Download {confirm.family}</button>
                    <button type="button" className="btn small" onClick={() => setConfirm(null)}>Not now</button>
                  </div>
                </div>
              ) : (
                <div className="row gf-use">
                  <div className="gf-plan small">
                    {chosen && plan ? <><b>{chosen.family}</b> for the {ROLE_WORD[role]}: {planInWords(plan).toLowerCase()} {plan.italic === undefined && (plan.range || plan.bold === undefined) ? 'is' : 'are'} saved into your project. {LICENCE_NAMES[chosen.licence]}: free to use and to send inside a deck.</> : 'Choose a font from the list.'}
                  </div>
                  <button type="button" className="btn primary" disabled={!chosen} aria-disabled={busy ? true : undefined} onClick={() => void use(chosen)}>{busy ? `Getting ${busy}…` : chosen ? `Use ${chosen.family}` : 'Use this font'}</button>
                </div>
              )}
              <div role="status" aria-live="polite" className="pd-vh">{busy ? `Getting ${busy} from Google Fonts.` : ''}</div>
              {problem && <p className="pd-bad small" role="alert">✕ {problem}</p>}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface RowsProps {
  rows: CatalogueFamily[]; from: number; to: number; rowH: number; active: number; listId: string; current?: string; previews: boolean; loader: PreviewLoader;
  root: React.RefObject<HTMLDivElement | null>; sample: string; big: boolean; onActive: (i: number) => void; onUse: (f: CatalogueFamily) => void;
}
/** The rows on screen (and a few either side) out of however many match: the list is as tall as all of them, and only
 *  these are in the page. A row's preview is asked for once the row has been in view for a moment. */
function FontRows({ rows, from, to, rowH, active, listId, current, previews, loader, root, sample, big, onActive, onUse }: RowsProps) {
  const [watch, setWatch] = useState<IntersectionObserver | null>(null);
  const looking = useRef(new Map<Element, { family: CatalogueFamily; timer: number | null }>());
  useEffect(() => {
    if (!previews || typeof IntersectionObserver === 'undefined' || !root.current) { setWatch(null); return; }
    const seen = looking.current;
    const io = new IntersectionObserver(entries => {
      for (const en of entries) {
        const row = seen.get(en.target); if (!row) continue;
        if (en.isIntersecting && row.timer === null) row.timer = window.setTimeout(() => { row.timer = null; loader.want(row.family); }, LOOK_MS);
        else if (!en.isIntersecting) { if (row.timer !== null) { clearTimeout(row.timer); row.timer = null; } loader.drop(row.family.family); }
      }
    }, { root: root.current, threshold: 0.2 });
    setWatch(io);
    return () => { io.disconnect(); for (const r of seen.values()) if (r.timer !== null) clearTimeout(r.timer); seen.clear(); };
  }, [previews, loader, root]);
  const see = useCallback((el: Element, family: CatalogueFamily) => {
    if (!watch) return () => undefined;
    const seen = looking.current;
    seen.set(el, { family, timer: null }); watch.observe(el);
    return () => { const r = seen.get(el); if (r?.timer != null) clearTimeout(r.timer); seen.delete(el); watch.unobserve(el); loader.drop(family.family); };
  }, [watch, loader]);
  return (
    <div className="gf-rows" style={{ height: rows.length * rowH }}>
      {rows.slice(from, to).map((f, k) => {
        const i = from + k;
        return <FontRowView key={f.family} f={f} i={i} n={rows.length} y={i * rowH} h={rowH} id={`${listId}-${i}`} active={i === active} mine={!!current && current === f.family}
          state={previews ? loader.state(f.family) : undefined} face={loader.faceName(f.family)} previews={previews} sample={sample} big={big} see={see} onActive={onActive} onUse={onUse} />;
      })}
    </div>
  );
}

interface RowProps {
  f: CatalogueFamily; i: number; n: number; y: number; h: number; id: string; active: boolean; mine: boolean; state: PreviewState | undefined; face: string; previews: boolean; sample: string; big: boolean;
  see: (el: Element, f: CatalogueFamily) => () => void; onActive: (i: number) => void; onUse: (f: CatalogueFamily) => void;
}
const FontRowView = memo(function FontRowView({ f, i, n, y, h, id, active, mine, state, face, previews, sample, big, see, onActive, onUse }: RowProps) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => (el.current ? see(el.current, f) : undefined), [see, f]);
  const ready = state === 'ready';
  return (
    <div ref={el} id={id} role="option" aria-selected={active} aria-posinset={i + 1} aria-setsize={n} className={`gf-row${active ? ' on' : ''}`} style={{ top: y, height: h }}
      onClick={() => onActive(i)} onDoubleClick={() => onUse(f)}>
      <div className="gf-row-head">
        <span className="gf-name">{f.family}</span>
        <span className="gf-meta">{CATEGORY_NAMES[f.category]} · {weightsInWords(f)} · {f.licence}</span>
        {mine && <span className="gf-mine">✓ In your project</span>}
      </div>
      {previews && (state === 'failed'
        ? <div className="gf-sample none" aria-hidden="true">No preview just now</div>
        : <div className={`gf-sample${big ? ' big' : ''}${ready ? '' : ' wait'}`} aria-hidden="true" style={ready ? { fontFamily: `"${face}", ${FALLBACK[f.category]}` } : undefined}>{sample}</div>)}
    </div>
  );
});
