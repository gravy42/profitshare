// @vitest-environment jsdom
// Movement: the vocabulary and its one door (`cleanMotion`), and what the runtime does with it. A deck's movement is
// words from short lists and a few clamped numbers; nothing in it is ever read as a style or as code.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../engine/pathMath';
import type { SlideMotion as EngineSlideMotion, DeckMotion as EngineDeckMotion } from '../engine/types';
import type { DeckData, DeckMotion, DeckSlide, SlideMotion } from './data';
import { money } from './format';
import {
  cleanDeckMotion,
  cleanMotion,
  ENTRANCES,
  MARKER_PATHS,
  MARKER_SIZE_MAX,
  MARKER_SIZE_MIN,
  markerPathOf,
  STAGGER_MAX,
} from './motion';
import { mountDeck, cleanMotion as fromRuntime, type DeckHandle } from './runtime';

// the engine keeps its own copy of the two shapes (its types file imports nothing): they must stay the same shape
const _a: EngineSlideMotion = {} as SlideMotion;
const _b: SlideMotion = {} as EngineSlideMotion;
const _c: EngineDeckMotion = {} as DeckMotion;
const _d: DeckMotion = {} as EngineDeckMotion;
void [_a, _b, _c, _d];

const PIC = 'data:image/png;base64,iVBORw0KGgo=';
const theme = {
  name: '',
  colors: {
    bg: '#101418',
    ink: '#f1ece0',
    accent: '#e0a84a',
    accent2: '#8fb0d8',
    muted: '#9a958a',
    card: '#f1e9d6',
    cardInk: '#1b1608',
    line: '#9a958a',
  },
  fonts: { title: '', body: '' },
  signoff: '',
};
function deck(slides: unknown[], over: Record<string, unknown> = {}): DeckData {
  return {
    version: 1,
    film: 'Salt Flat',
    coverLine: 'Investor deck.',
    theme,
    images: [{ id: 'pic', src: PIC, alt: 'An invented picture' }],
    slides: slides as DeckSlide[],
    recipients: [],
    paths: {
      cashBudget: 600_000,
      deferred: 0,
      sources: [{ key: 'grants', label: 'Grants', amount: 100_000, on: true }],
      waterfall: { model: 'off-the-gross', recoupPct: 120, poolPct: 50, grossSharePct: 40 },
      cases: [{ label: 'Mid', gross: 2_000_000 }],
      feePct: 20,
    },
    currency: 'USD',
    legal: 'Illustrative only.',
    ...over,
  } as DeckData;
}
const cards = (motion?: unknown) => ({
  id: 'gap',
  layout: 'cards',
  eyebrow: 'The gap',
  headline: 'Nobody is making this.',
  punch: 'So we are.',
  cards: [
    { id: 'a', title: 'One', body: 'First.' },
    { id: 'b', title: 'Two', body: 'Second.' },
    { id: 'c', title: 'Three', body: 'Third.' },
  ],
  motion,
});
const stats = (motion?: unknown) => ({
  id: 'aud',
  layout: 'stats',
  eyebrow: 'The audience',
  lead: { value: '7 in 10', text: 'invented buyers', source: 'Invented Survey, 2030' },
  stats: [
    { id: 's1', value: '41%', label: 'an invented share', source: 'Invented Survey, 2030' },
    { id: 's2', value: '$1,250', label: 'an invented spend', source: 'Invented Survey, 2030' },
  ],
  motion,
});
const numbers = (motion?: unknown) => ({
  id: 'num',
  layout: 'numbers',
  eyebrow: 'The numbers',
  body: '',
  caseNote: 'Fees come off the top.',
  motion,
});

