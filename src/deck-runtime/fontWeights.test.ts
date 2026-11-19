// @vitest-environment jsdom
// A family's weights in a deck: each file carries its weight and style from the data to the browser's FontFace and to
// an @font-face rule, the files of one family share one name (so the browser can choose among them and bold is real),
// and a deck file made before any of this draws exactly as it did.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { deckData } from '../engine/deckData';
import { withPitch } from '../engine/pitch';
import type { DeckData } from './data';
import { fontFaceCss } from './exportHtml';
import { MAX_FONT_FACES, cleanStyle, cleanWeight, faceName, familyFaceName, weightText } from './fonts';
import { cleanFontFaces, mountDeck, namedFontFaces, type DeckHandle } from './runtime';

const A = 'data:font/woff2;base64,d09GMgABAAAAAA==',
  B = 'data:font/woff2;base64,d09GMgABAAAAAQ==',
  C = 'data:font/woff2;base64,d09GMgABAAAAAg=='; // invented bytes
const mounted: DeckHandle[] = [];
afterEach(() => {
  for (const h of mounted.splice(0)) h.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  delete (document as unknown as { fonts?: unknown }).fonts;
  delete (window as unknown as { FontFace?: unknown }).FontFace;
});
interface Made {
  family: string;
  src: string;
  args: number;
  descriptors?: { weight?: string; style?: string };
}
function stubFonts() {
  const made: Made[] = [];
  const set = new Set<unknown>();
  class Face {
    status = 'unloaded';
    constructor(...a: unknown[]) {
      made.push({
        family: a[0] as string,
        src: a[1] as string,
        args: a.length,
        descriptors: a[2] as Made['descriptors'],
      });
    }
    load() {
      this.status = 'loaded';
      return Promise.resolve(this);
    }
  }
  vi.stubGlobal('FontFace', Face);
  (window as unknown as { FontFace: unknown }).FontFace = Face;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: (f: unknown) => {
        set.add(f);
      },
      delete: (f: unknown) => set.delete(f),
      ready: Promise.resolve(),
    },
  });
  return { made, set };
}
function deck(faces: unknown): DeckData {
  const d = deckData(withPitch(applyDeal(sampleProject())));
  (d.theme as unknown as { fontFaces: unknown }).fontFaces = faces;
  return d;
}
function mount(data: DeckData) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const handle = mountDeck(host, data, { css: '.x{}' });
  mounted.push(handle);
  const root = (host.shadowRoot ?? host) as ParentNode;
  return {
    handle,
    stack: (which: 'title' | 'body') =>
      (root.querySelector('.psd') as HTMLElement).style.getPropertyValue(`--psd-${which}-font`),
  };
}

describe('a weight, as a deck may carry it', () => {
  it('is a whole number from 1 to 1000, or two of them, and anything else is none', () => {
    expect(cleanWeight(400)).toBe(400);
    expect(cleanWeight(399.6)).toBe(400);
    expect(cleanWeight(0)).toBe(1);
    expect(cleanWeight(-50)).toBe(1);
    expect(cleanWeight(5000)).toBe(1000);
    expect(cleanWeight([100, 900])).toEqual([100, 900]);
    expect(cleanWeight([900, 100])).toEqual([100, 900]);
    expect(cleanWeight([0, 99999])).toEqual([1, 1000]);
    expect(cleanWeight([400, 400])).toBe(400);
    for (const v of [
      undefined,
      null,
      '400',
      'bold',
      NaN,
      Infinity,
      {},
      [],
      [400],
      [1, 2, 3],
      ['100', '900'],
      [100, 'x'],
      '100 900; } x {',
    ])
      expect(cleanWeight(v)).toBeUndefined();
    expect(weightText(400)).toBe('400');
    expect(weightText([100, 900])).toBe('100 900');
    expect(cleanStyle('italic')).toBe('italic');
    expect(cleanStyle('normal')).toBe('normal');
    for (const v of [undefined, 'oblique', 'italic; x', 1, null]) expect(cleanStyle(v)).toBeUndefined();
    expect(MAX_FONT_FACES).toBe(8);
  });
  it('is read from a face with its style, and a face that names neither is left exactly as it was', () => {
    expect(
      cleanFontFaces([
        { family: 'Plain', src: A, role: 'title' },
        { family: 'Sized', src: A, role: 'body', weight: 400, style: 'normal' },
        { family: 'Sized', src: B, role: 'body', weight: [100, 900], style: 'italic' },
        { family: 'Odd', src: C, role: 'body', weight: 'bold', style: 'slanted"; }' },
        { family: 'Clamped', src: C, role: 'title', weight: 1e9 },
      ]),
    ).toEqual([
      { family: 'Plain', src: A, role: 'title' },
      { family: 'Sized', src: A, role: 'body', weight: 400, style: 'normal' },
      { family: 'Sized', src: B, role: 'body', weight: [100, 900], style: 'italic' },
      { family: 'Odd', src: C, role: 'body' },
      { family: 'Clamped', src: C, role: 'title', weight: 1000 },
    ]);
    expect(Object.keys(cleanFontFaces([{ family: 'Plain', src: A, role: 'title' }])[0])).toEqual([
      'family',
      'src',
      'role',
    ]);
  });
});

