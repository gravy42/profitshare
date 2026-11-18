// Google Fonts, as far as rules go: reading the bundled catalogue, searching it, choosing which weights a role
// needs, building the one address the picker asks Google for, reading Google's answer, and the font files a picked
// family becomes in a project. Pure: no DOM, no network, no clock. The page that does the asking is
// src/ui/googleFontsNet.ts; nothing in the deck's runtime knows any of this exists.
import type { FontFile } from './types';
import { cleanFamily, shortHash, weightText, type FaceWeight } from '../deck-runtime/fonts';
import { dataUrlBytes, readFontFiles } from './deckEdit';

// ---------- the only two places the picker ever asks ----------

export const GOOGLE_CSS_ORIGIN = 'https://fonts.googleapis.com';    // the stylesheet that says where a family's files are
export const GOOGLE_FILE_ORIGIN = 'https://fonts.gstatic.com';      // the files
export const GOOGLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'] as const;

export const GOOGLE_CSS_MAX = 200_000;         // a stylesheet longer than this is not one of Google's for a single family
export const GOOGLE_FILE_MAX_BYTES = 2_000_000;   // one font file; latin files are tens of kilobytes
export const GOOGLE_WARN_BYTES = 600_000;      // a family that adds more than this to a project is worth a word

/** What the page says before anything is asked of Google. One wording, everywhere it is shown. */
export const GOOGLE_DISCLOSURE = "Browsing fonts loads previews from Google Fonts (fonts.googleapis.com and fonts.gstatic.com). Google sees your computer's address and which fonts you look at, the same as on any site that uses Google Fonts. Nothing about your project is sent. The font you pick is saved into your project, so your deck never needs Google again.";

// ---------- the catalogue ----------

export const FONT_CATEGORIES = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'] as const;
export type FontCategory = typeof FONT_CATEGORIES[number];
export const CATEGORY_NAMES: Record<FontCategory, string> = { 'sans-serif': 'Sans serif', serif: 'Serif', display: 'Display', handwriting: 'Handwriting', monospace: 'Monospace' };
export const FONT_LICENCES = ['OFL', 'Apache', 'UFL'] as const;
export type FontLicence = typeof FONT_LICENCES[number];
export const LICENCE_NAMES: Record<FontLicence, string> = { OFL: 'SIL Open Font License', Apache: 'Apache License 2.0', UFL: 'Ubuntu Font Licence' };

export interface CatalogueFamily {
  family: string;               // exactly as Google names it; letters, digits and spaces only
  category: FontCategory;
  weights: number[];            // upright weights, lightest first: 100 to 900
  italics: number[];            // the weights that have an italic
  licence: FontLicence;
  latinExt: boolean;            // there are files for central European and other extended Latin letters
  rank: number;                 // 1 is first in the catalogue's browsing order; 0: no place in it
  variable?: [number, number];  // a variable family: the lightest and heaviest weight its one file holds
}
export interface Catalogue { made: string; source: string; rank: 'google' | 'well-known'; families: CatalogueFamily[] }

const FAMILY_OK = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/;
const unmask = (m: unknown): number[] => { const out: number[] = []; if (typeof m === 'number' && Number.isInteger(m)) for (let i = 0; i < 9; i++) if (m & (1 << i)) out.push((i + 1) * 100); return out; };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The catalogue file as the picker uses it. A row that is not what the script writes is left out, never guessed at:
 *  a family name goes into an address, so only the plain names the script lets through are kept. */
