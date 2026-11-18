import { describe, it, expect } from 'vitest';
import { FROM_BUDGET, readFontFiles, readRecipients, readSlides, suggestEnding, validRecipients, FONT_MAX_BYTES, FONT_WARN_BYTES, dataUrlBytes, familyFromFileName, fileSize, fontMime, setFontFile, LAYOUTS, addCard, addSlide, deleteSlide, duplicateSlide, highlightChoices, layoutName, linkEndingProblem, linkProblemText, moveItem, moveSlide, moveSlideTo, neighbourId, newRecipient, newSlide, nextItemId, patchSlide, renameRecipient, setSlideHidden, slideLabel, uniqueId } from './deckEdit';
import { PAPER_CHOICES, PAPERS, SHADES, SHADE_CHOICES, hasPaper } from './deckEdit';
import { MIX_ORDER, PAPER_SHADES, PAPER_STYLES } from '../deck-runtime/paper';
import { deckData } from './deckData';
import { applyDeal } from './deal';
import { sampleProject } from '../data/seed';
import { withPitch } from './pitch';
import type { FontFile, Recipient, SlideSpec } from './types';

// Invented slides only.
const deck = (): SlideSpec[] => [
  { id: 'cover', layout: 'cover' },
  { id: 'why', layout: 'text', headline: 'Why this film', body: 'An invented paragraph.' },
  { id: 'ways', layout: 'ways', eyebrow: 'Ways to take part', cards: [{ id: 'invest', title: 'Invest', body: 'Invented terms.' }, { id: 'give', title: 'Give', body: 'An invented gift.' }] },
  { id: 'ask', layout: 'ask' },
];
const ids = (s: SlideSpec[]) => s.map(x => x.id);

describe('the layouts', () => {
  it('are the thirteen the deck draws, each with a name and a line about it', () => {
    expect(LAYOUTS.map(l => l.id).sort()).toEqual(['ask', 'cards', 'closing', 'comps', 'cover', 'model', 'numbers', 'photo', 'stats', 'team', 'text', 'timeline', 'ways']);
    for (const l of LAYOUTS) { expect(l.name.length).toBeGreaterThan(2); expect(l.about.length).toBeGreaterThan(20); expect(l.about).not.toMatch(/slug/i); }
    expect(layoutName('stats')).toBe('Proof (numbers and a quote)');
    expect(LAYOUTS.map(l => l.name)).toEqual(['Cover', 'Picture and a line', 'Words', 'Cards', 'Proof (numbers and a quote)', 'Comparable films', 'Team', 'Plan', 'How the money flows', 'Ways to take part', 'The money', 'The ask', 'Closing']);
    expect(LAYOUTS.find(l => l.id === 'timeline')!.about).not.toMatch(/timeline/i);
    for (const l of LAYOUTS) expect(`${l.name} ${l.about}`, l.id).not.toMatch(/on a line|pinned|hung|clip|\bpeg/i);
    expect([...FROM_BUDGET].sort()).toEqual(['model', 'numbers', 'timeline']);
    expect(layoutName('nope')).toBe('Unknown layout');
  });
  it('every new slide of every layout is one the deck can draw', () => {
    const base = withPitch(applyDeal(sampleProject()));
    for (const l of LAYOUTS) {
      const { slides } = addSlide([], l.id);
      const data = deckData({ ...base, pitch: { ...base.pitch!, slides } });
      expect(data.slides.map(s => s.layout)).toEqual([l.id]);
    }
  });
});