describe('the weights of one family in a deck', () => {
  const lato = [
    { family: 'Lato', src: A, role: 'title', weight: 400, style: 'normal' },
    { family: 'Lato', src: B, role: 'title', weight: 700, style: 'normal' },
  ];
  it('share one name for a role, and a face with no weight keeps a name of its own', () => {
    const named = namedFontFaces([
      ...lato,
      { family: 'Lato', src: C, role: 'body', weight: 400 },
      { family: 'Invented Slab', src: A, role: 'body' },
    ]);
    expect(named[0].name).toBe(familyFaceName('title', 'Lato', [A, B]));
    expect(named[1].name).toBe(named[0].name);
    expect(named[0].name).toMatch(/^psd-title Lato [a-z0-9]{1,7}$/);
    expect(named[2].name).toBe(familyFaceName('body', 'Lato', [C]));
    expect(named[2].name).not.toBe(named[0].name); // the same family for the other role is another name
    expect(named[3].name).toBe(faceName('body', 'Invented Slab', A)); // as it always was
    expect(familyFaceName('title', 'Lato', [A, B])).not.toBe(familyFaceName('title', 'Lato', [A, C])); // other files, another name
  });
  it('are registered with the browser as that weight and style, under the one name, once in the stack', () => {
    const { made, set } = stubFonts();
    const body = [
      { family: 'Work Sans', src: A, role: 'body', weight: [100, 900], style: 'normal' },
      { family: 'Work Sans', src: C, role: 'body', weight: [100, 900], style: 'italic' },
    ];
    const { handle, stack } = mount(deck([...lato, ...body]));
    const title = familyFaceName('title', 'Lato', [A, B]),
      text = familyFaceName('body', 'Work Sans', [A, C]);
    expect(made).toEqual([
      { family: title, src: `url("${A}")`, args: 3, descriptors: { weight: '400', style: 'normal' } },
      { family: title, src: `url("${B}")`, args: 3, descriptors: { weight: '700', style: 'normal' } },
      { family: text, src: `url("${A}")`, args: 3, descriptors: { weight: '100 900', style: 'normal' } },
      { family: text, src: `url("${C}")`, args: 3, descriptors: { weight: '100 900', style: 'italic' } },
    ]);
    expect(set.size).toBe(4);
    expect(stack('title').split(`"${title}"`).length - 1).toBe(1);
    expect(stack('title').startsWith(`"${title}", `)).toBe(true);
    expect(stack('title')).toContain('Special Elite'); // the app's own face is still behind it
    expect(stack('body').startsWith(`"${text}", `)).toBe(true);
    handle.destroy();
    expect(set.size).toBe(0);
  });
  it('a deck made before weights existed is registered as it always was: two arguments, a name a file', () => {
    const { made } = stubFonts();
    const { stack } = mount(
      deck([
        { family: 'Invented Slab', src: A, role: 'title' },
        { family: 'Invented Sans', src: B, role: 'body' },
      ]),
    );
    expect(made).toEqual([
      { family: faceName('title', 'Invented Slab', A), src: `url("${A}")`, args: 2, descriptors: undefined },
      { family: faceName('body', 'Invented Sans', B), src: `url("${B}")`, args: 2, descriptors: undefined },
    ]);
    expect(stack('title').startsWith(`"${faceName('title', 'Invented Slab', A)}", `)).toBe(true);
  });
  it('a hostile weight or style never reaches a descriptor', () => {
    const { made } = stubFonts();
    mount(
      deck([
        { family: 'Lato', src: A, role: 'title', weight: '400; } body { display: none', style: 'italic"); x' },
        { family: 'Lato', src: B, role: 'body', weight: [1, 'x'], style: 'normal' },
      ]),
    );
    expect(made[0]).toMatchObject({ args: 2 }); // neither was a weight or a style: a whole face
    expect(made[1].descriptors).toEqual({ style: 'normal' });
  });
});

describe('@font-face rules for a page', () => {
  it("writes a weight, or the two ends of a variable file's range", () => {
    expect(fontFaceCss([{ family: 'Lato', weight: 700, style: 'italic', src: A }])).toBe(
      `@font-face{font-family:"Lato";font-weight:700;font-style:italic;font-display:block;src:url(${A}) format("woff2")}`,
    );
    expect(fontFaceCss([{ family: 'Work Sans', weight: [100, 900], src: A }])).toBe(
      `@font-face{font-family:"Work Sans";font-weight:100 900;font-style:normal;font-display:block;src:url(${A}) format("woff2")}`,
    );
    expect(fontFaceCss([{ family: 'Work Sans', weight: [900, 100], src: A }])).toContain('font-weight:100 900;');
  });
  it('leaves out a face whose weight is not one', () => {
    for (const weight of [
      0,
      1001,
      NaN,
      [100],
      [0, 900],
      [100, 2000],
      [100, 'x'],
      'bold',
      '400; } x {',
      null,
    ] as unknown[])
      expect(fontFaceCss([{ family: 'Lato', weight: weight as number, src: A }])).toBe('');
  });
});
