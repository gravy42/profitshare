// @vitest-environment jsdom
// The Pitch tab's deck builder and design box drawn from project files with nonsense in them: nothing may throw, and
// if something does, the boundary shows a plain message instead of taking the page down.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sampleDemo, sampleProject } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { defaultDesign, withPitch } from '../engine/pitch';
import type { PitchDesign, Project } from '../engine/types';
import PitchDeck from './PitchDeck';
import { LoadFailed, forgetWork, loadWork } from './DeckSend';
import { CardColor, FontFiles, PaletteBuilder, PaperChooser } from './DesignBuilder';
import { Boundary } from './Boundary';

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let box: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.restoreAllMocks(); vi.useRealTimers(); });
function draw(node: React.ReactNode): HTMLElement {
  box = document.createElement('div'); document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(node); });
  return box;
}
/** Lets the preview's timer run: the deck is drawn a moment after the page. */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });
const base = (): Project => withPitch(applyDeal(sampleProject()));
const withPitchFields = (over: Record<string, unknown>): Project => { const p = base(); return { ...p, pitch: { ...p.pitch!, ...over } as Project['pitch'] }; };
const junk: unknown[] = [null, undefined, 7, 'text', [], {}, { id: '' }, { id: 5 }];

describe('the pitch deck builder with anything in the project file', () => {
  it('draws the sample: the draft, a preview, nothing to throw', async () => {
    const el = draw(<PitchDeck project={base()} setPitch={() => undefined} />);
    await settle();
    expect(el.querySelector('h2')!.textContent).toBe('Pitch deck');
    expect(el.textContent).toContain('Build my deck');
    expect(el.querySelectorAll('.pd-row').length).toBeGreaterThan(3);
    expect(el.querySelector('.pd-host')!.shadowRoot!.querySelectorAll('section').length).toBeGreaterThan(3);
  });
  it('draws slides, cards, numbers, people, pictures and font files that are nonsense', async () => {
    const p = withPitchFields({
      slides: [...junk, { id: 'a', layout: 'stats', headline: 5, stats: [null, 'x', { value: 3 }], lead: 'no', quote: 7, cards: 'no', hidden: 'yes' }, { id: 'b', layout: 'cards', cards: [null, { title: 'One' }, 9] },
        { id: 'c', layout: 'hologram' }, { id: 'd', layout: 'text', columns: [null, { lines: 'x' }], imageId: 'gone' }, { id: 'e', layout: 'team', aside: 'no' }, { id: 'f', layout: 'timeline', milestones: [null, {}] }],
      recipients: [...junk, { name: 'No id' }, { id: 'r', name: null, slug: 4, highlightCardId: 'nope' }],
      lookbook: [...junk, { id: 'pic', dataUrl: 12 }, { id: 'ok', dataUrl: 'data:image/png;base64,AAAA', caption: null }],
      design: { ...defaultDesign(), colors: 'red', fonts: null, fontFiles: [...junk, { id: 'f', role: 'title', family: 'Ok Face', dataUrl: 7 }] },
    });
    let el!: HTMLElement;
    expect(() => { el = draw(<PitchDeck project={p} setPitch={() => undefined} />); }).not.toThrow();
    expect(el.querySelector('[role="alert"]')).toBeNull();           // drawn, not caught by a boundary
    expect([...el.querySelectorAll('.pd-row .pd-pick b')].map(b => b.textContent)).toEqual(['Proof (numbers and a quote)', 'Cards', 'Words', 'Team', 'Plan']);
    expect(el.textContent).toContain('1 slide was made in a newer version of ProfitShare and cannot be shown here.');
    await settle();
    expect(el.querySelector('.pd-host')!.shadowRoot!.querySelectorAll('section').length).toBe(5);
    expect(el.querySelectorAll('.pd-person')).toHaveLength(5);        // every object is a person, most with nothing typed; the rest are not people
    expect(el.textContent).not.toContain('font file has no name');    // an entry that is not a font file is not reported as one
    // every slide can be selected and edited without throwing
    for (const pick of [...el.querySelectorAll<HTMLButtonElement>('.pd-row .pd-pick')]) expect(() => act(() => { pick.click(); })).not.toThrow();
    expect(el.querySelector('.pd-editor')).not.toBeNull();
  });
  it.each([['slides', 'text'], ['slides', 5], ['slides', {}], ['recipients', 'text'], ['recipients', {}], ['lookbook', 'text'], ['lookbook', {}], ['design', 'text'], ['design', 7], ['design', []]])('%s: %j', (key, value) => {
    expect(() => draw(<PitchDeck project={withPitchFields({ [key]: value })} setPitch={() => undefined} />)).not.toThrow();
    expect(box!.querySelector('h2')!.textContent).toBe('Pitch deck');
  });
  it('the design box parts take nonsense too', () => {
    const d = { ...defaultDesign(), card: 9, fontFiles: [...junk, { id: 'f', role: 'body', family: null, dataUrl: null, embedOk: 'yes' }] } as never;
    expect(() => draw(<><CardColor design={d} set={() => undefined} /><FontFiles design={d} set={() => undefined} /></>)).not.toThrow();
    expect(box!.textContent).toContain('Give the font a name');
    act(() => root!.unmount()); box!.remove();
    expect(() => draw(<PaletteBuilder project={withPitchFields({ lookbook: [...junk, { id: 'p', dataUrl: 5 }], design: 'x' })} setPitch={() => undefined} onClose={() => undefined} />)).not.toThrow();
    expect(box!.textContent).toContain('The look book has no pictures yet');
  });
  it('a colour that is really an address never becomes a background', async () => {
    const p = withPitchFields({ lookbook: [], design: { ...defaultDesign(), colors: { bg: 'url(http://example.invalid/track.png)', ink: 'url(x)', accent: 'red; background: url(x)', accent2: '', muted: 7 }, card: 'url(http://example.invalid/card.png)' } });
    const el = draw(<><PitchDeck project={p} setPitch={() => undefined} /><CardColor design={p.pitch!.design!} set={() => undefined} /></>);
    await settle();
    for (const node of [el, ...el.querySelectorAll<HTMLElement>('*')]) expect(node.getAttribute('style') ?? '').not.toMatch(/url\(|example\.invalid/);
    const deck = el.querySelector('.pd-host')!.shadowRoot!.querySelector<HTMLElement>('.psd')!;
    expect(deck.getAttribute('style')).not.toMatch(/url\(|example\.invalid/);
  });
});

describe('papers', () => {
  const sample = (): Project => applyDeal(sampleDemo());
  it('the design box offers each paper as a named radio button with a card drawn by the deck itself, and the two switches', () => {
    let d: PitchDesign = { ...defaultDesign() };
    const set = (f: (x: typeof d) => typeof d) => { d = f(d); act(() => root!.render(<PaperChooser design={d} set={set} />)); };
    const el = draw(<PaperChooser design={d} set={set} />);
    const group = el.querySelector('fieldset')!;
    expect(group.querySelector('legend')!.textContent).toBe('Paper for cards');
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map(r => r.closest('label')!.textContent)).toEqual(['Plain', 'Postcard', 'Letter', 'Notebook', 'Torn page']);
    expect(new Set(radios.map(r => r.name)).size).toBe(1);   // one group: the arrow keys move through it
    expect(radios.map(r => r.checked)).toEqual([true, false, false, false, false]);   // nothing set: plain
    const thumbs = [...el.querySelectorAll<HTMLElement>('.paperthumb')];
    expect(thumbs.map(t => t.shadowRoot!.querySelector<HTMLElement>('.psd-card')!.dataset.paper)).toEqual(['plain', 'postcard', 'letter', 'notebook', 'torn']);
    for (const t of thumbs) { expect(t.getAttribute('aria-hidden')).toBe('true'); expect(t.shadowRoot!.querySelector('.psd')!.classList.contains('psd-swatch')).toBe(true); }
    act(() => radios[4].click());
    expect(d.paper).toBe('torn');
    act(() => el.querySelectorAll<HTMLInputElement>('input[type="radio"]')[0].click());
    expect('paper' in d).toBe(false);   // plain is nothing in the file
    const [hand, tilt] = [...el.querySelectorAll<HTMLInputElement>('.pd-checks input[type="checkbox"]')];
    expect(hand.closest('label')!.textContent).toBe(' Handwriting on the papers');
    expect(tilt.closest('label')!.textContent).toBe(' Tilt the cards a little');
    expect([hand.checked, tilt.checked]).toEqual([false, false]);
    act(() => hand.click());
    expect(d.hand).toBe(true);
    expect(el.querySelector('.paperthumb')!.shadowRoot!.querySelector('.psd')!.classList.contains('psd-hand')).toBe(true);   // the samples follow
    act(() => el.querySelectorAll<HTMLInputElement>('.pd-checks input')[1].click());
    expect(d.tilt).toBe(true);
    act(() => el.querySelectorAll<HTMLInputElement>('.pd-checks input')[0].click());
    expect('hand' in d).toBe(false);
    expect(el.textContent).not.toMatch(/on a line|pinned|hung|\bclip|\bpeg/i);
  });
  it('the chooser takes nonsense for a paper and for every colour', () => {
    const d = { ...defaultDesign(), paper: 'url(x)', hand: 'yes', tilt: 3, colors: 'red', card: 7, fonts: null } as never;
    expect(() => draw(<PaperChooser design={d} set={() => undefined} />)).not.toThrow();
    expect([...box!.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(r => r.checked)).toEqual([true, false, false, false, false]);
    for (const node of box!.querySelectorAll<HTMLElement>('*')) expect(node.getAttribute('style') ?? '').not.toMatch(/url\(/);
  });
  it('a slide with cards has a Paper choice; a slide with none has not; choosing writes one word to the slide', async () => {
    let p = sample();
    const setPitch = (f: (x: NonNullable<Project['pitch']>) => NonNullable<Project['pitch']>) => { p = { ...p, pitch: f(p.pitch!) }; act(() => root!.render(<PitchDeck project={p} setPitch={setPitch} />)); };
    const el = draw(<PitchDeck project={p} setPitch={setPitch} />);
    await settle();
    const pick = (id: string) => act(() => { [...el.querySelectorAll<HTMLButtonElement>('.pd-row .pd-pick')][p.pitch!.slides!.findIndex(s => s.id === id)].click(); });
    const paper = () => el.querySelector<HTMLSelectElement>('.pd-editor select[data-field="paper"]');
    pick('why'); expect(paper()).toBeNull();
    pick('plan'); expect(paper()).toBeNull();
    pick('gap');
    expect(el.querySelector(`label[for="${paper()!.id}"]`)!.textContent).toBe('Paper');
    expect([...paper()!.options].map(o => o.textContent)).toEqual(['Deck default', 'Plain', 'Postcard', 'Letter', 'Notebook', 'Torn page', 'A mix']);
    expect(paper()!.value).toBe('mixed');
    const choose = (v: string) => act(() => { const s = paper()!; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); });
    choose('letter');
    expect(p.pitch!.slides!.find(s => s.id === 'gap')!.paper).toBe('letter');
    choose('');
    expect('paper' in p.pitch!.slides!.find(s => s.id === 'gap')!).toBe(false);
    for (const id of ['cover', 'audience', 'team', 'ways']) { pick(id); expect(paper(), id).not.toBeNull(); }
    expect(el.querySelector('.pd-editor')!.textContent).not.toMatch(/on a line|pinned|hung\b/i);
  });
});

describe('the boundary', () => {
  const Broken = (): never => { throw new Error('a part that cannot be drawn'); };
  it('shows a plain message in place of a part that throws, and the rest of the page stays', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = draw(<div><p>The rest of the page.</p><Boundary what="The pitch deck builder"><Broken /></Boundary></div>);
    expect(el.textContent).toContain('The rest of the page.');
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('The pitch deck builder could not be shown.');
    expect(alert.textContent).toContain('nothing has been changed or lost');
    expect(alert.querySelector('button')!.textContent).toBe('Try again');
  });
  it('draws its children when nothing is wrong, and tries again when asked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    const Part = () => { if (broken) throw new Error('not yet'); return <p>Drawn.</p>; };
    const el = draw(<Boundary what="This part"><Part /></Boundary>);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    broken = false;
    act(() => { el.querySelector('button')!.click(); });
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).toBe('Drawn.');
  });
});

