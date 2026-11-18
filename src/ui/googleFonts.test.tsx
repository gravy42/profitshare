// @vitest-environment jsdom
// The Google Fonts picker, with Google stubbed: no request leaves this file. What is checked is what a person sees
// (the words before anything is asked, a list that works with no previews, a pick that lands in the project) and what
// the page asks for: nothing before a yes, and after it only the two hosts.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import raw from '../data/google-fonts.json';
import { defaultDesign } from '../engine/pitch';
import type { FontFile, PitchDesign } from '../engine/types';
import { GOOGLE_DISCLOSURE, GOOGLE_FILE_MAX_BYTES, PREVIEW_LETTERS, findFamily, readCatalogue, roleFont } from '../engine/googleFonts';
import { fontSrcOk } from '../deck-runtime/fonts';
import { GoogleFontPick, withGoogleFont, withoutRoleFont } from './GoogleFonts';
import { GoogleFontsError, OFFLINE_WORDS, PREVIEW_AT_ONCE, PreviewLoader, UNREACHABLE_WORDS, allowGoogleFonts, fetchGoogleFamily, forgetGoogleFontsAnswer, googleFontsAllowed } from './googleFontsNet';

const catalogue = readCatalogue(raw);
const fam = (name: string) => findFamily(catalogue.families, name)!;
beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = () => undefined; });
let root: Root | null = null; let box: HTMLElement | null = null; let design: PitchDesign;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); forgetGoogleFontsAnswer(); sessionStorage.clear(); });

const woff2 = (n: number, fill = 7) => { const b = new Uint8Array(n).fill(fill); b.set([0x77, 0x4f, 0x46, 0x32]); return b; };   // "wOF2" and invented bytes
const cssFor = (url: string): string => {
  const u = new URL(url); const [name, spec = 'wght@400'] = u.searchParams.get('family')!.split(':');
  const slug = name.toLowerCase().replace(/ /g, '');
  const tuples = spec.startsWith('ital,') ? spec.slice('ital,wght@'.length).split(';').map(t => t.split(',')) : spec.slice('wght@'.length).split(';').map(w => ['0', w]);
  return tuples.flatMap(([ital, w]) => ['latin-ext', 'latin'].map(subset =>
    `/* ${subset} */\n@font-face {\n  font-family: '${name}';\n  font-style: ${ital === '1' ? 'italic' : 'normal'};\n  font-weight: ${w.replace('..', ' ')};\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/s/${slug}/v1/${subset}-${w.replace('..', '-')}-${ital}.woff2) format('woff2');\n  unicode-range: ${subset === 'latin' ? 'U+0000-00FF, U+0131' : 'U+0100-02BA'};\n}`)).join('\n');
};
/** Stands in for Google: answers the stylesheet and the files, and keeps every address and how it was asked for. */
function google(opts: { css?: (url: string) => string; file?: (url: string) => Uint8Array; fail?: boolean; status?: (url: string) => number | undefined } = {}) {
  const asked: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    asked.push({ url, init });
    if (opts.fail) throw new TypeError('Failed to fetch');
    const status = opts.status?.(url);
    if (status) return new Response('no', { status });
    if (url.startsWith('https://fonts.googleapis.com/')) return new Response((opts.css ?? cssFor)(url), { status: 200, headers: { 'content-type': 'text/css' } });
    return new Response((opts.file ? opts.file(url) : woff2(/-700-|-600-/.test(url) ? 48 : 40)) as unknown as BodyInit, { status: 200 });
  }));
  return asked;
}
const hosts = (asked: { url: string }[]) => [...new Set(asked.map(a => new URL(a.url).hostname))].sort();