// The clock a web page has: every timer a deck can set, and not Node's setImmediate, which no browser has and the
// deck never calls. jsdom (from version 26 on) uses setImmediate for its own housekeeping: one is queued for each
// <style> put in the page, to say the sheet has loaded. Faking it too would count jsdom's timers as the deck's.
const PAGE_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
const mounted: DeckHandle[] = [];
function mount(data: DeckData, opts: Parameters<typeof mountDeck>[2] = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const handle = mountDeck(host, data, opts);
  mounted.push(handle);
  const root = host.shadowRoot as unknown as ParentNode;
  return {
    host,
    handle,
    root,
    deck: root.querySelector<HTMLElement>('.psd')!,
    slide: (i = 0) => root.querySelectorAll<HTMLElement>('section')[i],
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const h of mounted.splice(0)) h.destroy();
  document.body.replaceChildren();
});

const HOSTILE: unknown[] = [
  null,
  undefined,
  7,
  'rise',
  [],
  [{ entrance: 'rise' }],
  () => 1,
  {
    entrance: 'rise; background:url(https://example.com/x)',
    order: '<script>alert(1)</script>',
    stagger: '120',
    headline: 'javascript:alert(1)',
    count: 'true',
    marker: 'pic',
  },
  {
    entrance: ['rise'],
    order: { toString: () => 'reverse' },
    stagger: NaN,
    headline: true,
    count: 1,
    marker: { imageId: 5, path: 'line', end: 'stop' },
  },
  { stagger: Infinity, marker: { imageId: '', path: 'line' } },
  { marker: { imageId: 'x'.repeat(500), path: 'line', end: 'stop' } },
  JSON.parse('{"__proto__":{"entrance":"drop"},"constructor":{"prototype":{"count":true}}}'),
  Object.create({ entrance: 'drop', count: true }),
];