describe('papers, as the editor offers them', () => {
  it('a slide chooses the deck\'s own, one of the five, or a mix: in plain names', () => {
    expect(PAPER_CHOICES.map(c => c.name)).toEqual(['Deck default', 'Plain', 'Postcard', 'Letter', 'Notebook', 'Torn page', 'A mix']);
    expect(PAPER_CHOICES.map(c => c.id)).toEqual(['', ...PAPER_STYLES, 'mixed']);
    expect(PAPERS.map(p => p.id)).toEqual([...PAPER_STYLES]);
    for (const p of PAPERS) { expect(p.about.length).toBeGreaterThan(15); expect(`${p.name} ${p.about}`).not.toMatch(/on a line|pinned|hung|clip|\bpeg/i); }
    for (const m of MIX_ORDER) expect(PAPERS.some(p => p.id === m)).toBe(true);
  });
  it('is offered on the slides that draw a card', () => {
    expect(LAYOUTS.map(l => l.id).filter(hasPaper).sort()).toEqual(['cards', 'cover', 'stats', 'team', 'ways']);
    expect(hasPaper('hologram')).toBe(false);
  });
  it('a slide keeps its paper through reading, copying and patching, and loses a word that is not on the list', () => {
    const raw = [{ id: 'a', layout: 'cards', paper: 'mixed', cards: [{ id: 'c', title: 'T', body: '' }] }, { id: 'b', layout: 'cover', paper: 'postcard' }, { id: 'c', layout: 'cards', paper: 'glitter' }, { id: 'd', layout: 'team', paper: 7 }];
    expect(readSlides(raw).map(s => s.paper)).toEqual(['mixed', 'postcard', undefined, undefined]);
    expect('paper' in readSlides(raw)[2]).toBe(false);
    const copied = duplicateSlide(readSlides(raw), 'a');
    expect(copied.slides.find(s => s.id === copied.id)!.paper).toBe('mixed');
    expect(patchSlide(readSlides(raw), 'a', { paper: 'torn' })[0].paper).toBe('torn');
    expect('paper' in patchSlide(readSlides(raw), 'a', { paper: undefined })[0]).toBe(false);   // back to the deck's default: the key is gone
  });
});

describe('shades, as the editor offers them', () => {
  it('a deck chooses its design\'s own card colour or one of five papers of a fixed tone; a slide can also follow the deck', () => {
    expect(SHADES.map(s => s.id)).toEqual([...PAPER_SHADES]);
    expect(SHADES.map(s => s.name)).toEqual(['From my design', 'White', 'Cream', 'Aged', 'Kraft', 'Newsprint']);
    for (const s of SHADES) expect(s.about.length).toBeGreaterThan(15);
    expect(SHADE_CHOICES.map(c => c.id)).toEqual(['', ...PAPER_SHADES]);
    expect(SHADE_CHOICES[0].name).toBe('Deck default');
    expect(new Set(SHADE_CHOICES.map(c => c.name)).size).toBe(SHADE_CHOICES.length);
  });
  it('a slide keeps its shade through reading, copying and patching, and loses a word that is not on the list', () => {
    const raw = [{ id: 'a', layout: 'cards', paperShade: 'aged', cards: [{ id: 'c', title: 'T', body: '' }] }, { id: 'b', layout: 'cover', paperShade: 'theme' }, { id: 'c', layout: 'cards', paperShade: 'sepia' }, { id: 'd', layout: 'team', paperShade: 7 }];
    expect(readSlides(raw).map(s => s.paperShade)).toEqual(['aged', 'theme', undefined, undefined]);
    expect('paperShade' in readSlides(raw)[2]).toBe(false);
    const copied = duplicateSlide(readSlides(raw), 'a');
    expect(copied.slides.find(s => s.id === copied.id)!.paperShade).toBe('aged');
    expect(patchSlide(readSlides(raw), 'a', { paperShade: 'kraft' })[0].paperShade).toBe('kraft');
    expect('paperShade' in patchSlide(readSlides(raw), 'a', { paperShade: undefined })[0]).toBe(false);   // back to the deck's: the key is gone
  });
});

describe('uniqueId', () => {
  it('takes the first free name', () => {
    expect(uniqueId('text', [])).toBe('text');
    expect(uniqueId('text', ['text'])).toBe('text-2');
    expect(uniqueId('text', ['text', 'text-2', 'text-4'])).toBe('text-3');
    expect(uniqueId('', ['id'])).toBe('id-2');
  });
});

