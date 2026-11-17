// The deck's runtime: draws a DeckData into a DOM element as 16:9 slides. No framework, no network, no markup
// built from strings: every piece of the author's text goes in as a text node. The same file is mounted in the
// app as a live preview and inlined into the exported .html, so it may import nothing but the two pure math
// modules below (and types).
//
// The data is treated as untrusted: a hand-edited or hostile file must never throw here. Every text field goes
// through `str()`, every list through `list()`, and the funding inputs and recipients are rebuilt by
// `cleanPaths()` and `cleanRecipients()` before anything reads them.
import { allSwitches, pathFor } from '../engine/pathMath';
import type { PathInputs, PathResult } from '../engine/pathMath';
import type { DeckData, DeckRecipient } from './data';
import { money, moneyParts, multiple, shares100 } from './format';
import { cleanFamily, faceName, fontSrcOk, MAX_FONT_FACES } from './fonts';

export type Lead = 'with-grants' | 'without-grants';

export interface MountOptions {
  recipient?: string;      // a DeckRecipient.slug
  lead?: Lead;             // overrides the recipient's lead
  static?: boolean;        // no motion, every slide in its final state, print-safe (for PDF)
  useHash?: boolean;       // read and follow location.hash (default false; the exported file turns it on)
  css?: string;            // the stylesheet text; when omitted the caller has already provided styles
  pageKeys?: boolean;      // also page on arrow keys pressed while nothing on the page has focus (for a page that is only the deck)
  stacked?: boolean;       // the stacked reading layout: true always; false never (a scaled preview: small print has no pixel floor
                           // either, so `checkOverflow` says what is true at full size); left out, it follows the size of the host
  startAt?: number;        // the slide to open on (an index into the slides drawn); the deck is there at once, with no scroll to watch
  motion?: boolean;        // false: nothing rises or drops in, every slide is in its final state, and the deck still pages and switches (an editor's preview)
  onSlide?: (index: number) => void;   // told when another slide becomes the current one, by paging or by scrolling
}
export interface DeckHandle {
  destroy(): void;
  /** Shows the deck as tailored for one recipient (null, or a slug nobody has: the general deck). Every switch goes
   *  back to how that recipient's deck opens (the saved sources, grants off for a without-grants lead) and a lead
   *  set earlier with `setLead` or `opts.lead` is forgotten. */
  setRecipient(slug: string | null): void;
  /** Sets the grants switch only: on as saved for 'with-grants', off for 'without-grants'. Every other switch and the
   *  recipient stay as they are. The lead holds until the next `setRecipient` (or link change). */
  setLead(lead: Lead): void;
  setSwitch(key: string, on: boolean): void;
  goTo(index: number): void;
  readonly slideCount: number;
  /** Fits every slide now (real browsers only): steps a slide's type down while its content spills, sets
   *  `data-overflow` on each and returns the indexes that still overflow at the smallest size. */
  checkOverflow(): number[];
}

export const GRANTS_KEY = 'grants';
export const DEFAULT_LEGAL = 'The figures in this deck are illustrative projections, not a promise of returns. Investing in a film is speculative and investors can lose all of the money they put in. This deck is not an offer to sell securities.';
export const MAX_SOURCES = 8;
const MAX_CASES = 12;
const TITLE_FALLBACK = '"Special Elite", "Courier New", monospace';
const BODY_FALLBACK = '"Work Sans", system-ui, sans-serif';
const DEFAULT_SCRIM = 0.7;
const MIN_SCRIM = 0.85;                 // under the text of a picture slide, at least this much of the background colour
const FIT_STEPS = [1.4, 1.25, 1.1];     // a slide's base type size, in hundredths of its width; stepped down while it overflows
const PAGE_STYLE_ID = 'psd-page-style';
// A named page, so the rule changes nothing else the host document prints.
const PAGE_CSS = '@page psd-deck{size:1600px 900px;margin:0}';

const live = new WeakMap<HTMLElement, DeckHandle>();                                   // one deck per host
// Font files are registered on the document (an @font-face rule does nothing inside a shadow tree), once per file,
// counted, and taken off again when the last deck that uses one has gone.
interface FaceLike { load?: () => Promise<unknown>; status?: string }
interface FaceSet { add(f: FaceLike): unknown; delete(f: FaceLike): unknown }
const facePool = new WeakMap<Document, Map<string, { face: FaceLike; n: number }>>();

/** The font files a theme carries that are safe to use: a clean family name, a base64 font data URL, a known role. */
export function cleanFontFaces(raw: unknown): { family: string; src: string; role: 'title' | 'body' }[] {
  const out: { family: string; src: string; role: 'title' | 'body' }[] = [];
  for (const f of list(raw)) {
    const family = cleanFamily(f.family);
    if (!family || !fontSrcOk(f.src) || (f.role !== 'title' && f.role !== 'body')) continue;
    out.push({ family, src: f.src, role: f.role });
    if (out.length >= MAX_FONT_FACES) break;
  }
  return out;
}
const pageStyles = new WeakMap<Document, { st: HTMLStyleElement; n: number }>();       // one @page rule per document, counted

// ---------- reading untrusted data ----------

type Obj = Record<string, unknown>;
/** Text from anything: a string as it is, a finite number as its digits, everything else empty. */
export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) as Obj[]) : []);
const has = (v: unknown): boolean => str(v).trim() !== '';
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => str(x).trim()).filter(Boolean) : []);
const paragraphs = (text: unknown): string[] => str(text).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
const imageOk = (src: string) => /^(data:image\/|blob:)/i.test(src);   // nothing that would go to the network
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];

/** The funding inputs with everything a hand-edited file can get wrong taken out: sources without a key, with a
 *  key that names something on every object, or with a key already used are dropped; at most MAX_SOURCES are read. */
