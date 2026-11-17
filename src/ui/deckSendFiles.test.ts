// @vitest-environment jsdom
// The browser side of making the files, with the canvas, the picture decoder and the network stubbed: every picture
// is drawn again (none passes through as stored), only font files cleared to travel go in, and a file or a PDF made
// for one person is made from data that holds that person alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { withPitch } from '../engine/pitch';
import type { Project } from '../engine/types';
import type { DeckData } from '../deck-runtime/data';

vi.mock('../deck-runtime/runtime', async original => { const m = await original<typeof import('../deck-runtime/runtime')>(); return { ...m, mountDeck: vi.fn(m.mountDeck) }; });
const captured: { fontCss?: string; meta?: { title: string; date: Date }; text?: string; slides?: number }[] = [];
vi.mock('./deckPdf', async original => {
  const m = await original<typeof import('./deckPdf')>();
  return { ...m, slidesToPdf: vi.fn(async (slides: HTMLElement[], o: { fontEmbedCSS?: string; meta?: { title: string; date: Date } }) => {
    captured.push({ fontCss: o.fontEmbedCSS, meta: o.meta, text: (slides[0]?.getRootNode() as ShadowRoot).textContent ?? '', slides: slides.length });
    return new Blob(['%PDF-stub'], { type: 'application/pdf' });
  }) };
});
import { mountDeck } from '../deck-runtime/runtime';
import { pdfDeck, prepare, redrawn, webDeck } from './deckSendFiles';

const b64 = (text: string) => Buffer.from(text, 'latin1').toString('base64');
// "pictures" as stored: their bytes carry a marker a camera might have written, which must never reach a file
const EXIF = 'Exif-GPS-MARKER-34.0522N-118.2437W';
const JPEG = `data:image/jpeg;base64,${b64(`\xff\xd8\xff\xe1${EXIF}small-jpeg`)}`;
const PNG = `data:image/png;base64,${b64(`\x89PNG${EXIF}small-png`)}`;
const WEBP = `data:image/webp;base64,${b64(`RIFF${EXIF}webp`)}`;
const FONT_OK = `data:font/woff2;base64,${b64('LICENSED-FONT-BYTES'.repeat(4))}`, FONT_NO = `data:font/woff2;base64,${b64('UNLICENSED-FONT-BYTES'.repeat(4))}`;
const REDRAWN = (type: string) => `data:${type};base64,${b64(`REDRAWN ${type}`)}`;

let sizes: Record<string, [number, number]> = {};
let alphaFor = new Set<string>();
let drawn: { src: string; w: number; h: number; type: string }[] = [];
let fetched: string[] = [];
let style: HTMLStyleElement | null = null;
let run = 0;   // font files read once are remembered for the session: each test has addresses of its own