describe('the slide list', () => {
  it('adds a slide with an id nobody has, after the chosen slide or at the end', () => {
    const a = addSlide(deck(), 'text', 'why');
    expect(ids(a.slides)).toEqual(['cover', 'why', 'text', 'ways', 'ask']);
    expect(a.id).toBe('text');
    const b = addSlide(a.slides, 'text');
    expect(b.id).toBe('text-2');
    expect(ids(b.slides).slice(-1)).toEqual(['text-2']);
    expect(addSlide(a.slides, 'cover').id).toBe('cover-2');
    expect(addSlide(undefined, 'ask').slides).toEqual([{ id: 'ask', layout: 'ask' }]);
    expect(addSlide(deck(), 'photo', 'no-such-slide').slides.slice(-1)[0].id).toBe('photo');
  });
  it('a new cards slide starts with one card whose id is free across the deck', () => {
    expect(newSlide('cards', deck()).cards).toEqual([{ id: 'card', title: '', body: '' }]);
    const two = addSlide(addSlide(deck(), 'cards').slides, 'ways').slides;
    expect(two.flatMap(s => (s.cards ?? []).map(c => c.id))).toEqual(['invest', 'give', 'card', 'card-2']);
    expect(newSlide('text').cards).toBeUndefined();
  });
  it('moves a slide one place, and stops at the ends', () => {
    const s = deck();
    expect(ids(moveSlide(s, 'why', 1))).toEqual(['cover', 'ways', 'why', 'ask']);
    expect(ids(moveSlide(s, 'why', -1))).toEqual(['why', 'cover', 'ways', 'ask']);
    expect(moveSlide(s, 'cover', -1)).toBe(s);   // nothing moved: the same list
    expect(moveSlide(s, 'ask', 1)).toBe(s);
    expect(moveSlide(s, 'nobody', 1)).toBe(s);
    expect(ids(s)).toEqual(['cover', 'why', 'ways', 'ask']);   // the list given is never changed
  });
  it('drops a dragged slide where it was let go', () => {
    const s = deck();
    expect(ids(moveSlideTo(s, 'ask', 0))).toEqual(['ask', 'cover', 'why', 'ways']);
    expect(ids(moveSlideTo(s, 'cover', 2))).toEqual(['why', 'ways', 'cover', 'ask']);
    expect(ids(moveSlideTo(s, 'cover', 99))).toEqual(['why', 'ways', 'ask', 'cover']);
    expect(ids(moveSlideTo(s, 'ask', -3))).toEqual(['ask', 'cover', 'why', 'ways']);
    expect(moveSlideTo(s, 'why', 1)).toBe(s);
    expect(moveSlideTo(undefined, 'why', 1)).toEqual([]);
  });
  it('copies a slide to the place after it, with ids of its own for the slide and its cards', () => {
    const s = deck();
    const { slides, id } = duplicateSlide(s, 'ways');
    expect(ids(slides)).toEqual(['cover', 'why', 'ways', 'ways-2', 'ask']);
    expect(id).toBe('ways-2');
    expect(slides[3].cards!.map(c => c.id)).toEqual(['invest-2', 'give-2']);
    expect(slides[3].cards!.map(c => c.title)).toEqual(['Invest', 'Give']);
    slides[3].cards![0].title = 'Changed';
    expect(s[2].cards![0].title).toBe('Invest');   // a deep copy: the original is untouched
    expect(duplicateSlide(slides, 'ways').id).toBe('ways-3');
    expect(duplicateSlide(s, 'nobody')).toEqual({ slides: s, id: null });
  });
  it('hides and shows a slide; a hidden slide stays in the list and is left off the deck', () => {
    const hidden = setSlideHidden(deck(), 'why', true);
    expect(hidden[1].hidden).toBe(true);
    const base = withPitch(applyDeal(sampleProject()));
    expect(deckData({ ...base, pitch: { ...base.pitch!, slides: hidden } }).slides.map(x => x.id)).toEqual(['cover', 'ways', 'ask']);
    const shown = setSlideHidden(hidden, 'why', false);
    expect('hidden' in shown[1]).toBe(false);
    expect(shown).toEqual(deck());
  });
  it('never deletes the last slide: a deck with none would silently become the automatic draft', () => {
    const one: SlideSpec[] = [{ id: 'cover', layout: 'cover' }];
    expect(deleteSlide(one, 'cover')).toBe(one);
    expect(ids(deleteSlide(deck().slice(0, 2), 'why'))).toEqual(['cover']);
    expect(deleteSlide(deck(), 'nobody')).toEqual(deck());
  });
  it('a copy of a copy keeps a short id', () => {
    const a = duplicateSlide(deck(), 'ways'); const b = duplicateSlide(a.slides, 'ways-2'); const c = duplicateSlide(b.slides, 'ways-3');
    expect([a.id, b.id, c.id]).toEqual(['ways-2', 'ways-3', 'ways-4']);
    expect(c.slides.find(x => x.id === 'ways-4')!.cards!.map(x => x.id)).toEqual(['invest-4', 'give-4']);
    expect(new Set(c.slides.flatMap(x => (x.cards ?? []).map(y => y.id))).size).toBe(8);
  });
  it('never stores hidden: false', () => {
    const hidden = patchSlide(deck(), 'why', { hidden: true });
    expect(hidden[1].hidden).toBe(true);
    expect('hidden' in patchSlide(hidden, 'why', { hidden: false })[1]).toBe(false);
    expect('hidden' in patchSlide(deck(), 'why', { hidden: false, headline: 'x' })[1]).toBe(false);
    expect('hidden' in patchSlide([{ id: 'a', layout: 'text', hidden: false } as SlideSpec], 'a', { headline: 'x' })[0]).toBe(false);
  });
  it('deletes a slide and says which one to select next', () => {
    const s = deck();
    expect(ids(deleteSlide(s, 'why'))).toEqual(['cover', 'ways', 'ask']);
    expect(deleteSlide(undefined, 'x')).toEqual([]);
    expect(neighbourId(s, 'why')).toBe('ways');
    expect(neighbourId(s, 'ask')).toBe('ways');
    expect(neighbourId([s[0]], 'cover')).toBeNull();
    expect(neighbourId(s, 'nobody')).toBe('cover');
  });
  it('changes a slide and drops what was emptied, never its id or layout', () => {
    const s = patchSlide(deck(), 'why', { headline: 'A new headline', body: '', punch: 'And a punch' });
    expect(s[1]).toEqual({ id: 'why', layout: 'text', headline: 'A new headline', punch: 'And a punch' });
    const t = patchSlide(s, 'why', { id: 'hijack', layout: 'ask', punch: undefined, cards: [] } as Partial<SlideSpec>);
    expect(t[1]).toEqual({ id: 'why', layout: 'text', headline: 'A new headline' });
    expect(patchSlide(deck(), 'nobody', { headline: 'x' })).toEqual(deck());
    expect(patchSlide(deck(), 'cover', { scrim: 0 })[0].scrim).toBe(0);   // zero is a value, not an empty field
  });
  it('labels a slide by its headline, else its eyebrow', () => {
    expect(slideLabel({ id: 'a', layout: 'text', headline: ' Head ', eyebrow: 'Brow' })).toBe('Head');
    expect(slideLabel({ id: 'a', layout: 'text', eyebrow: 'Brow' })).toBe('Brow');
    expect(slideLabel({ id: 'a', layout: 'cover' })).toBe('');
  });
});

