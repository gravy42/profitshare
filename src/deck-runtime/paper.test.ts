// @vitest-environment jsdom
// Papers: the word a deck says a card is drawn with, how a mixed slide deals them, the edges worked out for a torn
// or hand-cut sheet, the colours a paper is drawn in (and that its words can be read on every one of them), and
// what the runtime builds for each. Nothing here is a picture: a paper is empty elements the stylesheet shapes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeckData, PaperStyle } from './data';
import { cleanPaper, cleanSlidePaper, dealPapers, MIX_ORDER, PAPER_LAYOUTS, PAPER_STYLES, SLIDE_PAPERS, tornEdge, unevenEdge } from './paper';
import { cleanPaper as fromRuntime, contrastRatio, HAND_FAMILY, mountDeck, PAPER_INK_MIN, PAPER_SMALL_MIN, paperColors } from './runtime';
import type { DeckHandle } from './runtime';

const css = readFileSync(resolve(process.cwd(), 'src/deck-runtime/deck.css'), 'utf8');
const runtimeSrc = readFileSync(resolve(process.cwd(), 'src/deck-runtime/runtime.ts'), 'utf8');
const GONE = ['psd-hang', 'psd-rope', 'psd-pinned', 'psd-rail', 'psd-hang-mark', 'psd-peg', 'psd-clip'];   // the classes of the look that was taken out
const HOSTILE: unknown[] = [null, undefined, 7, true, '', 'Torn', 'torn ', 'mixed', 'url(x)', '"><img src=x onerror=alert(1)>', ['torn'], { toString: () => 'torn' }, () => 'torn', '__proto__', 'constructor'];

// the four themes the runtime's own tests use to try its colours, the sample's, and cards no ink reads well on
const STRESS_THEMES = [
  { bg: '#f7f3ea', ink: '#1c1a17', accent: '#c2410c', accent2: '#1d4ed8', muted: '#6b665e', card: '#ffffff', cardInk: '#1c1a17', line: '#8a8378' },
  { bg: '#ffffff', ink: '#111111', accent: '#f5b700', accent2: '#00b4d8', muted: '#8a8a8a', card: '#fff8dc', cardInk: '#222222', line: '#bbbbbb' },
  { bg: '#1b1d24', ink: '#e6e6e6', accent: '#3a3f52', accent2: '#2a2e3d', muted: '#5a5f70', card: '#22252e', cardInk: '#d8d8d8', line: '#343846' },
  { bg: '#f4f1ec', ink: '#3b3a38', accent: '#d9c9a8', accent2: '#c8d3e0', muted: '#b9b4ab', card: '#f0ece4', cardInk: '#4a4844', line: '#ddd8cf' },
];
const HARD_THEMES = [
  { bg: '#10101f', ink: '#ecefed', accent: '#c67467', accent2: '#6d88cd', muted: '#909196', card: '#dbe1dd', cardInk: '#1b1608', line: '#909196' },
  { bg: '#000000', ink: '#ffffff', accent: '#ff0000', accent2: '#00ff00', muted: '#888888', card: '#777777', cardInk: '#777777', line: '#888888' },   // a mid grey nothing reads on at 7:1
  { bg: '#ffffff', ink: '#000000', accent: '#0000ff', accent2: '#ff00ff', muted: '#888888', card: '#8a5a2b', cardInk: '#8a5a2b', line: '#888888' },
  { bg: '#222222', ink: '#eeeeee', accent: '#ffcc00', accent2: '#00ccff', muted: '#888888', card: '#000000', cardInk: '#000000', line: '#888888' },   // ink the colour of its card
  { bg: '#222222', ink: '#eeeeee', accent: 'nonsense', accent2: 7, muted: null, card: 'url(x)', cardInk: {}, line: [] },
];

