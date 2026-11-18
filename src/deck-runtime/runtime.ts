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
import type { DeckData, DeckRecipient, PaperShade, PaperStyle } from './data';
import { money, moneyParts, multiple, shares100 } from './format';
import { cleanFamily, cleanStyle, cleanWeight, faceName, familyFaceName, fontSrcOk, HAND_FAMILY, MAX_FONT_FACES, weightText, type FaceWeight } from './fonts';
import { cleanDeckMotion, cleanMotion } from './motion';
import { cleanPaper, cleanPaperShade, dealPapers, dealShade, paperMarks, tornEdge, unevenEdge } from './paper';

export { cleanDeckMotion, cleanMotion, cleanPaper, cleanPaperShade, dealPapers, HAND_FAMILY };

export type Lead = 'with-grants' | 'without-grants';

export interface MountOptions {
  recipient?: string;      // a DeckRecipient.slug
  lead?: Lead;             // overrides the recipient's lead
  static?: boolean;        // no motion, every slide in its final state, print-safe (for PDF)
  useHash?: boolean;       // read and follow location.hash (default false; the exported file turns it on)
  fixedRecipient?: boolean;   // a file made for one person (or for nobody): a link ending can switch the ask, never who the deck is for
  css?: string;            // the stylesheet text; when omitted the caller has already provided styles
  pageKeys?: boolean;      // also page on arrow keys pressed while nothing on the page has focus (for a page that is only the deck)
  stacked?: boolean;       // the stacked reading layout: true always; false never (a scaled preview: small print has no pixel floor
                           // either, so `checkOverflow` says what is true at full size); left out, it follows the size of the host
  startAt?: number;        // the slide to open on (an index into the slides drawn); the deck is there at once, with no scroll to watch
  motion?: boolean;        // false: nothing rises or drops in, every slide is in its final state, and the deck still pages and switches (an editor's preview)
  onSlide?: (index: number) => void;   // told when another slide becomes the current one, by paging or by scrolling
  swatch?: boolean;        // a sample, not a deck: the first slide's cards fill the host with nothing around them (a paper shown in a chooser)
}
/** Why `play` did nothing: the reader asked their computer for less motion, or the deck is one that never moves. */
export type PlayResult = 'played' | 'reduced' | 'still';
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
  /** Plays one slide's movement again from the start (the current slide when no index is given), even in a deck
   *  mounted with `motion: false`. Never in a static or stacked deck, and never for a reader who asked for less motion. */
  play(index?: number): PlayResult;
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
const SHORT_BODY = 48;                  // a card's text this short is a note, and can be handwritten; longer text stays in the body face
const DEFAULT_SCRIM = 0.7;
const MIN_SCRIM = 0.85;                 // under the text of a picture slide, at least this much of the background colour
const FIT_STEPS = [1.4, 1.25, 1.1];     // a slide's base type size, in hundredths of its width; stepped down while it overflows
const ONE_BY_ONE = 140;                 // milliseconds between parts that arrive one at a time, when the slide names no gap
const PLAY_MS = 6000;                   // the longest a slide's movement runs: a still deck is still again after this
const PAGE_STYLE_ID = 'psd-page-style';
// A named page, so the rule changes nothing else the host document prints.
const PAGE_CSS = '@page psd-deck{size:1600px 900px;margin:0}';

const live = new WeakMap<HTMLElement, DeckHandle>();                                   // one deck per host
// Font files are registered on the document (an @font-face rule does nothing inside a shadow tree), once per file,
// counted, and taken off again when the last deck that uses one has gone.
interface FaceLike { load?: () => Promise<unknown>; status?: string }
interface FaceSet { add(f: FaceLike): unknown; delete(f: FaceLike): unknown }
const facePool = new WeakMap<Document, Map<string, { face: FaceLike; n: number }>>();

export interface CleanFace { family: string; src: string; role: 'title' | 'body'; weight?: FaceWeight; style?: 'normal' | 'italic' }
/** The font files a theme carries that are safe to use: a clean family name, a base64 font data URL, a known role;
 *  a weight (1 to 1000, or a range of them) and a style when the face says which of its family it is. */
export function cleanFontFaces(raw: unknown): CleanFace[] {
  const out: CleanFace[] = [];
  for (const f of list(raw)) {
    const family = cleanFamily(f.family);
    if (!family || !fontSrcOk(f.src) || (f.role !== 'title' && f.role !== 'body')) continue;
    const weight = cleanWeight(f.weight), style = cleanStyle(f.style);
    out.push({ family, src: f.src, role: f.role, ...(weight !== undefined ? { weight } : {}), ...(style ? { style } : {}) });
    if (out.length >= MAX_FONT_FACES) break;
  }
  return out;
}
/** The same faces with the name each is registered under. A face that says nothing of weight or style is a whole
 *  face on its own, under a name of its own; the weights of one family for one role share a name, so the browser
 *  can choose among them. */
