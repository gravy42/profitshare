// Papers, as a fixed vocabulary. A card is drawn flat or as one of four papers, and a deck says which with a word
// from the list below: never a style, never a picture. `cleanPaper()` is the one door the word comes through, and
// whatever is not on the list is the plain card. The torn and uneven edges are worked out here too, by arithmetic
// from the card's place on its slide, so the same deck always tears the same way. Shared by the runtime (which
// draws the papers) and the engine (which writes the word into the deck's data). Pure: no DOM, no imports but types.
import type { PaperShade, PaperStyle } from './data';

export const PAPER_STYLES = ['plain', 'postcard', 'letter', 'notebook', 'torn'] as const;
export const SLIDE_PAPERS = [...PAPER_STYLES, 'mixed'] as const;
/** The order a mixed slide deals its papers in: the first card a notebook page, the next a torn page, and round again. */
export const MIX_ORDER: readonly PaperStyle[] = ['notebook', 'torn', 'letter', 'postcard'];
/** The layouts that draw a card, so the ones a paper can be chosen for. */
export const PAPER_LAYOUTS: readonly string[] = ['cover', 'cards', 'ways', 'stats', 'team'];

const oneOf = <T extends string>(v: unknown, words: readonly T[]): T | undefined =>
  typeof v === 'string' && (words as readonly string[]).includes(v) ? (v as T) : undefined;

/** A paper style from anything: a word on the list as it is, everything else plain. */
export const cleanPaper = (v: unknown): PaperStyle => oneOf(v, PAPER_STYLES) ?? 'plain';
/** A slide's own choice: a word on the list or 'mixed'; undefined (the deck's default) for anything else. */
export const cleanSlidePaper = (v: unknown): PaperStyle | 'mixed' | undefined => oneOf(v, SLIDE_PAPERS);

/** The shades a paper comes in. `theme` is the design system's own card colour (what a deck that says nothing gets);
 *  the others are papers of a fixed tone, whatever the deck's colours are. */
export const PAPER_SHADES = ['theme', 'white', 'cream', 'aged', 'kraft', 'newsprint'] as const;
/** A shade from anything: a word on the list as it is, everything else the theme's own. */
export const cleanPaperShade = (v: unknown): PaperShade => oneOf(v, PAPER_SHADES) ?? 'theme';
/** A slide's own shade: a word on the list; undefined (the deck's) for anything else. */
export const cleanSlidePaperShade = (v: unknown): PaperShade | undefined => oneOf(v, PAPER_SHADES);
/** The shade a slide's cards are drawn in: the slide's own when it names one, else the deck's. */
export const dealShade = (deck: unknown, slide: unknown): PaperShade =>
  cleanSlidePaperShade(slide) ?? cleanPaperShade(deck);

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
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pt = (x: number, y: number) => `${Math.round(x * 100) / 100}% ${Math.round(y * 100) / 100}%`;

/** The outline of a page torn off along its top, as a CSS polygon: a ragged top edge that never comes lower than
 *  `depth` percent of the page's height, and three straight sides. */
export function tornEdge(seed: number, depth = 3.2): string {
  const rand = seeded(seed),
    top: string[] = [];
  let x = 0,
    y = depth * (0.3 + rand() * 0.5);
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
  const rand = seeded(seed + 7919),
    out: string[] = [];
  const side = (n: number, at: (t: number, d: number) => [number, number]) => {
    for (let i = 0; i < n; i++) {
      const [x, y] = at(i / n, i === 0 ? 0 : rand() * wobble);
      out.push(pt(x, y));
    }
  };
  side(7, (t, d) => [t * 100, d]);
  side(5, (t, d) => [100 - d * 0.6, t * 100]);
  side(7, (t, d) => [100 - t * 100, 100 - d]);
  side(5, (t, d) => [d * 0.6, 100 - t * 100]);
  return `polygon(${out.join(', ')})`;
}