describe('asking Google for a family', () => {
  it('asks for nothing until the person has said yes', async () => {
    const asked = google();
    expect(googleFontsAllowed()).toBe(false);
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toMatchObject({ kind: 'stopped' });
    expect(asked).toEqual([]);
  });
  it('after a yes asks the two hosts and no other, with no cookies, no referrer and no redirect followed', async () => {
    const asked = google(); allowGoogleFonts();
    const files = await fetchGoogleFamily(fam('Lato'), 'body');
    expect(asked.map(a => a.url)).toEqual([
      'https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;1,400&display=swap',
      'https://fonts.gstatic.com/s/lato/v1/latin-400-0.woff2', 'https://fonts.gstatic.com/s/lato/v1/latin-700-0.woff2', 'https://fonts.gstatic.com/s/lato/v1/latin-400-1.woff2',
    ]);
    expect(hosts(asked)).toEqual(['fonts.googleapis.com', 'fonts.gstatic.com']);
    for (const a of asked) { expect(a.init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' }); expect(a.init.body).toBeUndefined(); expect(a.init.headers).toBeUndefined(); }
    expect(files.map(f => [f.role, f.family, f.weight, f.style, f.source, f.licence, f.embedOk])).toEqual([['body', 'Lato', 400, 'normal', 'google', 'OFL', true], ['body', 'Lato', 700, 'normal', 'google', 'OFL', true], ['body', 'Lato', 400, 'italic', 'google', 'OFL', true]]);
    for (const f of files) { expect(f.dataUrl.startsWith('data:font/woff2;base64,d09GMg')).toBe(true); expect(fontSrcOk(f.dataUrl)).toBe(true); }
    expect(roleFont(files, 'body')!.bytes).toBe(40 + 48 + 40);
  });
  it('a title gets no italic, and a variable family is one file for all its weights', async () => {
    const asked = google(); allowGoogleFonts();
    expect((await fetchGoogleFamily(fam('Lato'), 'title')).map(f => [f.weight, f.style])).toEqual([[400, 'normal'], [700, 'normal']]);
    asked.length = 0;
    const ws = await fetchGoogleFamily(fam('Work Sans'), 'title');
    expect(asked.map(a => a.url)).toEqual(['https://fonts.googleapis.com/css2?family=Work+Sans:wght@100..900&display=swap', 'https://fonts.gstatic.com/s/worksans/v1/latin-100-900-0.woff2']);
    expect(ws.map(f => [f.weight, f.style])).toEqual([[[100, 900], 'normal']]);
  });
  it('never follows an address in the answer that is not a .woff2 at fonts.gstatic.com', async () => {
    allowGoogleFonts();
    for (const evil of ['https://evil.invalid/a.woff2', 'http://fonts.gstatic.com/s/a.woff2', 'https://fonts.gstatic.com.evil.invalid/a.woff2', 'javascript:alert(1)', 'https://fonts.gstatic.com/s/a.woff2?x=https://evil.invalid']) {
      const asked = google({ css: url => cssFor(url).replace(/https:\/\/fonts\.gstatic\.com\/[^)]+/g, evil) });
      await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toMatchObject({ kind: 'unreadable' });
      expect(asked).toHaveLength(1);                                   // the stylesheet, and then nothing
      expect(hosts(asked)).toEqual(['fonts.googleapis.com']);
    }
    const asked = google({ css: url => `${cssFor(url)}\n@import url("https://evil.invalid/more.css");` });
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toBeInstanceOf(GoogleFontsError);
    expect(asked).toHaveLength(1);
  });
  it('saves nothing when a file is not a font, or is bigger than a font should be', async () => {
    allowGoogleFonts();
    google({ file: () => new TextEncoder().encode('<html><script>alert(1)</script></html>') });
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toThrow(/not a font file/);
    google({ file: () => woff2(GOOGLE_FILE_MAX_BYTES + 1) });
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toThrow(/more than a font should be/);
    google({ css: () => `/* x */${' '.repeat(300_000)}` });
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toBeInstanceOf(GoogleFontsError);
  });
  it('says plainly when Google cannot be reached, or the computer is offline', async () => {
    allowGoogleFonts();
    google({ fail: true });
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toMatchObject({ kind: 'unreachable', message: UNREACHABLE_WORDS });
    const asked = google();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toMatchObject({ kind: 'offline', message: OFFLINE_WORDS });
    expect(asked).toEqual([]);                                         // offline: nothing is even tried
    vi.restoreAllMocks();
    google({ status: () => 503 });
    await expect(fetchGoogleFamily(fam('Lato'), 'title')).rejects.toMatchObject({ kind: 'unreachable' });
  });
  it('when Google has no italic after all, takes the upright files', async () => {
    allowGoogleFonts();
    const asked = google({ status: url => (url.includes('ital,') ? 400 : undefined) });
    const files = await fetchGoogleFamily(fam('Lato'), 'body');
    expect(asked.map(a => a.url).slice(0, 2)).toEqual(['https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;1,400&display=swap', 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap']);
    expect(files.map(f => f.style)).toEqual(['normal', 'normal']);
  });
});

describe('previews', () => {
  const some = catalogue.families.filter(f => !['Work Sans', 'Special Elite', 'Caveat'].includes(f.family)).slice(0, 12);
  const settle = async (ms = 20) => { await new Promise(r => setTimeout(r, ms)); };
  /** The browser's FontFace and document.fonts, which jsdom does not have: what was made, and what is registered now. */
  function faces(opts: { refuse?: boolean } = {}) {
    const made: { family: string; source: unknown; descriptors?: unknown }[] = []; const set = new Set<unknown>();
    class Face { status = 'unloaded'; constructor(public family: string, public source: unknown, public descriptors?: unknown) { made.push(this); } load() { if (opts.refuse) return Promise.reject(new Error('not a font')); this.status = 'loaded'; return Promise.resolve(this); } }
    vi.stubGlobal('FontFace', Face); (window as unknown as { FontFace: unknown }).FontFace = Face;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (f: unknown) => { set.add(f); }, delete: (f: unknown) => set.delete(f) } });
    return { made, set };
  }
  /** Google for previews: the cut-down stylesheet, then its file. `hold` keeps every answer back until release(). */
  function previews(opts: { hold?: boolean; fail?: (url: string, n: number) => boolean; css?: (url: string) => string } = {}) {
    const asked: { url: string; init: RequestInit }[] = []; const waiting: (() => void)[] = []; let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      asked.push({ url, init }); const mine = n++;
      if (opts.hold) await new Promise<void>((ok, no) => { waiting.push(ok); init.signal?.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
      if (opts.fail?.(url, mine)) throw new TypeError('Failed to fetch');
      const u = new URL(url);
      if (u.hostname === 'fonts.googleapis.com') return new Response(opts.css ? opts.css(url) : `@font-face {\n  font-family: '${u.searchParams.get('family')!.split(':')[0]}';\n  font-style: normal;\n  font-weight: 100 900;\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/l/font?kit=${u.searchParams.get('family')!.split(':')[0].replace(/ /g, '')}&skey=1&v=v1) format('woff2');\n}\n`, { status: 200 });
      return new Response(woff2(64) as unknown as BodyInit, { status: 200 });
    }));
    return { asked, release: (k = waiting.length) => { for (const ok of waiting.splice(0, k)) ok(); } };
  }
  afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; delete (window as unknown as { FontFace?: unknown }).FontFace; });

  it('ask for nothing before a yes', async () => {
    const { made } = faces(); const { asked } = previews();
    const loader = new PreviewLoader(() => undefined);
    for (const f of some) loader.want(f);
    await settle();
    expect(asked).toEqual([]); expect(made).toEqual([]);
    expect(loader.state(some[0].family)).toBeUndefined();
  });
  it('fetch the stylesheet and its one file from the two hosts, and give the bytes to a face under a private name: no link, no markup', async () => {
    allowGoogleFonts();
    const { made, set } = faces(); const { asked } = previews();
    let changed = 0;
    const loader = new PreviewLoader(() => { changed++; });
    loader.want(fam('Roboto')); loader.want(fam('Open Sans'));
    await settle();
    expect(asked.map(a => a.url).sort()).toEqual([
      `https://fonts.googleapis.com/css2?family=Open+Sans:wght@400&text=${encodeURIComponent(PREVIEW_LETTERS)}&display=swap`,
      `https://fonts.googleapis.com/css2?family=Roboto:wght@400&text=${encodeURIComponent(PREVIEW_LETTERS)}&display=swap`,
      'https://fonts.gstatic.com/l/font?kit=OpenSans&skey=1&v=v1', 'https://fonts.gstatic.com/l/font?kit=Roboto&skey=1&v=v1',
    ]);
    for (const a of asked) expect(a.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    expect(made.map(f => f.family).sort()).toEqual(['gfp Open Sans', 'gfp Roboto']);
    for (const f of made) { expect(f.source).toBeInstanceOf(ArrayBuffer); expect((f.source as ArrayBuffer).byteLength).toBe(64); expect(f.descriptors).toBeUndefined(); }   // bytes, never an address; no weight to match: a variable family is drawn like any other
    expect(set.size).toBe(2);
    expect(loader.state('Roboto')).toBe('ready'); expect(loader.faceName('Roboto')).toBe('gfp Roboto');
    expect(changed).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('link')).toBeNull(); expect(document.head.querySelector('style')).toBeNull();
    loader.close();
    expect(set.size).toBe(0);                                         // every face goes when the picker closes
    loader.want(fam('Lato')); await settle();
    expect(asked).toHaveLength(4);                                     // closed: nothing more is asked
  });
  it('fetch a few at a time, the row seen last first; a row that scrolls away gives up its place or is called off', async () => {
    allowGoogleFonts();
    const { set } = faces(); const { asked, release } = previews({ hold: true });
    const loader = new PreviewLoader(() => undefined);
    for (const f of some) loader.want(f);
    await settle();
    expect(asked).toHaveLength(PREVIEW_AT_ONCE);
    loader.drop(some[11].family);                                      // still waiting its turn: out of the queue
    expect(loader.state(some[11].family)).toBeUndefined();
    const flying = new URL(asked[0].url).searchParams.get('family')!.split(':')[0];
    loader.drop(flying);                                               // on its way: called off
    expect(asked[0].init.signal!.aborted).toBe(true);
    await settle();
    expect(loader.state(flying)).toBeUndefined();                      // neither ready nor failed: it can be asked for again
    expect(loader.unreachable).toBe(false);
    expect(asked).toHaveLength(PREVIEW_AT_ONCE + 1);                   // its place went to the next row
    release(); await settle(); release(); await settle();
    expect(set.size).toBeGreaterThanOrEqual(PREVIEW_AT_ONCE - 1);
    const at = asked.length;
    loader.close();
    release(); await settle();
    expect(asked.length).toBe(at); expect(set.size).toBe(0);
  });
  it('the app\'s own three faces need nothing from Google', async () => {
    allowGoogleFonts(); faces(); const { asked } = previews();
    const loader = new PreviewLoader(() => undefined);
    for (const name of ['Work Sans', 'Special Elite', 'Caveat']) { loader.want(fam(name)); expect(loader.state(name)).toBe('ready'); expect(loader.faceName(name)).toBe(name); }
    await settle(); expect(asked).toEqual([]);
  });
  it('a preview that failed is tried once more when its row comes back into view, and then left alone', async () => {
    allowGoogleFonts();
    const { set } = faces(); let bad = true;
    const { asked } = previews({ fail: url => bad && url.includes('family=Lato') });
    const loader = new PreviewLoader(() => undefined);
    loader.want(fam('Roboto')); loader.want(fam('Lato')); await settle();
    expect(loader.state('Roboto')).toBe('ready'); expect(loader.state('Lato')).toBe('failed');
    loader.want(fam('Lato')); await settle();                           // back in view: once more
    expect(loader.state('Lato')).toBe('failed');
    const n = asked.length;
    loader.want(fam('Lato')); await settle();                           // and no more
    expect(asked).toHaveLength(n);
    bad = false; loader.retry(); loader.want(fam('Lato')); await settle();   // unless the person asks
    expect(loader.state('Lato')).toBe('ready'); expect(set.size).toBe(2);
    loader.close();
  });
  it('a stylesheet that is not Google\'s, or bytes the browser will not take as a font, is no preview and nothing is followed', async () => {
    allowGoogleFonts();
    faces(); const evil = previews({ css: () => `@font-face { font-family: 'x'; src: url(https://evil.invalid/a.woff2) format('woff2'); }` });
    const loader = new PreviewLoader(() => undefined);
    loader.want(fam('Roboto')); await settle();
    expect(loader.state('Roboto')).toBe('failed');
    expect(evil.asked.map(a => new URL(a.url).hostname)).toEqual(['fonts.googleapis.com']);
    loader.close();
    const refused = faces({ refuse: true }); previews();
    const second = new PreviewLoader(() => undefined);
    second.want(fam('Lato')); await settle();
    expect(second.state('Lato')).toBe('failed'); expect(refused.set.size).toBe(0);
  });
  it('stop asking once it is plain Google cannot be reached, and can be tried again', async () => {
    allowGoogleFonts(); faces(); const { asked } = previews({ fail: () => true });
    const loader = new PreviewLoader(() => undefined);
    for (const f of some) loader.want(f);
    await settle(40);
    expect(loader.unreachable).toBe(true);
    expect(asked.length).toBeLessThanOrEqual(PREVIEW_AT_ONCE + 2);     // it did not go on through all twelve
    const n = asked.length;
    loader.want(some[11]); await settle();
    expect(asked).toHaveLength(n);
    loader.retry();
    expect(loader.unreachable).toBe(false);
    loader.close();
  });
});