export function namedFontFaces(raw: unknown): (CleanFace & { name: string })[] {
  const faces = cleanFontFaces(raw);
  const one = (f: CleanFace) => f.weight !== undefined || f.style !== undefined;
  const key = (f: CleanFace) => `${f.role}\n${f.family}`;
  const groups = new Map<string, string[]>();
  for (const f of faces) if (one(f)) groups.set(key(f), [...(groups.get(key(f)) ?? []), f.src]);
  return faces.map(f => ({ ...f, name: one(f) ? familyFaceName(f.role, f.family, groups.get(key(f))!) : faceName(f.role, f.family, f.src) }));
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

/** Whether a slide's content is short enough to sit in the middle of the slide and not at the top of it: it fills
 *  less than `share` of the room it has. Sizes are injected, so this is tested without a browser. */
export const CENTRE_UNDER = 0.7;
export function shouldCentre(room: number, content: number, share = CENTRE_UNDER): boolean {
  return room > 0 && content > 0 && content < room * share;
}
/** The layouts whose content is centred when it is short. The others place themselves: a cover and a closing slide
 *  are centred already, a picture slide keeps its words at the foot, and the numbers slide keeps its legal line there. */
const CENTRED: ReadonlySet<string> = new Set(['text', 'cards', 'ways', 'stats', 'timeline', 'comps', 'team', 'model', 'ask']);

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

// ---------- papers: every tone a paper is drawn in, and proof that its words can be read on all of them ----------

export const PAPER_INK_MIN = 7, PAPER_SMALL_MIN = 4.5;
/** The colours one paper is drawn in, as custom properties for its card, worked out from the theme's card colours.
 *  `--psd-pp-shade` is the darkest (on a dark card, the lightest) tone anything drawn under the words may reach: an
 *  aged corner, a crease, a ruled line. The ink reaches 7:1 on the paper, on that shade and on the ruled line; the
 *  small print and the accent reach 4.5:1 on all three. When no ink could reach 7:1 on the card colour itself (a
 *  mid grey), the paper moves away from the ink until one does. The stamp's colours are fills, never under words. */
export function paperColors(colors: unknown, style: PaperStyle, tone: PaperShade = 'theme'): Record<string, string> {
  if (cleanPaperShade(tone) !== 'theme') return shadeColors(colors, style, cleanPaperShade(tone) as FixedShade);
  const c = obj(colors);
  const bg = safeColor(c.bg, WHITE), rawInk = safeColor(c.ink, '#111111');
  const hex = (v: unknown, fallback: string): string => { const x = parseColor(safeColor(v, fallback)); return x ? hexOf(x) : fallback; };   // a colour this arithmetic can read, or the fallback
  const accent = hex(c.accent, hex(rawInk, '#111111')), accent2 = hex(c.accent2, accent);
  let paper = hex(c.card, hex(bg, WHITE));
  const end = contrastRatio(paper, BLACK) >= contrastRatio(paper, WHITE) ? BLACK : WHITE;   // the end of the scale the ink is nearer
  const far = end === BLACK ? WHITE : BLACK;
  // room for the shade as well as the ink: the paper itself must stand well clear of 7:1
  for (let t = 0.05; contrastRatio(mixColors(paper, end, 0.12), end) < PAPER_INK_MIN + 0.5 && t <= 1.0001; t += 0.05) paper = mixColors(paper, far, 0.05);
  const within = (tone: string, ink: string, min: number) => { let x = tone; for (let i = 0; i < 20 && contrastRatio(x, ink) < min; i++) x = mixColors(x, paper, 0.25); return contrastRatio(x, ink) < min ? paper : x; };
  const asked = textSafe(safeColor(c.cardInk, rawInk), [paper], end, PAPER_INK_MIN);
  // how much the paper may darken under the words: more on a letter (it is aged), a little on the others
  const shade = within(mixColors(paper, end, style === 'letter' ? 0.1 : 0.05), end, PAPER_INK_MIN + 0.3);
  const rule = style === 'notebook' || style === 'torn' ? within(mixColors(mixColors(paper, accent2, 0.4), end, 0.08), end, PAPER_INK_MIN + 0.3) : shade;
  const under = [paper, shade, rule];
  const ink = textSafe(asked, under, end, PAPER_INK_MIN);
  return {
    '--psd-card': paper, '--psd-card-ink': ink,
    '--psd-card-accent': textSafe(accent, under, ink, PAPER_SMALL_MIN), '--psd-card-muted': textSafe(mixColors(ink, paper, 0.3), under, ink, PAPER_SMALL_MIN),
    '--psd-pp-shade': shade, '--psd-pp-rule': rule, '--psd-pp-edge': mixColors(paper, ink, 0.35), '--psd-pp-light': mixColors(paper, far, 0.55),
    '--psd-pp-margin': mixColors(paper, accent, 0.6),
    '--psd-pp-stamp': mixColors(paper, ink, 0.14), '--psd-pp-sky': mixColors(accent2, paper, 0.4), '--psd-pp-sun': accent,
    '--psd-pp-dune': mixColors(accent, ink, 0.4), '--psd-pp-dune2': mixColors(accent2, ink, 0.55), '--psd-pp-post': mixColors(paper, ink, 0.6),
  };
}

type FixedShade = Exclude<PaperShade, 'theme'>;
/** The papers of a fixed tone. `paper` is the sheet; `deep` the darkest its uneven tone, its creases and its worn
 *  patches reach; `stain` and `fox` an old stain and a foxing spot; `burn` the browned rim, which is drawn only in
 *  the margin of a card, outside its words; `rule` and `margin` the lines of a ruled page; `fade` how far the
 *  stamp's colours have gone toward the paper. */
const SHADES: Record<FixedShade, { paper: string; deep: string; stain: string; fox: string; burn: string; rule: string; margin: string; ink: string; fade: number }> = {
  white: { paper: '#fbfaf5', deep: '#f0eee6', stain: '#f0eee6', fox: '#f0eee6', burn: '#d9d6cb', rule: '#aebfd8', margin: '#dc8c86', ink: '#1b1a18', fade: 0 },
  cream: { paper: '#f5ebd4', deep: '#eadcbc', stain: '#eadcbc', fox: '#eadcbc', burn: '#cdb88c', rule: '#b3bcc6', margin: '#cf8272', ink: '#201a12', fade: 0.1 },
  aged: { paper: '#e9d6aa', deep: '#d2b885', stain: '#cfb37c', fox: '#c79f69', burn: '#8f6a3b', rule: '#9aa7ad', margin: '#b0563f', ink: '#1e160c', fade: 0.35 },
  kraft: { paper: '#cfab7c', deep: '#bf9967', stain: '#bd9562', fox: '#b58c58', burn: '#8a6537', rule: '#a48c6c', margin: '#9c4a34', ink: '#140d05', fade: 0.3 },
  newsprint: { paper: '#dedbd0', deep: '#cbc7b9', stain: '#c9c3b0', fox: '#c4bca6', burn: '#a59a7c', rule: '#a3acb4', margin: '#a9645a', ink: '#17171a', fade: 0.3 },
};
/** The tones of a paper that can lie under its words: the sheet, every mark of age on it, the darkest any of them
 *  can come to where they overlap (`floor`: no mix of colours is darker in any channel than the darkest of each),
 *  and the ruled line. The browned rim is not among them: it is drawn in the card's margin only. */
export function paperUnder(t: Record<string, string>): string[] {
  const sheet = ['--psd-card', '--psd-pp-shade', '--psd-pp-stain', '--psd-pp-fox'].map(k => t[k]).filter((v): v is string => !!v);
  const parsed = sheet.map(parseColor).filter((x): x is RGB => !!x);
  const floor = parsed.length ? hexOf([0, 1, 2].map(i => Math.min(...parsed.map(x => x[i]))) as RGB) : t['--psd-card'];
  return [...new Set([...sheet, floor, t['--psd-pp-rule']].filter(Boolean))];
}
/** The colours of a paper of a fixed tone. The tone is the shade's own, whatever the theme; the ink is the shade's
 *  dark ink, at 7:1 on every tone under the words (`paperUnder`); the small print and the label (the theme's accent,
 *  moved toward the ink as far as it takes) reach 4.5:1 on all of them. Marks of age that would cost the words
 *  their contrast are pulled back toward the paper until they do not. The ink also reads at 4.5:1 on the rim. */
function shadeColors(colors: unknown, style: PaperStyle, shade: FixedShade): Record<string, string> {
  const c = obj(colors), s = SHADES[shade], paper = s.paper;
  const hex = (v: unknown, fallback: string): string => { const x = parseColor(safeColor(v, fallback)); return x ? hexOf(x) : fallback; };
  const accent = hex(c.accent, s.ink), accent2 = hex(c.accent2, accent);
  const ruled = style === 'notebook' || style === 'torn';
  let deep = s.deep, stain = s.stain, fox = s.fox, rule = ruled ? s.rule : s.deep, burn = s.burn;
  const tones = (): Record<string, string> => ({ '--psd-card': paper, '--psd-pp-shade': deep, '--psd-pp-stain': stain, '--psd-pp-fox': fox, '--psd-pp-rule': rule });
  for (let i = 0; i < 40 && worst(s.ink, paperUnder(tones())) < PAPER_INK_MIN + 0.3; i++) { deep = mixColors(deep, paper, 0.15); stain = mixColors(stain, paper, 0.15); fox = mixColors(fox, paper, 0.15); rule = mixColors(rule, paper, 0.15); }
  for (let i = 0; i < 40 && contrastRatio(s.ink, burn) < PAPER_SMALL_MIN + 0.2; i++) burn = mixColors(burn, paper, 0.05);
  const under = paperUnder(tones());
  const ink = textSafe(s.ink, under, BLACK, PAPER_INK_MIN);
  const faded = (color: string) => mixColors(color, paper, s.fade);
  return {
    ...tones(), '--psd-card-ink': ink,
    '--psd-card-accent': textSafe(accent, under, ink, PAPER_SMALL_MIN), '--psd-card-muted': textSafe(mixColors(ink, paper, 0.3), under, ink, PAPER_SMALL_MIN),
    '--psd-pp-burn': burn, '--psd-pp-edge': mixColors(paper, ink, 0.35), '--psd-pp-light': mixColors(paper, WHITE, 0.55),
    '--psd-pp-margin': s.margin,
    '--psd-pp-stamp': mixColors(paper, ink, 0.14), '--psd-pp-sky': faded(mixColors(accent2, paper, 0.4)), '--psd-pp-sun': faded(accent),
    '--psd-pp-dune': faded(mixColors(accent, ink, 0.4)), '--psd-pp-dune2': faded(mixColors(accent2, ink, 0.55)), '--psd-pp-post': mixColors(paper, ink, 0.6 - s.fade * 0.5),
  };
}

// ---------- the scrim over a picture: strong behind the words, light everywhere else ----------

export interface Box { x: number; y: number; w: number; h: number }
/** The layouts whose picture shows around the words: on these the strong scrim is drawn behind each block of text only. */
export const VEILED: ReadonlySet<string> = new Set(['cover', 'photo', 'closing']);
export const VEIL_PAD = 0.5;    // em: how far past the measured text the full-strength scrim reaches before it starts to fade
export const VEIL_SNAP = 3;     // percent: a box that ends this near an edge of the slide runs off that edge
/** How much of the background colour lies over the parts of a picture that have no words on them, in percent: the
 *  author's "how much the picture is faded" (0 to 1), never under 10% and never over 30%. */
export function scrimLight(asked: unknown): number {
  const a = typeof asked === 'number' && Number.isFinite(asked) ? Math.max(0, Math.min(1, asked)) : DEFAULT_SCRIM;
  return Math.round(Math.max(10, Math.min(30, a * 40)));
}
export const VEIL_LABEL = 2.2;  // em: a block no taller than this is a label (a small heading, a sign-off, a footnote)
export const VEIL_NEAR = 1.6;   // em: blocks this close above or below one another share one box
/** Where the shade goes: one box for each group of text, as percentages of the slide (`frame`); `em` is the slide's
 *  type size in pixels. Each measured block is widened by `VEIL_PAD` on every side, rounded outward to a hundredth of
 *  a percent and cut at the slide's edges, so no pixel of the text is outside its box; from there a box only ever
 *  grows. Blocks that sit over or under one another, within `VEIL_NEAR`, are joined (one box round a heading and its
 *  paragraphs, so the shade has one plain shape and not a step for every line). A box that ends within `VEIL_SNAP`
 *  percent of an edge runs off that edge. A block with no size, or wholly off the slide, gets none; a frame with no
 *  size gets none at all (and the slide keeps its scrim everywhere). The footer is not given to this function: it has
 *  its own band along the bottom (`footBand`). */
export function veilBoxes(texts: Box[], frame: Box, em: number): { left: number; top: number; width: number; height: number }[] {
  if (!(frame.w > 0) || !(frame.h > 0)) return [];
  const unit = Number.isFinite(em) && em > 0 ? em : 0, p = unit * VEIL_PAD;
  const down = (v: number) => Math.floor(v * 100) / 100, up = (v: number) => Math.ceil(v * 100) / 100;
  interface Edge { l: number; r: number; a: number; b: number; label: boolean }
  let boxes: Edge[] = [];
  for (const t of texts) {
    if (![t.x, t.y, t.w, t.h].every(Number.isFinite) || !(t.w > 0) || !(t.h > 0)) continue;
    const l = Math.max(0, down(((t.x - p - frame.x) / frame.w) * 100)), r = Math.min(100, up(((t.x + t.w + p - frame.x) / frame.w) * 100));
    const a = Math.max(0, down(((t.y - p - frame.y) / frame.h) * 100)), b = Math.min(100, up(((t.y + t.h + p - frame.y) / frame.h) * 100));
    if (r > l && b > a) boxes.push({ l, r, a, b, label: t.h <= unit * VEIL_LABEL });
  }
  // a block joins the nearest block it sits over or under, when that block is close
  const near = ((unit * VEIL_NEAR) / frame.h) * 100;
  for (let again = true; again;) {
    again = false;
    for (const x of boxes) {
      let best: Edge | null = null, bestGap = Infinity;
      for (const y of boxes) {
        if (y === x || Math.min(x.r, y.r) <= Math.max(x.l, y.l)) continue;
        const gap = Math.max(0, y.a - x.b, x.a - y.b);
        if (gap <= near && gap < bestGap) { best = y; bestGap = gap; }
      }
      if (!best) continue;
      const joined: Edge = { l: Math.min(x.l, best.l), r: Math.max(x.r, best.r), a: Math.min(x.a, best.a), b: Math.max(x.b, best.b), label: x.label && best.label };
      boxes = boxes.filter(q => q !== x && q !== best); boxes.push(joined); again = true; break;
    }
  }
  const out: { left: number; top: number; width: number; height: number }[] = [], seen = new Set<string>();
  for (const q of boxes) {
    let { l, r, a, b } = q;
    if (l <= VEIL_SNAP) l = 0;
    if (r >= 100 - VEIL_SNAP) r = 100;
    if (a <= VEIL_SNAP) a = 0;
    if (b >= 100 - VEIL_SNAP) b = 100;
    const box = { left: l, top: a, width: Math.round((r - l) * 100) / 100, height: Math.round((b - a) * 100) / 100 }, key = `${box.left} ${box.top} ${box.width} ${box.height}`;
    if (!seen.has(key)) { seen.add(key); out.push(box); }
  }
  return out.sort((x, y) => x.top - y.top || x.left - y.left);
}
export const FOOT_RISE = 2.6;   // em: how far above the footer's words its band takes to reach full strength
/** Where the footer's band starts, as a percentage down the slide: `FOOT_RISE` above the highest of the footer's
 *  words (the band runs the whole width, from there to the bottom edge). Null when there is nothing to measure. */
export function footBand(texts: Box[], frame: Box, em: number): { top: number } | null {
  if (!(frame.w > 0) || !(frame.h > 0)) return null;
  const unit = Number.isFinite(em) && em > 0 ? em : 0;
  let top = Infinity;
  for (const t of texts) {
    if (![t.x, t.y, t.w, t.h].every(Number.isFinite) || !(t.w > 0) || !(t.h > 0)) continue;
    if (t.y >= frame.y + frame.h || t.y + t.h <= frame.y) continue;
    top = Math.min(top, t.y);
  }
  if (top === Infinity) return null;
  const pct = ((top - unit * (FOOT_RISE + VEIL_PAD) - frame.y) / frame.h) * 100;
  return { top: Math.max(0, Math.min(100, Math.floor(pct * 100) / 100)) };
}

// ---------- how strong the shade has to be: read from the picture itself ----------

export const SHADE_STEP = 0.05;
export const SHADE_SPARE = 0.05;      // added to what was measured: the picture may move a little, and was read small
export const SHADE_PASS = 0.95;       // this share of the picture under the words has to pass
export const TURN_FROM = 0.3;        // a slide whose words need at least this much shade is tried the other way round
export const TURN_GAIN = 0.2;        // and stays that way only when it then needs this much less
export const LARGE_TEXT = 1.2;        // times the slide's type size: words this large need 3 to 1, smaller ones 4.5 to 1
/** A colour as the browser reports it from a computed style: `rgb()`, `rgba()`, hex, or `color(srgb r g b)`. */
export function readColor(color: string): RGB | null {
  const plain = parseColor(color);
  if (plain) return plain;
  const m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(str(color).trim().toLowerCase());
  return m ? ([1, 2, 3].map(i => Math.max(0, Math.min(255, +m[i] * 255))) as RGB) : null;
}
/** How much of the background colour (0 to `ceiling`, in steps of `SHADE_STEP`) has to lie over these pixels of the
 *  picture for words of this colour to be readable on them. `pixels` is RGBA, as a canvas gives it; `wash` (0 to 1)
 *  is the light wash already over the whole picture. The shade is enough when `SHADE_PASS` of the pixels give the
 *  words their contrast (4.5 to 1, or 3 to 1 for large words); `SHADE_SPARE` is added on top. Anything that cannot
 *  be read (no pixels, a colour that is not a colour) answers the ceiling, which is the shade a slide had before. */
export function shadeNeeded(pixels: ArrayLike<number>, bg: string, text: string, large: boolean, wash: number, ceiling = MIN_SCRIM): number {
  const b = readColor(bg), t = readColor(text), n = Math.floor((pixels?.length ?? 0) / 4);
  if (!b || !t || n < 1 || !Number.isFinite(wash)) return ceiling;
  const w = Math.max(0, Math.min(1, wash)), want = large ? 3 : 4.5, lt = luminance(t);
  const washed: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const px = [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]];
    if (!px.every(Number.isFinite)) return ceiling;
    washed.push(px.map((v, c) => v + (b[c] - v) * w) as RGB);
  }
  const steps = Math.round(ceiling / SHADE_STEP);
  for (let s = 0; s <= steps; s++) {
    const k = Math.min(ceiling, s * SHADE_STEP);
    let ok = 0;
    for (const px of washed) {
      const l = luminance(px.map((v, c) => v + (b[c] - v) * k) as RGB);
      if ((Math.max(l, lt) + 0.05) / (Math.min(l, lt) + 0.05) >= want) ok++;
    }
    if (ok / n >= SHADE_PASS) return Math.min(ceiling, Math.round((k + SHADE_SPARE) * 100) / 100);
  }
  return ceiling;
}

