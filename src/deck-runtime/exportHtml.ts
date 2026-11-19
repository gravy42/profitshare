// The file a filmmaker sends: one .html with the deck's runtime, stylesheet, typefaces and data all inside it, so
// it opens from an email attachment or a disk with no network at all. `deckHtml` is the whole assembly: text in,
// text out. No DOM, no clock, no dice: the same inputs always give the same file, byte for byte.
//
// One person per file. A file made for someone holds that one recipient and nobody else; a file made for anyone
// holds no recipients at all. Nothing an author typed can become markup: the data travels as JSON with every
// character that could end a script element or open a comment written as a \u escape.
import type { DeckData } from './data';
import { cleanFamily, cleanWeight, fontSrcOk, HAND_FAMILY, HAND_WEIGHT, weightText } from './fonts';
import { base64, sha256, utf8 } from './hash';

export { base64, sha256, utf8 };

/** A typeface as a data URL, for an @font-face in a page: one the app itself ships (Work Sans, Special Elite, Caveat),
 *  or a font file the deck carries. `weight` is one number, or the lightest and heaviest of a variable file. */
export interface PageFont {
  family: string;
  weight: number | [number, number];
  style?: 'normal' | 'italic';
  src: string;
  unicodeRange?: string;
}
interface DeckParts {
  runtimeJs: string; // the runtime bundle: an IIFE that defines window.ProfitShareDeck
  css: string; // deck.css
  title?: string; // the page title; left out, the film's name and "Investor deck"
  lang?: string; // the page language (default en)
  fonts?: PageFont[]; // the app's own typefaces the deck's theme uses
}
interface DeckHtmlOptions {
  recipient?: string; // a link ending: the file is made for this one person and holds nobody else
  static?: boolean; // every slide in its final state, one under the other, nothing to press (for print)
}

// ---------- text that is safe where it goes ----------

/** JSON that can sit inside a script element: `<`, `>`, `&` and the two line separators JavaScript reads as line
 *  ends are written as \u escapes, so no text in it can close the element, open a comment or break a string.
 *  A value with no JSON of its own (undefined, a function) is written as null. */
