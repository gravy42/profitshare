// Read a brand or design-system document (its text, from a PDF) into the deck's design: colours by the role they
// are given on the page, the type faces it names, a name for the system. Pure, so it is tested without pdf.js.
import type { DeckRules, PitchDesign } from './types';
import { defaultDeckRules } from './pitch';

export interface BrandColors extends Partial<PitchDesign['colors']> { line?: string; inkBright?: string; card?: string }
export interface BrandFound {
  name: string;
  colors: BrandColors;                        // the set the deck will use (the night set when the document has both)
  night?: BrandColors;
  day?: BrandColors;
  fonts: Partial<PitchDesign['fonts']>;
  swatches: { name: string; hex: string }[];   // every named colour on the pages, for the status line
  faces: string[];                            // every type face recognised
  rules: Partial<DeckRules>;                  // slide rules the document states: split layout, eyebrows, the bleed
}

const HEX = /#([0-9a-f]{6})\b/gi;
// a colour's role is the word (or hyphenated word) that sits next to its hex on the page
const ROLE: { key: keyof BrandColors; test: RegExp }[] = [
  { key: 'bg', test: /^(surface|background|ground|page|bg)$/i },
  { key: 'ink', test: /^(ink|text|foreground|body)$/i },
  { key: 'accent', test: /^(accent|primary|highlight|brand)$/i },
  { key: 'accent2', test: /^(signal|secondary|accent-?2|second-?accent)$/i },
  { key: 'muted', test: /^(ink-?muted|muted|caption|secondary-?text)$/i },
  { key: 'line', test: /^(line|rule|divider|border)$/i },
  { key: 'inkBright', test: /^(ink-?bright|bright)$/i },
  { key: 'card', test: /^(card|paper)$/i },
];
// faces this app knows how to pair; the first match in each list becomes the deck's face
const TITLE_FACES = ['Adler', 'Special Elite', 'Courier Prime', 'American Typewriter', 'Playfair Display', 'Peckham Press', 'Bebas Neue', 'Oswald', 'Anton'];
const BODY_FACES = ['Work Sans', 'Inter', 'Roboto', 'Lato', 'Open Sans', 'Source Sans', 'Helvetica Neue', 'Helvetica', 'Arial', 'Georgia', 'IBM Plex Sans', 'DM Sans', 'Nunito'];

const isLabel = (w: string) => /^[a-z][a-z0-9-]*$/.test(w) && w.length <= 20;
const words = (l: string) => l.trim().split(/\s+/).filter(Boolean);
/** A line that is nothing but role labels: "surface", "ink-muted", or two of them when the page has two columns. */
const isLabelLine = (l: string) => { const w = words(l); return w.length > 0 && w.length <= 4 && w.every(isLabel); };

/** Named colours over the document's non-empty lines. The label is the role word beside the hex: on a label line
 *  just above (the k-th label for the k-th hex on the line, as a two-column page lays them out), else a label right
 *  after or before the hex, else a label line just below. Sentences are never labels. `at` is the line index. */
export function namedColors(lines: string[]): { name: string; hex: string; at: number }[] {
  const out: { name: string; hex: string; at: number }[] = [];
  lines.forEach((line, i) => {
    const hexes = [...line.matchAll(HEX)];
    hexes.forEach((m, k) => {
      const hex = `#${m[1].toUpperCase()}`;
      const prev = lines[i - 1] ?? '', next = lines[i + 1] ?? '';
      const after = words(line.slice(m.index! + m[0].length))[0] ?? '';
      const before = words(line.slice(0, m.index)).pop() ?? '';
      let name = '';
      if (isLabelLine(prev)) { const w = words(prev); name = w[Math.min(k, w.length - 1)]; }
      else if (isLabel(after)) name = after;
      else if (isLabel(before)) name = before;
      else if (isLabelLine(next)) { const w = words(next); name = w[Math.min(k, w.length - 1)]; }
      out.push({ name: name.toLowerCase(), hex, at: i });
    });
  });
  return out;
}

const roleMap = (subset: { name: string; hex: string }[]): BrandColors => {
  const c: BrandColors = {};
  for (const n of subset) for (const r of ROLE) if (!c[r.key] && r.test.test(n.name)) c[r.key] = n.hex;
  return c;
};