describe('cleanMotion', () => {
  it('is the same function in the runtime and in the vocabulary file', () => {
    expect(fromRuntime).toBe(cleanMotion);
  });
  it('keeps every word on the lists and every number in range', () => {
    for (const entrance of ENTRANCES) expect(cleanMotion({ entrance })).toEqual({ entrance });
    expect(
      cleanMotion({
        entrance: 'drop',
        order: 'one-by-one',
        stagger: 120,
        headline: 'type',
        count: true,
        marker: { imageId: 'pic', path: 'timeline', end: 'settle', size: 1.5 },
      }),
    ).toEqual({
      entrance: 'drop',
      order: 'one-by-one',
      stagger: 120,
      headline: 'type',
      count: true,
      marker: { imageId: 'pic', path: 'timeline', end: 'settle', size: 1.5 },
    });
  });
  it('drops what means nothing: no movement at all is undefined, a headline that is not typed and a count that is off are left out', () => {
    expect(cleanMotion({})).toBeUndefined();
    expect(cleanMotion({ headline: 'none', count: false })).toBeUndefined();
    expect(cleanMotion({ marker: { imageId: 'pic', path: 'timeline', end: 'stop', size: 1 } })).toEqual({
      marker: { imageId: 'pic', path: 'timeline', end: 'stop' },
    });
  });
  it('clamps numbers: the gap to 0 to 400 ms, the picture to half to twice its size', () => {
    expect(cleanMotion({ stagger: 1e9 })!.stagger).toBe(STAGGER_MAX);
    expect(cleanMotion({ stagger: -50 })!.stagger).toBe(0);
    expect(cleanMotion({ stagger: 119.6 })!.stagger).toBe(120);
    expect(cleanMotion({ marker: { imageId: 'p', size: 1e6 } })!.marker!.size).toBe(MARKER_SIZE_MAX);
    expect(cleanMotion({ marker: { imageId: 'p', size: -3 } })!.marker!.size).toBe(MARKER_SIZE_MIN);
  });
  it('gives a travelling picture the timeline and an end when the file names neither, or names nonsense', () => {
    expect(cleanMotion({ marker: { imageId: 'p', path: 'spiral', end: 'explode' } })).toEqual({
      marker: { imageId: 'p', path: 'timeline', end: 'stop' },
    });
    expect(cleanMotion({ marker: { imageId: 'p' } })).toEqual({
      marker: { imageId: 'p', path: 'timeline', end: 'stop' },
    });
  });
  it('drops, without a word, a picture on the path cards used to have: nothing travels along cards any more', () => {
    expect(MARKER_PATHS).toEqual(['timeline']);
    expect(cleanMotion({ marker: { imageId: 'p', path: 'line', end: 'stop' } })).toBeUndefined();
    expect(
      cleanMotion({
        entrance: 'drop',
        order: 'one-by-one',
        marker: { imageId: 'p', path: 'line', end: 'settle', size: 2 },
      }),
    ).toEqual({ entrance: 'drop', order: 'one-by-one' });
    for (const layout of ['cards', 'ways'])
      for (const path of ['line', 'timeline', undefined]) {
        expect(
          cleanMotion({ marker: { imageId: 'p', path, end: 'stop' } }, layout),
          `${layout} ${path}`,
        ).toBeUndefined();
        expect(
          cleanMotion({ entrance: 'drop', order: 'one-by-one', stagger: 140, marker: { imageId: 'p', path } }, layout),
        ).toEqual({ entrance: 'drop', order: 'one-by-one', stagger: 140 }); // the cards still arrive one at a time
      }
  });
  it('drops everything that is not in the vocabulary: other keys, other words, the wrong kind of thing', () => {
    for (const raw of HOSTILE) expect(cleanMotion(raw), JSON.stringify(raw)).toBeUndefined();
    const out = cleanMotion({
      entrance: 'fade',
      style: 'color:red',
      onclick: 'alert(1)',
      css: '}',
      transform: 'rotate(9deg)',
      duration: 99999,
      marker: { imageId: 'p', src: 'https://example.com/a.png', style: 'x' },
    });
    expect(out).toEqual({ entrance: 'fade', marker: { imageId: 'p', path: 'timeline', end: 'stop' } });
    expect(JSON.stringify(out)).not.toMatch(/http|style|alert|rotate/);
  });
  it('with a layout, keeps a travelling picture only on the plan, along its timeline', () => {
    const marker = { imageId: 'p', path: 'timeline', end: 'stop' };
    expect(markerPathOf('cards')).toBeNull();
    expect(markerPathOf('ways')).toBeNull();
    expect(markerPathOf('timeline')).toBe('timeline');
    expect(markerPathOf('text')).toBeNull();
    expect(cleanMotion({ marker }, 'timeline')!.marker!.path).toBe('timeline');
    expect(cleanMotion({ marker: { ...marker, path: 'line' } }, 'timeline')!.marker!.path).toBe('timeline');
    expect(cleanMotion({ marker }, 'stats')).toBeUndefined();
    expect(cleanMotion({ marker, count: true }, 'stats')).toEqual({ count: true });
  });
  it('the deck: a pace and a way in, each from its list, with calm and rise for anything else', () => {
    expect(cleanDeckMotion({ pace: 'brisk', entrance: 'none' })).toEqual({ pace: 'brisk', entrance: 'none' });
    expect(cleanDeckMotion({ pace: 'frantic', entrance: 'drop', extra: 1 })).toEqual({
      pace: 'calm',
      entrance: 'rise',
    });
    for (const raw of [null, undefined, 3, 'brisk', []]) expect(cleanDeckMotion(raw)).toBeUndefined();
  });
});