export function cleanPaths(raw: unknown): PathInputs {
  const p = obj(raw), w = obj(p.waterfall), seen = new Set<string>();
  const sources: PathInputs['sources'] = [];
  for (const s of list(p.sources)) {
    const key = str(s.key);
    if (!key || BAD_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    sources.push({ key, label: str(s.label).trim() || key, amount: Math.max(0, num(s.amount)), on: !!s.on, note: str(s.note) });
    if (sources.length >= MAX_SOURCES) break;
  }
  return {
    cashBudget: Math.max(0, num(p.cashBudget)), deferred: Math.max(0, num(p.deferred)), sources,
    waterfall: { model: w.model === 'recoup-first' ? 'recoup-first' : 'off-the-gross', recoupPct: num(w.recoupPct), poolPct: num(w.poolPct), grossSharePct: num(w.grossSharePct) },
    cases: list(p.cases).slice(0, MAX_CASES).map(c => ({ label: str(c.label), gross: Math.max(0, num(c.gross)) })),
    feePct: num(p.feePct),
  };
}

/** A link ending the deck reads as a switch, so nobody can have it: the same rule the engine applies. */
export const reservedSlug = (slug: string): boolean => /^(with|without)(-grants)?$/.test(slug) || /-(with|without)$/.test(slug);

/** The recipients a deck can be shown for: each needs a link ending of its own that is not a reserved one. */
export function cleanRecipients(raw: unknown): DeckRecipient[] {
  const out: DeckRecipient[] = [], seen = new Set<string>();
  for (const r of list(raw)) {
    const slug = str(r.slug).trim();
    if (!slug || seen.has(slug) || reservedSlug(slug.toLowerCase())) continue;
    seen.add(slug);
    out.push({ slug, name: str(r.name), coverLine: str(r.coverLine), note: str(r.note), lead: r.lead === 'without-grants' ? 'without-grants' : 'with-grants', highlightCardId: str(r.highlightCardId) });
  }
  return out;
}

// ---------- pure helpers (exported for tests) ----------

/** What a link ending asks for. `slug` is null for the general deck; `lead` is set only when the hash names one. */
export function parseHash(hash: string, slugs: string[]): { slug: string | null; lead?: Lead } {
  let s = (hash || '').replace(/^#/, '');
  try { s = decodeURIComponent(s); } catch { /* keep it as typed */ }
  s = s.trim().toLowerCase();
  if (!s) return { slug: null };
  const leadOf = (t: string): Lead | undefined => (t === 'without' ? 'without-grants' : t === 'with' ? 'with-grants' : undefined);
  const known = [...new Set(slugs.filter(Boolean))].sort((a, b) => b.length - a.length);   // longest first
  for (const slug of known) if (s === slug) return { slug };
  for (const slug of known) {
    if (!s.startsWith(`${slug}-`)) continue;
    const lead = leadOf(s.slice(slug.length + 1));
    if (lead) return { slug, lead };
  }
  const alone = leadOf(s);
  return alone ? { slug: null, lead: alone } : { slug: null };
}

/** The switches a deck opens with: each source as saved, and the grants source off when the lead is without grants.
 *  The object has no prototype, so no source key can collide with anything inherited. */
export function initialSwitches(sources: { key: string; on: boolean }[], lead: Lead): Record<string, boolean> {
  const out: Record<string, boolean> = Object.create(null);
  for (const s of sources) out[s.key] = s.key === GRANTS_KEY && lead === 'without-grants' ? false : !!s.on;
  return out;
}

export interface AskPiece { text: string; amount?: boolean }
/** An ask body with its tokens filled. `grants` null means the deck has no grants source: the token is taken out. */
export function fillAsk(template: string, investors: string, grants: string | null): AskPiece[] {
  let t = template || '';
  if (grants == null) t = t.replace(/\s*\{grants\}/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1');
  const out: AskPiece[] = [];
  for (const part of t.split(/(\{investors\}|\{grants\})/)) {
    if (!part) continue;
    if (part === '{investors}') out.push({ text: investors, amount: true });
    else if (part === '{grants}') out.push({ text: grants as string, amount: true });
    else out.push({ text: part });
  }
  return out;
}

/** Whether content of the given size spills out of its box. Sizes are injected so this can be tested without a browser. */
export function overflows(box: { width: number; height: number }, content: { width: number; height: number }, tolerance = 2): boolean {
  if (!(box.width > 0) || !(box.height > 0)) return false;   // not laid out: nothing can be said
  return content.height > box.height + tolerance || content.width > box.width + tolerance;
}

const COLOR_OK = /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z.,%\s/+-]*\))$/i;
/** A colour that is safe to put in a custom property: nothing that could load a URL or close the declaration. */
export function safeColor(value: unknown, fallback: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  return v && COLOR_OK.test(v) ? v : fallback;
}
/** A font stack with anything but names, quotes, commas and hyphens taken out, followed by the built-in fallback. */
export function fontStack(value: unknown, fallback: string): string {
  const v = typeof value === 'string' ? value.replace(/[^A-Za-z0-9 ,'"_-]/g, '').trim().replace(/^,+|,+$/g, '') : '';
  const balanced = v && (v.match(/"/g) ?? []).length % 2 === 0 && (v.match(/'/g) ?? []).length % 2 === 0;
  return balanced ? `${v}, ${fallback}` : fallback;
}

// ---------- colour: contrast is worked out from the theme, whatever the theme is ----------

type RGB = [number, number, number];
const BLACK = '#000000', WHITE = '#ffffff';   // the two ends of the scale, for a theme whose own ink cannot be read

/** Red, green and blue (0 to 255) of a hex or rgb() colour; null for anything else (a name, oklch(), ...). */
export function parseColor(color: string): RGB | null {
  const s = str(color).trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const h = hex[1].length < 6 ? [...hex[1]].map(ch => ch + ch).join('') : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(s);
  return m ? ([1, 2, 3].map(i => Math.min(255, +m[i])) as RGB) : null;
}
const hexOf = (c: RGB) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
function luminance(c: RGB): number {
  const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The WCAG contrast ratio of two colours (1 to 21); 0 when either cannot be read as a colour. */
export function contrastRatio(a: string, b: string): number {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y) return 0;
  const la = luminance(x), lb = luminance(y);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** `a` with `t` (0 to 1) of `b` mixed in, as hex; `a` unchanged when either cannot be read as a colour. */
export function mixColors(a: string, b: string, t: number): string {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y) return a;
  const k = Math.max(0, Math.min(1, t));
  return hexOf(x.map((v, i) => v + (y[i] - v) * k) as RGB);
}
const worst = (color: string, surfaces: string[]) => Math.min(21, ...surfaces.map(s => contrastRatio(color, s)).filter(r => r > 0));
/** `color`, moved toward `toward` only as far as it takes to reach `min` contrast against every surface. A colour
 *  that already passes comes back untouched. When even `toward` falls short, black or white, whichever reads better. */
export function textSafe(color: string, surfaces: string[], toward: string, min = 4.5): string {
  if (!parseColor(color)) return parseColor(toward) ? toward : color;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = t === 0 ? color : mixColors(color, toward, t);
    if (worst(c, surfaces) >= min) return c;
  }
  return worst(BLACK, surfaces) >= worst(WHITE, surfaces) ? BLACK : WHITE;
}
/** Of two candidate inks, the one that reads better on `surface` (the first when the colours cannot be compared). */
export function readableOn(surface: string, a: string, b: string): string {
  return contrastRatio(surface, b) > contrastRatio(surface, a) ? b : a;
}

/** Every colour the stylesheet uses, as custom properties, worked out from the theme. The theme's accent, second
 *  accent and muted colours are used as they are for fills only; text gets a `-text` version that is the same
 *  colour moved toward the ink until it reaches 4.5:1 on the background (and on the faint panels drawn over it).
 *  `picture` is how much of a picture can show through under the text of a picture slide (0 to 1); with it, only
 *  the text colours are returned, safe on the background with that much of anything, dark or light, behind it. */
export function deckColors(colors: unknown, picture = 0): Record<string, string> {
  const c = obj(colors);
  const bg = safeColor(c.bg, WHITE), rawInk = safeColor(c.ink, '#111111');
  const accent = safeColor(c.accent, rawInk), accent2 = safeColor(c.accent2, accent), muted = safeColor(c.muted, rawInk);
  const card = safeColor(c.card, bg);
  const on = picture > 0 ? [bg, mixColors(bg, BLACK, picture), mixColors(bg, WHITE, picture)] : [bg];
  const ink = textSafe(rawInk, on, rawInk);
  const surfaces = [...on, ...on.map(s => mixColors(s, ink, 0.07))];   // the page, and the faint panels (toggles, steps) on it
  const t = (color: string) => textSafe(color, surfaces, ink);
  const text = {
    '--psd-ink': ink, '--psd-accent-text': t(accent), '--psd-accent2-text': t(accent2), '--psd-muted-text': t(muted),
    '--psd-soft': t(mixColors(ink, bg, 0.18)), '--psd-legal': t(mixColors(ink, bg, 0.25)),
  };
  if (picture > 0) return text;
  const cardInk = textSafe(safeColor(c.cardInk, rawInk), [card], rawInk);
  const row = mixColors(bg, accent, 0.15);
  const onFill = (fill: string) => textSafe(readableOn(fill, bg, ink), [fill], ink);
  return {
    ...text,
    '--psd-bg': bg, '--psd-accent': accent, '--psd-accent2': accent2, '--psd-muted': muted, '--psd-line': safeColor(c.line, rawInk),
    '--psd-card': card, '--psd-card-ink': cardInk,
    '--psd-card-accent': textSafe(accent, [card], cardInk), '--psd-card-muted': textSafe(mixColors(cardInk, card, 0.3), [card], cardInk),
    '--psd-on-accent': onFill(accent), '--psd-on-accent2': onFill(accent2),
    '--psd-row': row, '--psd-row-text': textSafe(accent, [row], ink), '--psd-row-ink': textSafe(ink, [row], ink),
    '--psd-seg1': mixColors(accent2, ink, 0.5), '--psd-seg2': mixColors(accent2, bg, 0.5),
  };
}

// ---------- the mount ----------

type Kid = Node | string | null | undefined | false;
interface Part { index: number; layout: string; section: HTMLElement; box: HTMLElement; cells: HTMLElement[]; update?: () => void }
type Timer = ReturnType<typeof setTimeout>;

interface TakenFaces { faces: { family: string; src: string; role: 'title' | 'body'; name: string }[]; loads: Promise<unknown>[]; release: () => void }
/** Registers a theme's font files with the document and says what each was registered as. `release` lets go of them
 *  (once: a second call does nothing); a face another deck still holds stays. */
function takeFaces(doc: Document, win: (Window & typeof globalThis) | null, theme: unknown): TakenFaces {
  const faces = cleanFontFaces(obj(theme).fontFaces).map(f => ({ ...f, name: faceName(f.role, f.family, f.src) }));
  const releases: (() => void)[] = [];
  const loads: Promise<unknown>[] = [];
  const Face = win && (win as unknown as { FontFace?: new (family: string, src: string) => FaceLike }).FontFace;
  const set = (doc as unknown as { fonts?: FaceSet }).fonts;
  if (Face && set && typeof set.add === 'function') {
    let pool = facePool.get(doc);
    if (!pool) { pool = new Map(); facePool.set(doc, pool); }
    const mine = pool;
    for (const f of faces) {
      const key = `${f.name}\n${f.src}`;   // the name carries a hash of the file; the file itself settles the one-in-a-billion clash
      let entry = mine.get(key);
      if (!entry) {
        try {
          const face = new Face(f.name, `url("${f.src}")`);   // the address was checked: base64 only, so nothing in it can close the quotes
          set.add(face);
          entry = { face, n: 0 };
          mine.set(key, entry);
        } catch { continue; }   // a file the browser will not take: the stack falls through to the next family
      }
      entry.n++;
      const held = entry;
      const p = held.face.status === 'loaded' ? null : held.face.load?.();
      if (p && typeof p.then === 'function') loads.push(p.then(() => undefined, () => undefined));
      releases.push(() => { if (--held.n <= 0) { try { set.delete(held.face); } catch { /* already gone */ } if (mine.get(key) === held) mine.delete(key); } });
    }
  }
  return { faces, loads, release: () => { for (const fn of releases.splice(0)) fn(); } };
}

export function mountDeck(host: HTMLElement, data: DeckData, opts: MountOptions = {}): DeckHandle {
  const doc = host.ownerDocument;
  // font files are taken before the deck this one replaces lets go of its own, so a face both use is never dropped and read again
  const taken = takeFaces(doc, doc.defaultView, obj(obj(data).theme));
  try { return mountWith(host, data, opts, taken); }
  catch (err) { taken.release(); throw err; }   // a mount that fails leaves nothing registered behind it
}

function mountWith(host: HTMLElement, data: DeckData, opts: MountOptions, taken: TakenFaces): DeckHandle {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const d = obj(data);
  const faces = taken.faces, faceLoads = taken.loads;
  live.get(host)?.destroy();   // a host shows one deck: the one before this goes first, with its listeners
  const isStatic = !!opts.static;
  const cur = str(d.currency) || 'USD';
  const film = str(d.film);
  const paths = cleanPaths(d.paths);
  const sources = paths.sources;
  const recipients = cleanRecipients(d.recipients);
  const grantsSource = sources.find(s => s.key === GRANTS_KEY);
  const theme = obj(d.theme);

  // --- state ---
  const findRecipient = (slug: unknown): DeckRecipient | null => (typeof slug === 'string' && slug ? recipients.find(r => r.slug === slug) ?? null : null);
  const asLead = (l: unknown): Lead => (l === 'without-grants' ? 'without-grants' : 'with-grants');
  let recipient: DeckRecipient | null = findRecipient(opts.recipient);
  let leadOverride: Lead | null = opts.lead == null ? null : asLead(opts.lead);
  const lead = (): Lead => leadOverride ?? recipient?.lead ?? 'with-grants';
  let switches = initialSwitches(sources, lead());
  let result: PathResult = pathFor(paths, switches);
  let current = 0;
  let destroyed = false;
  let stacked = opts.stacked === true;
  let unbounded = false;
  const cleanups: (() => void)[] = [];
  const timers = new Set<Timer>();
  const later = (fn: () => void, ms: number): Timer => { const t: Timer = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms); timers.add(t); return t; };
  const cancel = (t: Timer | null) => { if (t != null) { clearTimeout(t); timers.delete(t); } };
  cleanups.push(() => { for (const t of timers) clearTimeout(t); timers.clear(); });
  cleanups.push(taken.release);
  const listen = (target: EventTarget, type: string, fn: (e: Event) => void, options?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  const el = (tag: string, cls?: string, ...kids: Kid[]): HTMLElement => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) if (k || k === '') e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  const txt = (tag: string, cls: string, text: unknown): HTMLElement | null => (has(text) ? el(tag, cls, str(text).trim()) : null);
  const setText = (e: Element, text: string) => { if (e.textContent !== text) e.textContent = text; };
  /** A shape drawn by the stylesheet (a tick, a dash, a pointer, an arrow): no glyph, so no font has to have it. */
  const icon = (name: string): HTMLElement => { const i = el('i', `psd-ic psd-ic-${name}`); i.setAttribute('aria-hidden', 'true'); return i; };
  const hidden = (text: string): HTMLElement => el('span', 'psd-vh', text);
  /** A currency symbol outside ASCII is set in the body typeface: a display face often has no glyph for it. */
  const symbol = (text: string): Kid => (/[^\x00-\x7f]/.test(text) ? el('span', 'psd-sym', text) : text);
  const moneyKids = (n: number): Kid[] => moneyParts(n, cur).map(p => (p.symbol ? symbol(p.text) : p.text));
  const symKids = (text: string): Kid[] => text.split(/(\p{Sc}+)/u).map((p, i) => (i % 2 ? symbol(p) : p));
  const putMoney = (e: Element, n: number) => { if (e.textContent !== money(n, cur)) e.replaceChildren(...(moneyKids(n).filter(Boolean) as (Node | string)[])); };
  const val = (tag: string, cls: string, text: unknown): HTMLElement | null => (has(text) ? el(tag, cls, ...symKids(str(text).trim())) : null);
  const cell = <T extends HTMLElement | null>(e: T): T => { if (e) e.dataset.cell = ''; return e; };   // a column whose children must not stick out sideways
  let riseCount = 0;
  const rise = <T extends HTMLElement | null>(e: T, cls = 'psd-rise'): T => {
    if (e) { e.classList.add(cls); e.style.setProperty('--i', String(riseCount++)); }
    return e;
  };

  // --- root ---
  const shadow: ShadowRoot | HTMLElement = typeof host.attachShadow === 'function' ? (host.shadowRoot ?? host.attachShadow({ mode: 'open' })) : host;
  while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
  if (typeof opts.css === 'string') { const st = doc.createElement('style'); st.textContent = opts.css; shadow.appendChild(st); }
  const root = el('div', `psd${isStatic ? ' psd-static' : ''}${opts.stacked === false ? ' psd-scaled' : ''}${opts.motion === false ? ' psd-still' : ''}`);
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'slide deck');
  root.setAttribute('aria-label', `${film || 'Film'} pitch deck. Use the arrow keys to move between slides.`);
  if (!isStatic) root.tabIndex = 0;
  const fonts = obj(theme.fonts);
  // a font file goes in front of its role's stack, under the name it was registered with
  const withFaces = (role: 'title' | 'body', stack: string) => [...faces.filter(f => f.role === role).map(f => `"${f.name}"`), stack].join(', ');
  const vars: Record<string, string> = { ...deckColors(theme.colors), '--psd-title-font': withFaces('title', fontStack(fonts.title, TITLE_FALLBACK)), '--psd-body-font': withFaces('body', fontStack(fonts.body, BODY_FALLBACK)) };
  for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);

  // --- shared pieces ---
  const head = (s: Obj, headline: unknown = s.headline): HTMLElement | null => {
    if (!has(s.eyebrow) && !has(headline) && !has(s.punch)) return null;
    const h = el('header', 'psd-head');
    if (has(s.eyebrow)) h.appendChild(rise(el('p', 'psd-eyebrow', str(s.eyebrow).trim())));
    if (has(headline) || has(s.punch)) {
      const a = str(headline).trim().length, b = str(s.punch).trim().length;
      const size = Math.max(a, b) > 80 || a + b > 130 ? ' psd-h-xlong' : Math.max(a, b) > 45 || a + b > 80 ? ' psd-h-long' : '';
      h.appendChild(rise(el('h2', `psd-h${size}`, txt('span', 'psd-h1', headline), txt('span', 'psd-punch', s.punch))));
    }
    return h;
  };
  const paras = (text: unknown, cls: string): HTMLElement[] => paragraphs(text).map(p => rise(el('p', cls, p)));
  const cardEl = (cd: Obj, i: number, n: number): HTMLElement => {
    const e = cell(el('article', 'psd-card psd-pinned',
      txt('p', 'psd-kicker', cd.kicker), txt('h3', 'psd-card-title', cd.title), txt('p', 'psd-card-body', cd.body), txt('p', 'psd-card-foot', cd.footnote)));
    e.style.setProperty('--r', `${(i % 2 === 0 ? -1 : 1) * (n > 3 ? 1.1 : 1.5)}deg`);
    e.dataset.cardId = str(cd.id);
    return rise(e, 'psd-drop');
  };
  const cardRow = (cards: unknown): HTMLElement | null => {
    const shown = list(cards).filter(cd => has(cd.title) || has(cd.body)).slice(0, 4);
    if (!shown.length) return null;
    const row = el('div', 'psd-cards');
    row.style.setProperty('--n', String(shown.length));
    row.dataset.n = String(shown.length);
    shown.forEach((cd, i) => row.appendChild(cardEl(cd, i, shown.length)));
    return el('div', 'psd-hang', el('div', 'psd-rope'), row);
  };

  // --- the layouts: each returns the slide's content, and may set `part.update` for what changes after mounting ---
  const layouts: Record<string, (s: Obj, part: Part) => Kid[]> = {
    cover(s, part) {
      const line = el('p', 'psd-coverline');
      line.dataset.part = 'cover-line';
      part.update = () => { const t = (has(recipient?.coverLine) ? recipient!.coverLine : str(d.coverLine)).trim(); setText(line, t); line.hidden = !t; };
      const title = (has(s.title) ? str(s.title) : film).trim();
      return [el('div', 'psd-cover',
        el('div', 'psd-cover-main',
          rise(cell(el('div', 'psd-card psd-cover-card', line, txt('h1', `psd-title${title.length > 40 ? ' psd-title-xlong' : title.length > 20 ? ' psd-title-long' : ''}`, title))), 'psd-drop'),
          rise(txt('p', 'psd-byline', s.byline))),
        rise(txt('p', 'psd-tagline', s.tagline)))];
    },
    photo(s) { return [el('div', 'psd-photo', head(s), ...paras(s.body, 'psd-lede'))]; },
    text(s) {
      const cols = list(s.aside).filter(a => has(a.label) || texts(a.lines).length);
      const aside = cols.length ? el('div', 'psd-aside', ...cols.map(a => rise(el('div', 'psd-aside-col', txt('p', 'psd-lab', a.label), ...texts(a.lines).map(l => el('p', 'psd-aside-line', l)))))) : null;
      if (aside) aside.style.setProperty('--n', String(cols.length));
      const body = paras(s.body, 'psd-p');
      return [head(s), body.length ? el('div', 'psd-prose', ...body) : null, aside, rise(txt('p', 'psd-closing', s.closing))];
    },
    cards(s, part) { return layouts.ways(s, part); },   // a row of cards either way: a recipient can have one of them picked out
    ways(s, part) {
      const row = cardRow(s.cards);
      part.update = () => {
        row?.querySelectorAll<HTMLElement>('.psd-card').forEach(e => {
          const on = !!recipient?.highlightCardId && e.dataset.cardId === recipient.highlightCardId;
          e.classList.toggle('psd-highlight', on);
          if (on) e.setAttribute('aria-current', 'true'); else e.removeAttribute('aria-current');
        });
      };
      return [head(s), row];
    },
    stats(s) {
      const ld = obj(s.lead);
      const lead = has(ld.value) || has(ld.text)
        ? rise(el('div', 'psd-lead', val('p', 'psd-big', ld.value), el('div', 'psd-lead-say', txt('p', 'psd-lead-text', ld.text), txt('p', 'psd-src', ld.source))))
        : null;
      const body = paras(s.body, 'psd-p');
      const q = obj(s.quote);
      const quote = has(q.text)
        ? rise(el('figure', 'psd-card psd-quote', el('blockquote', 'psd-quote-text', str(q.text).trim()), txt('figcaption', 'psd-quote-by', q.by)), 'psd-drop')
        : null;
      if (quote) quote.style.setProperty('--r', '1.6deg');
      const stats = list(s.stats).filter(x => has(x.value) || has(x.label));
      const row = stats.length ? el('div', 'psd-stats', ...stats.map(x => rise(cell(el('div', 'psd-stat', val('p', 'psd-stat-val', x.value), txt('p', 'psd-stat-lab', x.label), txt('p', 'psd-src', x.source)))))) : null;
      if (row) row.style.setProperty('--n', String(stats.length));
      const left = lead || body.length ? cell(el('div', 'psd-stats-main', lead, ...body)) : null;
      const top = left || quote ? el('div', `psd-stats-top${quote && left ? ' psd-two' : ''}`, left, quote) : null;
      return [head(s), top, row, rise(txt('p', 'psd-note', s.note))];
    },
    timeline(s) {
      const facts = list(s.facts).filter(f => has(f.value));
      const factRow = facts.length ? el('div', 'psd-facts', ...facts.map(f => rise(cell(el('div', 'psd-fact', val('p', 'psd-fact-val', f.value), txt('p', 'psd-lab', f.label)))))) : null;
      if (factRow) { factRow.style.setProperty('--n', String(facts.length)); factRow.dataset.n = String(facts.length); factRow.classList.toggle('psd-facts-many', facts.length > 4); }
      const miles = list(s.milestones).filter(m => has(m.when) || has(m.what));
      const track = miles.length ? el('div', 'psd-track', el('div', 'psd-rail'),
        el('ol', 'psd-miles', ...miles.map(m => rise(el('li', 'psd-mile', el('span', 'psd-tick'), txt('span', 'psd-when', m.when), txt('span', 'psd-what', m.what)))))) : null;
      if (track) track.style.setProperty('--n', String(miles.length));
      return [head(s), factRow, track, rise(txt('p', 'psd-note', s.note))];
    },
    comps(s) {
      const bars = list(s.bars).filter(b => num(b.value) > 0);
      const max = Math.max(0, ...bars.map(b => num(b.value)));
      const small = (t: unknown) => (has(t) ? el('small', '', ` ${str(t).trim()}`) : null);
      const barBox = bars.length ? cell(el('div', 'psd-bars', txt('p', 'psd-lab', s.barsLabel), ...bars.map(b => {
        const fill = el('i', 'psd-bar-fill');
        fill.style.setProperty('--w', `${max > 0 ? Math.max(1, (num(b.value) / max) * 100) : 0}%`);
        return rise(el('div', 'psd-bar-row', el('span', 'psd-bar-label', str(b.label), small(b.note)), el('span', 'psd-bar', fill), el('span', 'psd-bar-val', multiple(num(b.value)))));
      }))) : null;
      const groups = list(s.groups).filter(g => list(g.rows).length);
      const rows = groups.length ? cell(el('div', 'psd-groups', ...groups.map(g => rise(el('div', 'psd-group', txt('p', 'psd-lab', g.group),
        el('ul', 'psd-plain', ...list(g.rows).map(r => el('li', '', el('span', 'psd-row-title', str(r.title), small(r.year)),
          el('span', 'psd-row-val', typeof r.multiple === 'number' && Number.isFinite(r.multiple) ? multiple(r.multiple) : 'n/a'))))))))) : null;
      const grid = barBox || rows ? el('div', `psd-comps${barBox && rows ? ' psd-two' : ''}`, barBox, rows) : null;
      return [head(s), grid, rise(txt('p', 'psd-callout', s.callout))];
    },
    team(s) {
      const members = list(s.members).filter(m => has(m.name));
      const people = members.length ? el('ul', `psd-team${members.length > 4 ? ' psd-team-cols' : ''}`, ...members.map(m => rise(el('li', 'psd-member',
        el('p', 'psd-member-name', el('b', '', str(m.name).trim()), has(m.role) ? el('span', 'psd-role', ` · ${str(m.role).trim()}`) : null), txt('p', 'psd-member-bio', m.bio))))) : null;
      const a = obj(s.aside);
      const aside = has(a.title) || texts(a.lines).length
        ? rise(cell(el('aside', 'psd-card psd-pinned psd-team-aside', txt('h3', 'psd-card-title', a.title), ...texts(a.lines).map(l => el('p', 'psd-card-body', l)), txt('p', 'psd-card-foot', a.footnote))), 'psd-drop')
        : null;
      if (aside) aside.style.setProperty('--r', '1.4deg');
      const grid = people || aside ? el('div', `psd-team-grid${people && aside ? ' psd-two' : ''}`, people, aside) : null;
      return [head(s), grid];
    },
    model(s) {
      const steps = list(s.steps).filter(x => has(x.title) || has(x.body)).slice(0, 3);
      const kids: Kid[] = [];
      steps.forEach((x, i) => {
        if (i > 0) { const arrow = el('li', 'psd-arrow', icon('arrow')); arrow.setAttribute('aria-hidden', 'true'); kids.push(rise(arrow)); }
        kids.push(rise(cell(el('li', 'psd-step', txt('p', 'psd-lab', x.label), val('h3', 'psd-step-title', x.title), txt('p', 'psd-step-body', x.body)))));
      });
      const row = steps.length ? el('ol', 'psd-steps', ...kids) : null;
      if (row) row.style.setProperty('--n', String(steps.length));
      return [head(s), ...paras(s.body, 'psd-p'), row, rise(txt('p', 'psd-closing', s.closing))];
    },
    numbers(s, part) {
      const n = sources.length;
      // toggles (or, in a static deck, plain chips)
      const toggles = sources.map(src => {
        const state = el('span', 'psd-toggle-state');
        const t = el(isStatic ? 'div' : 'button', isStatic ? 'psd-chip' : 'psd-toggle',
          isStatic ? null : el('span', 'psd-knob'),
          el('span', 'psd-toggle-text', el('b', 'psd-toggle-label', src.label), el('span', 'psd-toggle-amt', ...moneyKids(src.amount)), state, txt('small', 'psd-toggle-note', src.note)));
        t.dataset.key = src.key;
        if (!isStatic) {
          (t as HTMLButtonElement).type = 'button';
          listen(t, 'click', () => setSwitch(src.key, !switches[src.key]));
        }
        return { key: src.key, t, state };
      });
      // the control says what it is, whatever the author wrote (or did not write) above it
      const togglesLabel = isStatic ? el('p', 'psd-lab psd-toggles-lab', 'Funding sources')
        : el('p', 'psd-lab psd-toggles-lab', el('span', 'psd-screen', 'Switch a source on or off'), el('span', 'psd-paper', 'Funding sources'));
      const budget = el('span', 'psd-fig-val'); budget.dataset.part = 'budget';
      const investors = el('span', 'psd-fig-val'); investors.dataset.part = 'investors';
      const figs = el('div', 'psd-figs', el('div', 'psd-fig', el('span', 'psd-lab', 'Budget to raise'), budget), el('div', 'psd-fig psd-fig-big', el('span', 'psd-lab', 'Investors fund'), investors));
      const stack = el('div', 'psd-stack'); stack.setAttribute('role', 'img');
      const legend = el('ul', 'psd-legend psd-plain');
      const segs = [...sources.map((src, i) => ({ label: src.label, cls: `psd-seg-src psd-seg-${i % 3}` })), { label: 'Investors', cls: 'psd-seg-inv' }].map(x => {
        const e = el('div', `psd-seg ${x.cls}`), pct = el('b'), item = el('li', 'psd-legend-item', el('i', `psd-sw ${x.cls}`), el('span', '', x.label), pct);
        stack.appendChild(e); legend.appendChild(item);
        return { label: x.label, e, pct, item };
      });

      // returns: only when the deck has revenue cases
      const colHead = (t: string, cls = '') => { const th = el('th', cls, t); th.setAttribute('scope', 'col'); return th; };
      const caseRows = paths.cases.map(cs => {
        const cells = { gross: el('td'), net: el('td'), toInvestors: el('td'), multiple: el('td', 'psd-strong') };
        for (const k of Object.keys(cells) as (keyof typeof cells)[]) cells[k].dataset.col = k;
        const th = el('th', '', cs.label); th.setAttribute('scope', 'row');
        const tr = el('tr', '', th, cells.gross, cells.net, cells.toInvestors, cells.multiple);
        tr.dataset.case = cs.label;
        return { tr, cells };
      });
      const cases = caseRows.length ? el('table', 'psd-table psd-cases',
        el('caption', 'psd-vh', 'What comes back in each case'),
        el('thead', '', el('tr', '', ...['Case', 'Receipts', 'Net', 'To investors', 'Multiple'].map(t => colHead(t)))),
        el('tbody', '', ...caseRows.map(r => r.tr))) : null;

      // what investors fund under each combination. Up to three sources: every combination (a tick matrix for
      // three). More: only this selection, everything on and investors alone, so the table never grows as 2^n.
      const matrix = n === 3, few = n > 0 && n <= 3;
      const comboOf = (sw: Record<string, boolean>) => sources.map(src => (sw[src.key] ? '1' : '0')).join('');
      const comboRow = (sw: Record<string, boolean> | null, name: string) => {
        const nameEl = matrix ? hidden(name) : el('span', '', name);
        const th = el('th', 'psd-cur', icon('tri'), nameEl); th.setAttribute('scope', 'row');
        const marks = matrix && sw ? sources.map(src => el('td', 'psd-mark', icon(sw[src.key] ? 'check' : 'dash'), hidden(sw[src.key] ? 'on' : 'off'))) : [];
        const amt = el('td', 'psd-combo-amt', sw ? money(pathFor(paths, sw).investors, cur) : '');
        const tr = el('tr', '', th, ...marks, amt);
        if (sw) tr.dataset.combo = comboOf(sw);
        return { combo: sw ? comboOf(sw) : '', tr, amt };
      };
      const nameOf = (sw: Record<string, boolean>) => { const on = sources.filter(src => sw[src.key]).map(src => src.label); return on.length ? `With ${on.join(' + ')}` : 'Investors alone'; };
      const allOn = initialSwitches(sources.map(src => ({ key: src.key, on: true })), 'with-grants');
      const allOff = initialSwitches(sources.map(src => ({ key: src.key, on: false })), 'with-grants');
      const selection = few || !n ? null : comboRow(null, 'This selection');
      const combos = few ? allSwitches(sources).map(sw => comboRow(sw, nameOf(sw))) : n ? [comboRow(allOn, 'Everything on'), comboRow(allOff, 'Investors alone')] : [];
      const comboTable = n ? el('table', `psd-table psd-combos${matrix ? ' psd-matrix' : ''}`,
        el('caption', 'psd-lab', few ? 'Investors fund, every combination' : 'Investors fund'),
        matrix ? el('thead', '', el('tr', '', colHead('', 'psd-cur'), ...sources.map(src => colHead(src.label)), colHead('Investors fund'))) : null,
        el('tbody', '', selection?.tr, ...combos.map(x => x.tr))) : null;

      const right = cases || comboTable ? cell(el('div', 'psd-num-right', cases, cases ? txt('p', 'psd-src psd-casenote', s.caseNote) : null, comboTable)) : null;
      part.update = () => {
        for (const tg of toggles) {
          const on = !!result.switches[tg.key];
          if (isStatic) { tg.t.dataset.on = String(on); setText(tg.state, on ? 'Included' : 'Not included'); }
          else { tg.t.setAttribute('aria-pressed', String(on)); setText(tg.state, on ? 'On' : 'Off'); }
        }
        putMoney(budget, paths.cashBudget);
        putMoney(investors, result.investors);
        // the big figure is sized by its length, and the pair stacks when it would not fit side by side
        const big = money(result.investors, cur).length, size = big <= 8 ? 3.3 : big <= 11 ? 2.6 : 2;
        figs.dataset.size = size === 3.3 ? 'l' : size === 2.6 ? 'm' : 's';
        figs.classList.toggle('psd-figs-stack', (big * size + money(paths.cashBudget, cur).length * 1.7) * 0.56 + 2.6 > 26);
        const amounts = [...sources.map(src => (result.switches[src.key] ? src.amount : 0)), result.investors];
        const total = amounts.reduce((a, b) => a + b, 0);
        const pcts = shares100(amounts);
        const said: string[] = [];
        segs.forEach((sg, i) => {
          const share = total > 0 ? Math.max(0, amounts[i]) / total : 0;
          sg.e.style.flexBasis = `${share * 100}%`;
          sg.e.classList.toggle('psd-seg-off', share <= 0);
          sg.item.hidden = share <= 0;
          setText(sg.pct, `${pcts[i]}%`);
          if (share > 0) said.push(`${sg.label} ${pcts[i]}%`);
        });
        stack.setAttribute('aria-label', `Share of the budget: ${said.join(', ') || 'nothing to fund'}`);
        result.cases.forEach((cs, i) => {
          const r = caseRows[i]; if (!r) return;
          setText(r.cells.gross, money(cs.gross, cur)); setText(r.cells.net, money(cs.net, cur));
          setText(r.cells.toInvestors, money(cs.toInvestors, cur)); setText(r.cells.multiple, multiple(cs.multiple));
        });
        const now = comboOf(result.switches);
        const named = combos.some(x => x.combo === now);
        if (selection) {
          selection.tr.hidden = named;
          selection.tr.dataset.combo = now;
          setText(selection.amt, money(result.investors, cur));
        }
        for (const x of selection ? [selection, ...combos] : combos) {
          if (x === selection ? !named : x.combo === now) x.tr.setAttribute('aria-current', 'true'); else x.tr.removeAttribute('aria-current');
        }
      };
      const legal = el('p', 'psd-legal', has(d.legal) ? str(d.legal).trim() : DEFAULT_LEGAL);
      legal.dataset.part = 'legal';
      return [head(s), el('div', `psd-numbers${n > 2 ? ' psd-many' : ''}${right ? '' : ' psd-one'}`,
        rise(cell(el('div', 'psd-num-left', ...paragraphs(s.body).map(p => el('p', 'psd-p psd-num-body', p)),
          toggles.length ? togglesLabel : null,
          toggles.length ? el('div', 'psd-toggles', ...toggles.map(x => x.t)) : null,
          figs, stack, legend))),
        rise(right)), rise(legal)];
    },
    ask(s, part) {
      const body = el('p', 'psd-ask-body'); body.dataset.part = 'ask-body';
      let note: HTMLElement | null = null;
      part.update = () => {
        const grantsOn = grantsSource ? !!result.switches[GRANTS_KEY] : true;
        // grants can only cover what there is to raise: never "another $50,000,000" of a smaller budget
        const pieces = fillAsk(str(grantsOn ? s.withGrants : s.withoutGrants), money(result.investors, cur), grantsSource ? money(Math.min(grantsSource.amount, paths.cashBudget), cur) : null);
        // the first sentence reads large; whatever follows it reads as a second, quieter line
        const full = pieces.map(p => p.text).join('');
        const m = /[.!?]["'”’)]?(\s+|$)/.exec(full.replace(/\d[.,]\d/g, 'x_x'));
        const cut = m ? m.index + m[0].length : full.length;
        const first = el('span', 'psd-ask-first'), rest = el('span', 'psd-ask-rest');
        let at = 0;
        for (const p of pieces) {
          const a = Math.max(0, Math.min(p.text.length, cut - at));
          const put = (into: HTMLElement, t: string) => { if (t) into.appendChild(p.amount ? el('strong', 'psd-amt', ...symKids(t)) : doc.createTextNode(t)); };
          if (p.amount) put(at < cut ? first : rest, p.text);
          else { put(first, p.text.slice(0, a)); put(rest, p.text.slice(a)); }
          at += p.text.length;
        }
        body.replaceChildren(first, ...(rest.childNodes.length ? [rest] : []));
        body.hidden = !full.trim();
        // a recipient's note is taken out of the document, not hidden, when the deck is no longer theirs
        note?.remove(); note = null;
        const text = str(recipient?.note).trim();
        if (text) { note = el('p', 'psd-ask-note', text); note.dataset.part = 'ask-note'; body.after(note); }
      };
      // a headline that only repeats the eyebrow says nothing twice
      const repeats = str(s.headline).trim().toLowerCase() === str(s.eyebrow).trim().toLowerCase();
      return [head(s, repeats ? '' : s.headline), rise(body), rise(txt('p', 'psd-next', s.nextStep)), rise(txt('p', 'psd-contact', s.contact))];
    },
    closing(s) {
      return [el('div', 'psd-closing-slide', head(s), rise(txt('h2', 'psd-title psd-title-end', has(s.title) ? s.title : film)), rise(txt('p', 'psd-signoff', theme.signoff)))];
    },
  };

  // --- build ---
  const images = new Map(list(d.images).filter(i => typeof i.src === 'string' && imageOk(i.src)).map(i => [str(i.id), i] as const));
  const drawable = list(d.slides).filter(s => typeof s.layout === 'string' && Object.prototype.hasOwnProperty.call(layouts, s.layout));
  const parts: Part[] = [];
  drawable.forEach((s, index) => {
    riseCount = 0;
    const layout = s.layout as string;
    const section = el('section', `psd-slide psd-l-${layout}`);
    const label = [s.eyebrow, s.headline, s.title].find(has);
    section.setAttribute('aria-label', label === undefined ? `Slide ${index + 1}` : str(label).trim());
    section.setAttribute('aria-roledescription', 'slide');
    section.dataset.slideId = str(s.id);
    section.dataset.layout = layout;
    const inner = el('div', 'psd-in');
    const img = has(s.imageId) ? images.get(str(s.imageId)) : undefined;
    if (img) {
      const pic = doc.createElement('img');
      pic.className = 'psd-bg'; pic.alt = str(img.alt); pic.decoding = 'async'; pic.src = img.src as string;
      const asked = typeof s.scrim === 'number' && Number.isFinite(s.scrim) ? Math.max(0, Math.min(1, s.scrim)) : DEFAULT_SCRIM;
      const k = Math.max(MIN_SCRIM, asked);   // under the text; the author's value still sets the side with no text
      const scrim = el('div', 'psd-scrim');
      scrim.style.setProperty('--psd-scrim', `${Math.round(k * 100)}%`);
      scrim.style.setProperty('--psd-scrim-soft', `${Math.round(asked * 45)}%`);
      inner.append(pic, scrim);
      section.classList.add('psd-has-picture');
      const safe = deckColors(theme.colors, 1 - k);   // text colours that hold with a picture showing through
      for (const key of Object.keys(safe)) section.style.setProperty(key, safe[key]);
    }
    const box = el('div', 'psd-box');
    const part: Part = { index, layout, section, box, cells: [] };
    for (const k of layouts[layout](s, part)) if (k) box.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    // a slide that is only its headline: the headline is the slide
    if (box.children.length === 1 && box.firstElementChild!.classList.contains('psd-head')) section.classList.add('psd-only-head');
    const small = txt('p', 'psd-footnote', s.footnote);
    if (small) box.appendChild(small);
    part.cells = [...box.querySelectorAll<HTMLElement>('[data-cell]')];
    inner.append(box, el('footer', 'psd-foot', el('span', 'psd-foot-film', film), el('span', 'psd-foot-n', `${index + 1} / ${drawable.length}`)));
    section.appendChild(inner);
    root.appendChild(el('div', 'psd-stage', section));
    parts.push(part);
  });
  const updateAll = () => { for (const p of parts) p.update?.(); };
  updateAll();
  shadow.appendChild(root);
  host.classList.add('psd-host');

  // --- fit: a slide never scrolls, so its type steps down while its content spills, and it says so when that is not enough ---
  const spills = (p: Part): boolean =>
    overflows({ width: p.box.clientWidth, height: p.box.clientHeight }, { width: p.box.scrollWidth, height: p.box.scrollHeight })
    || p.cells.some(c => c.clientWidth > 0 && c.scrollWidth > c.clientWidth + 2);   // a child sticking out of its column
  function fitPart(p: Part): boolean {
    p.section.style.removeProperty('--psd-fs');
    if (stacked || !(p.box.clientHeight > 0)) {   // the stacked layout grows with its content; a slide not laid out says nothing
      if (stacked) p.section.dataset.overflow = 'false';
      return false;
    }
    let bad = false;
    for (const fs of FIT_STEPS) {
      if (fs !== FIT_STEPS[0]) p.section.style.setProperty('--psd-fs', String(fs));
      bad = spills(p);
      if (!bad) break;
    }
    p.section.dataset.overflow = String(bad);
    if ((p.layout === 'photo' || p.layout === 'closing') && p.section.classList.contains('psd-has-picture')) {   // the scrim is full strength as far up as the text goes
      const top = p.box.querySelector('.psd-photo > *, .psd-closing-slide > *')?.getBoundingClientRect().top, r = p.section.getBoundingClientRect();
      if (top != null && r.height > 0) p.section.style.setProperty('--psd-stop', `${Math.round(Math.max(30, Math.min(100, ((r.bottom - top) / r.height) * 100 + 8)))}%`);
    }
    return bad;
  }
  function fitAll(): number[] {
    if (destroyed) return [];
    root.classList.add('psd-measuring');   // parts waiting to rise are measured where they will land
    const bad = parts.filter(fitPart).map(p => p.index);
    root.classList.remove('psd-measuring');
    return bad;
  }
  let refitT: Timer | null = null;
  const refit = () => { if (refitT == null) refitT = later(() => { refitT = null; fitAll(); }, 0); };

  // --- state changes ---
  const recompute = () => { result = pathFor(paths, switches); updateAll(); refit(); };
  function setSwitch(key: string, on: boolean) {
    if (destroyed || !sources.some(s => s.key === key)) return;
    switches = Object.assign(Object.create(null), switches, { [key]: !!on });
    recompute();
  }
  const applyAudience = (slug: string | null, newLead: Lead | null) => {
    recipient = findRecipient(slug);
    leadOverride = newLead;
    switches = initialSwitches(sources, lead());
    recompute();
  };

  // --- which slide is showing, and moving between them ---
  const stageOf = (i: number) => parts[i]?.section.parentElement as HTMLElement | undefined;
  const startAt = typeof opts.startAt === 'number' && Number.isFinite(opts.startAt) ? Math.max(0, Math.min(parts.length - 1, Math.round(opts.startAt))) : 0;
  current = startAt;
  let told = current;   // the slide `onSlide` last heard about
  const reduced = () => isStatic || !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const paged = () => !isStatic && !stacked && !unbounded;   // one slide on show at a time
  /** Marks the current slide. While one slide shows at a time the others are inert (nothing on a slide that is out
   *  of sight can be focused or pressed). Focus left behind on another slide moves to the deck itself: always when
   *  the deck is paged from here (`goTo`), and when the reader scrolls by hand only where one slide shows at a time. */
  const mark = (moveFocus = paged()) => {
    const page = paged();
    const active = 'activeElement' in shadow ? (shadow as ShadowRoot).activeElement : doc.activeElement;
    if (moveFocus && active && active !== root && root.contains(active) && !parts[current]?.section.contains(active)) root.focus({ preventScroll: true });
    parts.forEach((p, i) => { p.section.toggleAttribute('data-current', i === current); p.section.toggleAttribute('inert', page && i !== current); });
    if (current !== told) { told = current; try { opts.onSlide?.(current); } catch { /* the listener's own trouble */ } }
  };
  const scrolls = () => root.scrollHeight > root.clientHeight + 1;
  /** The slide at the top of the view: the last one that starts above the middle of it. */
  const nearest = () => {
    if (typeof root.getBoundingClientRect !== 'function') return current;
    const own = scrolls(), r = root.getBoundingClientRect();
    const view = own ? r.height : win?.innerHeight ?? 0;
    if (!(r.width > 0) || !(view > 0)) return current;   // not laid out
    const mid = (own ? r.top : 0) + view / 2;
    let best = 0;
    parts.forEach((_, i) => { const st = stageOf(i); if (st && st.getBoundingClientRect().top <= mid) best = i; });
    return best;
  };
  let flight: Timer | null = null;   // set while a scroll this code started is on its way
  // While the host is being resized (a window drag, full screen) the browser snaps the scroll to whatever slide is
  // nearest at the new size. That is not the reader paging: nothing is followed until the deck is back where it was.
  let frozen = false;
  let thaw: Timer | null = null;
  let settle: Timer | null = null;
  const freeze = () => { frozen = true; cancel(settle); settle = null; cancel(thaw); thaw = null; };
  const land = () => { cancel(flight); flight = null; };
  function goTo(index: number) {
    if (destroyed || !parts.length) return;
    current = Math.max(0, Math.min(parts.length - 1, Math.round(index) || 0));
    mark(!isStatic);
    const stage = stageOf(current);
    if (!stage) return;
    cancel(flight);
    flight = later(() => { flight = null; }, 1500);
    const behavior: ScrollBehavior = reduced() ? 'auto' : 'smooth';
    if (scrolls() && typeof root.scrollTo === 'function') root.scrollTo({ top: stage.offsetTop, behavior });
    else if (typeof stage.scrollIntoView === 'function') stage.scrollIntoView({ block: 'start', behavior });
  }
  if (!isStatic) {
    const onKey = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const onControl = !!(e.target as Element | null)?.closest?.('button, a, input, select, textarea');
      const space = e.key === ' ' || e.key === 'Spacebar';
      const fwd = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key) || (space && !onControl && !e.shiftKey);
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key) || (space && !onControl && e.shiftKey);
      const to = fwd || back ? (flight ? current : nearest()) + (fwd ? 1 : -1)   // while a scroll is in flight, step from where it is going
        : e.key === 'Home' ? 0 : e.key === 'End' ? parts.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      goTo(to);
    };
    listen(root, 'keydown', onKey);
    // a page that is only the deck: keys pressed with nothing focused page it too, so it never has to take focus on load
    if (opts.pageKeys) listen(doc, 'keydown', e => { if (e.target === doc.body || e.target === doc.documentElement) onKey(e); });
    // the reader scrolls by hand: follow, once the scroll settles
    listen(root, 'scroll', () => {
      if (flight || frozen || settle != null) return;
      settle = later(() => { settle = null; if (flight || frozen) return; const n = nearest(); if (n !== current) { current = n; mark(); } }, 120);
    }, { passive: true });
    listen(root, 'scrollend', land);
  }

  // --- motion: a slide gets `psd-seen` when it scrolls into view ---
  const IO = win && (win as unknown as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (isStatic || !IO || opts.motion === false) for (const p of parts) p.section.classList.add('psd-seen');
  else {
    const io = new IO(entries => {
      for (const en of entries) {
        // a fifth of the slide, or (a slide taller than the view) two fifths of the view
        if (!en.isIntersecting || !(en.intersectionRatio >= 0.2 || (en.rootBounds && en.intersectionRect.height >= en.rootBounds.height * 0.4))) continue;
        (en.target as HTMLElement).classList.add('psd-seen');
      }
    }, { threshold: [0.02, 0.05, 0.1, 0.2] });
    for (const p of parts) io.observe(p.section);
    cleanups.push(() => io.disconnect());
  }

  // --- sizing: fit the host's height when it has one; otherwise let the slides take the width and the page scroll.
  //     A small host (narrow, or too short for a readable slide) gets the stacked reading layout instead of slides. ---
  const layout = () => {
    if (destroyed) return;
    if (!isStatic && typeof root.getBoundingClientRect === 'function') {
      root.classList.remove('psd-unbounded');
      const r = root.getBoundingClientRect();
      unbounded = r.width > 0 && r.height < 1;
      root.classList.toggle('psd-unbounded', unbounded);
      if (opts.stacked == null) stacked = r.width > 0 && (r.width < 600 || Math.min(r.width * 9 / 16, unbounded ? Infinity : r.height) < 420);
    }
    root.classList.toggle('psd-stacked', stacked);
    mark();
    fitAll();
  };
  layout();
  // open on the slide asked for, at once: no scroll to watch (and none for `onSlide` to report)
  const jump = () => { const st = stageOf(current); if (st && current > 0 && !isStatic && typeof root.scrollTo === 'function' && scrolls()) root.scrollTo({ top: st.offsetTop, behavior: 'instant' as ScrollBehavior }); };
  if (startAt > 0) { flight = later(() => { flight = null; }, 300); jump(); }
  // a slide's height follows the host's, so after a resize the same scroll offset is another slide: lay out again, go
  // back to the current slide, and only then start following the reader's own scrolling again
  let pending: Timer | null = null;
  const resized = () => {
    if (destroyed) return;
    freeze();
    if (pending == null) pending = later(() => {
      pending = null;
      layout();
      if (paged()) jump();
      thaw = later(() => { thaw = null; frozen = false; }, 300);
    }, 150);
  };
  const RO = win && (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (RO) {
    const ro = new RO(resized);
    ro.observe(host);
    cleanups.push(() => ro.disconnect());
  }
  if (!isStatic) listen(doc, 'fullscreenchange', resized);
  // the typefaces arrive after the first layout, and change what fits
  (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(() => { fitAll(); }, () => { /* nothing to refit */ });
  if (faceLoads.length) void Promise.all(faceLoads).then(() => { fitAll(); });

  // --- printing: @page does not apply from inside a shadow tree, so the (named, harmless elsewhere) page rule goes
  //     in the document, once, and stays until the last deck that needs it has gone ---
  if (doc.head) {
    let entry = pageStyles.get(doc);
    if (!entry || !entry.st.isConnected) {
      const st = doc.createElement('style'); st.id = PAGE_STYLE_ID; st.textContent = PAGE_CSS; doc.head.appendChild(st);
      entry = { st, n: 0 };
      pageStyles.set(doc, entry);
    }
    entry.n++;
    const mine = entry;
    cleanups.push(() => { if (--mine.n <= 0) { mine.st.remove(); if (pageStyles.get(doc) === mine) pageStyles.delete(doc); } });
  }

  // --- links: deck.html#slug, #slug-without, #without ---
  if (opts.useHash && win) {
    const slugs = recipients.map(r => r.slug);
    const fromHash = (initial: boolean) => {
      const raw = win.location?.hash ?? '';
      if (initial && !raw.replace(/^#/, '')) return;   // no link ending: keep what the caller asked for
      const h = parseHash(raw, slugs);
      applyAudience(h.slug, h.lead ?? null);
    };
    fromHash(true);
    listen(win, 'hashchange', () => fromHash(false));
  }

  const handle: DeckHandle = {
    get slideCount() { return parts.length; },
    setRecipient(slug) { if (!destroyed) applyAudience(slug, null); },
    setLead(l) {
      if (destroyed) return;
      leadOverride = asLead(l);
      if (grantsSource) switches = Object.assign(Object.create(null), switches, { [GRANTS_KEY]: leadOverride === 'with-grants' ? !!grantsSource.on : false });
      recompute();
    },
    setSwitch,
    goTo,
    checkOverflow: fitAll,
    destroy() {
      if (destroyed) return;   // a handle that has already gone (or was replaced by a newer mount) does nothing
      destroyed = true;
      for (const fn of cleanups.splice(0)) fn();
      if (live.get(host) === handle) {
        live.delete(host);
        while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
        host.classList.remove('psd-host');
      }
      parts.length = 0;
    },
  };
  live.set(host, handle);
  return handle;
}