const mounted: DeckHandle[] = [];
afterEach(() => { for (const h of mounted.splice(0)) h.destroy(); document.body.replaceChildren(); });
function deck(slides: unknown[], theme: Record<string, unknown> = {}): DeckData {
  return {
    version: 1, film: 'Salt Flat', coverLine: 'Investor deck.', images: [], recipients: [], currency: 'USD', legal: 'Invented.',
    theme: { name: '', colors: { ...STRESS_THEMES[0] }, fonts: { title: 'Georgia, serif', body: 'Arial, sans-serif' }, signoff: '', ...theme },
    slides, paths: { cashBudget: 100, deferred: 0, sources: [], waterfall: { model: 'off-the-gross', recoupPct: 120, poolPct: 50, grossSharePct: 40 }, cases: [], feePct: 0 },
  } as unknown as DeckData;
}
function mount(data: DeckData, opts = {}) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const handle = mountDeck(host, data, { css, ...opts }); mounted.push(handle);
  const root = host.shadowRoot!.querySelector<HTMLElement>('.psd')!;
  return { host, root, slide: (i: number) => root.querySelectorAll<HTMLElement>('.psd-slide')[i], papers: (i: number) => [...root.querySelectorAll<HTMLElement>('.psd-slide')[i].querySelectorAll<HTMLElement>('.psd-card')].map(c => c.dataset.paper) };
}
const cards = (n: number, extra: Record<string, unknown> = {}) => ({ id: `c${n}`, layout: 'cards', headline: 'An invented headline', cards: Array.from({ length: n }, (_, i) => ({ id: `k${i}`, kicker: 'Invented', title: `Card ${i + 1}`, body: 'A short invented line.', footnote: 'An invented source' })), ...extra });
const cover = (extra: Record<string, unknown> = {}) => ({ id: 'cover', layout: 'cover', title: 'Salt Flat', tagline: 'An invented line.', byline: 'By Ada Example', ...extra });
const stats = (extra: Record<string, unknown> = {}) => ({ id: 'stats', layout: 'stats', stats: [], quote: { text: 'An invented thing somebody said.', by: 'An invented respondent' }, ...extra });
const team = (extra: Record<string, unknown> = {}) => ({ id: 'team', layout: 'team', members: [{ name: 'Ada Example', role: 'Director', bio: 'Invented.' }], aside: { title: 'Also attached', lines: ['An invented casting office', 'An invented composer, on a package that is a longer line than a note'], footnote: 'Invented.' }, ...extra });

describe('the word for a paper', () => {
  it('is one of five, and anything else is the plain card', () => {
    expect([...PAPER_STYLES]).toEqual(['plain', 'postcard', 'letter', 'notebook', 'torn']);
    for (const p of PAPER_STYLES) expect(cleanPaper(p)).toBe(p);
    for (const raw of HOSTILE) expect(cleanPaper(raw), String(raw)).toBe('plain');
    expect(fromRuntime).toBe(cleanPaper);   // one door, in the runtime and in the vocabulary file
  });
  it('a slide can also say mixed; anything else means the deck\'s own', () => {
    expect([...SLIDE_PAPERS]).toEqual([...PAPER_STYLES, 'mixed']);
    for (const p of SLIDE_PAPERS) expect(cleanSlidePaper(p)).toBe(p);
    for (const raw of HOSTILE.filter(x => x !== 'mixed')) expect(cleanSlidePaper(raw), String(raw)).toBeUndefined();
    expect([...PAPER_LAYOUTS]).toEqual(['cover', 'cards', 'ways', 'stats', 'team']);
  });
});