export function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(
    /[<>&\u2028\u2029]/g,
    ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
/** Text for an element's content or a double-quoted attribute. */
export const escapeHtml = (text: string): string =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
/** A script's source with nothing in it that the HTML parser could take for the end of the element or the start of
 *  a comment (`</script`, `<!--`): inside JavaScript `<\/` and `<\!` mean what `</` and `<!` mean. */
export const safeScript = (js: string): string => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

// ---------- the app's own typefaces: only what the theme uses ----------

const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i;
export const BUNDLED_FAMILIES = ['Work Sans', 'Special Elite', HAND_FAMILY] as const;
type BundledFamily = (typeof BUNDLED_FAMILIES)[number];
// what the runtime puts after every stack (runtime.ts: TITLE_FALLBACK, BODY_FALLBACK)
const ROLE_FALLBACK: Record<'title' | 'body', BundledFamily> = { title: 'Special Elite', body: 'Work Sans' };

/** The app's typeface a stack lands on, or null when it never gets that far. Names are tried in order: one of the
 *  app's own is the answer; a generic word (serif, system-ui) always matches something on the reader's machine, so
 *  the search ends there; any other name may or may not be installed, so the search goes on, and at the end of the
 *  author's list stands the role's fallback, which is one of the app's. */
export function bundledFamilyOf(stack: unknown, role: 'title' | 'body'): BundledFamily | null {
  const names = (typeof stack === 'string' ? stack : '')
    .split(',')
    .map(x =>
      x
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter(Boolean);
  for (const name of names) {
    const own = BUNDLED_FAMILIES.find(f => f.toLowerCase() === name.toLowerCase());
    if (own) return own;
    if (GENERIC.test(name)) return null;
  }
  return ROLE_FALLBACK[role];
}

export interface FaceNeed {
  family: BundledFamily;
  weight: number;
  style: 'normal' | 'italic';
}
/** The faces of the app's own typefaces a deck draws with: the weights the stylesheet asks of each role (titles are
 *  set at 400; body text at 400 and 600, and in italics only for a recipient's note). A role that carries a font file
 *  of its own does without them, unless the deck's text has letters outside basic Latin, which that file may lack.
 *  The handwriting face is among them only when the theme asks for handwriting and a slide has a card to write on.
 *  Sorted, with no face twice. */
export function bundledFacesNeeded(data: DeckData): FaceNeed[] {
  const fonts = data?.theme?.fonts ?? { title: '', body: '' };
  const files = Array.isArray(data?.theme?.fontFaces) ? data.theme.fontFaces : [];
  const wide = needsLatinExt(data);
  const covered = (role: 'title' | 'body') =>
    !wide && files.some(f => f && f.role === role && !!cleanFamily(f.family) && fontSrcOk(f.src));
  const out = new Map<string, FaceNeed>();
  const add = (family: BundledFamily | null, weight: number, style: 'normal' | 'italic' = 'normal') => {
    if (!family) return;
    const w = family === 'Special Elite' ? 400 : family === HAND_FAMILY ? HAND_WEIGHT : weight; // one weight is all those faces have (or all the app carries)
    const st = family === 'Work Sans' ? style : 'normal';
    out.set(`${family}|${w}|${st}`, { family, weight: w, style: st });
  };
  if (!covered('title')) add(bundledFamilyOf(fonts.title, 'title'), 400);
  if (!covered('body')) {
    const body = bundledFamilyOf(fonts.body, 'body');
    add(body, 400);
    add(body, 600);
    if (Array.isArray(data?.recipients) && data.recipients.some(r => r && typeof r.note === 'string' && r.note.trim()))
      add(body, 400, 'italic');
  }
  if (data?.theme?.hand === true && hasCards(data)) add(HAND_FAMILY, HAND_WEIGHT);
  return [...out.values()].sort(
    (a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style),
  );
}
/** Whether any slide draws a card: a cover, a row of cards, a quote, the card beside the team. */
export function hasCards(data: DeckData): boolean {
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  return (Array.isArray(data?.slides) ? data.slides : []).some(
    s =>
      !!s &&
      typeof s === 'object' &&
      (s.layout === 'cover' ||
        ((s.layout === 'cards' || s.layout === 'ways') &&
          Array.isArray(s.cards) &&
          s.cards.some(c => !!c && (text(c.title) || text(c.body)))) ||
        (s.layout === 'stats' && text(s.quote?.text)) ||
        (s.layout === 'team' &&
          !!s.aside &&
          (text(s.aside.title) || (Array.isArray(s.aside.lines) && s.aside.lines.some(text))))),
  );
}

/** The characters the "latin-ext" files of the app's typefaces cover: a deck with none of them does not carry those files. */
const LATIN_EXT =
  /[\u0100-\u02ba\u02bd-\u02c5\u02c7-\u02cc\u02ce-\u02d7\u02dd-\u02ff\u1d00-\u1dbf\u1e00-\u1e9f\u1ef2-\u1eff\u2020\u20a0-\u20ab\u20ad-\u20c0\u2113\u2c60-\u2c7f\ua720-\ua7ff]/;
export const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
export const LATIN_EXT_RANGE =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
/** Whether any text in the deck (pictures and font files aside) has a letter outside basic Latin. */
export function needsLatinExt(data: DeckData): boolean {
  const { images: _i, theme, ...rest } = data ?? ({} as DeckData);
  return LATIN_EXT.test(JSON.stringify([rest, theme?.name, theme?.signoff]));
}

const RANGE_OK = /^U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?(,\s?U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?)*$/i;
/** @font-face rules for the page. A face whose file is not a base64 font, or whose name is not a plain one, is left out. */
export function fontFaceCss(fonts: PageFont[] | undefined): string {
  const out: string[] = [];
  for (const f of Array.isArray(fonts) ? fonts : []) {
    const family = cleanFamily(f?.family);
    // a weight outside what a stylesheet takes is a face left out, not one moved to the nearest it does take
    const whole = (v: unknown) => {
      const n = Math.round(Number(v));
      return n >= 1 && n <= 1000 ? n : undefined;
    };
    const raw: unknown = f?.weight;
    const weight = Array.isArray(raw)
      ? raw.length === 2 && raw.every(v => whole(v) !== undefined)
        ? cleanWeight(raw.map(whole))
        : undefined
      : whole(raw);
    if (!family || !fontSrcOk(f?.src) || weight === undefined) continue;
    const range =
      typeof f.unicodeRange === 'string' && RANGE_OK.test(f.unicodeRange) ? `;unicode-range:${f.unicodeRange}` : '';
    const format = /^data:font\/woff2/i.test(f.src) ? ' format("woff2")' : '';
    out.push(
      `@font-face{font-family:"${family}";font-weight:${weightText(weight)};font-style:${f.style === 'italic' ? 'italic' : 'normal'};font-display:block;src:url(${f.src})${format}${range}}`,
    );
  }
  return out.join('\n');
}

// ---------- the page ----------

/** The data as it goes into a file: the one recipient the file is for, or none. Never more than one. */
export function dataFor(data: DeckData, recipient?: string): DeckData {
  const all = Array.isArray(data.recipients) ? data.recipients : [];
  if (recipient == null || recipient === '') return { ...data, recipients: [] };
  const one = all.find(r => r && r.slug === recipient);
  if (!one) throw new Error(`No one on this deck has the link ending "${recipient}".`);
  return { ...data, recipients: [one] };
}

export const deckTitle = (film: string): string => (film.trim() ? `${film.trim()}: Investor deck` : 'Investor deck');
const NOSCRIPT =
  'This deck draws its slides with JavaScript, which is switched off here. Open the file in a web browser with JavaScript on, or ask for the PDF.';
const HEX = /^#[0-9a-f]{3,8}$/i;

/** The script that starts the deck. The recipient is fixed when the file is written: a link ending (#without,
 *  #with) can switch the ask and nothing else. */
const bootScript = (isStatic: boolean, slug: string | null): string =>
  `(function(){var g=function(i){return JSON.parse(document.getElementById(i).textContent)};window.deck=window.ProfitShareDeck.mountDeck(document.getElementById("deck"),g("deck-data"),{css:g("deck-css"),useHash:true,fixedRecipient:true,pageKeys:true,static:${isStatic ? 'true' : 'false'}${slug ? `,recipient:${safeJson(slug)}` : ''}})})();`;

/** The whole page for a deck, as text. `parts` is the runtime and its stylesheet (and the app's typefaces the theme
 *  uses, already read into data URLs); `opts.recipient` makes it one person's file. */
export function deckHtml(data: DeckData, parts: DeckParts, opts: DeckHtmlOptions = {}): string {
  const mine = dataFor(data, opts.recipient);
  const slug = mine.recipients[0]?.slug ?? null;
  const isStatic = !!opts.static;
  const film = typeof mine.film === 'string' ? mine.film : '';
  const title = (parts.title ?? '').trim() || deckTitle(film);
  const lang = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(parts.lang ?? '') ? parts.lang! : 'en';
  const bg = HEX.test(mine.theme?.colors?.bg ?? '') ? mine.theme.colors.bg : '#ffffff';
  const faces = fontFaceCss(parts.fonts);
  // one script, so one hash in the policy: the runtime, then the few lines that start it
  const script = `${safeScript(parts.runtimeJs.trim())}\n${bootScript(isStatic, slug)}`;
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${base64(sha256(utf8(script)))}'`,
    "style-src 'unsafe-inline'", // the deck's stylesheet goes into its own shadow tree as a style element
    'img-src data:', // every picture is inside the file
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${faces ? `${faces}\n` : ''}html,body{margin:0;height:100%;background:${bg}}
#deck{height:${isStatic ? 'auto' : '100vh;height:100dvh'}}
noscript p{margin:0;padding:2em;font:16px/1.5 system-ui,sans-serif;background:#fff;color:#111}
</style>
</head>
<body>
<div id="deck"></div>
<noscript><p>${escapeHtml(NOSCRIPT)}</p></noscript>
<script type="application/json" id="deck-data">${safeJson(mine)}</script>
<script type="application/json" id="deck-css">${safeJson(parts.css)}</script>
<script>${script}</script>
</body>
</html>
`;
}