describe('movement in the deck', () => {
  it('a deck with no movement in its data is drawn as before: no attribute, no property, no wrapper', () => {
    const { deck: d, slide, root } = mount(deck([cards(), stats()]));
    expect(d.dataset.enter).toBeUndefined();
    expect(d.classList.contains('psd-brisk')).toBe(false);
    expect(slide(0).dataset.enter).toBeUndefined();
    expect(slide(0).style.getPropertyValue('--psd-gap')).toBe('');
    expect(root.querySelectorAll('.psd-num, .psd-ch, .psd-mark, .psd-typed')).toHaveLength(0);
  });
  it('writes a way in as an attribute, the gap as a property in milliseconds, and the pace as a class', () => {
    const { deck: d, slide } = mount(
      deck(
        [
          cards({ entrance: 'drop', order: 'one-by-one', stagger: 120 }),
          cards({ order: 'together' }),
          cards({ order: 'one-by-one' }),
          cards({ stagger: 5000 }),
        ],
        { motion: { pace: 'brisk', entrance: 'fade' } },
      ),
    );
    expect(d.classList.contains('psd-brisk')).toBe(true);
    expect(d.dataset.enter).toBe('fade');
    expect(slide(0).dataset.enter).toBe('drop');
    expect(slide(0).style.getPropertyValue('--psd-gap')).toBe('120ms');
    expect(slide(1).style.getPropertyValue('--psd-gap')).toBe('0ms');
    expect(slide(2).style.getPropertyValue('--psd-gap')).toBe('140ms');
    expect(slide(3).style.getPropertyValue('--psd-gap')).toBe('400ms');
  });
  it('in reverse, the last part is the first to arrive', () => {
    const { slide } = mount(deck([cards({ order: 'reverse' })]));
    const order = [...slide(0).querySelectorAll<HTMLElement>('.psd-rise, .psd-drop')].map(
      e => +e.style.getPropertyValue('--i'),
    );
    expect(order).toEqual([4, 3, 2, 1, 0]);
  });
  it('hostile movement leaves nothing behind: no attribute, no inline style from it, no element', () => {
    for (const raw of HOSTILE) {
      const { slide, deck: d, host } = mount(deck([cards(raw)], { motion: raw }));
      expect(slide(0).dataset.enter).toBeUndefined();
      expect(slide(0).getAttribute('style') ?? '').not.toMatch(/psd-gap|url|script|expression/i);
      expect(d.dataset.enter).toBeUndefined();
      expect(host.shadowRoot!.innerHTML).not.toMatch(/example\.com|alert\(|javascript:/);
    }
    const plan = {
      id: 'plan',
      layout: 'timeline',
      facts: [{ value: '12', label: 'shoot days' }],
      milestones: [{ id: 'm1', when: 'Spring 2031', what: 'Shoot' }],
      motion: {
        entrance: '"><img src=x onerror=alert(1)>',
        stagger: 120,
        marker: { imageId: 'pic', end: 'settle"; background:url(https://example.com)', size: '2;position:fixed' },
      },
    };
    const { host, slide } = mount(deck([plan]));
    expect(host.shadowRoot!.querySelectorAll('img[onerror]')).toHaveLength(0);
    expect(slide(0).dataset.enter).toBeUndefined();
    const mark = slide(0).querySelector<HTMLElement>('.psd-mark')!;
    expect(mark.className).toBe('psd-mark');
    expect(mark.getAttribute('style')).toBeNull();
  });

  describe('a headline typed out', () => {
    it('keeps the whole headline for a screen reader, hides the copy that is typed, and gives every letter its place', () => {
      const { slide } = mount(deck([cards({ headline: 'type' })]));
      const h2 = slide(0).querySelector('h2')!;
      expect(h2.querySelector('.psd-vh')!.textContent).toBe('Nobody is making this. So we are.');
      const seen = h2.querySelector('.psd-typed')!;
      expect(seen.getAttribute('aria-hidden')).toBe('true');
      expect(seen.querySelector('.psd-h1')!.textContent).toBe('Nobody is making this.');
      expect(seen.querySelector('.psd-punch')!.textContent).toBe('So we are.');
      const letters = [...seen.querySelectorAll<HTMLElement>('.psd-ch')];
      expect(letters).toHaveLength('NobodyismakingthisSoweare'.length + 2);
      expect(letters.map(l => +l.style.getPropertyValue('--c'))).toEqual(letters.map((_, i) => i));
      expect(h2.style.getPropertyValue('--psd-type')).toMatch(/^\d+ms$/);
      expect(slide(0).querySelectorAll('h2')).toHaveLength(1);
    });
    it('markup in a typed headline is still only text', () => {
      const s = { ...cards({ headline: 'type' }), headline: '<img src=x onerror=alert(1)>', punch: '' };
      const { slide } = mount(deck([s]));
      expect(slide(0).querySelectorAll('img')).toHaveLength(0);
      expect(slide(0).querySelector('.psd-vh')!.textContent).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('a travelling picture', () => {
    it("is drawn from the deck's own pictures, for the eye only, on the timeline, and never on a slide of cards", () => {
      const tl = {
        id: 'plan',
        layout: 'timeline',
        eyebrow: 'The plan',
        facts: [{ value: '12', label: 'shoot days' }],
        milestones: [
          { id: 'm1', when: 'Spring 2031', what: 'Shoot' },
          { id: 'm2', when: 'Autumn 2031', what: 'Premiere' },
        ],
        motion: { marker: { imageId: 'pic', path: 'timeline', end: 'settle', size: 1.5 } },
      };
      const { slide } = mount(
        deck([
          cards({ order: 'one-by-one', marker: { imageId: 'pic', path: 'line', end: 'stop' } }),
          cards({ marker: { imageId: 'pic', path: 'timeline', end: 'stop' } }),
          tl,
        ]),
      );
      for (const i of [0, 1]) {
        expect(slide(i).querySelectorAll('img')).toHaveLength(0);
        expect(slide(i).querySelectorAll('.psd-card')).toHaveLength(3);
      }
      expect(slide(0).style.getPropertyValue('--psd-gap')).toBe('140ms'); // the cards still arrive one at a time
      const b = slide(2).querySelector<HTMLImageElement>('.psd-track > img.psd-mark')!;
      expect(b.getAttribute('src')).toBe(PIC);
      expect(b.alt).toBe('');
      expect(b.getAttribute('aria-hidden')).toBe('true');
      expect(b.classList.contains('psd-mark-settle')).toBe(true);
      expect(b.style.getPropertyValue('--psd-mark')).toBe('1.5');
    });
    it("comes to rest inside the slide: never left of the timeline's start, whatever the count of milestones, and its width is known from its height", () => {
      const css = readFileSync(resolve(process.cwd(), 'src/deck-runtime/deck.css'), 'utf8');
      // right edge at the tick, but never less than its own (capped) width from the start of the timeline
      expect(css).toMatch(
        /\.psd-mark \{[^}]*--psd-mark-h: calc\(var\(--psd-mark, 1\) \* 2\.6em\); left: max\(var\(--psd-end, 100%\), var\(--psd-mark-h\) \* 2\);[^}]*max-width: calc\(var\(--psd-mark-h\) \* 2\);/,
      );
      expect(css).not.toMatch(/psd-hang|psd-rope|psd-pinned|psd-rail/);
      // the arithmetic of that rule, for every count and size: where the picture's box lies along a timeline 60em long
      const endOf = (n: number, w = 60) => w - (w - (n - 1) * 2) / n;
      for (const n of [1, 2, 3, 4, 5, 6])
        for (const size of [0.5, 1, 2]) {
          const width = size * 2.6 * 2,
            right = Math.max(endOf(n), width),
            left = right - width;
          expect(left, `${n} at ${size}`).toBeGreaterThanOrEqual(0);
          expect(right, `${n} at ${size}`).toBeLessThanOrEqual(60);
        }
      expect(endOf(1)).toBe(0); // the case that put it off the slide before
    });
    it('the timeline makes room for it, by its size, so it never covers the facts above', () => {
      const tl = (motion: unknown) => ({
        id: 'plan',
        layout: 'timeline',
        facts: [{ value: '12', label: 'shoot days' }],
        milestones: [{ id: 'm1', when: 'Spring 2031', what: 'Shoot' }],
        motion,
      });
      const { slide } = mount(
        deck([
          tl({ marker: { imageId: 'pic', path: 'timeline', end: 'stop', size: 2 } }),
          tl({ marker: { imageId: 'pic', path: 'timeline', end: 'stop' } }),
          tl(undefined),
          tl({ marker: { imageId: 'gone', path: 'timeline', end: 'stop' } }),
        ]),
      );
      const track = (i: number) => slide(i).querySelector<HTMLElement>('.psd-track')!;
      expect(track(0).classList.contains('psd-track-mark')).toBe(true);
      expect(track(0).style.getPropertyValue('--psd-mark')).toBe('2');
      expect(track(1).classList.contains('psd-track-mark')).toBe(true);
      expect(track(1).style.getPropertyValue('--psd-mark')).toBe('');
      expect(track(2).classList.contains('psd-track-mark')).toBe(false);
      expect(track(3).classList.contains('psd-track-mark')).toBe(false); // no picture, no room kept for one
      const css = readFileSync(resolve(process.cwd(), 'src/deck-runtime/deck.css'), 'utf8');
      expect(css).toMatch(/\.psd-track-mark \{ margin-top: calc\(var\(--psd-mark, 1\) \* 2\.6em \+ 1\.1em\); \}/);
    });
    it('is left off when its picture is not in the deck, when the picture could reach the network, and on a slide with no timeline', () => {
      const plan = (imageId: string) => ({
        id: 'plan',
        layout: 'timeline',
        facts: [],
        milestones: [{ id: 'm1', when: 'Spring 2031', what: 'Shoot' }],
        motion: { marker: { imageId, path: 'timeline', end: 'stop' } },
      });
      const { root } = mount(
        deck([
          plan('gone'),
          stats({ marker: { imageId: 'pic', path: 'timeline', end: 'stop' } }),
          cards({ marker: { imageId: 'pic', path: 'timeline', end: 'stop' } }),
        ]),
      );
      expect(root.querySelectorAll('.psd-mark')).toHaveLength(0);
      const remote = deck([plan('pic')], { images: [{ id: 'pic', src: 'https://example.com/a.png', alt: '' }] });
      expect(mount(remote).root.querySelectorAll('.psd-mark')).toHaveLength(0);
    });
  });

  describe('numbers that count up', () => {
    /** A window whose frames run when the test says so. */
    function frames() {
      let next = 1;
      const waiting = new Map<number, FrameRequestCallback>();
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
        waiting.set(next, cb);
        return next++;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
        waiting.delete(id);
      });
      return {
        run(now: number) {
          const fns = [...waiting.values()];
          waiting.clear();
          for (const f of fns) f(now);
        },
        get waiting() {
          return waiting.size;
        },
      };
    }
    it('wraps each number, and the wrapped text is exactly what the deck showed without movement', () => {
      const plain = mount(deck([stats(), numbers()])),
        moving = mount(deck([stats({ count: true }), numbers({ count: true })]));
      for (const sel of ['.psd-big', '.psd-stat-val', '[data-part="budget"]', '[data-part="investors"]']) {
        const a = [...plain.root.querySelectorAll(sel)].map(e => e.textContent),
          b = [...moving.root.querySelectorAll(sel)].map(e => e.textContent);
        expect(b, sel).toEqual(a);
      }
      expect(moving.slide(0).querySelectorAll('.psd-num')).toHaveLength(3);
      expect(moving.root.querySelector('[data-part="legal"] .psd-num')).toBeNull();
      expect(moving.root.querySelector('[data-part="legal"]')!.textContent).toBe('Illustrative only.');
      expect(moving.root.querySelectorAll('.psd-counting, .psd-count-live')).toHaveLength(0); // no observer here: every slide is in its final state
    });
    it('counts over the figure, for the eye only, and ends on exactly the figure', () => {
      const f = frames();
      const { handle, slide } = mount(deck([stats({ count: true })]), { motion: false });
      expect(handle.play(0)).toBe('played');
      const big = slide(0).querySelector('.psd-big')!,
        pct = slide(0).querySelectorAll('.psd-stat-val')[0],
        spend = slide(0).querySelectorAll('.psd-stat-val')[1];
      const live = (e: Element) => e.querySelector('.psd-count-live')!;
      for (const e of [big, pct, spend]) {
        expect(e.classList.contains('psd-counting')).toBe(true);
        expect(live(e).getAttribute('aria-hidden')).toBe('true');
      }
      expect([live(big).textContent, live(pct).textContent, live(spend).textContent]).toEqual(['0 in 10', '0%', '$0']);
      expect(big.querySelector('.psd-num')!.textContent).toBe('7 in 10'); // the figure itself never changes
      f.run(1000);
      f.run(1550); // half way
      expect(live(pct).textContent).toMatch(/^\d+%$/);
      expect(+live(pct).textContent!.slice(0, -1)).toBeGreaterThan(20);
      expect(live(spend).textContent).toMatch(/^\$1,\d{3}$/);
      f.run(1000 + 5000);
      expect(slide(0).querySelectorAll('.psd-counting, .psd-count-live')).toHaveLength(0);
      expect([big.textContent, pct.textContent, spend.textContent]).toEqual(['7 in 10', '41%', '$1,250']);
      expect(f.waiting).toBe(0);
    });
    it("on the numbers slide the figures are still pathFor's, before, during and after a count, and a switch ends the count", () => {
      const f = frames();
      const data = deck([numbers({ count: true })]);
      const { handle, root } = mount(data, { motion: false });
      const inv = () => root.querySelector('[data-part="investors"] .psd-num')!.textContent;
      expect(inv()).toBe(money(pathFor(data.paths).investors, 'USD'));
      handle.play(0);
      f.run(0);
      f.run(300);
      expect(root.querySelector('[data-part="investors"] .psd-count-live')).not.toBeNull();
      expect(inv()).toBe(money(pathFor(data.paths).investors, 'USD'));
      handle.setSwitch('grants', false);
      expect(root.querySelectorAll('.psd-count-live, .psd-counting')).toHaveLength(0);
      expect(root.querySelector('[data-part="investors"]')!.textContent).toBe(
        money(pathFor(data.paths, { grants: false }).investors, 'USD'),
      );
      expect(root.querySelector('[data-part="legal"]')!.textContent).toBe('Illustrative only.');
    });
    it('a deck that is destroyed mid-count leaves no frame waiting and no timer', () => {
      vi.useFakeTimers({ toFake: [...PAGE_TIMERS] });
      const f = frames();
      const { handle } = mount(deck([stats({ count: true })]), { motion: false });
      handle.play(0);
      f.run(0);
      expect(f.waiting).toBe(1);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      handle.destroy();
      expect(f.waiting).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('play', () => {
    it('plays one slide of a still deck, and the deck is still again afterwards', () => {
      vi.useFakeTimers();
      const { handle, deck: d, slide } = mount(deck([cards({ entrance: 'drop' }), cards()]), { motion: false });
      expect(d.classList.contains('psd-still')).toBe(true);
      expect(handle.play(0)).toBe('played');
      expect(d.classList.contains('psd-still')).toBe(false);
      expect(slide(0).classList.contains('psd-seen')).toBe(true);
      expect(slide(0).classList.contains('psd-reset')).toBe(false);
      expect(slide(1).classList.contains('psd-seen')).toBe(true); // the others stay where they landed
      vi.advanceTimersByTime(7000);
      expect(d.classList.contains('psd-still')).toBe(true);
    });
    it('does nothing in a static deck, a stacked one, or for a reader who asked for less motion, and says which', () => {
      expect(mount(deck([cards()]), { static: true }).handle.play(0)).toBe('still');
      expect(mount(deck([cards()]), { stacked: true }).handle.play(0)).toBe('still');
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: /reduce/.test(q),
        addEventListener() {},
        removeEventListener() {},
      }));
      (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: /reduce/.test(q) });
      const { handle, slide } = mount(deck([stats({ count: true })]), { motion: false });
      expect(handle.play(0)).toBe('reduced');
      expect(slide(0).querySelectorAll('.psd-counting')).toHaveLength(0);
      delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    });
    it('a handle that has gone, or a slide that is not there, plays nothing', () => {
      const { handle } = mount(deck([cards()]));
      expect(handle.play(9)).toBe('still');
      handle.destroy();
      expect(handle.play(0)).toBe('still');
    });
  });

  describe('one heading a slide', () => {
    it('a slide with only its small label has that label as its heading; with a headline, the headline', () => {
      const only = { id: 't', layout: 'text', eyebrow: 'Why this film', body: 'An invented paragraph.' };
      const both = {
        id: 'u',
        layout: 'text',
        eyebrow: 'Why this film',
        headline: 'I know this place.',
        body: 'An invented paragraph.',
      };
      const { slide } = mount(
        deck([
          only,
          both,
          {
            id: 'ask',
            layout: 'ask',
            eyebrow: 'The ask',
            headline: 'The ask',
            withGrants: 'We are raising {investors}.',
            withoutGrants: 'We are raising {investors}.',
            nextStep: '',
            contact: '',
          },
        ]),
      );
      expect(slide(0).querySelector('h2.psd-eyebrow')!.textContent).toBe('Why this film');
      expect(slide(1).querySelector('p.psd-eyebrow')).not.toBeNull();
      expect(slide(1).querySelectorAll('h1, h2')).toHaveLength(1);
      expect(slide(2).querySelector('h2.psd-eyebrow')!.textContent).toBe('The ask');
      for (const i of [0, 1, 2]) expect(slide(i).querySelectorAll('h1, h2').length).toBe(1);
    });
    it('the closing slide: the title is the heading, unless the slide has a headline above it', () => {
      const { slide } = mount(
        deck([
          { id: 'c', layout: 'closing', title: 'Salt Flat', eyebrow: 'Thank you' },
          { id: 'd', layout: 'closing', title: 'Salt Flat', headline: 'See you in the desert.' },
        ]),
      );
      expect(slide(0).querySelector('h2')!.className).toContain('psd-title-end');
      expect(slide(0).querySelectorAll('h2')).toHaveLength(1);
      expect(slide(1).querySelectorAll('h2')).toHaveLength(1);
      expect(slide(1).querySelector('p.psd-title-end')!.textContent).toBe('Salt Flat');
    });
  });
});

describe('the stylesheet: less motion, a still deck, a PDF, a stacked deck and print always win', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/deck-runtime/deck.css'), 'utf8');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'), css.indexOf('/* static: for PDF'));
  const print = css.slice(css.indexOf('@media print'));
  it('for a reader who asked for less motion', () => {
    expect(reduced).toMatch(/\.psd-ch \{ opacity: 1 !important; transition: none !important; \}/);
    expect(reduced).toMatch(
      /\.psd-mark \{ transform: translate\(-100%, -100%\) !important; transition: none !important; animation: none !important; \}/,
    );
    expect(reduced).toMatch(/\.psd-count-live \{ display: none !important; \}/);
    expect(reduced).toMatch(/\.psd-counting > \.psd-num \{ opacity: 1 !important; \}/);
  });
  it('for a static (PDF), a still and a stacked deck', () => {
    expect(css).toMatch(
      /:is\(\.psd-static, \.psd-still, \.psd-stacked\) \.psd-ch \{ opacity: 1 !important; transition: none !important; \}/,
    );
    expect(css).toMatch(
      /:is\(\.psd-static, \.psd-still\) \.psd-mark \{ transform: translate\(-100%, -100%\) !important;/,
    );
    expect(css).toMatch(/\.psd-stacked \.psd-mark \{[^}]*transition: none !important; animation: none !important; \}/);
    expect(css).toMatch(
      /:is\(\.psd-static, \.psd-still, \.psd-stacked\) \.psd-count-live \{ display: none !important; \}/,
    );
  });
  it('for print', () => {
    expect(print).toMatch(/\.psd-ch \{ opacity: 1 !important; \}/);
    expect(print).toMatch(
      /\.psd-mark \{ transform: translate\(-100%, -100%\) !important; animation: none !important; \}/,
    );
    expect(print).toMatch(/\.psd-count-live \{ display: none !important; \}/);
  });
  it('names every way in the vocabulary has, and reads nothing else from the deck', () => {
    for (const e of ENTRANCES) if (e !== 'rise' || true) expect(css, e).toContain(`[data-enter="${e}"]`);
    expect(css).not.toMatch(/attr\(|url\(/);
  });
});