describe('Send it', () => {
  const people = [
    { id: 'r1', name: 'Ada Example', slug: 'ada-example', coverLine: 'Prepared for Ada Example.', note: 'A note.', lead: 'with-grants' },
    { id: 'r2', name: 'Placeholder Fund', slug: 'with', coverLine: '', lead: 'with-grants' },     // a reserved link ending: no file
    { id: 'r3', name: '', slug: '', coverLine: '', lead: 'with-grants' },                          // nobody has started typing: not a row
  ];
  const rowsOf = (el: HTMLElement) => [...el.querySelectorAll('.pd-sendtable tbody tr')];
  it('lists anyone and each person with a link ending, names the files, and sends the rest to their link ending', async () => {
    const p = withPitchFields({ recipients: people });
    const el = draw(<PitchDeck project={{ ...p, name: 'Salt Flat', waterfall: { ...p.waterfall, nonRecoupable: 0 } }} setPitch={() => undefined} />);
    await settle();
    const rows = rowsOf(el);
    expect(rows.map(r => r.querySelector('th')!.textContent)).toEqual(['Anyone (no name on it)', 'Ada Example #ada-example', 'Placeholder Fund']);
    expect([...rows[0].querySelectorAll('button')].map(b => [b.textContent, b.title])).toEqual([['Download web deck', 'salt-flat-deck.html'], ['Download PDF', 'salt-flat-deck.pdf']]);
    expect([...rows[1].querySelectorAll('button')].map(b => b.title)).toEqual(['salt-flat-deck-ada-example.html', 'salt-flat-deck-ada-example.pdf']);
    expect(rows[2].textContent).toContain('No file: fix the link ending.');
    expect(rows[2].querySelector('button')!.textContent).toBe('Go to their link ending');
    expect(el.querySelector('.pd-sendall')!.textContent).toContain('2 web decks and 2 PDFs');
    expect(el.querySelector('.pd-where summary')!.textContent).toBe('Where to put it');
    expect(el.querySelector('.pd-sendfonts')!.textContent).toMatch(/Fonts inside these files: Special Elite and Work Sans\./);
  });
  it('offers the PDF with and without grants when the project has both asks', async () => {
    const p = withPitchFields({ recipients: people });
    const el = draw(<PitchDeck project={{ ...p, name: 'Salt Flat', waterfall: { ...p.waterfall, nonRecoupable: 60_000 } }} setPitch={() => undefined} />);
    await settle();
    expect([...rowsOf(el)[1].querySelectorAll('button')].map(b => [b.textContent, b.title])).toEqual([
      ['Download web deck', 'salt-flat-deck-ada-example.html'], ['PDF, with grants', 'salt-flat-deck-ada-example-with-grants.pdf'], ['PDF, without grants', 'salt-flat-deck-ada-example-without-grants.pdf']]);
    expect([...rowsOf(el)[0].querySelectorAll('button')].map(b => b.title)).toEqual(['salt-flat-deck.html', 'salt-flat-deck-with-grants.pdf', 'salt-flat-deck-without-grants.pdf']);
    expect(el.querySelector('.pd-sendall')!.textContent).toContain('2 web decks and 4 PDFs');
    expect(el.querySelector('.pd-where')!.textContent).toContain('#without');
  });
  it('says how many things are left to fix before a download, and lets it go ahead or shows them', async () => {
    const p = withPitchFields({ recipients: people });
    const el = draw(<PitchDeck project={{ ...p, name: 'Salt Flat' }} setPitch={() => undefined} />);
    await settle();
    const fixes = el.querySelectorAll('.pd-fixes li').length;
    expect(fixes).toBeGreaterThan(0);                                   // the reserved link ending, at least
    expect(el.querySelector('.pd-sendask')).toBeNull();
    act(() => { rowsOf(el)[0].querySelector('button')!.click(); });
    const ask = el.querySelector('.pd-sendask')!;
    expect(ask.textContent).toContain(fixes === 1 ? 'There is 1 thing to fix on this deck.' : `There are ${fixes} things to fix on this deck.`);
    expect([...ask.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Show me', 'Download anyway']);
    expect(el.querySelector('#pd-fixes-h')!.textContent).toBe('Things to fix');
  });
  it('keeps that question up when the project is only handed over again, and takes it down when the things to fix change', async () => {
    const p = { ...withPitchFields({ recipients: people }), name: 'Salt Flat' };
    const el = draw(<PitchDeck project={p} setPitch={() => undefined} />);
    await settle();
    act(() => { rowsOf(el)[0].querySelector('button')!.click(); });
    expect(el.querySelector('.pd-sendask')).not.toBeNull();
    // the same project as a new object (its pictures came back from the browser's store): nothing she did, nothing to dismiss
    act(() => { root!.render(<PitchDeck project={{ ...p, pitch: { ...p.pitch!, lookbook: [...(p.pitch!.lookbook ?? [])] } }} setPitch={() => undefined} />); });
    await settle();
    expect(el.querySelector('.pd-sendask')).not.toBeNull();
    expect([...el.querySelectorAll('.pd-sendask button')].map(b => b.textContent)).toEqual(['Show me', 'Download anyway']);
    // she fixes the link ending: the list of things to fix is another list, and the question about the old one goes
    act(() => { root!.render(<PitchDeck project={{ ...p, pitch: { ...p.pitch!, recipients: people.map(r => (r.id === 'r2' ? { ...r, slug: 'placeholder-fund' } : r)) } as Project['pitch'] }} setPitch={() => undefined} />); });
    await settle();
    expect(el.querySelector('.pd-sendask')).toBeNull();
  });
  it('says in the help that making the files fetches nothing from outside the app', async () => {
    const el = draw(<PitchDeck project={base()} setPitch={() => undefined} />);
    await settle();
    expect(el.querySelector('.pd-send .help')!.textContent).toMatch(/fetches nothing from outside this app/);
    expect(el.querySelector('.pd-send .help')!.textContent).toMatch(/the app's own font files/);
  });
});

describe('the note under the preview about a font that does not travel', () => {
  const FONT = `data:font/woff2;base64,${'QUJD'.repeat(10)}`;
  const withFonts = (files: unknown[]) => withPitchFields({ design: { ...defaultDesign(), fontFiles: files } });
  it('names a font file whose box is not ticked, with the way to its box', async () => {
    const el = draw(<PitchDeck project={withFonts([{ id: 'f1', role: 'title', family: 'Licensed Face', dataUrl: FONT, embedOk: true }, { id: 'f2', role: 'body', family: 'Unlicensed Face', dataUrl: FONT, embedOk: false }])} setPitch={() => undefined} />);
    await settle();
    const note = el.querySelector('.pd-fontnote')!;
    expect(note.textContent).toBe('The preview uses Unlicensed Face; the files you send will not, because its box under Design system is not ticked. Go to Design system');
    expect(note.querySelector('button')!.textContent).toBe('Go to Design system');
  });
  it('is not there when every font file may travel, or there are none', async () => {
    const ticked = draw(<PitchDeck project={withFonts([{ id: 'f1', role: 'title', family: 'Licensed Face', dataUrl: FONT, embedOk: true }])} setPitch={() => undefined} />);
    await settle();
    expect(ticked.querySelector('.pd-fontnote')).toBeNull();
    act(() => root?.unmount()); box?.remove();
    const none = draw(<PitchDeck project={base()} setPitch={() => undefined} />);
    await settle();
    expect(none.querySelector('.pd-fontnote')).toBeNull();
  });
});

describe('loading the export code', () => {
  const fake = { downloadBlob: () => undefined } as unknown as typeof import('./deckSendFiles');
  afterEach(() => forgetWork());
  it('loads it once', async () => {
    const load = vi.fn(async () => fake);
    expect(await loadWork(load)).toBe(fake);
    expect(await loadWork(load)).toBe(fake);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('after a failure asks for the same file under a new address, which the browser has not seen fail', async () => {
    const load = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module: http://localhost:4175/profitshare/assets/deckSendFiles-AbC123.js'); });
    const again = vi.fn(async (_url: string) => fake);
    expect(await loadWork(load, again)).toBe(fake);
    expect(again).toHaveBeenCalledTimes(1);
    expect(again.mock.calls[0][0]).toMatch(/^http:\/\/localhost:4175\/profitshare\/assets\/deckSendFiles-AbC123\.js\?again=[a-z0-9]+$/);
  });
  it('says the code could not be loaded, and tries afresh on the next click', async () => {
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module: http://localhost:4175/assets/deckSendFiles-AbC123.js'); });
    await expect(loadWork(offline, offline as never)).rejects.toBeInstanceOf(LoadFailed);
    await expect(loadWork(offline, offline as never)).rejects.toBeInstanceOf(LoadFailed);
    expect(offline).toHaveBeenCalledTimes(4);          // each click: the file, then the file under a new address
    const noAddress = vi.fn(async () => { throw new TypeError('Importing a module script failed.'); });
    await expect(loadWork(noAddress, async () => fake)).rejects.toBeInstanceOf(LoadFailed);   // a browser that names no file: nothing to ask for again
    const back = vi.fn(async () => fake);
    expect(await loadWork(back)).toBe(fake);            // online again: the failure was not remembered
  });
});