export function readCatalogue(raw: unknown): Catalogue {
  const o = isObj(raw) ? raw : {};
  const src = isObj(o.source) ? o.source : {};
  const families: CatalogueFamily[] = []; const seen = new Set<string>();
  for (const row of Array.isArray(o.families) ? o.families : []) {
    if (!Array.isArray(row)) continue;
    const [family, cat, up, ital, lic, ext, rank, lo, hi] = row as unknown[];
    if (typeof family !== 'string' || !FAMILY_OK.test(family) || family !== cleanFamily(family) || seen.has(family.toLowerCase())) continue;
    const category = FONT_CATEGORIES[cat as number], licence = FONT_LICENCES[lic as number];
    const weights = unmask(up);
    if (!category || !licence || !weights.length) continue;
    const range = typeof lo === 'number' && typeof hi === 'number' && Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && hi <= 1000 && lo < hi ? [lo, hi] as [number, number] : undefined;
    seen.add(family.toLowerCase());
    families.push({ family, category, weights, italics: unmask(ital), licence, latinExt: ext === 1, rank: typeof rank === 'number' && Number.isInteger(rank) && rank > 0 ? rank : 0, ...(range ? { variable: range } : {}) });
  }
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 80) : '');
  return { made: text(o.made), source: [text(src['google-font-metadata']) && `google-font-metadata ${text(src['google-font-metadata'])}`, text(src['google/fonts']) && `google/fonts ${text(src['google/fonts']).slice(0, 10)}`].filter(Boolean).join(', '), rank: o.rank === 'google' ? 'google' : 'well-known', families };
}

/** A name someone typed (or a font stack: its first name), found in the catalogue whatever its capitals or quotes.
 *  What comes back is the catalogue's own row: the typed text is never what goes into an address. */
export function findFamily(families: CatalogueFamily[], typed: unknown): CatalogueFamily | undefined {
  const name = (typeof typed === 'string' ? typed : '').split(',')[0].replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return name ? families.find(f => f.family.toLowerCase() === name) : undefined;
}

export type FontSort = 'popular' | 'az';
export interface FontQuery { query?: string; category?: FontCategory | ''; sort?: FontSort }
const byName = (a: CatalogueFamily, b: CatalogueFamily) => { const x = a.family.toLowerCase(), y = b.family.toLowerCase(); return x < y ? -1 : x > y ? 1 : a.family < b.family ? -1 : a.family > b.family ? 1 : 0; };
const byRank = (a: CatalogueFamily, b: CatalogueFamily) => (a.rank && b.rank ? a.rank - b.rank : a.rank ? -1 : b.rank ? 1 : 0) || byName(a, b);

/** The families that match: every word typed is somewhere in the name; one category, or all. With something typed,
 *  names that start with it come first, then names with a word that starts with it, then the rest; inside each, the
 *  chosen order. */
export function searchCatalogue(families: CatalogueFamily[], q: FontQuery = {}): CatalogueFamily[] {
  const words = (typeof q.query === 'string' ? q.query : '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean).slice(0, 6);
  const order = q.sort === 'az' ? byName : byRank;
  const typed = words.join(' ');
  const score = (f: CatalogueFamily): number => {
    const name = f.family.toLowerCase();
    if (!words.every(w => name.includes(w))) return -1;
    if (!typed) return 0;
    return name.startsWith(typed) ? 0 : name.split(' ').some(part => part.startsWith(words[0])) ? 1 : 2;
  };
  return families.filter(f => !q.category || f.category === q.category).map(f => ({ f, s: score(f) })).filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s || order(a.f, b.f)).map(x => x.f);
}

/** "Variable, 100 to 900, with italics"; "9 weights, 100 to 900"; "Regular and bold, with italics"; "One weight". */
export function weightsInWords(f: CatalogueFamily): string {
  const ital = f.italics.length ? ', with italics' : '';
  if (f.variable) return `Variable, ${f.variable[0]} to ${f.variable[1]}${ital}`;
  const w = f.weights;
  if (w.length === 1) return `One weight${w[0] === 400 ? '' : ` (${w[0]})`}${f.italics.length ? ', with an italic' : ''}`;
  if (w.length === 2 && w[0] === 400 && w[1] === 700) return `Regular and bold${ital}`;
  return `${w.length} weights, ${w[0]} to ${w[w.length - 1]}${ital}`;
}

// ---------- which weights a role needs ----------