// ---------- the mount ----------

type Kid = Node | string | null | undefined | false;
interface Part { index: number; layout: string; section: HTMLElement; box: HTMLElement; cells: HTMLElement[]; counts: HTMLElement[]; veils?: HTMLElement; inks?: { plain: Record<string, string>; turned: Record<string, string>; turnedBg: string }; update?: () => void }
interface Count { e: HTMLElement; live: HTMLElement; pre: string; post: string; to: number; dec: number; group: boolean }
type Timer = ReturnType<typeof setTimeout>;

interface TakenFaces { faces: (CleanFace & { name: string })[]; loads: Promise<unknown>[]; release: () => void }
/** Registers a theme's font files with the document and says what each was registered as. `release` lets go of them
 *  (once: a second call does nothing); a face another deck still holds stays. */
function takeFaces(doc: Document, win: (Window & typeof globalThis) | null, theme: unknown): TakenFaces {
  const faces = namedFontFaces(obj(theme).fontFaces);
  const releases: (() => void)[] = [];
  const loads: Promise<unknown>[] = [];
  const Face = win && (win as unknown as { FontFace?: new (family: string, src: string, descriptors?: { weight?: string; style?: string }) => FaceLike }).FontFace;
  const set = (doc as unknown as { fonts?: FaceSet }).fonts;
  if (Face && set && typeof set.add === 'function') {
    let pool = facePool.get(doc);
    if (!pool) { pool = new Map(); facePool.set(doc, pool); }
    const mine = pool;
    for (const f of faces) {
      const sized = f.weight !== undefined || f.style !== undefined;   // one weight of a family: registered as that weight and style
      const key = `${f.name}\n${f.src}${sized ? `\n${f.weight !== undefined ? weightText(f.weight) : ''}\n${f.style ?? ''}` : ''}`;   // the name carries a hash of the file; the file itself settles the one-in-a-billion clash
      let entry = mine.get(key);
      if (!entry) {
        try {
          // the address was checked: base64 only, so nothing in it can close the quotes
          const face = sized
            ? new Face(f.name, `url("${f.src}")`, { ...(f.weight !== undefined ? { weight: weightText(f.weight) } : {}), ...(f.style ? { style: f.style } : {}) })
            : new Face(f.name, `url("${f.src}")`);
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
  // what the slide being built asked for (set before its layout runs): numbers that count up, a headline typed out, a picture that travels along the timeline
  let counting: HTMLElement[] | null = null;
  let typed = false;
  let marker: HTMLElement | null = null;
  /** The number inside `e`, wrapped so that a count can run over it without moving anything. */
  const numBox = (e: HTMLElement, ...kids: Kid[]): HTMLElement => { const n = el('span', 'psd-num', ...kids); e.appendChild(n); counting?.push(e); return n; };
  const val = (tag: string, cls: string, text: unknown): HTMLElement | null => {
    if (!has(text)) return null;
    const kids = symKids(str(text).trim());
    if (!counting) return el(tag, cls, ...kids);
    const e = el(tag, cls); numBox(e, ...kids);
    return e;
  };
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
  const root = el('div', `psd${isStatic ? ' psd-static' : ''}${opts.stacked === false ? ' psd-scaled' : ''}${opts.motion === false ? ' psd-still' : ''}${opts.swatch ? ' psd-swatch' : ''}`);
  const deckMotion = cleanDeckMotion(d.motion);
  const brisk = deckMotion?.pace === 'brisk';
  if (brisk) root.classList.add('psd-brisk');
  if (deckMotion && deckMotion.entrance !== 'rise') root.dataset.enter = deckMotion.entrance;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'slide deck');
  root.setAttribute('aria-label', `${film || 'Film'} pitch deck. Use the arrow keys to move between slides.`);
  if (!isStatic) root.tabIndex = 0;
  const fonts = obj(theme.fonts);
  // a font file goes in front of its role's stack, under the name it was registered with
  const withFaces = (role: 'title' | 'body', stack: string) => [...new Set(faces.filter(f => f.role === role).map(f => `"${f.name}"`)), stack].join(', ');
  const titleFont = withFaces('title', fontStack(fonts.title, TITLE_FALLBACK));
  const vars: Record<string, string> = { ...deckColors(theme.colors), '--psd-title-font': titleFont, '--psd-body-font': withFaces('body', fontStack(fonts.body, BODY_FALLBACK)) };
  const hand = theme.hand === true, tilt = theme.tilt === true;
  if (hand) { root.classList.add('psd-hand'); vars['--psd-hand-font'] = `"${HAND_FAMILY}", ${titleFont}`; }
  for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);

  // --- papers: a card is dressed as the paper its slide (or the deck) names. Everything drawn is an empty element
  //     the stylesheet shapes; the only values set here are colours worked out from the theme and edges worked out
  //     from the card's place in the deck. ---
  const tones = new Map<string, Record<string, string>>();
  const TILTS = [-0.6, 0.5, -0.4, 0.7];
  let slideAt = 0;                                  // the slide being built: with a card's place on it, the seed its edge is cut from
  let slidePapers: (n: number) => PaperStyle[] = () => [];
  let slideShade: PaperShade = 'theme';                // the tone of the papers on the slide being built
  const bit = (cls: string, ...kids: Kid[]): HTMLElement => el('i', cls, ...kids);
  const dress = <T extends HTMLElement>(card: T, style: PaperStyle, at = 0): T => {
    const seed = slideAt * 8 + at;
    const shade = slideShade, toneKey = `${style} ${shade}`;
    let tone = tones.get(toneKey);
    if (!tone) { tone = paperColors(theme.colors, style, shade); tones.set(toneKey, tone); }
    for (const k of Object.keys(tone)) card.style.setProperty(k, tone[k]);
    card.dataset.paper = style;
    if (shade !== 'theme') card.dataset.shade = shade;   // a paper of a fixed tone; a card that says nothing is the theme's own
    const layer = el('span', 'psd-pp', bit('psd-pp-edge'), style === 'torn' ? bit('psd-pp-rip') : null, bit('psd-pp-sheet'));
    layer.setAttribute('aria-hidden', 'true');
    if (style === 'torn') layer.style.setProperty('--psd-pp-cut', tornEdge(seed));
    if (style === 'letter') { layer.style.setProperty('--psd-pp-cut', unevenEdge(seed)); layer.append(bit('psd-pp-fold psd-pp-fold-a'), bit('psd-pp-fold psd-pp-fold-b'), bit('psd-pp-fold psd-pp-fold-v')); }
    if (style === 'notebook') layer.append(bit('psd-pp-margin'));
    if (style === 'postcard') layer.append(bit('psd-pp-divider'), bit('psd-pp-address'), bit('psd-pp-stamp', bit('psd-pp-stamp-art')), bit('psd-pp-postmark'));
    const marks = paperMarks(seed, shade);
    if (marks) layer.style.setProperty('--psd-pp-marks', marks);
    card.insertBefore(layer, card.firstChild);
    if (tilt) card.style.setProperty('--r', `${TILTS[seed % TILTS.length]}deg`);
    return card;
  };
  /** A card's text: its last paragraph runs to the foot of the card (on a ruled paper the lines go on under it), and a
   *  line short enough to be a note is marked as one. */
  const cardBodies = (bodies: (HTMLElement | null)[]): (HTMLElement | null)[] => {
    const have = bodies.filter((b): b is HTMLElement => !!b);
    have.forEach((b, i) => { if (i === have.length - 1) b.classList.add('psd-card-fill'); if ((b.textContent ?? '').length <= SHORT_BODY) b.classList.add('psd-short'); });
    return bodies;
  };

  // --- shared pieces ---
  const head = (s: Obj, headline: unknown = s.headline, lone = true): HTMLElement | null => {
    if (!has(s.eyebrow) && !has(headline) && !has(s.punch)) return null;
    const h = el('header', 'psd-head');
    const lines = has(headline) || has(s.punch);
    // a slide has one heading: its headline, or the small label when that is all there is
    if (has(s.eyebrow)) h.appendChild(rise(el(lines || !lone ? 'p' : 'h2', 'psd-eyebrow', str(s.eyebrow).trim())));
    if (lines) {
      const a = str(headline).trim().length, b = str(s.punch).trim().length;
      const size = Math.max(a, b) > 80 || a + b > 130 ? ' psd-h-xlong' : Math.max(a, b) > 45 || a + b > 80 ? ' psd-h-long' : '';
      if (!typed) h.appendChild(rise(el('h2', `psd-h${size}`, txt('span', 'psd-h1', headline), txt('span', 'psd-punch', s.punch))));
      else {
        // typed out: the whole headline is there for a screen reader from the start; the copy that appears letter
        // by letter is for the eye only, and takes its full room before the first letter shows
        let c = 0;
        const letters = (cls: string, text: unknown): HTMLElement | null => (has(text) ? el('span', cls, ...[...str(text).trim()].map(ch => {
          if (/\s/.test(ch)) return ch;
          const e = el('span', 'psd-ch', ch); e.style.setProperty('--c', String(c++)); return e;
        })) : null);
        const seen = el('span', 'psd-typed', letters('psd-h1', headline), letters('psd-punch', s.punch));
        seen.setAttribute('aria-hidden', 'true');
        const h2 = el('h2', `psd-h${size}`, hidden([headline, s.punch].filter(has).map(t => str(t).trim()).join(' ')), seen);
        h2.style.setProperty('--psd-type', `${Math.round(Math.min(34, 1700 / Math.max(1, c)))}ms`);
        h.appendChild(h2);
      }
    }
    return h;
  };
  const paras = (text: unknown, cls: string): HTMLElement[] => paragraphs(text).map(p => rise(el('p', cls, p)));
  const cardEl = (cd: Obj, i: number, style: PaperStyle): HTMLElement => {
    const e = cell(el('article', 'psd-card',
      txt('p', 'psd-kicker', cd.kicker), txt('h3', 'psd-card-title', cd.title), ...cardBodies([txt('p', 'psd-card-body', cd.body)]), txt('p', 'psd-card-foot', cd.footnote)));
    e.dataset.cardId = str(cd.id);
    return rise(dress(e, style, i), 'psd-drop');
  };
  /** A slide's cards, side by side in one row: two to four across, each as tall as the tallest. */
  const cardRow = (cards: unknown): HTMLElement | null => {
    const shown = list(cards).filter(cd => has(cd.title) || has(cd.body)).slice(0, 4);
    if (!shown.length) return null;
    const row = el('div', 'psd-cards');
    row.style.setProperty('--n', String(shown.length));
    row.dataset.n = String(shown.length);
    const papers = slidePapers(shown.length);
    shown.forEach((cd, i) => row.appendChild(cardEl(cd, i, papers[i])));
    return row;
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
          rise(dress(cell(el('div', 'psd-card psd-cover-card', line, txt('h1', `psd-title${title.length > 40 ? ' psd-title-xlong' : title.length > 20 ? ' psd-title-long' : ''}`, title), bit('psd-card-rules'))), slidePapers(1)[0]), 'psd-drop'),
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
      const top = head(s);   // built first, so the headline arrives before the cards under it
      const row = cardRow(s.cards);
      part.update = () => {
        row?.querySelectorAll<HTMLElement>('.psd-card').forEach(e => {
          const on = !!recipient?.highlightCardId && e.dataset.cardId === recipient.highlightCardId;
          e.classList.toggle('psd-highlight', on);
          if (on) e.setAttribute('aria-current', 'true'); else e.removeAttribute('aria-current');
        });
      };
      return [top, row];
    },
    stats(s) {
      const ld = obj(s.lead);
      const lead = has(ld.value) || has(ld.text)
        ? rise(el('div', 'psd-lead', val('p', 'psd-big', ld.value), el('div', 'psd-lead-say', txt('p', 'psd-lead-text', ld.text), txt('p', 'psd-src', ld.source))))
        : null;
      const body = paras(s.body, 'psd-p');
      const q = obj(s.quote);
      const quote = has(q.text)
        ? rise(dress(el('figure', 'psd-card psd-quote', el('blockquote', 'psd-quote-text', str(q.text).trim()), txt('figcaption', 'psd-quote-by', q.by)), slidePapers(1)[0]), 'psd-drop')
        : null;
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
      const track = miles.length ? el('div', 'psd-track', el('div', 'psd-axis'), marker,
        el('ol', 'psd-miles', ...miles.map(m => rise(el('li', 'psd-mile', el('span', 'psd-tick'), txt('span', 'psd-when', m.when), txt('span', 'psd-what', m.what)))))) : null;
      if (track) track.style.setProperty('--n', String(miles.length));
      if (track && marker) { track.classList.add('psd-track-mark'); const size = marker.style.getPropertyValue('--psd-mark'); if (size) track.style.setProperty('--psd-mark', size); }   // room for the picture between the facts and the rail
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
        ? rise(dress(cell(el('aside', 'psd-card psd-team-aside', txt('h3', 'psd-card-title', a.title), ...cardBodies(texts(a.lines).map(l => el('p', 'psd-card-body', l))), txt('p', 'psd-card-foot', a.footnote))), slidePapers(1)[0]), 'psd-drop')
        : null;
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
      const budgetBox = el('span', 'psd-fig-val'); budgetBox.dataset.part = 'budget';
      const investorsBox = el('span', 'psd-fig-val'); investorsBox.dataset.part = 'investors';
      const budget = numBox(budgetBox), investors = numBox(investorsBox);   // a count runs over the figure; what is counted to is always the figure itself
      const figs = el('div', 'psd-figs', el('div', 'psd-fig', el('span', 'psd-lab', 'Budget to raise'), budgetBox), el('div', 'psd-fig psd-fig-big', el('span', 'psd-lab', 'Investors fund'), investorsBox));
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
      // the title is the slide's heading, unless the slide has a headline of its own above it
      return [el('div', 'psd-closing-slide', head(s, s.headline, false), rise(txt(has(s.headline) || has(s.punch) ? 'p' : 'h2', 'psd-title psd-title-end', has(s.title) ? s.title : film)), rise(txt('p', 'psd-signoff', theme.signoff)))];
    },
  };

  // --- build ---
  const images = new Map(list(d.images).filter(i => typeof i.src === 'string' && imageOk(i.src)).map(i => [str(i.id), i] as const));
  const drawable = list(d.slides).filter(s => typeof s.layout === 'string' && Object.prototype.hasOwnProperty.call(layouts, s.layout));
  const parts: Part[] = [];
  let pictureIn: () => void = () => { /* set once the deck can be measured again */ };
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
    let veilHost: HTMLElement | undefined;
    let inks: Part['inks'];
    const img = has(s.imageId) ? images.get(str(s.imageId)) : undefined;
    if (img) {
      const pic = doc.createElement('img');
      pic.className = 'psd-bg'; pic.alt = str(img.alt); pic.decoding = 'async';
      pic.addEventListener('load', () => pictureIn());   // the shade behind the words is set from the picture: measure again once it is there
      pic.src = img.src as string;
      const asked = typeof s.scrim === 'number' && Number.isFinite(s.scrim) ? Math.max(0, Math.min(1, s.scrim)) : DEFAULT_SCRIM;
      const k = Math.max(MIN_SCRIM, asked);   // under the text; the author's value still sets the side with no text
      const scrim = el('div', 'psd-scrim');
      scrim.style.setProperty('--psd-scrim', `${Math.round(k * 100)}%`);
      scrim.style.setProperty('--psd-scrim-soft', `${Math.round(asked * 45)}%`);
      scrim.style.setProperty('--psd-scrim-light', `${scrimLight(asked)}%`);
      if (VEILED.has(layout)) { veilHost = el('span', 'psd-veils'); veilHost.setAttribute('aria-hidden', 'true'); scrim.appendChild(veilHost); }
      inner.append(pic, scrim);
      section.classList.add('psd-has-picture');
      const safe = deckColors(theme.colors, 1 - k);   // text colours that hold with a picture showing through
      for (const key of Object.keys(safe)) section.style.setProperty(key, safe[key]);
      if (veilHost) {
        // the same words the other way round, for a picture that suits them better: the theme's ink as the shade, its
        // background as the ink (dark words on a pale picture, on a dark deck)
        const c = obj(theme.colors), turnedBg = safeColor(c.ink, '#111111');
        inks = { plain: safe, turned: deckColors({ ...c, bg: c.ink, ink: c.bg }, 1 - k), turnedBg };
        section.style.setProperty('--psd-turned-bg', turnedBg);
      }
    }
    const box = el('div', 'psd-box');
    const part: Part = { index, layout, section, box, cells: [], counts: [], veils: veilHost, inks };
    // movement: words from the fixed list become an attribute or a class, numbers are clamped and set as properties
    const mo = cleanMotion(s.motion, layout) ?? {};
    if (mo.entrance) section.dataset.enter = mo.entrance;
    const gap = mo.order === 'together' ? 0 : mo.stagger ?? (mo.order ? ONE_BY_ONE : null);
    if (gap != null) section.style.setProperty('--psd-gap', `${gap}ms`);
    counting = mo.count ? part.counts : null;
    typed = mo.headline === 'type';
    const mk = mo.marker ? images.get(mo.marker.imageId) : undefined;
    marker = null;
    if (mo.marker && mk) {
      const im = doc.createElement('img');
      im.className = `psd-mark${mo.marker.end === 'settle' ? ' psd-mark-settle' : ''}`; im.alt = ''; im.decoding = 'async'; im.src = mk.src as string;
      im.setAttribute('aria-hidden', 'true');
      if (mo.marker.size != null) im.style.setProperty('--psd-mark', String(mo.marker.size));
      marker = im;
    }
    slideAt = index;
    slidePapers = n => dealPapers(theme.paper, s.paper, n);
    slideShade = dealShade(theme.paperShade, s.paperShade);
    for (const k of layouts[layout](s, part)) if (k) box.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    counting = null; typed = false; marker = null;
    // parts arrive in the order they are read (top to bottom), or last first
    const moving = [...box.querySelectorAll<HTMLElement>('.psd-rise, .psd-drop')];
    moving.forEach((e, i) => e.style.setProperty('--i', String(mo.order === 'reverse' ? moving.length - 1 - i : i)));
    // a slide that is only its headline: the headline is the slide
    if (box.children.length === 1 && box.firstElementChild!.classList.contains('psd-head')) section.classList.add('psd-only-head');
    const small = txt('p', 'psd-footnote', s.footnote);
    if (small) { box.appendChild(small); section.classList.add('psd-has-footnote'); }
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
  /** How tall the slide's content is (its first part's top to its last part's foot, small print aside) and how much room it has. */
  const filled = (p: Part): { room: number; content: number } => {
    const kids = [...p.box.children].filter(k => !k.classList.contains('psd-footnote') && !(k as HTMLElement).hidden) as HTMLElement[];
    const note = p.box.querySelector<HTMLElement>(':scope > .psd-footnote');
    const cs = win?.getComputedStyle?.(p.box);
    const pad = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    if (!kids.length) return { room: 0, content: 0 };
    const top = kids[0].getBoundingClientRect().top, foot = kids[kids.length - 1].getBoundingClientRect().bottom;
    return { room: p.box.clientHeight - pad - (note ? note.offsetHeight : 0), content: foot - top };
  };
  function fitPart(p: Part): boolean {
    p.section.style.removeProperty('--psd-fs');
    p.section.classList.remove('psd-centre');   // measured from the top, as it is laid out
    if (stacked || !(p.box.clientHeight > 0)) {   // the stacked layout grows with its content; a slide not laid out says nothing
      if (stacked) p.section.dataset.overflow = 'false';
      veil(p, false);
      return false;
    }
    let bad = false;
    for (const fs of FIT_STEPS) {
      if (fs !== FIT_STEPS[0]) p.section.style.setProperty('--psd-fs', String(fs));
      bad = spills(p);
      if (!bad) break;
    }
    p.section.dataset.overflow = String(bad);
    // a slide with little on it: its content sits in the middle (a touch above), not in the top half of an empty slide
    if (!bad && CENTRED.has(p.layout) && !p.section.classList.contains('psd-only-head')) {
      const f = filled(p);
      p.section.classList.toggle('psd-centre', shouldCentre(f.room, f.content));
    }
    if ((p.layout === 'photo' || p.layout === 'closing') && p.section.classList.contains('psd-has-picture')) {   // the scrim is full strength as far up as the text goes
      const top = p.box.querySelector('.psd-photo > *, .psd-closing-slide > *')?.getBoundingClientRect().top, r = p.section.getBoundingClientRect();
      if (top != null && r.height > 0) p.section.style.setProperty('--psd-stop', `${Math.round(Math.max(30, Math.min(100, ((r.bottom - top) / r.height) * 100 + 8)))}%`);
    }
    veil(p, true);
    return bad;
  }
  /** Turns the words of a picture slide the other way round (dark words and a pale shade on a dark deck, and the
   *  reverse on a light one), or back. */
  function turn(p: Part, on: boolean) {
    if (!p.inks) return;
    const set = on ? p.inks.turned : p.inks.plain;
    for (const key of Object.keys(set)) p.section.style.setProperty(key, set[key]);
    p.section.classList.toggle('psd-turned', on);
  }
  /** The picture of a slide, read small (64 across), as the slide crops it: what is behind any part of the slide.
   *  Null when it cannot be read (not loaded yet, no canvas, a picture the page may not read). */
  function pictureGrid(p: Part, frame: { width: number; height: number }): { w: number; h: number; data: ArrayLike<number> } | null {
    try {
      const img = p.section.querySelector<HTMLImageElement>('img.psd-bg');
      if (!img || !img.complete || !(img.naturalWidth > 0) || !(img.naturalHeight > 0) || !(frame.width > 0) || !(frame.height > 0)) return null;
      const w = 64, h = Math.max(1, Math.round((w * frame.height) / frame.width));
      const canvas = doc.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (!ctx) return null;
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / scale, sh = h / scale;   // object-fit: cover, centred
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
      return { w, h, data: ctx.getImageData(0, 0, w, h).data };
    } catch { return null; }
  }
  /** The pixels of that small picture under a rectangle of the slide (in the slide's own pixels). */
  function under(grid: { w: number; h: number; data: ArrayLike<number> }, r: Box, frame: { left: number; top: number; width: number; height: number }): number[] {
    const x0 = Math.max(0, Math.floor(((r.x - frame.left) / frame.width) * grid.w)), x1 = Math.min(grid.w, Math.ceil(((r.x + r.w - frame.left) / frame.width) * grid.w));
    const y0 = Math.max(0, Math.floor(((r.y - frame.top) / frame.height) * grid.h)), y1 = Math.min(grid.h, Math.ceil(((r.y + r.h - frame.top) / frame.height) * grid.h));
    const out: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * grid.w + x) * 4; out.push(grid.data[i], grid.data[i + 1], grid.data[i + 2], grid.data[i + 3]); }
    return out;
  }
  /** The shade of a picture slide, drawn where its words are: every block of text outside a card is measured where it
   *  will sit. The words of the slide get one soft shade round each group of them, and the footer a band along the
   *  bottom; each is only as strong as the picture behind it needs for those words to be readable (never stronger than
   *  the scrim a slide had before). The rest of the picture keeps only the light wash. Until a slide has been measured
   *  (and whenever it cannot be) the scrim is as it always was. */
  function veil(p: Part, on: boolean) {
    const host = p.veils; if (!host) return;
    turn(p, false);   // measured first with the words as the theme has them
    const boxes: ReturnType<typeof veilBoxes> = [];
    let band: ReturnType<typeof footBand> = null, strong: number | null = null, footStrong: number | null = null;
    if (on && typeof doc.createRange === 'function') {
      const frame = p.section.getBoundingClientRect(), em = parseFloat((win?.getComputedStyle(host).fontSize) ?? '') || 0;
      const blocks = new Set<Element>();
      for (const e of p.section.querySelectorAll('.psd-box *, .psd-foot *, .psd-foot')) {
        if (e.closest('.psd-card')) continue;   // a card is its own surface
        if (![...e.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')) continue;
        blocks.add(e.closest('p, h1, h2, h3, li, figcaption, blockquote') ?? e);
      }
      const words: { rect: Box; el: Element; foot: boolean }[] = [];
      for (const b of blocks) { const range = doc.createRange(); range.selectNodeContents(b); const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : b.getBoundingClientRect(); words.push({ rect: { x: r.left, y: r.top, w: r.width, h: r.height }, el: b, foot: !!b.closest('.psd-foot') }); }
      if (em > 0 && blocks.size) {
        const f = { x: frame.left, y: frame.top, w: frame.width, h: frame.height };
        boxes.push(...veilBoxes(words.filter(x => !x.foot).map(x => x.rect), f, em));
        band = footBand(words.filter(x => x.foot).map(x => x.rect), f, em);
        // how strong: read from the picture behind each block of words, with the words as the theme has them and
        // then the other way round; the slide takes whichever needs clearly less shade
        const grid = pictureGrid(p, frame), look = win?.getComputedStyle(host);
        const wash = (parseFloat(look?.getPropertyValue('--psd-scrim-light') ?? '') || 0) / 100;
        const measure = (bg: string): { main: number; foot: number } | null => {
          if (!grid || !readColor(bg)) return null;
          let main = 0, foot = 0;
          for (const x of words) {
            if (!(x.rect.w > 0) || !(x.rect.h > 0)) continue;
            const cs = win?.getComputedStyle(x.el), size = parseFloat(cs?.fontSize ?? '') || 0;
            const need = shadeNeeded(under(grid, x.rect, frame), bg, cs?.color ?? '', size >= em * LARGE_TEXT, wash);
            if (x.foot) foot = Math.max(foot, need); else main = Math.max(main, need);
          }
          return { main, foot };
        };
        const plain = measure(look?.getPropertyValue('--psd-bg').trim() ?? '');
        let chosen = plain;
        if (plain && p.inks) {
          const worst = (m: { main: number; foot: number }) => (words.some(x => !x.foot) ? m.main : m.foot);
          if (worst(plain) >= TURN_FROM) {
            turn(p, true);
            const turned = measure(p.inks.turnedBg);
            if (turned && worst(turned) <= worst(plain) - TURN_GAIN) chosen = turned; else turn(p, false);
          }
        }
        if (chosen) { strong = chosen.main; footStrong = chosen.foot; }
      }
    }
    while (host.firstChild) host.removeChild(host.firstChild);
    for (const b of boxes) {
      const v = el('i', 'psd-veil'); v.style.left = `${b.left}%`; v.style.top = `${b.top}%`; v.style.width = `${b.width}%`; v.style.height = `${b.height}%`;
      if (strong != null) v.style.setProperty('--k', String(strong));
      host.appendChild(v);
    }
    if (band) {
      const v = el('i', 'psd-veil-foot'); v.style.top = `${band.top}%`;
      if (footStrong != null) v.style.setProperty('--k', String(footStrong));
      host.appendChild(v);
    }
    if (boxes.length || band) p.section.dataset.veil = ''; else delete p.section.dataset.veil;
  }
  function fitAll(): number[] {
    if (destroyed) return [];
    root.classList.add('psd-measuring');   // parts waiting to rise are measured where they will land
    const bad = parts.filter(fitPart).map(p => p.index);
    root.classList.remove('psd-measuring');
    return bad;
  }
  let stillT: Timer | null = null;   // set while a still deck is playing one slide
  let refitT: Timer | null = null;
  const refit = () => { if (refitT == null) refitT = later(() => { refitT = null; fitAll(); }, 0); };
  pictureIn = refit;

  // --- numbers that count up. Only what is drawn over the figure moves: the figure itself is in the document, whole,
  //     from the start (for a screen reader, for the fit, for print) and is what shows again when the count ends. ---
  const counts = new Set<Count>();
  let frame = 0;
  const raf = win && typeof win.requestAnimationFrame === 'function' ? win : null;
  function stopCounts() {
    for (const c of counts) { c.live.remove(); c.e.classList.remove('psd-counting'); }
    counts.clear();
    if (frame && raf) raf.cancelAnimationFrame(frame);
    frame = 0;
  }
  cleanups.push(stopCounts);
  function startCounts(p: Part) {
    if (!raf || destroyed || !p.counts.length) return;
    for (const e of p.counts) {
      if ([...counts].some(c => c.e === e)) continue;
      const m = /^(\D*)(\d[\d,]*(?:\.\d+)?)([^]*)$/.exec(e.querySelector('.psd-num')?.textContent ?? '');
      const to = m ? parseFloat(m[2].replace(/,/g, '')) : NaN;
      if (!m || !Number.isFinite(to) || to <= 0) continue;
      const live = el('span', 'psd-count-live'); live.setAttribute('aria-hidden', 'true');
      e.appendChild(live); e.classList.add('psd-counting');
      counts.add({ e, live, pre: m[1], post: m[3], to, dec: (m[2].split('.')[1] ?? '').length, group: m[2].includes(',') });
    }
    const ms = brisk ? 700 : 1100;
    let t0 = -1;
    const show = (c: Count, k: number) => {
      const [whole, frac] = (c.to * k).toFixed(c.dec).split('.');
      const text = `${c.pre}${c.group ? whole.replace(/\B(?=(\d{3})+$)/g, ',') : whole}${frac ? `.${frac}` : ''}${c.post}`;
      if (c.live.textContent !== text) c.live.replaceChildren(...(symKids(text).filter(Boolean) as (Node | string)[]));
    };
    const step = (now: number) => {
      frame = 0;
      if (destroyed) return;
      if (t0 < 0) t0 = now;
      const t = Math.min(1, (now - t0) / ms);
      if (t >= 1 || stacked || reduced()) { stopCounts(); return; }
      for (const c of counts) show(c, 1 - (1 - t) ** 3);
      frame = raf.requestAnimationFrame(step);
    };
    for (const c of counts) show(c, 0);
    if (counts.size && !frame) frame = raf.requestAnimationFrame(step);
  }

  // --- state changes ---
  const recompute = () => { stopCounts(); result = pathFor(paths, switches); updateAll(); refit(); };
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
        const sec = en.target as HTMLElement;
        if (sec.classList.contains('psd-seen')) continue;
        sec.classList.add('psd-seen');
        const p = parts.find(x => x.section === sec);
        if (p && !stacked && !reduced()) startCounts(p);
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
    // one observer: the host changing size is a resize; a block of words on a picture slide changing size only means
    // its scrim has to be measured again
    const ro = new RO((entries?: { target: Element }[]) => { if (!entries || !entries.length || entries.some(e => e.target === host)) resized(); else refit(); });
    ro.observe(host);
    for (const p of parts) if (p.veils) { for (const e of p.section.querySelectorAll('.psd-box > *, .psd-box > * > *, .psd-foot')) ro.observe(e); }
    cleanups.push(() => ro.disconnect());
  }
  if (!isStatic) listen(doc, 'fullscreenchange', resized);
  // the typefaces arrive after the first layout, and change what fits
  (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(() => { fitAll(); }, () => { /* nothing to refit */ });
  if (faceLoads.length) void Promise.all(faceLoads).then(() => { fitAll(); });
  // the words of a picture slide have their scrim where they were measured: when a face that loaded late may have
  // moved them they are measured again (a block that changed size is seen by the observer above)
  const fontSet = (doc as Document & { fonts?: EventTarget }).fonts;
  if (fontSet && typeof fontSet.addEventListener === 'function') { fontSet.addEventListener('loadingdone', refit); cleanups.push(() => fontSet.removeEventListener('loadingdone', refit)); }

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
      // a file made for one person stays theirs whatever the link ending says: only the ask can change
      applyAudience(opts.fixedRecipient ? recipient?.slug ?? null : h.slug, h.lead ?? null);
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
    play(index) {
      const p = parts[index == null ? current : Math.round(index)];
      if (destroyed || !p || isStatic || stacked) return 'still';
      if (reduced()) return 'reduced';
      stopCounts();
      // back to where the slide starts, with nothing easing on the way there, then let it go
      p.section.classList.add('psd-reset');
      root.classList.remove('psd-still');
      p.section.classList.remove('psd-seen');
      void p.section.offsetWidth;
      p.section.classList.remove('psd-reset');
      void p.section.offsetWidth;
      p.section.classList.add('psd-seen');
      startCounts(p);
      if (opts.motion === false) { cancel(stillT); stillT = later(() => { stillT = null; root.classList.add('psd-still'); }, PLAY_MS); }
      return 'played';
    },
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