describe('the picker', () => {
  function Harness({ start }: { start?: PitchDesign }) {
    const [d, setD] = useState<PitchDesign>(start ?? { ...defaultDesign(), fonts: { title: '"Special Elite", monospace', body: '' } });
    design = d;
    return <><GoogleFontPick role="title" design={d} set={f => setD(f)} film="Salt Flat" /><GoogleFontPick role="body" design={d} set={f => setD(f)} film="Salt Flat" /></>;
  }
  function draw(start?: PitchDesign): HTMLElement { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); act(() => { root!.render(<Harness start={start} />); }); return box; }
  const tick = (ms = 30) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
  const button = (text: string | RegExp, el: ParentNode = document.body) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!)))!;
  const click = (b: Element) => act(() => { (b as HTMLElement).click(); });
  const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
  const type = (el: HTMLInputElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const names = () => [...document.querySelectorAll('[role="option"] .gf-name')].map(n => n.textContent);
  async function open(role: 'title' | 'body' = 'title') { click(document.querySelector(`button[aria-label="Pick the ${role} font from Google Fonts"]`)!); for (let i = 0; i < 6 && !dialog(); i++) await tick(); await tick(); }

  it('opens on the words about Google, with nothing asked and no list of previews yet', async () => {
    const asked = google(); draw();
    await open();
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Pick a title font from Google Fonts');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toBe(GOOGLE_DISCLOSURE);
    expect(button('Show the fonts')).toBeTruthy(); expect(button('Not now')).toBeTruthy();
    expect(document.activeElement).toBe(button('Show the fonts'));
    expect(d.querySelector('[role="listbox"]')).toBeNull();
    expect(asked).toEqual([]); expect(document.head.querySelector('link')).toBeNull();
  });
  it('Not now lists every font by name with no previews, asks nothing, and asks the question again next time', async () => {
    const asked = google(); draw();
    await open(); click(button('Not now')); await tick();
    expect(document.querySelector('[role="status"].gf-count')!.textContent).toBe(`${catalogue.families.length.toLocaleString('en-US')} fonts`);
    expect(names().length).toBeGreaterThan(5);
    expect(names().length).toBeLessThan(60);                           // a window on the list, not 1,887 rows
    expect(names()[0]).toBe('Roboto');
    expect(document.querySelector('.gf-sample')).toBeNull();
    expect(document.querySelector('.gf-banner')!.textContent).toContain(GOOGLE_DISCLOSURE);
    expect(googleFontsAllowed()).toBe(false); expect(sessionStorage.length).toBe(0);
    expect(asked).toEqual([]); expect(document.head.querySelector('link')).toBeNull();
    key(dialog()!, 'Escape'); await tick();
    expect(dialog()).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Pick the title font from Google Fonts');   // the keyboard is back where it was
    await open();
    expect(button('Show the fonts')).toBeTruthy(); expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(asked).toEqual([]);
  });
  it('searches, filters by kind, sorts, and says how many match', async () => {
    google(); draw(); await open(); click(button('Not now')); await tick();
    const search = dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);
    expect(dialog()!.querySelector(`label[for="${search.id}"]`)!.textContent).toBe('Search fonts');
    type(search, 'playfair'); await tick();
    expect(names()).toEqual(['Playfair Display', 'Playfair', 'Playfair Display SC']);
    expect(document.querySelector('.gf-count')!.textContent).toBe(`3 of ${catalogue.families.length.toLocaleString('en-US')} fonts`);
    type(search, 'zzzz'); await tick();
    expect(names()).toEqual([]); expect(document.querySelector('.gf-count')!.textContent).toMatch(/^No font matches/);
    expect(button(/^Use/)!.disabled).toBe(true);
    type(search, ''); await tick();
    click(button('Monospace')); await tick();
    expect(button('Monospace').getAttribute('aria-pressed')).toBe('true');
    const mono = catalogue.families.filter(f => f.category === 'monospace').length;
    expect(document.querySelector('.gf-count')!.textContent).toBe(`${mono} of ${catalogue.families.length.toLocaleString('en-US')} fonts`);
    expect(names()[0]).toBe('Roboto Mono');
    const sort = dialog()!.querySelector('select')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sort, 'az'); sort.dispatchEvent(new Event('change', { bubbles: true })); }); await tick();
    expect(names()[0]).toBe(catalogue.families.find(f => f.category === 'monospace')!.family);
    click(button('All')); await tick();
    expect(names()[0]).toBe(catalogue.families[0].family);
  });
  it('arrow keys move through the list, Enter picks; picking before a yes asks first, and then saves the family into the project', async () => {
    const asked = google(); draw(); await open(); click(button('Not now')); await tick();
    const list = dialog()!.querySelector<HTMLElement>('[role="listbox"]')!;
    const active = () => document.getElementById(list.getAttribute('aria-activedescendant')!)!;
    expect(active().querySelector('.gf-name')!.textContent).toBe('Roboto');
    key(list, 'ArrowDown'); key(list, 'ArrowDown'); key(list, 'ArrowDown'); key(list, 'ArrowDown'); key(list, 'ArrowUp');
    expect(active().getAttribute('aria-selected')).toBe('true');
    const chosen = active().querySelector('.gf-name')!.textContent!;
    expect(chosen).toBe(names()[3]);
    type(dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!, 'lato'); await tick();
    expect(active().querySelector('.gf-name')!.textContent).toBe('Lato');
    key(list, 'Enter'); await tick();
    expect(asked).toEqual([]);                                         // no yes yet: the question, with the same words
    expect(dialog()!.querySelector('.gf-confirm')!.textContent).toContain(GOOGLE_DISCLOSURE);
    click(button('Download Lato')); await tick(60);
    expect(hosts(asked)).toEqual(['fonts.googleapis.com', 'fonts.gstatic.com']);
    expect(asked[0].url).toBe('https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap');
    expect(dialog()).toBeNull();                                       // picked: the picker closes
    expect(googleFontsAllowed()).toBe(true); expect(sessionStorage.getItem('profitshare.gfonts.ok')).toBe('1');
    expect(design.fonts.title).toBe('Lato');
    expect(design.fontFiles!.map(f => [f.role, f.family, f.weight, f.source, f.embedOk])).toEqual([['title', 'Lato', 400, 'google', true], ['title', 'Lato', 700, 'google', true]]);
    for (const f of design.fontFiles!) expect(fontSrcOk(f.dataUrl)).toBe(true);
    expect(JSON.stringify(design)).not.toContain('gstatic');           // the project keeps the font, not where it came from
    expect(box!.querySelector('[role="status"]')!.textContent).toMatch(/Lato is now the title font, and 1 KB of font files are saved in your project/);
    expect(document.head.querySelector('link')).toBeNull();
  });
  it('a pick for the body leaves the title\'s font alone, and picking again replaces the family', async () => {
    google(); allowGoogleFonts(); draw();
    await open('title'); expect(dialog()!.querySelector('[role="listbox"]')).toBeTruthy();   // already a yes this session: straight to the list
    type(dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!, 'lora'); await tick();
    click(button('Use Lora')); await tick(60);
    await open('body');
    expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)!.textContent).toBe('Pick a body font from Google Fonts');
    type(dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!, 'karla'); await tick();
    key(dialog()!.querySelector('input[type="search"]')!, 'Enter'); await tick(60);
    expect(design.fonts).toEqual({ title: 'Lora', body: 'Karla' });
    expect([...new Set(design.fontFiles!.map(f => `${f.role} ${f.family}`))]).toEqual(['title Lora', 'body Karla']);
    expect(design.fontFiles!.some(f => f.role === 'body' && f.style === 'italic')).toBe(true);
    const lora = design.fontFiles!.filter(f => f.role === 'title').map(f => f.id);
    await open('title');
    expect(dialog()!.querySelector('.gf-mine')?.textContent ?? '').toBe('');   // Lora is not on screen at the top of the list
    type(dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!, 'lora'); await tick();
    expect(dialog()!.querySelector('.gf-mine')!.textContent).toBe('✓ In your project');
    type(dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!, 'bitter'); await tick();
    click(button('Use Bitter')); await tick(60);
    expect(design.fonts.title).toBe('Bitter');
    expect(design.fontFiles!.filter(f => f.role === 'title').every(f => f.family === 'Bitter')).toBe(true);
    expect(design.fontFiles!.some(f => lora.includes(f.id))).toBe(false);       // every file of the family before is gone
    expect(design.fontFiles!.filter(f => f.role === 'body').every(f => f.family === 'Karla')).toBe(true);
  });
  it('says so plainly when Google cannot be reached, changes nothing, and stays usable', async () => {
    google({ fail: true }); allowGoogleFonts(); draw(); await open();
    const before = JSON.stringify(design);
    click(button(/^Use Roboto/)); await tick(60);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain(UNREACHABLE_WORDS);
    expect(JSON.stringify(design)).toBe(before);
    expect(names().length).toBeGreaterThan(5);
    expect(button(/^Use Roboto/).disabled).toBe(false);                // and it can be tried again
    click(button(/^Close/)); await tick();
    expect(dialog()).toBeNull();
  });
});