beforeEach(() => {
  sizes = { [JPEG]: [800, 600], [PNG]: [640, 480], [WEBP]: [4000, 3000] }; alphaFor = new Set(); drawn = []; fetched = []; captured.length = 0;
  vi.mocked(mountDeck).mockClear();
  class FakeImage { src = ''; naturalWidth = 0; naturalHeight = 0; async decode() { const s = sizes[this.src]; if (!s) throw new Error('cannot decode'); [this.naturalWidth, this.naturalHeight] = s; } }
  vi.stubGlobal('Image', FakeImage);
  const make = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: ElementCreationOptions) => {
    const el = make(tag, o);
    if (tag !== 'canvas') return el;
    let source = '';
    Object.assign(el, {
      getContext: () => ({
        drawImage: (img: { src: string }) => { source = img.src; }, fillRect: () => undefined, globalCompositeOperation: '', fillStyle: '',
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(alphaFor.has(source) ? 0 : 255) }),
      }),
      toDataURL: (type: string) => { drawn.push({ src: source, w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height, type }); return REDRAWN(type); },
    });
    return el;
  }) as typeof document.createElement);
  // the app's own stylesheet, as its pages have it
  run++;
  style = document.createElement('style');
  const face = (family: string, weight: number, st: string, file: string, range: string) => `@font-face { font-family: '${family}'; font-style: ${st}; font-weight: ${weight}; src: url(/assets/t${run}/${file}.woff2) format('woff2'), url(/assets/t${run}/${file}.woff) format('woff'); unicode-range: ${range}; }`;
  style.textContent = [
    face('Work Sans', 400, 'normal', 'ws-vietnamese-400', 'U+0102-0103,U+1EA0-1EF9'), face('Work Sans', 400, 'normal', 'ws-latin-ext-400', 'U+0100-02BA,U+02BD-02C5'), face('Work Sans', 400, 'normal', 'ws-latin-400', 'U+0000-00FF,U+0131'),
    face('Work Sans', 400, 'italic', 'ws-latin-400-italic', 'U+0000-00FF,U+0131'), face('Work Sans', 600, 'normal', 'ws-latin-600', 'U+0000-00FF,U+0131'), face('Work Sans', 700, 'normal', 'ws-latin-700', 'U+0000-00FF'),
    face('Special Elite', 400, 'normal', 'se-latin-400', 'U+0000-00FF,U+0131'),
  ].join('\n');
  document.head.appendChild(style);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(String(url));
    const body = new TextEncoder().encode(`wOF2 ${String(url).split('/').pop()}`);
    return { ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  }));
});
afterEach(() => { style?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

let n = 0;
/** A project nobody has prepared before (prepared files are remembered against the project object). */
function project(over: Record<string, unknown> = {}): Project {
  const p = withPitch(applyDeal(sampleProject()));
  return {
    ...p, name: `Salt Flat ${++n}`, waterfall: { ...p.waterfall, nonRecoupable: 60_000 },
    pitch: {
      ...p.pitch!,
      slides: [{ id: 'cover', layout: 'cover', imageId: 'a' }, { id: 'place', layout: 'photo', headline: 'The place', body: 'A dry lake.', imageId: 'b' }, { id: 'look', layout: 'photo', headline: 'The look', body: 'Dust.', imageId: 'c' },
        { id: 'gone', layout: 'photo', headline: 'A picture nothing can draw', body: 'x', imageId: 'd' }, { id: 'numbers', layout: 'numbers' }, { id: 'ask', layout: 'ask' }],
      recipients: [
        { id: 'r1', name: 'Ada Example', slug: 'ada-example', coverLine: 'Prepared for Ada Example.', note: 'Ada: the desert unit is yours.', lead: 'without-grants' },
        { id: 'r2', name: 'Placeholder Fund', slug: 'placeholder-fund', coverLine: 'For the Placeholder Fund committee.', note: 'A note only the Fund should read.', lead: 'with-grants' },
      ],
      lookbook: [{ id: 'a', dataUrl: JPEG, caption: 'small jpeg', section: 'tone' }, { id: 'b', dataUrl: PNG, caption: 'small png', section: 'tone' }, { id: 'c', dataUrl: WEBP, caption: 'big webp', section: 'tone' },
        { id: 'd', dataUrl: 'data:image/jpeg;base64,AAAA', caption: 'UNDRAWABLE', section: 'tone' }, { id: 'e', dataUrl: 'idb:', caption: 'not back yet', section: 'tone' }],
      design: { ...p.pitch!.design!, fonts: { title: '', body: '' }, fontFiles: [{ id: 'f1', role: 'title', family: 'Licensed Face', dataUrl: FONT_OK, embedOk: true }, { id: 'f2', role: 'body', family: 'Unlicensed Face', dataUrl: FONT_NO, embedOk: false }] },
      ...over,
    } as Project['pitch'],
  };
}
const textOf = (blob: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsText(blob); });
const FUND = ['Placeholder Fund', 'placeholder-fund', 'For the Placeholder Fund committee.', 'A note only the Fund should read.'];
const ADA = ['Ada Example', 'ada-example', 'Prepared for Ada Example.', 'Ada: the desert unit is yours.'];

describe('pictures', () => {
  it('are always drawn again: a small JPEG and a small PNG do not pass through as stored', async () => {
    expect(await redrawn(JPEG)).toBe(REDRAWN('image/jpeg'));
    expect(await redrawn(PNG)).toBe(REDRAWN('image/jpeg'));           // not see-through: a JPEG
    alphaFor.add(PNG);
    expect(await redrawn(PNG)).toBe(REDRAWN('image/png'));            // see-through: it stays a PNG
    alphaFor.add(JPEG);
    expect(await redrawn(JPEG)).toBe(REDRAWN('image/jpeg'));
    expect(drawn.map(d => [d.w, d.h])).toEqual([[800, 600], [640, 480], [640, 480], [800, 600]]);   // never made larger
    expect(await redrawn(WEBP)).toBe(REDRAWN('image/jpeg'));
    expect(drawn[4]).toMatchObject({ w: 1600, h: 1200 });
  });
  it('are left out when they cannot be drawn, never passed through', async () => {
    expect(await redrawn('data:image/jpeg;base64,AAAA')).toBeNull();          // the decoder refuses it
    expect(await redrawn('idb:')).toBeNull();
    expect(await redrawn('data:text/html;base64,AAAA')).toBeNull();
    sizes[JPEG] = [0, 0];
    expect(await redrawn(JPEG)).toBeNull();
    sizes[JPEG] = [800, 600];
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => null } : document.createElementNS('http://www.w3.org/1999/xhtml', tag))) as never);
    expect(await redrawn(JPEG)).toBeNull();                                   // no canvas: no picture, not the stored one
  });
  it('no stored picture, and nothing a camera wrote beside it, is in a prepared deck or a file made from it', async () => {
    const prep = await prepare(project(), '2031-03-04');
    expect(prep.data.images.map(i => [i.id, i.src])).toEqual([['a', REDRAWN('image/jpeg')], ['b', REDRAWN('image/jpeg')], ['c', REDRAWN('image/jpeg')]]);
    const html = await textOf(webDeck(prep));
    for (const stored of [JPEG, PNG, WEBP, b64(EXIF), 'UNDRAWABLE', 'AAAA"']) expect(html).not.toContain(stored);
    expect(JSON.stringify(prep.data)).not.toContain(b64(EXIF).slice(4, 30));
  });
});