export type FontRole = FontFile['role'];
/** What to fetch for a role. A family with fixed weights: a regular, a bold when there is one, and for body text an
 *  italic. A variable family: its one file, which holds every weight (`range`), and for body text its italic one. */
export interface WeightPlan { regular: number; bold?: number; italic?: number; range?: [number, number] }

const nearest = (list: number[], to: number): number => list.reduce((best, w) => (Math.abs(w - to) < Math.abs(best - to) ? w : best), list[0]);

/** The deck sets titles at 400 and body text at 400 and 600, with italics only in body text. So: the weight nearest
 *  400 as the regular; as the bold, the heavier weight nearest 700 for a title and nearest 600 for body text (when
 *  the family has nothing from 600 up, its heaviest); and for body text the italic of the regular, or the nearest
 *  italic there is. A family with one weight gets that one, and bold is drawn from it as it always was. */
export function weightsFor(role: FontRole, f: CatalogueFamily): WeightPlan {
  const body = role === 'body';
  if (f.variable) {
    const [lo, hi] = f.variable; const mid = Math.min(hi, Math.max(lo, 400));
    return { regular: mid, range: [lo, hi], ...(body && f.italics.length ? { italic: mid } : {}) };
  }
  const weights = [...f.weights].sort((a, b) => a - b);
  const regular = nearest(weights, 400);
  const heavier = weights.filter(w => w > regular), strong = heavier.filter(w => w >= 600);
  const bold = strong.length ? nearest(strong, body ? 600 : 700) : heavier.length ? heavier[heavier.length - 1] : undefined;
  const italic = body && f.italics.length ? (f.italics.includes(regular) ? regular : nearest([...f.italics].sort((a, b) => a - b), regular)) : undefined;
  return { regular, ...(bold !== undefined ? { bold } : {}), ...(italic !== undefined ? { italic } : {}) };
}

/** "Regular 400 and bold 700"; "Regular 400, bold 600 and italic"; "Every weight from 100 to 900, and italics". */
export function planInWords(p: WeightPlan): string {
  if (p.range) return `Every weight from ${p.range[0]} to ${p.range[1]}${p.italic !== undefined ? ', and italics' : ''}`;
  const parts = [`${p.regular === 400 ? 'Regular' : 'Weight'} ${p.regular}`, ...(p.bold !== undefined ? [`bold ${p.bold}`] : []), ...(p.italic !== undefined ? ['italic'] : [])];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

// ---------- the address ----------

/** A family's name as it goes into an address. Only a name the catalogue's own rule passes; anything else is refused. */
function familyParam(f: CatalogueFamily): string {
  if (!FAMILY_OK.test(f.family)) throw new Error('not a family name from the catalogue');
  return encodeURIComponent(f.family).replace(/%20/g, '+');
}
/** The stylesheet that says where a family's files for a plan are (Google's "css2" form). `italic: false` asks for
 *  the upright files alone: what to fall back to if Google has no italic after all. */
export function css2Url(f: CatalogueFamily, plan: WeightPlan, opts: { italic?: boolean } = {}): string {
  const ital = opts.italic !== false && plan.italic !== undefined;
  const span = plan.range ? `${plan.range[0]}..${plan.range[1]}` : '';
  const upright = plan.range ? [span] : [plan.regular, ...(plan.bold !== undefined ? [plan.bold] : [])].sort((a, b) => a - b).map(String);
  const spec = ital ? `ital,wght@${[...upright.map(w => `0,${w}`), `1,${plan.range ? span : plan.italic}`].join(';')}` : `wght@${upright.join(';')}`;
  return `${GOOGLE_CSS_ORIGIN}/css2?family=${familyParam(f)}:${spec}&display=swap`;
}
/** The letters a preview is drawn with. Fixed: the same for every family and every project, so asking for a preview
 *  says nothing about the film (not even which letters its title has). Letters outside it are drawn in a standard font. */
export const PREVIEW_LETTERS = ' !&\'(),-.0123456789:?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** The stylesheet for one family's preview: one weight, and only the letters above, so it is a few kilobytes. */
export function previewCssUrl(f: CatalogueFamily): string {
  const w = f.variable ? Math.min(f.variable[1], Math.max(f.variable[0], 400)) : nearest([...f.weights].sort((a, b) => a - b), 400);
  return `${GOOGLE_CSS_ORIGIN}/css2?family=${familyParam(f)}:wght@${w}&text=${encodeURIComponent(PREVIEW_LETTERS)}&display=swap`;
}
/** The weight a preview is drawn at (the one its stylesheet asks for). */
export const previewWeight = (f: CatalogueFamily): number => (f.variable ? Math.min(f.variable[1], Math.max(f.variable[0], 400)) : nearest([...f.weights].sort((a, b) => a - b), 400));
/** True for an address on one of the two hosts, over https, and nothing else. */
export function isGoogleFontsUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  return url.startsWith(`${GOOGLE_CSS_ORIGIN}/`) || url.startsWith(`${GOOGLE_FILE_ORIGIN}/`);
}