describe('a picked font in the design', () => {
  const files = (role: 'title' | 'body', family: string): FontFile[] => [400, 700].map(w => ({ id: `gfont_${role}_${w}_x`, role, family, dataUrl: 'data:font/woff2;base64,d09GMgABAAAAAA==', embedOk: true, weight: w, style: 'normal', source: 'google', licence: 'OFL' }));
  it('sets the role\'s font name and files, and removing it takes both away', () => {
    const start: PitchDesign = { ...defaultDesign(), fonts: { title: 'Georgia, serif', body: 'Verdana' }, fontFiles: [{ id: 'font_b', role: 'body', family: 'Invented Sans', dataUrl: 'data:font/woff2;base64,d09GMgABAAAAAA==', embedOk: false }] };
    const picked = withGoogleFont(start, 'title', fam('Lato'), files('title', 'Lato'));
    expect(picked.fonts).toEqual({ title: 'Lato', body: 'Verdana' });
    expect(picked.fontFiles!.map(f => f.id)).toEqual(['gfont_title_400_x', 'gfont_title_700_x', 'font_b']);
    const gone = withoutRoleFont(picked, 'title');
    expect(gone.fonts).toEqual({ title: '', body: 'Verdana' });
    expect(gone.fontFiles!.map(f => f.id)).toEqual(['font_b']);
    expect('fontFiles' in withoutRoleFont(gone, 'body')).toBe(false);                 // none left: the field goes, as before
    expect(withoutRoleFont(gone, 'body').fonts.body).toBe('Verdana');                 // an attached file's removal never touched the name
    expect(withoutRoleFont({ ...picked, fonts: { ...picked.fonts, title: 'Lato, Georgia' } }, 'title').fonts.title).toBe('Lato, Georgia');   // a name the person has since edited is theirs
  });
});