describe('a slide\'s own lists', () => {
  it('moves an item one place', () => {
    const xs = ['a', 'b', 'c'];
    expect(moveItem(xs, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(xs, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(xs, 0, -1)).toBe(xs);
    expect(moveItem(xs, 2, 1)).toBe(xs);
    expect(moveItem(xs, 7, -1)).toBe(xs);
  });
  it('adds cards up to four, each with an id free across the deck', () => {
    let s = deck();
    s = addCard(s, 'ways'); s = addCard(s, 'ways');
    expect(s[2].cards!.map(c => c.id)).toEqual(['invest', 'give', 'card', 'card-2']);
    expect(addCard(s, 'ways')).toEqual(s);   // four is the most a slide holds
    expect(addCard(deck(), 'why')[1].cards).toEqual([{ id: 'card', title: '', body: '' }]);
  });
  it('names the next stat or milestone', () => {
    expect(nextItemId('stat', undefined)).toBe('stat');
    expect(nextItemId('stat', [{ id: 'stat' }, { id: 'stat-2' }])).toBe('stat-3');
  });
});

describe('recipients', () => {
  it('says what is wrong with a link ending, read the way the deck reads it', () => {
    expect(linkEndingProblem('', [])).toBe('empty');
    expect(linkEndingProblem('  !!  ', [])).toBe('empty');
    expect(linkEndingProblem('ada-example', [])).toBe('');
    expect(linkEndingProblem('Ada Example', ['ben-sample'])).toBe('');
    expect(linkEndingProblem('Ada Example', ['ada-example'])).toBe('taken');
    expect(linkEndingProblem('ada-example', ['ADA  EXAMPLE'])).toBe('taken');
    for (const r of ['with', 'without', 'with-grants', 'without-grants', 'WITHOUT', 'ada-without', 'ada-with']) expect(linkEndingProblem(r, [])).toBe('reserved');
    expect(linkEndingProblem('withers', [])).toBe('');
  });
  it('puts each problem in plain words, and never says slug', () => {
    expect(linkProblemText('', 'ada')).toBe('');
    for (const p of ['empty', 'taken', 'reserved'] as const) { const t = linkProblemText(p, 'Ada Without'); expect(t.length).toBeGreaterThan(20); expect(t).not.toMatch(/slug/i); }
    expect(linkProblemText('reserved', 'Ada Without')).toBe('This ending is reserved. Try another, such as ada-without-film.');
    expect(linkEndingProblem('ada-without-film', [])).toBe('');   // and the suggestion is one that works
    expect(linkProblemText('taken', 'Ada Example')).toContain('"ada-example"');
  });
  it('makes a new recipient with an id nobody has', () => {
    const a = newRecipient(undefined);
    expect(a).toEqual({ id: 'to', slug: '', name: '', coverLine: '', lead: 'with-grants' });
    expect(newRecipient([a]).id).toBe('to-2');
    expect(newRecipient([a, { ...a, id: 'to-2' }]).id).toBe('to-3');
  });
  it('suggests a short ending from a long name, and never a reserved one', () => {
    expect(suggestEnding('Placeholder Capital Partners Fund')).toBe('placeholder-capital');
    expect(suggestEnding('Ada')).toBe('ada');
    expect(suggestEnding('  Ada   Example  ')).toBe('ada-example');
    expect(suggestEnding('Fund Without')).toBe('fund-without-film');
    expect(linkEndingProblem(suggestEnding('Fund Without'), [])).toBe('');
    expect(suggestEnding('With')).toBe('with-film');
    expect(suggestEnding('')).toBe('');
    expect(suggestEnding(null as never)).toBe('');
    let r = newRecipient([]);
    for (const name of ['P', 'Placeholder', 'Placeholder Capital', 'Placeholder Capital Partners']) r = renameRecipient(r, name);
    expect(r.slug).toBe('placeholder-capital');   // followed the name all the way, two words at most
  });
  it('says who gets a deck, the way the deck decides it', () => {
    const all = [{ id: 'a', name: ' Ada Example ', slug: 'Ada Example', coverLine: '', lead: 'without-grants' }, { id: 'b', name: 'Twin', slug: 'ada-example' }, { id: 'c', name: 'Res', slug: 'without' }, { id: 'd', name: 'None', slug: '' }, null, { id: 'e', name: 'Ben', slug: 'ben' }];
    expect(validRecipients(all)).toEqual([{ id: 'a', at: 0, slug: 'ada-example', name: 'Ada Example', lead: 'without-grants' }, { id: 'e', at: 4, slug: 'ben', name: 'Ben', lead: 'with-grants' }]);
    expect(validRecipients(undefined)).toEqual([]);
  });
  it('suggests the link ending from the name until one is typed', () => {
    const r: Recipient = newRecipient([]);
    const a = renameRecipient(r, 'Ada');
    expect(a.slug).toBe('ada');
    const b = renameRecipient(a, 'Ada Example');
    expect(b.slug).toBe('ada-example');                    // still following the name
    const typed = { ...b, slug: 'ada' };
    expect(renameRecipient(typed, 'Ada Q. Example').slug).toBe('ada');   // their own ending stays
    expect(renameRecipient({ ...typed, slug: ' ' }, 'Ben Sample').slug).toBe('ben-sample');
  });
  it('lists the cards a recipient can have picked out: cards and ways slides that are on the deck', () => {
    const s: SlideSpec[] = [...deck(),
      { id: 'gap', layout: 'cards', headline: 'The gap', cards: [{ id: 'g1', title: 'First finding', body: 'x' }, { id: 'g2', title: '', body: 'Body only' }, { id: 'g3', title: '', body: '' }] },
      { id: 'off', layout: 'cards', hidden: true, cards: [{ id: 'h1', title: 'Hidden', body: 'x' }] },
      { id: 'dup', layout: 'ways', cards: [{ id: 'invest', title: 'Invest again', body: 'x' }] }];
    expect(highlightChoices(s)).toEqual([
      { id: 'invest', label: 'Invest (Ways to take part)' }, { id: 'give', label: 'Give (Ways to take part)' },
      { id: 'g1', label: 'First finding (The gap)' }, { id: 'g2', label: 'Untitled card (The gap)' },
    ]);
    expect(highlightChoices([{ id: 'c', layout: 'cards', cards: [{ id: 'x', title: 'T', body: '' }] }])[0].label).toBe('T (Cards)');
  });
});

describe('font files', () => {
  const bytes = (s: string) => [...s].map(c => c.charCodeAt(0));
  it('knows a font by how the file starts, whatever it is called', () => {
    expect(fontMime(bytes('wOF2....'))).toBe('font/woff2');
    expect(fontMime(bytes('wOFF....'))).toBe('font/woff');
    expect(fontMime(bytes('OTTO....'))).toBe('font/otf');
    expect(fontMime([0, 1, 0, 0, 0, 12])).toBe('font/ttf');
    expect(fontMime(bytes('true'))).toBe('font/ttf');
    expect(fontMime(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toBe('font/woff2');
    for (const not of ['<svg', '%PDF', 'GIF8', 'PK\u0003\u0004', '<htm']) expect(fontMime(bytes(not))).toBeNull();
    expect(fontMime([])).toBeNull();
    expect(fontMime([0x77, 0x4f])).toBeNull();
    expect(fontMime(null as never)).toBeNull();
  });
  it('suggests a family name from the file name', () => {
    expect(familyFromFileName('Invented_Slab-Bold.woff2')).toBe('Invented Slab');
    expect(familyFromFileName('special-elite-latin-400-normal.woff2')).toBe('Special Elite');
    expect(familyFromFileName('work-sans-latin-ext-600-italic.woff')).toBe('Work Sans');
    expect(familyFromFileName('InventedGrotesk-VariableFont_wght.ttf')).toBe('InventedGrotesk VariableFont');
    expect(familyFromFileName('made.up.face.ttf')).toBe('Made Up Face');
    expect(familyFromFileName('bold.otf')).toBe('Bold');            // a name that is only a weight word is still a name
    expect(familyFromFileName('"; } evil {.otf')).toBe('Evil');
    expect(familyFromFileName(null as never)).toBe('My font');
    expect(familyFromFileName('.woff2')).toBe('My font');
    expect(familyFromFileName('')).toBe('My font');
  });
  it('says a size the way a person would, and counts the bytes in a data URL', () => {
    expect(fileSize(412_300)).toBe('412 KB');
    expect(fileSize(2_140_000)).toBe('2.1 MB');
    expect(fileSize(12)).toBe('1 KB');
    expect(dataUrlBytes('data:font/woff2;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:font/woff2;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:font/woff2;base64,AA==')).toBe(1);
    expect(dataUrlBytes('nonsense')).toBe(0);
    expect(FONT_WARN_BYTES).toBe(1_500_000);
    expect(FONT_MAX_BYTES).toBeGreaterThan(FONT_WARN_BYTES);
  });
  it('keeps one file a role: a new one takes the old one\'s place, title first', () => {
    const f = (id: string, role: 'title' | 'body') => ({ id, role, family: id, dataUrl: 'data:font/woff2;base64,AAAA', embedOk: false });
    expect(setFontFile(undefined, f('a', 'body')).map(x => x.id)).toEqual(['a']);
    const two = setFontFile([f('a', 'body')], f('b', 'title'));
    expect(two.map(x => x.id)).toEqual(['b', 'a']);
    expect(setFontFile(two, f('c', 'body')).map(x => x.id)).toEqual(['b', 'c']);
    expect(setFontFile(two, f('d', 'title')).map(x => x.id)).toEqual(['d', 'a']);
  });
});

describe('a project file with anything in it', () => {
  const junk: unknown[] = [null, undefined, 7, 'text', [], {}, { id: '' }, { id: 5 }, { layout: 'text' }];
  it('readSlides keeps what it can show, the right shape, untrimmed', () => {
    const raw = [...junk, { id: 'a', layout: 'text', headline: ' typing ', body: 7, cards: 'no', stats: [null, { value: 4 }, { id: 'x', value: '1', label: 'l', source: ' s ' }, { id: 'x' }], hidden: 'yes', scrim: 9,
      columns: [null, { label: 3, lines: ['a', 5, null] }], lead: 'no', quote: { text: 'q' }, aside: { title: 't', lines: 'no' } },
      { id: 'b', layout: 'hologram' }, { id: 'a', layout: 'cover' }, { id: 'c', layout: 'cards', cards: [null, { title: 'One' }, { id: 'k', title: 'Two' }, { id: 'k', title: 'Three' }], hidden: true }];
    const read = readSlides(raw);
    expect(read.map(s => s.id)).toEqual(['a', 'c']);   // junk, an unknown layout and a second slide with the same id are left out
    expect(read[0]).toEqual({ id: 'a', layout: 'text', headline: ' typing ', body: '7', scrim: 1,
      stats: [{ id: 'stat', value: '4', label: '', source: '' }, { id: 'x', value: '1', label: 'l', source: ' s ' }, { id: 'stat-2', value: '', label: '', source: '' }],
      columns: [{ label: '3', lines: ['a', '5', ''] }], quote: { text: 'q', by: '' }, aside: { title: 't', lines: [] } });
    expect(read[1].cards!.map(c => c.id)).toEqual(['card', 'k', 'card-2']);
    expect(read[1].hidden).toBe(true);
    for (const v of [null, undefined, 'x', 4, {}]) expect(readSlides(v)).toEqual([]);
  });
  it('every slide-list function takes it without throwing, and leaves a slide of a layout it does not know where it is', () => {
    const raw = [...junk, { id: 'a', layout: 'text', cards: [null, 'x'] }, { id: 'future', layout: 'hologram', beam: true }, { id: 'c', layout: 'cards', cards: [null, { id: 'k', title: 'K' }] }] as never;
    const ids = (x: SlideSpec[]) => x.map(s => s.id);
    expect(ids(addSlide(raw, 'ways', 'a').slides)).toEqual(['a', 'ways', 'future', 'c']);
    expect(addSlide(raw, 'cards').slides.slice(-1)[0].cards).toEqual([{ id: 'card', title: '', body: '' }]);
    expect(ids(moveSlide(raw, 'c', -1))).toEqual(['a', 'c', 'future']);
    expect(ids(moveSlideTo(raw, 'a', 2))).toEqual(['future', 'c', 'a']);
    expect(duplicateSlide(raw, 'c').slides.find(s => s.id === 'c-2')!.cards).toEqual([{ id: 'k-2', title: 'K' }]);
    expect(ids(setSlideHidden(raw, 'a', true))).toEqual(['a', 'future', 'c']);
    expect(ids(deleteSlide(raw, 'a'))).toEqual(['future', 'c']);
    expect(deleteSlide(raw, 'a').find(s => s.id === 'future')).toEqual({ id: 'future', layout: 'hologram', beam: true });
    expect(neighbourId(raw, 'a')).toBe('future');
    expect(patchSlide(raw, 'a', { headline: 'H' })[0].headline).toBe('H');
    expect(addCard(raw, 'c').find(s => s.id === 'c')!.cards).toEqual([{ id: 'k', title: 'K' }, { id: 'card', title: '', body: '' }]);
    expect(highlightChoices(raw)).toEqual([{ id: 'k', label: 'K (Cards)' }]);
    for (const v of [null, undefined, 'x', 4, {}] as never[]) {
      expect(addSlide(v, 'text').slides).toHaveLength(1);
      expect(moveSlide(v, 'a', 1)).toEqual([]); expect(moveSlideTo(v, 'a', 1)).toEqual([]); expect(duplicateSlide(v, 'a').id).toBeNull();
      expect(setSlideHidden(v, 'a', true)).toEqual([]); expect(deleteSlide(v, 'a')).toEqual([]); expect(neighbourId(v, 'a')).toBeNull();
      expect(patchSlide(v, 'a', {})).toEqual([]); expect(addCard(v, 'a')).toEqual([]); expect(highlightChoices(v)).toEqual([]);
      expect(moveItem(v, 0, 1)).toEqual([]); expect(nextItemId('stat', v)).toBe('stat');
    }
    expect(nextItemId('stat', [null, { id: 'stat' }, {}] as never)).toBe('stat-2');
    expect(slideLabel(null as never)).toBe('');
  });
  it('recipients: entries with no id get one, nonsense is left out, and nothing throws', () => {
    const raw = [null, 4, 'x', { name: 'No id', slug: 'no-id' }, { id: 'to', name: 9, slug: null, lead: 'sideways', note: 3 }, { id: 'to', name: 'Twin id' }];
    expect(readRecipients(raw)).toEqual([
      { id: 'to', slug: 'no-id', name: 'No id', coverLine: '', lead: 'with-grants' },
      { id: 'to-2', slug: '', name: '9', coverLine: '', lead: 'with-grants', note: '3' },
      { id: 'to-3', slug: '', name: 'Twin id', coverLine: '', lead: 'with-grants' }]);
    expect(newRecipient(raw as never).id).toBe('to-2');
    expect(renameRecipient({ id: 'r', name: null, slug: undefined } as never, 'Ada').slug).toBe('ada');
    expect(linkEndingProblem(null as never, null as never)).toBe('empty');
    expect(linkEndingProblem('ada', [null, 5, 'ada'] as never)).toBe('taken');
    for (const v of [null, undefined, 'x', 4, {}]) { expect(readRecipients(v)).toEqual([]); expect(validRecipients(v)).toEqual([]); }
  });
  it('font files: only real entries, one a role', () => {
    const ok: FontFile = { id: 'f', role: 'body', family: 'Ok', dataUrl: 'data:font/woff2;base64,AAAA', embedOk: true };
    expect(readFontFiles([null, 'x', 3, { role: 'title' }, { id: 'g', role: 'caption' }, ok, { ...ok, id: 'second-body' }, { id: 'h', role: 'title', family: 5, dataUrl: null, embedOk: 'yes' }]))
      .toEqual([ok, { id: 'h', role: 'title', family: '5', dataUrl: '', embedOk: false }]);
    expect(setFontFile([null, 'x', ok] as never, { ...ok, id: 'new' }).map(f => f.id)).toEqual(['new']);
    expect(dataUrlBytes(null as never)).toBe(0);
    expect(dataUrlBytes(12 as never)).toBe(0);
    for (const v of [null, undefined, 'x', 4, {}]) expect(readFontFiles(v)).toEqual([]);
  });
});