describe('dealing papers across a slide\'s cards', () => {
  it('gives every card the slide\'s paper, or the deck\'s when the slide names none', () => {
    expect(dealPapers('letter', undefined, 3)).toEqual(['letter', 'letter', 'letter']);
    expect(dealPapers('letter', 'torn', 2)).toEqual(['torn', 'torn']);
    expect(dealPapers('letter', 'plain', 2)).toEqual(['plain', 'plain']);   // a slide can go back to plain in a deck of papers
    expect(dealPapers(undefined, undefined, 4)).toEqual(['plain', 'plain', 'plain', 'plain']);
    expect(dealPapers('nonsense', 'nonsense', 1)).toEqual(['plain']);
    expect(dealPapers('mixed', undefined, 2)).toEqual(['plain', 'plain']);   // mixed is a slide's word, never the deck's
  });
  it('mixed deals a fixed order from the first card, the same every time', () => {
    expect([...MIX_ORDER]).toEqual(['notebook', 'torn', 'letter', 'postcard']);
    expect(dealPapers('plain', 'mixed', 3)).toEqual(['notebook', 'torn', 'letter']);
    expect(dealPapers('postcard', 'mixed', 4)).toEqual(['notebook', 'torn', 'letter', 'postcard']);
    expect(dealPapers('plain', 'mixed', 6)).toEqual(['notebook', 'torn', 'letter', 'postcard', 'notebook', 'torn']);
    expect(dealPapers('plain', 'mixed', 1)).toEqual(['notebook']);
    for (let i = 0; i < 5; i++) expect(dealPapers('plain', 'mixed', 4)).toEqual(dealPapers('letter', 'mixed', 4));
    expect(new Set(MIX_ORDER).size).toBe(4);
    expect(MIX_ORDER).not.toContain('plain');
  });
  it('never throws and never deals more than it is asked for', () => {
    for (const n of [0, -1, NaN, Infinity, 1.9, '3' as never, null as never]) expect(Array.isArray(dealPapers('torn', 'mixed', n))).toBe(true);
    expect(dealPapers('torn', 'mixed', 0)).toEqual([]);
    expect(dealPapers('torn', undefined, 1.9)).toEqual(['torn']);
    expect(dealPapers('torn', undefined, 1e9).length).toBeLessThanOrEqual(64);
  });
});

describe('edges worked out by arithmetic', () => {
  const points = (polygon: string) => /^polygon\((.*)\)$/.exec(polygon)![1].split(', ').map(p => p.split(' ').map(v => parseFloat(v)));
  it('a torn edge is a polygon in percentages only: nothing that could be a style of its own', () => {
    for (const seed of [0, 1, 2, 17, 255, 4096]) for (const edge of [tornEdge(seed), unevenEdge(seed)]) expect(edge).toMatch(/^polygon\((\d+(\.\d+)?% \d+(\.\d+)?%(, )?)+\)$/);
  });
  it('is the same for the same card every time, and different from card to card', () => {
    expect(tornEdge(5)).toBe(tornEdge(5));
    expect(unevenEdge(5)).toBe(unevenEdge(5));
    expect(new Set([0, 1, 2, 3, 8, 9, 10, 16].map(s => tornEdge(s))).size).toBe(8);
    expect(new Set([0, 1, 2, 3].map(s => unevenEdge(s))).size).toBe(4);
    expect(tornEdge(NaN)).toBe(tornEdge(0));
  });
  it('a tear stays at the top of the page: across its whole width, never deeper than it is told, the other three sides straight', () => {
    for (const seed of [0, 3, 11, 100]) {
      const pts = points(tornEdge(seed, 3.2)), top = pts.slice(0, -2);
      expect(top[0][0]).toBe(0); expect(top[top.length - 1][0]).toBe(100);
      for (let i = 1; i < top.length; i++) expect(top[i][0]).toBeGreaterThan(top[i - 1][0]);
      for (const [, y] of top) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(3.2); }
      expect(pts.slice(-2)).toEqual([[100, 100], [0, 100]]);
      expect(top.length).toBeGreaterThan(20);   // ragged, not a zigzag of three points
      expect(new Set(top.map(p => p[1])).size).toBeGreaterThan(8);
    }
  });
  it('a hand-cut sheet wanders by under one percent on every side, and its corners stay corners', () => {
    for (const seed of [0, 4, 9]) for (const [x, y] of points(unevenEdge(seed))) {
      expect(Math.min(x, 100 - x, y, 100 - y)).toBeLessThanOrEqual(0.56);   // every point is on the edge
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100);
    }
    expect(points(unevenEdge(1))[0]).toEqual([0, 0]);
  });
});