export function parseBrandText(text: string, fallbackName = ''): BrandFound {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // name: a running footer (the same short line on page after page) wins; else the heading above "brand system"; else the first short line
  // the running footer: the longest Title Case opening that keeps turning up on page after page
  let footer: string | undefined; let last = 0;
  for (let n = 2; n <= 5; n++) {
    const counts = new Map<string, number>();
    for (const l of lines) { const w = words(l); if (w.length >= n && w.slice(0, n).every(x => /^[A-Z][A-Za-z'&-]*$/.test(x))) { const k = w.slice(0, n).join(' '); counts.set(k, (counts.get(k) ?? 0) + 1); } }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 3 || (last && best[1] < last * 0.8)) break;
    footer = best[0]; last = best[1];
  }
  const sys = lines.findIndex(l => /\b(brand|design) system\b/i.test(l));
  const above = sys > 0 ? lines.slice(0, sys).reverse().find(l => l.length <= 40 && words(l).length >= 2 && !/[.:]$/.test(l) && !/^[\d.·\s]+$/.test(l)) : undefined;
  const name = (footer ?? above ?? lines.find(l => l.length <= 40 && words(l).length >= 2) ?? fallbackName).replace(/\s+/g, ' ').trim() || fallbackName;

  const named = namedColors(lines);
  const found: BrandFound = { name, colors: {}, fonts: {}, swatches: named.filter(n => n.name).map(n => ({ name: n.name, hex: n.hex })), faces: [], rules: deckRulesFromText(text) };
  const nightAt = lines.findIndex(l => /colou?r[,:]?\s*(night|dark)/i.test(l));
  const dayAt = lines.findIndex(l => /colou?r[,:]?\s*(day|light)/i.test(l));
  if (nightAt >= 0 && dayAt >= 0) {
    const [a, b] = nightAt < dayAt ? [nightAt, dayAt] : [dayAt, nightAt];
    const first = roleMap(named.filter(n => n.at >= a && n.at < b)), second = roleMap(named.filter(n => n.at >= b));
    found.night = nightAt < dayAt ? first : second;
    found.day = nightAt < dayAt ? second : first;
    found.colors = { ...found.night };
  } else {
    found.colors = roleMap(named);
  }
  // when roles are missing, the darkest colour stands in as the ground and the lightest as ink
  if (!found.colors.bg || !found.colors.ink) {
    const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return 0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255); };
    const sorted = [...new Set(named.map(n => n.hex))].sort((x, y) => lum(x) - lum(y));
    if (sorted.length >= 2) { found.colors.bg ??= sorted[0]; found.colors.ink ??= sorted[sorted.length - 1]; }
  }
  for (const f of TITLE_FACES) if (new RegExp(`\\b${f.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) { found.faces.push(f); found.fonts.title ??= f; }
  for (const f of BODY_FACES) if (new RegExp(`\\b${f.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) { found.faces.push(f); found.fonts.body ??= f; }
  return found;
}

/** Slide rules a brand document states in words: "split layout", "photo bleeds 50 to 60%", "one eyebrow per slide". */
export function deckRulesFromText(text: string): Partial<DeckRules> {
  const t = text.replace(/\s+/g, ' ');
  const out: Partial<DeckRules> = {};
  if (/\bsplit[- ]layout\b/i.test(t) || /photo bleeds/i.test(t)) out.layout = 'split';
  if (/\beyebrow/i.test(t)) out.eyebrow = true;
  const m = /bleeds?\s+(\d{2})\s*(?:to|-|–)\s*(\d{2})\s*%/i.exec(t) ?? /bleeds?\s+(\d{2})\s*%/i.exec(t);
  if (m) { const a = +m[1], b = m[2] ? +m[2] : a; const mid = Math.round(((a + b) / 2) / 5) * 5; if (mid >= 40 && mid <= 60) out.bleed = mid / 100; }
  const so = /sign-?off[^.]*?[“"]([^”"]{4,60})[”"]/i.exec(t) ?? /tag,?\s+[“"]?(from the world of [^”",.]{2,40})/i.exec(t);
  if (so) out.signoff = so[1].trim();
  return out;
}

/** The deck's colours and faces from what was found; what the document is silent on keeps the person's own setting. */
export function applyBrand(d: PitchDesign, b: BrandFound): PitchDesign {
  const c = b.colors;
  return {
    ...d,
    name: d.name || b.name,
    colors: { bg: c.bg ?? d.colors.bg, ink: c.ink ?? d.colors.ink, accent: c.accent ?? d.colors.accent, accent2: c.inkBright ?? c.accent2 ?? d.colors.accent2, muted: c.muted ?? d.colors.muted },
    fonts: { title: b.fonts.title ? `"${b.fonts.title}", var(--font-title)` : d.fonts.title, body: b.fonts.body ? `"${b.fonts.body}", var(--font-body)` : d.fonts.body },
    ...(c.line ? { line: c.line } : {}),
    ...(c.card ? { card: c.card } : {}),
    deck: { ...defaultDeckRules(), ...d.deck, ...b.rules },
  };
}