describe('fonts', () => {
  it('a prepared deck carries only font files whose licence box is ticked', async () => {
    const prep = await prepare(project(), '2031-03-04');
    expect(prep.data.theme.fontFaces).toEqual([{ family: 'Licensed Face', src: FONT_OK, role: 'title' }]);
    const html = await textOf(webDeck(prep));
    expect(html).toContain(FONT_OK);
    for (const no of [FONT_NO, 'Unlicensed Face']) expect(html).not.toContain(no);
  });
  it("reads the app's own typefaces from where the app's stylesheet says they are, and only the faces a file needs", async () => {
    const prep = await prepare(project(), '2031-03-04');
    // the title has its own file: no Special Elite. Body: Work Sans 400 and 600, and italics for a person's note
    expect(fetched.map(u => u.split('/').pop()).sort()).toEqual(['ws-latin-400-italic.woff2', 'ws-latin-400.woff2', 'ws-latin-600.woff2']);
    for (const u of fetched) expect(new URL(u).origin).toBe(window.location.origin);
    expect(prep.missingFonts).toEqual([]);
    const faces = (html: string) => [...html.matchAll(/@font-face\{font-family:"([^"]+)";font-weight:(\d+);font-style:(\w+)/g)].map(m => m.slice(1).join(' '));
    expect(faces(await textOf(webDeck(prep)))).toEqual(['Work Sans 400 normal', 'Work Sans 600 normal']);
    expect(faces(await textOf(webDeck(prep, 'placeholder-fund'))).sort()).toEqual(['Work Sans 400 italic', 'Work Sans 400 normal', 'Work Sans 600 normal']);
    expect(await textOf(webDeck(prep))).toContain(`src:url(data:font/woff2;base64,${b64('wOF2 ws-latin-400.woff2')}) format("woff2")`);
  });
  it('says which typeface it could not read, and does not keep a result that went without one', async () => {
    const p = project();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const first = await prepare(p, '2031-03-04');
    expect(first.missingFonts).toEqual(['Work Sans']);
    expect(first.fonts).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { const body = new TextEncoder().encode(`wOF2 ${url}`); return { ok: true, arrayBuffer: async () => body.buffer }; }));
    const second = await prepare(p, '2031-03-04');
    expect(second).not.toBe(first);
    expect(second.missingFonts).toEqual([]);
    expect(await prepare(p, '2031-03-04')).toBe(second);   // a whole result is kept
    const asked = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('<html>not a font').buffer }));
    vi.stubGlobal('fetch', asked);
    expect((await prepare(project(), '2031-03-04')).fonts.length).toBe(3);   // already read this session: not asked for again
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('one person per file, in the browser too', () => {
  it("a person's web deck holds that person and nobody else; a deck for anyone holds nobody", async () => {
    const prep = await prepare(project(), '2031-03-04');
    expect(prep.data.recipients.map(r => r.slug)).toEqual(['ada-example', 'placeholder-fund']);
    const ada = await textOf(webDeck(prep, 'ada-example'));
    for (const s of ADA) expect(ada).toContain(s);
    for (const s of FUND) expect(ada).not.toContain(s);
    expect(ada).toContain(',recipient:"ada-example"})');
    const anyone = await textOf(webDeck(prep));
    for (const s of [...ADA, ...FUND]) expect(anyone).not.toContain(s);
    expect(() => webDeck(prep, 'nobody')).toThrow(/link ending/);
  });
  it('the PDF is drawn from data that holds only that person and only fonts cleared to travel', async () => {
    const prep = await prepare(project(), '2031-03-04');
    const blob = await pdfDeck(prep, { recipient: 'ada-example', ask: 'with-grants' });
    expect(blob.type).toBe('application/pdf');
    expect(vi.mocked(mountDeck)).toHaveBeenCalledTimes(1);
    const [host, data, options] = vi.mocked(mountDeck).mock.calls[0] as [HTMLElement, DeckData, { static?: boolean; recipient?: string; lead?: string }];
    expect(data.recipients.map(r => r.slug)).toEqual(['ada-example']);
    expect(JSON.stringify(data)).not.toContain('Placeholder Fund');
    expect(data.theme.fontFaces).toEqual([{ family: 'Licensed Face', src: FONT_OK, role: 'title' }]);
    expect(JSON.stringify(data)).not.toContain(FONT_NO);
    expect(options).toMatchObject({ static: true, recipient: 'ada-example', lead: 'with-grants' });
    expect(captured[0].text).toContain('Prepared for Ada Example.');
    expect(captured[0].text).toContain('Ada: the desert unit is yours.');
    for (const s of FUND) expect(captured[0].text).not.toContain(s);
    expect(captured[0].slides).toBe(6);
    expect(captured[0].fontCss).toContain(FONT_OK);
    expect(captured[0].fontCss).not.toContain(FONT_NO);
    expect(captured[0].fontCss).toMatch(/font-family:"Work Sans";font-weight:400;font-style:italic/);   // her note
    expect(captured[0].meta).toEqual({ title: `${prep.data.film}: Investor deck`, date: new Date(Date.UTC(2031, 2, 4, 12)) });
    expect(host.isConnected).toBe(false);                                 // the off-screen deck is gone again
    expect(document.querySelector('body > div[aria-hidden="true"]')).toBeNull();
    await pdfDeck(prep, {});
    const general = vi.mocked(mountDeck).mock.calls[1][1] as DeckData;
    expect(general.recipients).toEqual([]);
    expect(captured[1].fontCss).not.toMatch(/font-style:italic/);
    for (const s of [...ADA, ...FUND]) expect(captured[1].text).not.toContain(s);
    await expect(pdfDeck(prep, { recipient: 'nobody' })).rejects.toThrow(/link ending/);
  });
});