describe('the colours a paper is drawn in', () => {
  const under = (t: Record<string, string>) => [t['--psd-card'], t['--psd-pp-shade'], t['--psd-pp-rule']];
  for (const [name, themes] of [['the four stress themes', STRESS_THEMES], ['the sample and cards no ink reads on', HARD_THEMES]] as const) {
    it(`ink reads at 7:1 and small print at 4.5:1 on every tone under the words, for every paper: ${name}`, () => {
      for (const theme of themes) for (const style of PAPER_STYLES) {
        const t = paperColors(theme, style), at = `${style} on ${JSON.stringify(theme.card)}`;
        for (const surface of under(t)) {
          expect(contrastRatio(t['--psd-card-ink'], surface), `ink, ${at}, on ${surface}`).toBeGreaterThanOrEqual(PAPER_INK_MIN);
          expect(contrastRatio(t['--psd-card-muted'], surface), `small print, ${at}, on ${surface}`).toBeGreaterThanOrEqual(PAPER_SMALL_MIN);
          expect(contrastRatio(t['--psd-card-accent'], surface), `label, ${at}, on ${surface}`).toBeGreaterThanOrEqual(PAPER_SMALL_MIN);
        }
        for (const v of Object.values(t)) expect(v).toMatch(/^#[0-9a-f]{6}$/);   // colours and nothing else
      }
    });
  }
  it('the limits are the ones the deck promises', () => { expect(PAPER_INK_MIN).toBe(7); expect(PAPER_SMALL_MIN).toBe(4.5); });
  it('a ruled line is drawn only on the two ruled papers, can be told from the paper, and never costs the words their contrast', () => {
    for (const theme of STRESS_THEMES) {
      for (const style of ['notebook', 'torn'] as const) {
        const t = paperColors(theme, style);
        expect(t['--psd-pp-rule']).not.toBe(t['--psd-card']);
        expect(contrastRatio(t['--psd-pp-rule'], t['--psd-card'])).toBeGreaterThan(1.05);
        expect(contrastRatio(t['--psd-card-ink'], t['--psd-pp-rule'])).toBeGreaterThanOrEqual(7);
      }
      for (const style of ['plain', 'postcard', 'letter'] as const) expect(paperColors(theme, style)['--psd-pp-rule']).toBe(paperColors(theme, style)['--psd-pp-shade']);
    }
  });
  it('keeps the card colour the theme chose wherever an ink can be read on it, on light cards and dark', () => {
    for (const theme of STRESS_THEMES) for (const style of PAPER_STYLES) expect(paperColors(theme, style)['--psd-card']).toBe(theme.card);
    expect(paperColors(HARD_THEMES[1], 'plain')['--psd-card']).not.toBe('#777777');   // the mid grey moves until one can
  });
  it('is the same answer every time, and takes nonsense without throwing', () => {
    for (const style of PAPER_STYLES) expect(paperColors(STRESS_THEMES[2], style)).toEqual(paperColors(STRESS_THEMES[2], style));
    for (const raw of [null, undefined, 7, 'x', [], {}]) expect(() => paperColors(raw, 'torn')).not.toThrow();
  });
});

describe('what the runtime builds', () => {
  const layerOf = (card: Element) => card.querySelector(':scope > .psd-pp')!;
  const bits = (card: Element) => [...layerOf(card).querySelectorAll('i')].map(i => i.className).sort();
  it('a deck that names no paper draws plain cards: one flat sheet behind the words and nothing else', () => {
    const { slide, root } = mount(deck([cover(), cards(3), stats(), team()]));
    const all = [...root.querySelectorAll<HTMLElement>('.psd-card')];
    expect(all).toHaveLength(6);
    for (const card of all) {
      expect(card.dataset.paper).toBe('plain');
      expect(bits(card)).toEqual(['psd-pp-edge', 'psd-pp-sheet']);
      expect(card.style.getPropertyValue('--r')).toBe('');
      expect(layerOf(card).getAttribute('aria-hidden')).toBe('true');
      expect(card.firstElementChild).toBe(layerOf(card));
    }
    expect(root.classList.contains('psd-hand')).toBe(false);
    expect(slide(1).querySelectorAll('.psd-cards > .psd-card')).toHaveLength(3);
  });
  it('each paper is its own set of empty elements, and none of them holds a word or a picture', () => {
    const want: Record<PaperStyle, string[]> = {
      plain: ['psd-pp-edge', 'psd-pp-sheet'],
      postcard: ['psd-pp-address', 'psd-pp-divider', 'psd-pp-edge', 'psd-pp-postmark', 'psd-pp-sheet', 'psd-pp-stamp', 'psd-pp-stamp-art'],
      letter: ['psd-pp-edge', 'psd-pp-fold psd-pp-fold-a', 'psd-pp-fold psd-pp-fold-b', 'psd-pp-fold psd-pp-fold-v', 'psd-pp-sheet'],
      notebook: ['psd-pp-edge', 'psd-pp-margin', 'psd-pp-sheet'],
      torn: ['psd-pp-edge', 'psd-pp-rip', 'psd-pp-sheet'],
    };
    for (const style of PAPER_STYLES) {
      const { root } = mount(deck([cover(), cards(2), stats(), team()], { paper: style }));
      const all = [...root.querySelectorAll<HTMLElement>('.psd-card')];
      expect(all).toHaveLength(5);
      for (const card of all) {
        expect(card.dataset.paper, style).toBe(style);
        expect(bits(card), style).toEqual(want[style]);
        expect(layerOf(card).textContent).toBe('');
        expect(layerOf(card).querySelectorAll('img, svg, canvas, a, [style*="url"]')).toHaveLength(0);
        const cut = (layerOf(card) as HTMLElement).style.getPropertyValue('--psd-pp-cut');
        if (style === 'torn' || style === 'letter') expect(cut).toMatch(/^polygon\(/); else expect(cut).toBe('');
        // its colours are set on the card itself: the ones worked out for that paper
        const tone = paperColors(STRESS_THEMES[0], style);
        for (const k of Object.keys(tone)) expect(card.style.getPropertyValue(k), `${style} ${k}`).toBe(tone[k]);
      }
    }
  });
  it('nothing of the line, the clips or the cards on them is left: not an element, not a class, not a rule', () => {
    for (const paper of [...PAPER_STYLES, undefined]) for (const isStatic of [false, true]) {
      const { host, root } = mount(deck([cover(), cards(1), cards(2), cards(3, { paper: 'mixed' }), cards(4), { ...cards(3), id: 'w', layout: 'ways' }, stats(), team()], { paper, tilt: true, hand: true }), { static: isStatic });
      for (const cls of GONE) expect(root.querySelectorAll(`.${cls}`), cls).toHaveLength(0);
      expect(host.shadowRoot!.querySelectorAll('[class*="hang"], [class*="rope"], [class*="pinned"], [class*="peg"], [class*="clip"], [class*="rail"]')).toHaveLength(0);
      // a row of cards is the row itself, straight under the headline: nothing between it and the slide
      for (const row of root.querySelectorAll('.psd-cards')) { expect(row.parentElement!.classList.contains('psd-box')).toBe(true); expect([...row.children].every(c => c.classList.contains('psd-card'))).toBe(true); }
    }
    for (const cls of GONE) { expect(css, cls).not.toContain(cls); expect(runtimeSrc, cls).not.toContain(cls); }
    expect(css).not.toMatch(/\bclothes|\bpeg\b|\bpinned|\bhung\b|on a line|along the line|the cards' line/i);
    expect(runtimeSrc).not.toMatch(/\bclothes|\bpeg\b|\bpinned|\bhung\b|on a line|along the line|the cards' line/i);
  });
  it('a timeline keeps its own axis, under a name of its own', () => {
    const { slide } = mount(deck([{ id: 'plan', layout: 'timeline', facts: [], milestones: [{ id: 'm', when: 'Spring 2031', what: 'Shoot' }] }]));
    expect(slide(0).querySelectorAll('.psd-track > .psd-axis')).toHaveLength(1);
  });
  it('a slide\'s own paper wins over the deck\'s, and mixed deals them in order across its cards', () => {
    const { papers } = mount(deck([cards(3), cards(3, { paper: 'mixed' }), cards(4, { paper: 'mixed' }), cards(2, { paper: 'plain' }), cards(2, { paper: 'nonsense' }), cover({ paper: 'postcard' }), stats({ paper: 'mixed' }), team({ paper: 'torn' })], { paper: 'letter' }));
    expect(papers(0)).toEqual(['letter', 'letter', 'letter']);
    expect(papers(1)).toEqual(['notebook', 'torn', 'letter']);
    expect(papers(2)).toEqual(['notebook', 'torn', 'letter', 'postcard']);
    expect(papers(3)).toEqual(['plain', 'plain']);
    expect(papers(4)).toEqual(['letter', 'letter']);
    expect(papers(5)).toEqual(['postcard']);
    expect(papers(6)).toEqual(['notebook']);   // one card on a mixed slide: the first of the deal
    expect(papers(7)).toEqual(['torn']);
  });
  it('draws the same deck the same way twice, torn edges and all', () => {
    const d = () => deck([cover(), cards(4, { paper: 'mixed' }), cards(3, { paper: 'torn' })], { paper: 'letter', tilt: true });
    const a = mount(d()).root.innerHTML, b = mount(d()).root.innerHTML;
    expect(a).toBe(b);
    const { slide } = mount(d());
    const cuts = [...slide(2).querySelectorAll<HTMLElement>('.psd-pp')].map(l => l.style.getPropertyValue('--psd-pp-cut'));
    expect(new Set(cuts).size).toBe(3);   // three torn pages, three different tears
  });
  it('hostile words for a paper draw plain cards and leave nothing of themselves behind', () => {
    for (const raw of HOSTILE.filter(x => x !== 'mixed')) {
      const { host, papers } = mount(deck([cards(2, { paper: raw }), cover({ paper: raw })], { paper: raw, hand: raw === true ? 'true' : raw, tilt: raw === true ? 1 : raw }));
      expect(papers(0)).toEqual(['plain', 'plain']);
      expect(papers(1)).toEqual(['plain']);
      expect(host.shadowRoot!.querySelector('.psd')!.classList.contains('psd-hand')).toBe(false);
      expect(host.shadowRoot!.innerHTML).not.toMatch(/onerror|<img|url\(x\)/);
    }
  });
  it('cards are straight unless the theme asks for a tilt, and a tilt is a fraction of a degree', () => {
    const flat = mount(deck([cards(4), cover()], { paper: 'torn' }));
    for (const c of flat.root.querySelectorAll<HTMLElement>('.psd-card')) expect(c.style.getPropertyValue('--r')).toBe('');
    const tilted = mount(deck([cards(4), cover()], { paper: 'torn', tilt: true }));
    const angles = [...tilted.root.querySelectorAll<HTMLElement>('.psd-card')].map(c => parseFloat(c.style.getPropertyValue('--r')));
    expect(angles).toHaveLength(5);
    for (const a of angles) { expect(Math.abs(a)).toBeGreaterThan(0); expect(Math.abs(a)).toBeLessThanOrEqual(0.7); }
    expect(angles.some(a => a < 0) && angles.some(a => a > 0)).toBe(true);
    expect(css).not.toMatch(/--r: -?\d/);   // no card is turned by the stylesheet
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (/psd-(card|drop|quote|cover-card|team-aside)\b/.test(sel)) expect(body, sel).not.toMatch(/rotate\(-?\d/);   // a card turns by its own --r and by nothing else
  });
  it('handwriting is a class on the deck and one family in front of the title stack; short lines are marked, long ones are not', () => {
    const plain = mount(deck([cards(2)]));
    expect(plain.root.style.getPropertyValue('--psd-hand-font')).toBe('');
    const { root, slide } = mount(deck([cards(2), team()], { hand: true, paper: 'notebook' }));
    expect(HAND_FAMILY).toBe('Caveat');
    expect(root.classList.contains('psd-hand')).toBe(true);
    expect(root.style.getPropertyValue('--psd-hand-font')).toBe(`"Caveat", ${root.style.getPropertyValue('--psd-title-font')}`);
    expect([...slide(1).querySelectorAll('.psd-card-body')].map(b => b.classList.contains('psd-short'))).toEqual([true, false]);
    expect([...slide(1).querySelectorAll('.psd-card-body')].map(b => b.classList.contains('psd-card-fill'))).toEqual([false, true]);   // the last line runs to the foot of the card
    // only titles, their small labels, the quote and short notes are ever handwritten: never small print, numbers or sources
    const hand = [...css.matchAll(/([^{}]+)\{[^}]*var\(--psd-hand-font\)[^}]*\}/g)].map(m => m[1]).join(' ');
    expect(hand).not.toMatch(/psd-card-foot|psd-src|psd-legal|psd-quote-by|psd-stat|psd-big|psd-fig|psd-footnote|psd-lab\b/);
    expect(hand).toMatch(/psd-card-title/); expect(hand).toMatch(/psd-kicker/); expect(hand).toMatch(/psd-quote-text/);
    // nothing handwritten is set under 1.15em: 18px and more on a slide 1600 wide, even at the smallest type step (1.1cqw = 17.6px)
    const sizes = [...css.matchAll(/\.psd-hand [^{}]*\{[^}]*?font-size: ([\d.]+)em/g)].map(m => +m[1]);
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    for (const s of sizes) expect(s * 17.6).toBeGreaterThanOrEqual(18);
  });
  it('a ruled paper draws its rules behind the text only, one line of text to a rule', () => {
    const ruled = /:is\(\[data-paper="notebook"\], \[data-paper="torn"\]\) :is\(\.psd-card-body, \.psd-quote-text, \.psd-card-rules\) \{([^}]*)\}/.exec(css)![1];
    expect(ruled).toContain('line-height: var(--lh)');
    expect(ruled).toContain('--lh: calc(var(--psd-pitch) / var(--fz))');
    expect(ruled).toMatch(/\/ 100% calc\(var\(--lh\) \* 1em\) repeat-y/);   // a rule every line, exactly
    expect(ruled).toContain('var(--psd-pp-rule)');
    for (const sel of [...css.matchAll(/([^{}]+)\{[^}]*var\(--psd-pp-rule\)[^}]*\}/g)].map(m => m[1])) expect(sel).not.toMatch(/psd-card-foot|psd-card-title\b|psd-kicker|psd-quote-by/);
  });
  it('shadows are for the screen: a PDF and a printed page get a hairline round every paper and no blur', () => {
    const tail = css.slice(css.indexOf('/* static: for PDF'));
    expect(tail).toContain('.psd-static .psd-pp { filter: none; }');
    expect(tail).toContain('.psd-static .psd-pp-sheet { box-shadow: none; }');
    expect(tail).toMatch(/\.psd-static :is\(\[data-paper="plain"\], \[data-paper="postcard"\], \[data-paper="notebook"\]\) \.psd-pp-sheet \{ border: 1px solid var\(--psd-pp-edge\); \}/);
    expect(tail).toMatch(/\.psd-static :is\(\[data-paper="letter"\], \[data-paper="torn"\]\) \.psd-pp-edge \{ display: block; \}/);
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toContain('.psd-pp { filter: none; }');
    expect(print).toContain('.psd-pp-sheet { box-shadow: none; }');
    expect(css).not.toMatch(/\.psd-static[^{]*\{[^}]*(drop-shadow|blur)\(/);
  });
  it('the stylesheet draws every paper itself: no picture, no address, nothing loaded', () => {
    expect(css).not.toMatch(/url\(|@import|https?:|data:/i);
    for (const style of PAPER_STYLES.filter(s => s !== 'plain')) expect(css).toContain(`[data-paper="${style}"]`);
  });
  it('a sample for a chooser is the first slide\'s cards and nothing around them', () => {
    const { root } = mount(deck([cards(1, { paper: 'postcard' })]), { swatch: true, stacked: false, motion: false });
    expect(root.classList.contains('psd-swatch')).toBe(true);
    expect(root.querySelector('.psd-card')!.getAttribute('data-paper')).toBe('postcard');
    expect(css).toContain('.psd-swatch .psd-stage:not(:first-child), .psd-swatch .psd-foot, .psd-swatch .psd-head { display: none; }');
    expect(mount(deck([cards(1)])).root.classList.contains('psd-swatch')).toBe(false);
  });
});