/** How much age a shade shows: soft patches of uneven tone, tide marks of an old stain, foxing spots. */
const WEAR: Record<PaperShade, { patches: number; stains: number; spots: number; strength: number }> = {
  theme: { patches: 0, stains: 0, spots: 0, strength: 0 },
  white: { patches: 0, stains: 0, spots: 0, strength: 0 },
  cream: { patches: 2, stains: 0, spots: 0, strength: 0.5 },
  aged: { patches: 4, stains: 2, spots: 11, strength: 1 },
  kraft: { patches: 3, stains: 0, spots: 5, strength: 0.7 },
  newsprint: { patches: 3, stains: 1, spots: 4, strength: 0.6 },
};
/** The marks of age on one sheet, as a list of CSS gradients for its background: patches, stains and spots, each
 *  placed by arithmetic from the card's seed, so the same card always ages the same way. Every colour in it is one
 *  of the card's own properties (`--psd-pp-shade`, `--psd-pp-stain`, `--psd-pp-fox`: tones the words are proven to
 *  read on) at a strength between nothing and all of it. Numbers and those three names only; '' for a shade with
 *  no marks. */
export function paperMarks(seed: number, shade: PaperShade): string {
  const w = WEAR[cleanPaperShade(shade)];
  if (!w.patches && !w.stains && !w.spots) return '';
  const rand = seeded((Number.isFinite(seed) ? seed : 0) + 104729),
    n = (v: number) => Math.round(v * 10) / 10,
    n2 = (v: number) => Math.round(v * 100) / 100;
  const tint = (name: 'shade' | 'stain' | 'fox', pct: number) =>
    `color-mix(in srgb, var(--psd-pp-${name}) ${Math.max(1, Math.min(100, Math.round(pct * w.strength)))}%, transparent)`;
  const out: string[] = [];
  // foxing: small soft spots, more of them toward the edges of the sheet than in the middle of it
  for (let i = 0; i < w.spots; i++) {
    const edge = rand() < 0.6,
      a = rand(),
      b = rand();
    const near = (v: number) => (v < 0.5 ? v * 0.28 : 1 - (1 - v) * 0.28) * 100;
    const x = edge && i % 2 === 0 ? near(a) : 4 + a * 92,
      y = edge && i % 2 === 1 ? near(b) : 4 + b * 92;
    const r = 0.05 + rand() * 0.13,
      strong = 45 + rand() * 50;
    out.push(
      `radial-gradient(circle at ${n(x)}% ${n(y)}%, ${tint('fox', strong)} 0, ${tint('fox', strong * 0.6)} ${n2(r)}em, transparent ${n2(r * 2.4)}em)`,
    );
  }
  // an old stain: paler inside, a darker line where it dried; two pools run together, so its outline is not an oval
  for (let i = 0; i < w.stains; i++) {
    const x = rand() < 0.5 ? rand() * 30 : 70 + rand() * 30,
      y = rand() < 0.5 ? rand() * 35 : 65 + rand() * 35;
    const rx = 12 + rand() * 16,
      ry = 10 + rand() * 16,
      line = 24 + rand() * 22;
    for (const [dx, dy, k] of [
      [0, 0, 1],
      [
        rx * (0.5 + rand() * 0.4) * (rand() < 0.5 ? -1 : 1),
        ry * (0.3 + rand() * 0.5) * (rand() < 0.5 ? -1 : 1),
        0.55 + rand() * 0.3,
      ],
    ])
      out.push(
        `radial-gradient(ellipse ${n(rx * k)}% ${n(ry * k)}% at ${n(x + dx)}% ${n(y + dy)}%, ${tint('stain', line * 0.4)} 0, ${tint('stain', line * 0.5)} 74%, ${tint('stain', line)} 90%, transparent 100%)`,
      );
  }
  // uneven tone: wide soft patches
  for (let i = 0; i < w.patches; i++) {
    const x = rand() * 100,
      y = rand() * 100,
      rx = 26 + rand() * 34,
      ry = 22 + rand() * 30,
      strong = 28 + rand() * 34;
    out.push(
      `radial-gradient(ellipse ${n(rx)}% ${n(ry)}% at ${n(x)}% ${n(y)}%, ${tint('shade', strong)} 0, transparent 100%)`,
    );
  }
  return out.join(', ');
}