// ---------- Google's answer ----------

export interface Css2Face { family: string; style: 'normal' | 'italic'; weight: FaceWeight; url: string; subset: string; unicodeRange: string }

// A file's address: https, the files host, a plain path that ends in .woff2. No query, no fragment, no dots that climb.
const FILE_URL = /^https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*\.woff2$/;
const SRC = /^url\(\s*(["']?)([^"'()\s]+)\1\s*\)\s+format\(\s*(["'])woff2\3\s*\)$/;
const RANGE = /^U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?(,\s*U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?)*$/i;
const BLOCK = /(?:\/\*\s*([a-z0-9-]{1,40})\s*\*\/\s*)?@font-face\s*\{([^{}]*)\}/g;
/** True when the text is @font-face blocks, comments and white space, and nothing else. */
function onlyFontFaces(css: string): boolean {
  const rest = css.replace(BLOCK, '');
  let left = '';
  for (let i = 0; ;) {
    const at = rest.indexOf('/*', i);
    if (at < 0) { left += rest.slice(i); break; }
    left += rest.slice(i, at);
    const end = rest.indexOf('*/', at + 2);
    if (end < 0 || left.length > 4000) return false;
    i = end + 2;
  }
  return left.trim() === '';
}

/** The faces in a stylesheet from Google: for each @font-face block its family, style, weight (one, or a range for a
 *  variable file), the address of its .woff2 and the subset it is for (the comment above the block, or worked out
 *  from its unicode range). The text is only ever read here, never put into a page. A block is left out whole
 *  unless every part is what Google writes: an address anywhere but https://fonts.gstatic.com/….woff2, a second
 *  address, a format that is not woff2, a weight that is not a number. Google's answer is @font-face blocks and
 *  comments and nothing else: a stylesheet with anything more in it (an @import, another rule, markup), or one too
 *  long to be Google's, gives nothing at all. */
