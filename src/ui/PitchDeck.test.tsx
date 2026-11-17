// @vitest-environment jsdom
// The Pitch tab's deck builder and design box drawn from project files with nonsense in them: nothing may throw, and
// if something does, the boundary shows a plain message instead of taking the page down.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { defaultDesign, withPitch } from '../engine/pitch';
import type { Project } from '../engine/types';
import PitchDeck from './PitchDeck';
import { CardColor, FontFiles, PaletteBuilder } from './DesignBuilder';
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
    expect([...el.querySelectorAll('.pd-row .pd-pick b')].map(b => b.textContent)).toEqual(['Proof (numbers and a quote)', 'Cards on a line', 'Words', 'Team', 'Plan']);
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
