// Papers, as a fixed vocabulary. A card is drawn flat or as one of four papers, and a deck says which with a word
// from the list below: never a style, never a picture. `cleanPaper()` is the one door the word comes through, and
// whatever is not on the list is the plain card. The torn and uneven edges are worked out here too, by arithmetic
// from the card's place on its slide, so the same deck always tears the same way. Shared by the runtime (which
// draws the papers) and the engine (which writes the word into the deck's data). Pure: no DOM, no imports but types.
import type { PaperStyle } from './data';

export const PAPER_STYLES = ['plain', 'postcard', 'letter', 'notebook', 'torn'] as const;
export const SLIDE_PAPERS = [...PAPER_STYLES, 'mixed'] as const;
/** The order a mixed slide deals its papers in: the first card a notebook page, the next a torn page, and round again. */
export const MIX_ORDER: readonly PaperStyle[] = ['notebook', 'torn', 'letter', 'postcard'];
/** The layouts that draw a card, so the ones a paper can be chosen for. */
export const PAPER_LAYOUTS: readonly string[] = ['cover', 'cards', 'ways', 'stats', 'team'];

const oneOf = <T extends string>(v: unknown, words: readonly T[]): T | undefined => (typeof v === 'string' && (words as readonly string[]).includes(v) ? (v as T) : undefined);

/** A paper style from anything: a word on the list as it is, everything else plain. */
export const cleanPaper = (v: unknown): PaperStyle => oneOf(v, PAPER_STYLES) ?? 'plain';
/** A slide's own choice: a word on the list or 'mixed'; undefined (the deck's default) for anything else. */
export const cleanSlidePaper = (v: unknown): PaperStyle | 'mixed' | undefined => oneOf(v, SLIDE_PAPERS);

/** The paper of each of `n` cards on a slide: the slide's own choice when it has one, else the deck's; 'mixed'
 *  deals `MIX_ORDER` from the first card on, the same way every time. */
export function dealPapers(deck: unknown, slide: unknown, n: number): PaperStyle[] {
  const choice = cleanSlidePaper(slide) ?? cleanPaper(deck);
  const count = Math.max(0, Math.min(64, Math.floor(typeof n === 'number' && Number.isFinite(n) ? n : 0)));
  return Array.from({ length: count }, (_, i) => (choice === 'mixed' ? MIX_ORDER[i % MIX_ORDER.length] : choice));
}

/** A small seeded generator (mulberry32): the same seed always gives the same numbers, each from 0 up to 1. */
function seeded(seed: number): () => number {
  let a = (Math.floor(Number.isFinite(seed) ? seed : 0) + 1) * 0x9e3779b1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pt = (x: number, y: number) => `${Math.round(x * 100) / 100}% ${Math.round(y * 100) / 100}%`;

/** The outline of a page torn off along its top, as a CSS polygon: a ragged top edge that never comes lower than
 *  `depth` percent of the page's height, and three straight sides. */
export function tornEdge(seed: number, depth = 3.2): string {
  const rand = seeded(seed), top: string[] = [];
  let x = 0, y = depth * (0.3 + rand() * 0.5);
  top.push(pt(0, y));
  while (x < 100) {
    x = Math.min(100, x + 1.4 + rand() * 3.4);
    // a tear wanders: mostly small steps, now and then a bigger bite
    y = Math.max(0, Math.min(depth, y + (rand() - 0.5) * depth * (rand() < 0.2 ? 1.5 : 0.7)));
    top.push(pt(x, y));
  }
  return `polygon(${[...top, pt(100, 100), pt(0, 100)].join(', ')})`;
}

/** The outline of a sheet cut by hand, as a CSS polygon: four sides that each wander by a fraction of a percent. */
export function unevenEdge(seed: number, wobble = 0.55): string {
  const rand = seeded(seed + 7919), out: string[] = [];
  const side = (n: number, at: (t: number, d: number) => [number, number]) => { for (let i = 0; i < n; i++) { const [x, y] = at(i / n, i === 0 ? 0 : rand() * wobble); out.push(pt(x, y)); } };
  side(7, (t, d) => [t * 100, d]);
  side(5, (t, d) => [100 - d * 0.6, t * 100]);
  side(7, (t, d) => [100 - t * 100, 100 - d]);
  side(5, (t, d) => [d * 0.6, 100 - t * 100]);
  return `polygon(${out.join(', ')})`;
}