export function parseCss2(css: unknown): Css2Face[] {
  if (typeof css !== 'string' || css.length > GOOGLE_CSS_MAX || !onlyFontFaces(css)) return [];
  const out: Css2Face[] = [];
  for (const m of css.matchAll(BLOCK)) {
    const decl = new Map<string, string>(); let twice = false;
    for (const part of m[2].split(';')) {
      const at = part.indexOf(':'); if (at < 0) continue;
      const key = part.slice(0, at).trim().toLowerCase(), value = part.slice(at + 1).trim();
      if (decl.has(key)) twice = true;
      decl.set(key, value);
    }
    if (twice) continue;
    const family = cleanFamily((decl.get('font-family') ?? '').replace(/^(["'])(.*)\1$/, '$2'));
    const style = decl.get('font-style') ?? 'normal';
    const w = /^(\d{1,4})(?: (\d{1,4}))?$/.exec(decl.get('font-weight') ?? '');
    const src = SRC.exec(decl.get('src') ?? '');
    const range = decl.get('unicode-range') ?? '';
    if (!family || (style !== 'normal' && style !== 'italic') || !w || !src || !FILE_URL.test(src[2]) || src[2].includes('..') || (range && !RANGE.test(range))) continue;
    const a = +w[1], b = w[2] === undefined ? a : +w[2];
    if (!(a >= 1 && b <= 1000 && a <= b)) continue;
    const subset = m[1] ?? (/^U\+0000-00FF\b/i.test(range) ? 'latin' : /^U\+0100-/i.test(range) ? 'latin-ext' : range ? 'other' : 'latin');
    out.push({ family, style, weight: a === b ? a : [a, b], url: src[2], subset, unicodeRange: range });
    if (out.length >= 400) break;
  }
  return out;
}

// A preview's file: the same host, and either a .woff2 path or the address Google gives a font cut down to a few
// letters (/l/font?kit=…&skey=…&v=…): plain names and values only, nothing that could carry another address.
const PREVIEW_URL = /^https:\/\/fonts\.gstatic\.com\/l\/font\?kit=[A-Za-z0-9_-]{1,400}(?:&[a-z]{1,12}=[A-Za-z0-9_.-]{1,80}){0,6}$/;
const PREVIEW_SRC = /^url\(\s*(["']?)([^"'()\s]+)\1\s*\)(?:\s+format\(\s*(["'])[a-z0-9-]{1,20}\3\s*\))?$/;
/** The one file a preview stylesheet (css2 with `text=`) names: its address, at fonts.gstatic.com over https and
 *  nowhere else, or null when the answer is not what Google writes. The same whole-answer rule as parseCss2: anything
 *  but @font-face blocks and comments, and nothing is taken. Upright before italic; latin when subsets are named. */
export function parsePreviewCss(css: unknown): string | null {
  if (typeof css !== 'string' || css.length > GOOGLE_CSS_MAX || !onlyFontFaces(css)) return null;
  const found: { url: string; rank: number }[] = [];
  for (const m of css.matchAll(BLOCK)) {
    const decl = new Map<string, string>(); let twice = false;
    for (const part of m[2].split(';')) {
      const at = part.indexOf(':'); if (at < 0) continue;
      const key = part.slice(0, at).trim().toLowerCase();
      if (decl.has(key)) twice = true;
      decl.set(key, part.slice(at + 1).trim());
    }
    const src = PREVIEW_SRC.exec(decl.get('src') ?? '');
    if (twice || !src || src[2].includes('..') || !(FILE_URL.test(src[2]) || PREVIEW_URL.test(src[2]))) continue;
    const range = decl.get('unicode-range') ?? '';
    const latin = (m[1] ?? (!range || /^U\+0000-00FF\b/i.test(range) ? 'latin' : 'other')) === 'latin';
    found.push({ url: src[2], rank: (decl.get('font-style') ?? 'normal') === 'normal' ? (latin ? 0 : 1) : 2 });
    if (found.length >= 40) break;
  }
  return found.sort((a, b) => a.rank - b.rank)[0]?.url ?? null;
}
/** The private name a preview's face is registered under: never a name a page, a project or a deck uses. */
export const previewFaceName = (family: string): string => `gfp ${cleanFamily(family)}`;
export const GOOGLE_PREVIEW_MAX_BYTES = 400_000;   // a preview is a few letters of one weight

export interface FileToFetch { url: string; weight: FaceWeight; style: 'normal' | 'italic' }
/** The files of a plan among the faces Google listed: the `latin` file of each weight and style the plan asked for,
 *  of the family that was asked for and no other. Sorted: upright before italic, lighter before heavier. */
export function filesToFetch(faces: Css2Face[], f: CatalogueFamily, plan: WeightPlan): FileToFetch[] {
  const want: { style: 'normal' | 'italic'; weight: number }[] = [{ style: 'normal', weight: plan.regular }];
  if (!plan.range && plan.bold !== undefined) want.push({ style: 'normal', weight: plan.bold });
  if (plan.italic !== undefined) want.push({ style: 'italic', weight: plan.italic });
  const out: FileToFetch[] = [];
  const holds = (w: FaceWeight, n: number) => (typeof w === 'number' ? w === n : w[0] <= n && n <= w[1]);
  for (const x of want) {
    const face = faces.find(c => c.subset === 'latin' && c.family === f.family && c.style === x.style && holds(c.weight, x.weight));
    if (!face || out.some(o => o.url === face.url && o.style === face.style)) continue;
    // a variable family asked for by its range comes back as one file for the range; asked for a single weight, Google
    // may still name the variable file under that one weight, and then that weight is all that is claimed for it
    out.push({ url: face.url, weight: face.weight, style: face.style });
  }
  return out;
}

// ---------- a picked family as the project's font files ----------

const ROLE_ORDER = (a: FontFile, b: FontFile) => (a.role === b.role ? 0 : a.role === 'title' ? -1 : 1);
const low = (w: FontFile['weight']) => (w === undefined ? 400 : typeof w === 'number' ? w : w[0]);

/** The files of a family picked from Google Fonts, as the project keeps them: the same kind of thing an attached
 *  font file is, with the weight and style each one is, where it came from and its licence. Open-licensed, so each
 *  may travel inside a deck. An id is a fingerprint of the file, so the same file always has the same id. */
export function googleFontFiles(role: FontRole, f: CatalogueFamily, got: { weight: FaceWeight; style: 'normal' | 'italic'; dataUrl: string }[]): FontFile[] {
  return got.map(g => ({
    id: `gfont_${role}_${weightText(g.weight).replace(' ', '-')}${g.style === 'italic' ? 'i' : ''}_${shortHash(g.dataUrl)}`,
    role, family: f.family, dataUrl: g.dataUrl, embedOk: true, weight: g.weight, style: g.style, source: 'google' as const, licence: f.licence,
  })).sort((a, b) => (a.style === b.style ? low(a.weight) - low(b.weight) : a.style === 'normal' ? -1 : 1));
}
/** The font files with a role's set put in: whatever the role had (an attached file, another family) goes. */
export function setRoleFonts(files: unknown, role: FontRole, mine: FontFile[]): FontFile[] {
  return [...readFontFiles(files).filter(f => f.role !== role), ...mine.filter(f => f.role === role)].sort(ROLE_ORDER);
}
/** The font files without a role's: every file of the family it held. */
export function removeRoleFonts(files: unknown, role: FontRole): FontFile[] {
  return readFontFiles(files).filter(f => f.role !== role);
}

export interface RoleFont { role: FontRole; family: string; google: boolean; licence: string; files: FontFile[]; bytes: number; missing: boolean; embedOk: boolean; weights: string }
/** What a role holds, as one font: its family, whether it came from Google Fonts, its files and their size together. */
export function roleFont(files: unknown, role: FontRole): RoleFont | undefined {
  const mine = readFontFiles(files).filter(f => f.role === role);
  if (!mine.length) return undefined;
  const upright = mine.filter(f => f.style !== 'italic' && f.weight !== undefined).map(f => (typeof f.weight === 'number' ? String(f.weight) : `${f.weight![0]} to ${f.weight![1]}`));
  const words = [...upright, ...(mine.some(f => f.style === 'italic') ? ['italic'] : [])];
  return {
    role, family: mine[0].family, google: mine.every(f => f.source === 'google'), licence: mine[0].licence ?? '', files: mine,
    bytes: mine.reduce((n, f) => n + dataUrlBytes(f.dataUrl), 0), missing: mine.some(f => !f.dataUrl.startsWith('data:')), embedOk: mine.every(f => f.embedOk),
    weights: words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] ?? '',
  };
}
/** The role's font name after a pick: the family itself, so the deck's stack starts with it. */
export const pickedFontName = (f: CatalogueFamily): string => f.family;
