import { describe, it, expect, vi, afterEach } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from './deal';
import { defaultIncentives } from './incentives';
import { defaultDeckRules, defaultDesign, withPitch } from './pitch';
import { pathInputs } from './paths';
import { pathFor } from './pathMath';
import { DARK_INK, DECK_LEGAL, DEFAULT_CARD, LIGHT_INK, cardInkFor, compactMoney, dateSpan, deckData, deckWarnings, defaultSlides, fontFacesOf, reservedSlug, firstSentence, slidesOf, slugify, unlabel, lookPictures, MAX_LOOKS } from './deckData';
import type { DeckSlide } from '../deck-runtime/data';
import type { FontFile, LookImage, Pitch, Project, Recipient, SlideSpec } from './types';

// Only the invented sample film and variants of it; every name and figure below is made up.
const seed = applyDeal(sampleProject());
const pitched = (p: Project, over: Partial<Pitch>): Project => { const q = withPitch(p); return { ...q, pitch: { ...q.pitch!, ...over } }; };
const pic = (id: string, caption = ''): LookImage => ({ id, dataUrl: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" id="${id}"/>`, caption, section: 'tone' });
const grants = (p: Project, amount = 200_000, feePct = 8): Project => ({ ...p, waterfall: { ...p.waterfall, nonRecoupable: amount, sponsorFeePct: feePct } });

/** The sample with every Pitch-tab field filled, so every default slide has something to say. */
const full = (): Project => {
  const d = defaultDesign();
  return grants(pitched(seed, {
    logline: 'A land surveyor finds a town the maps left out. Nobody there wants to be found.',
    why: 'I grew up at the edge of a dry lake. This is the film I could not find.',
    audience: { primary: 'Primary: people who drive out to see the desert', secondary: 'Secondary: readers of slow thrillers', notes: 'Regional screenings first.' },
    sections: [{ id: 's1', heading: 'The story', body: 'She arrives with a tripod.' }, { id: 's2', heading: '', body: '' }, { id: 's3', heading: 'The path to market', body: 'Festivals, then a small release.' }],
    comps: [
      { id: 'c1', title: 'Invented Film One', year: '2019', distributor: 'Nobody Pictures', budget: 1_000_000, domestic: null, worldwide: 4_000_000, note: '', source: '', group: 'Festival path' },
      { id: 'c2', title: 'Invented Film Two', year: '2021', distributor: 'Nobody Pictures', budget: 500_000, domestic: null, worldwide: 6_000_000, note: '', source: '' },
      { id: 'c3', title: 'Invented Film Three', year: '2022', distributor: '', budget: null, domestic: null, worldwide: 9_000_000, note: '', source: '' },
    ],
    revenue: [{ id: 'r', source: 'all', low: 400_000, mid: 2_000_000, high: 6_000_000 }],
    research: [
      { id: 'm1', kind: 'market', title: 'A made-up finding', body: 'Desert films are rare. A second sentence that stays off the card.', url: 'https://example.com/a' },
      { id: 'a1', kind: 'audience', title: 'Not a market item', body: 'Left off the gap slide.' },
      { id: 'm2', kind: 'market', title: 'Another', body: 'One sentence only' },
    ],
    team: [{ id: 't1', name: 'Ada Example', role: 'Director', bio: 'Invented.' }, { id: 't2', name: '  ', role: 'Nobody', bio: '' }],
    ask: 'We are raising {investors}.',
    lookbook: [pic('cover-pic', 'The flat at dawn'), pic('end-pic'), pic('spare-pic')],
    design: { ...d, deck: { ...defaultDeckRules(), coverImageId: 'cover-pic', closingImageId: 'end-pic', signoff: 'from the flat' } },
  }));
};
const byLayout = <L extends DeckSlide['layout']>(p: Project, layout: L) => deckData(p).slides.find(s => s.layout === layout) as Extract<DeckSlide, { layout: L }>;

afterEach(() => { vi.useRealTimers(); });

describe('slugify and the small formatters', () => {
  it('keeps lower-case letters, digits and single hyphens only', () => {
    expect(slugify('Ada Example')).toBe('ada-example');
    expect(slugify('  Zoë  O’Example -- 3rd!! ')).toBe('zoe-o-example-3rd');
    expect(slugify('---')).toBe('');
    for (const s of ['Ada Example', 'A__B', 'x..y', 'ÉCOLE 42']) expect(slugify(s)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it('takes the first sentence, not the first full stop inside a number', () => {
    expect(firstSentence('Desert films are rare. A second one.')).toBe('Desert films are rare.');
    expect(firstSentence('It grew 3.5 times in a year. Then stopped.')).toBe('It grew 3.5 times in a year.');
    expect(firstSentence('No stop at all')).toBe('No stop at all');
    expect(firstSentence('')).toBe('');
  });
  it('writes money compactly and date spans without a locale', () => {
    expect(compactMoney(1_234_000)).toBe('$1.2M');
    expect(compactMoney(850_400)).toBe('$850K');
    expect(compactMoney(999_700)).toBe('$1M');
    expect(compactMoney(900)).toBe('$900');
    expect(dateSpan('2031-03-08', '2031-04-02')).toBe('Mar 8 to Apr 2, 2031');
    expect(dateSpan('2031-12-29', '2032-01-09')).toBe('Dec 29, 2031 to Jan 9, 2032');
    expect(dateSpan('2031-03-08', '2031-03-08')).toBe('Mar 8, 2031');
  });
});

describe('defaultSlides', () => {
  it('lays out every slide in the fixed order when the pitch is full', () => {
    expect(defaultSlides(full()).map(s => s.id)).toEqual(['cover', 'logline', 'why', 'gap', 'opportunity', 'audience', 'sec:s1', 'sec:s3', 'team', 'plan', 'model', 'ways', 'numbers', 'ask', 'closing']);
    expect(defaultSlides(full()).map(s => s.layout)).toEqual(['cover', 'photo', 'text', 'cards', 'comps', 'stats', 'text', 'text', 'team', 'timeline', 'model', 'ways', 'numbers', 'ask', 'closing']);
  });
  it('skips what has nothing to say', () => {
    // the bare sample: a budget, a board and people, but no pitch
    expect(defaultSlides(seed).map(s => s.id)).toEqual(['cover', 'plan', 'model', 'ways', 'numbers', 'ask']);
    const empty: Project = { ...seed, lines: [], participants: [], board: { ...seed.board, scenes: [], strips: [], castList: [] } };
    expect(defaultSlides(empty).map(s => s.id)).toEqual(['cover', 'ways', 'ask']);
    expect(defaultSlides({ ...empty, pitch: undefined }).map(s => s.id)).toEqual(['cover', 'ways', 'ask']);
    // one rule at a time
    const ids = (over: Partial<Pitch>) => defaultSlides(pitched(full(), over)).map(s => s.id);
    expect(ids({ logline: '  ' })).not.toContain('logline');
    expect(ids({ why: '' })).not.toContain('why');
    expect(ids({ research: [{ id: 'a', kind: 'audience', title: 'x', body: 'y' }] })).not.toContain('gap');
    expect(ids({ comps: [] })).not.toContain('opportunity');
    expect(ids({ audience: { primary: '', secondary: '', notes: '' } })).not.toContain('audience');
    expect(ids({ team: [{ id: 't', name: '', role: 'Nobody', bio: '' }] })).not.toContain('team');
    expect(ids({ design: defaultDesign() })).not.toContain('closing');
    expect(defaultSlides({ ...full(), participants: [] }).map(s => s.id)).not.toContain('model');
    expect(defaultSlides({ ...full(), lines: [] }).map(s => s.id)).not.toContain('numbers');
  });
  it('gives the same slides, ids included, on every call', () => {
    expect(defaultSlides(full())).toEqual(defaultSlides(full()));
    const p = full();
    expect(JSON.stringify(defaultSlides(p))).toBe(JSON.stringify(defaultSlides(p)));
  });
  it('fills the slides from the Pitch tab', () => {
    const s = Object.fromEntries(defaultSlides(full()).map(x => [x.id, x]));
    expect(s.logline).toMatchObject({ eyebrow: 'Logline', body: 'A land surveyor finds a town the maps left out. Nobody there wants to be found.' });
    expect(s.why.eyebrow).toBe('Why this film, why me');
    expect(s.gap.cards).toEqual([
      { id: 'm1', title: 'A made-up finding', body: 'Desert films are rare.', footnote: 'https://example.com/a' },
      { id: 'm2', title: 'Another', body: 'One sentence only', footnote: '' },
    ]);
    expect(s.audience.body).toBe('people who drive out to see the desert\n\nreaders of slow thrillers');
    expect(s.audience.stats).toEqual([]);
    expect(s.audience.closing).toBe('Regional screenings first.');
    expect(s['sec:s1']).toMatchObject({ layout: 'text', headline: 'The story', body: 'She arrives with a tripod.' });
    expect(s.ask.body).toBe('We are raising {investors}.');
  });
  it('caps the gap slide at four cards', () => {
    const research = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, kind: 'market' as const, title: `Finding ${i}`, body: 'Body.' }));
    expect(defaultSlides(pitched(seed, { research })).find(s => s.id === 'gap')!.cards!.map(c => c.id)).toEqual(['m0', 'm1', 'm2', 'm3']);
  });
  it('puts pictures on the cover and the closing only', () => {
    const withPics = defaultSlides(full()).filter(s => s.imageId).map(s => [s.id, s.imageId]);
    expect(withPics).toEqual([['cover', 'cover-pic'], ['closing', 'end-pic']]);
  });
  it('offers Invest always and Give only when there are grants', () => {
    const ways = (p: Project) => defaultSlides(p).find(s => s.id === 'ways')!.cards!;
    expect(ways(seed).map(c => c.id)).toEqual(['invest']);
    expect(ways(grants(seed)).map(c => c.id)).toEqual(['invest', 'give']);
    expect(ways(grants(seed))[1].footnote).toContain('8%');
    expect(ways(grants(seed, 200_000, 0))[1].footnote).toBeUndefined();
    // the sample is off-the-gross: 40% of dollar one to the pool, 120% recoup, 50/50 after
    expect(ways(seed)[0].body).toBe('You take 60 cents of every dollar the film earns until you have 120% of your investment back, then 50% of everything after.');
    const rf: Project = { ...seed, waterfall: { ...seed.waterfall, model: 'recoup-first', recoupPct: 110, poolPct: 40 } };
    expect(ways(rf)[0].body).toBe('You recoup 110% of your investment first, then share 60% of everything after.');
  });
});

describe('slidesOf', () => {
  const own: SlideSpec[] = [{ id: 'z', layout: 'ask', body: 'Mine.' }, { id: 'a', layout: 'cover' }, { id: 'm', layout: 'text', headline: 'Second to last', body: 'Text.' }];
  it('uses the authored slides, in their order, when there are any', () => {
    const p = pitched(full(), { slides: own });
    expect(slidesOf(p)).toBe(own);
    expect(deckData(p).slides.map(s => s.id)).toEqual(['z', 'a', 'm']);
    expect(deckData(p).slides.map(s => s.layout)).toEqual(['ask', 'cover', 'text']);
  });
  it('falls back to the default when slides are absent or empty', () => {
    expect(slidesOf(pitched(full(), { slides: [] }))).toEqual(defaultSlides(full()));
    expect(slidesOf(full())).toEqual(defaultSlides(full()));
  });
});

describe('deckData', () => {
  it('drops hidden slides and unsourced numbers; deckWarnings names the numbers', () => {
    const slides: SlideSpec[] = [
      { id: 'cover', layout: 'cover' },
      { id: 'gone', layout: 'text', body: 'Hidden.', hidden: true },
      { id: 'aud', layout: 'stats', lead: { value: '7 in 10', text: 'invented people agree', source: ' ' },
        stats: [{ id: 'k1', value: '41%', label: 'made up', source: 'Invented Survey 2031' }, { id: 'k2', value: '9x', label: 'no source', source: '' }] },
      { id: 'aud2', layout: 'stats', lead: { value: '3', text: 'kept', source: 'Invented Almanac' }, stats: [], quote: { text: 'A made-up line.', by: 'Nobody' } },
      { id: 'hiddenStats', layout: 'stats', hidden: true, stats: [{ id: 'k3', value: '1', label: 'x', source: '' }] },
    ];
    const p = pitched(seed, { slides });
    const d = deckData(p);
    expect(d.slides.map(s => s.id)).toEqual(['cover', 'aud', 'aud2']);
    const aud = d.slides[1] as Extract<DeckSlide, { layout: 'stats' }>;
    expect(aud.stats).toEqual([{ id: 'k1', value: '41%', label: 'made up', source: 'Invented Survey 2031' }]);
    expect(aud.lead).toBeUndefined();
    const aud2 = d.slides[2] as Extract<DeckSlide, { layout: 'stats' }>;
    expect(aud2.lead).toEqual({ value: '3', text: 'kept', source: 'Invented Almanac' });
    expect(aud2.quote).toEqual({ text: 'A made-up line.', by: 'Nobody' });
    const w = deckWarnings(p);
    expect(w.map(x => x.slideId)).toEqual(['aud', 'aud']);   // the lead and one stat; nothing for the hidden slides
    expect(w[0].message).toContain('7 in 10');
    expect(w[1].message).toContain('9x');
  });

  it('warns about too many cards, a missing picture and bad link endings', () => {
    const card = (id: string) => ({ id, title: id, body: 'x' });
    const recipients: Recipient[] = [
      { id: 'r1', slug: 'ada', name: 'Ada Example', coverLine: 'For Ada.', lead: 'with-grants' },
      { id: 'r2', slug: ' ADA ', name: 'Another Ada', coverLine: '', lead: 'with-grants' },
      { id: 'r3', slug: '', name: 'No Slug', coverLine: '', lead: 'without-grants' },
    ];
    const p = pitched(seed, { lookbook: [pic('here')], recipients, slides: [
      { id: 'five', layout: 'cards', cards: ['a', 'b', 'c', 'd', 'e'].map(card) },
      { id: 'four', layout: 'ways', cards: ['a', 'b', 'c', 'd'].map(card) },
      { id: 'lost', layout: 'photo', body: 'x', imageId: 'nowhere' },
      { id: 'found', layout: 'photo', body: 'x', imageId: 'here' },
    ] });
    expect(deckWarnings(p).map(x => x.slideId)).toEqual(['five', 'lost', 'recipient:r2', 'recipient:r3']);
    expect(deckWarnings(full())).toEqual([]);
    expect(deckWarnings(seed).map(w => w.message)).toEqual([expect.stringMatching(/^No receipts are typed yet.*under What it could make\.$/)]);   // the seed project has no receipts typed
    // a picture that is gone is taken off the slide, never left as a dangling id
    const d = deckData(p);
    expect(d.slides.find(s => s.id === 'lost')!.imageId).toBeUndefined();
    expect(d.slides.find(s => s.id === 'found')!.imageId).toBe('here');
    expect((d.slides[0] as Extract<DeckSlide, { layout: 'cards' }>).cards).toHaveLength(5);   // warned about, not cut
  });

  it('carries only the pictures a visible slide uses', () => {
    const d = deckData(full());
    expect(d.images.map(i => i.id)).toEqual(['cover-pic', 'end-pic']);
    expect(d.images[0]).toEqual({ id: 'cover-pic', src: pic('cover-pic').dataUrl, alt: 'The flat at dawn' });
    expect(d.images[1].alt).toBe('Look book picture');
    const hidden = pitched(full(), { slides: [{ id: 'a', layout: 'photo', body: 'x', imageId: 'spare-pic' }, { id: 'b', layout: 'photo', body: 'y', imageId: 'end-pic', hidden: true }] });
    expect(deckData(hidden).images.map(i => i.id)).toEqual(['spare-pic']);
    expect(deckData(seed).images).toEqual([]);
  });

  it('themes the deck from the design, with the app defaults underneath', () => {
    const base = defaultDesign();
    const plain = deckData(seed).theme;
    expect(plain.colors).toEqual({ ...base.colors, card: DEFAULT_CARD, cardInk: DARK_INK, line: base.colors.muted });
    expect(plain.fonts).toEqual({ title: '', body: '' });
    expect(plain.signoff).toBe('');
    const own = deckData(pitched(seed, { design: { ...base, name: 'Made-up System', colors: { ...base.colors, bg: '#101010', accent: '' }, fonts: { title: 'Invented Serif, serif', body: '' }, card: '#14261f', line: '#335544', deck: { ...defaultDeckRules(), signoff: 'from the flat' } } })).theme;
    expect(own.name).toBe('Made-up System');
    expect(own.colors.bg).toBe('#101010');
    expect(own.colors.accent).toBe(base.colors.accent);   // a blank colour falls back
    expect(own.colors.card).toBe('#14261f');
    expect(own.colors.cardInk).toBe(LIGHT_INK);           // dark card, light ink
    expect(own.colors.line).toBe('#335544');
    expect(own.fonts.title).toBe('Invented Serif, serif');
    expect(own.signoff).toBe('from the flat');
    expect(cardInkFor('#fff')).toBe(DARK_INK);
    expect(cardInkFor('#000000')).toBe(LIGHT_INK);
    expect(cardInkFor('not a colour')).toBe(DARK_INK);
  });

  it('fills the cover from the project and leaves the byline empty', () => {
    expect(byLayout(full(), 'cover')).toMatchObject({ title: seed.name, tagline: 'A land surveyor finds a town the maps left out.', byline: '', imageId: 'cover-pic' });
    expect(byLayout(pitched(seed, { logline: `${'A very long first sentence '.repeat(8)}ends here. Short.` }), 'cover').tagline).toBe('');
    expect(byLayout(seed, 'cover').tagline).toBe('');
    expect(deckData(full()).film).toBe(seed.name);
    expect(byLayout(full(), 'closing')).toMatchObject({ title: seed.name, imageId: 'end-pic' });
  });

  it('draws the comps as groups and as bars, largest multiple first', () => {
    const c = byLayout(full(), 'comps');
    expect(c.barsLabel).toBe('Worldwide gross over budget');
    expect(c.bars).toEqual([{ label: 'Invented Film Two', value: 12, note: '2021' }, { label: 'Invented Film One', value: 4, note: '2019' }]);   // no budget, no bar
    expect(c.groups).toEqual([
      { group: 'Festival path', rows: [{ title: 'Invented Film One', year: '2019', multiple: 4 }] },
      { group: 'Comparable films', rows: [{ title: 'Invented Film Two', year: '2021', multiple: 12 }, { title: 'Invented Film Three', year: '2022', multiple: null }] },
    ]);
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, title: `Invented ${i}`, year: '', distributor: '', budget: 100, domestic: null, worldwide: 100 * (i + 1), note: '', source: '' }));
    const bars = byLayout(pitched(seed, { comps: many }), 'comps').bars;
    expect(bars.map(b => b.value)).toEqual([9, 8, 7, 6, 5, 4]);
    expect(bars[0]).toEqual({ label: 'Invented 8', value: 9 });
  });

  it('lists the named team', () => {
    expect(byLayout(full(), 'team').members).toEqual([{ name: 'Ada Example', role: 'Director', bio: 'Invented.' }]);
  });

  it('states the plan in facts the project holds', () => {
    const t = byLayout(seed, 'timeline');
    expect(t.facts.map(f => f.label)).toEqual(['shoot days', 'scenes', 'sets', 'speaking parts', 'crew', 'cash budget']);
    expect(t.facts[0].value).toBe('12');
    expect(t.facts[1].value).toBe('26');
    expect(t.facts[4].value).toBe(String(seed.participants.filter(x => x.group === 'crew').length));
    expect(t.facts[5].value).toMatch(/^\$\d+(\.\d)?[KM]$/);
    expect(t.milestones).toEqual([]);   // no calendar, no credit: nothing to date
    const dated: Project = { ...seed, calendar: { from: '2031-03', to: '2031-04', dayOne: '2031-03-10', workDays: [1, 2, 3, 4, 5], skipHolidays: false, events: [] } };
    expect(byLayout(dated, 'timeline').milestones).toEqual([{ id: 'shoot', when: 'Mar 10 to Mar 25, 2031', what: 'Principal photography' }]);
    const own = pitched(dated, { slides: [{ id: 'plan', layout: 'timeline', milestones: [{ id: 'x', when: 'Spring', what: 'Casting' }], closing: 'A made-up note.' }] });
    expect(byLayout(own, 'timeline').milestones).toEqual([{ id: 'x', when: 'Spring', what: 'Casting' }]);
    expect(byLayout(own, 'timeline').note).toBe('A made-up note.');
  });

  it('adds the California application round when the credit is on', () => {
    const inc = defaultIncentives(seed);
    const on: Project = { ...seed, incentives: { ...inc, startDate: '2027-03-01', ca: { ...inc.ca, enabled: true } } };
    expect(byLayout(on, 'timeline').milestones[0]).toEqual({ id: 'ca-window', when: 'Jan 11–13, 2027', what: 'California tax credit application window' });
    const off: Project = { ...on, incentives: { ...on.incentives!, ca: { ...on.incentives!.ca, enabled: false } } };
    expect(byLayout(off, 'timeline').milestones).toEqual([]);
  });

  it('explains the split in steps', () => {
    const m = byLayout(seed, 'model');
    expect(m.steps.map(s => s.label)).toEqual(['From dollar one', 'After 120%', 'The pool']);
    expect(m.steps[0].title).toBe('60¢ to investors, 40¢ to the pool');
    expect(m.steps[0].body).toContain('120%');
    expect(m.steps[1].title).toBe('50% to investors, 50% to the pool');
    expect(m.steps[2].title).toBe(`${seed.participants.length} people`);
    expect(m.body).toBe('');
    const rf: Project = pitched({ ...seed, waterfall: { ...seed.waterfall, model: 'recoup-first', recoupPct: 110, poolPct: 40 } }, { slides: [{ id: 'm', layout: 'model', body: 'Mine.', closing: 'Last line.' }] });
    const r = byLayout(rf, 'model');
    expect(r.steps.map(s => s.label)).toEqual(['First', 'After 110%', 'The pool']);
    expect(r.steps[0].title).toBe('Investors recoup 110%');
    expect(r.steps[1].title).toBe('60% to investors, 40% to the pool');
    expect(r).toMatchObject({ body: 'Mine.', closing: 'Last line.' });
  });

  it('gives the numbers slide the same inputs the engine computes from', () => {
    const p = full();
    const d = deckData(p);
    expect(d.paths).toEqual(pathInputs(p));
    expect(d.paths.sources.map(s => s.key)).toEqual(['grants']);
    expect(d.paths.sources[0].amount).toBeCloseTo(184_000, 6);   // 200,000 less the sponsor's 8%
    expect(pathFor(d.paths)).toEqual(pathFor(pathInputs(p)));     // the runtime's math on the deck's copy is the engine's
    expect(d.currency).toBe('USD');
    expect(d.legal).toBe(DECK_LEGAL);
    expect(d.legal.length).toBeGreaterThan(0);
    const n = byLayout(p, 'numbers');
    expect(n.caseNote).toContain('20%');
    expect(n.caseNote).not.toContain('Deferred');
    const l = p.lines.find(x => x.unit === 'DAY' && x.amount > 0 && x.rate > 0 && x.payType === 'cash')!;
    const deferred: Project = { ...p, lines: p.lines.map(x => x.id === l.id ? { ...x, payType: 'deferred' as const } : x) };
    expect(byLayout(deferred, 'numbers').caseNote).toMatch(/Deferred pay of \$[\d.]+[KM]? is paid first/);
    expect(deckData(deferred).paths.deferred).toBeGreaterThan(0);
  });

  it('writes a default ask with the tokens the runtime fills', () => {
    const bare = byLayout(grants(seed), 'ask');
    expect(bare.withGrants).toContain('{investors}');
    expect(bare.withGrants).toContain('{grants}');
    expect(bare.withoutGrants).toContain('{investors}');
    expect(bare.withoutGrants).toContain('{grants}');
    expect(bare.withGrants).not.toBe(bare.withoutGrants);
    expect(bare).toMatchObject({ nextStep: '', contact: '' });
    // no grants in the project: nothing for {grants} to say
    expect(byLayout(seed, 'ask').withGrants).toContain('{investors}');
    expect(byLayout(seed, 'ask').withGrants).not.toContain('{grants}');
    // the filmmaker's own words go on both
    const own = byLayout(full(), 'ask');
    expect(own.withGrants).toBe('We are raising {investors}.');
    expect(own.withoutGrants).toBe('We are raising {investors}.');
  });

  it('normalises recipients’ link endings and keeps the first of a duplicate', () => {
    const recipients: Recipient[] = [
      { id: 'r1', slug: 'Ada Example', name: 'Ada Example', coverLine: 'For Ada.', note: 'Met at a made-up festival.', lead: 'with-grants', highlightCardId: 'give' },
      { id: 'r2', slug: 'ada--example', name: 'A Second Ada', coverLine: '', lead: 'without-grants' },
      { id: 'r3', slug: '!!', name: 'No Slug', coverLine: '', lead: 'without-grants' },
      { id: 'r4', slug: 'Fund_42', name: 'Invented Fund', coverLine: 'For the fund.', lead: 'without-grants' },
    ];
    const d = deckData(pitched(seed, { recipients }));
    expect(d.recipients).toEqual([
      { slug: 'ada-example', name: 'Ada Example', coverLine: 'For Ada.', note: 'Met at a made-up festival.', lead: 'with-grants', highlightCardId: 'give' },
      { slug: 'fund-42', name: 'Invented Fund', coverLine: 'For the fund.', lead: 'without-grants' },
    ]);
    expect(deckData(seed).recipients).toEqual([]);
  });

  it('dates the cover line only when asked to', () => {
    expect(deckData(seed).coverLine).toBe('Investor deck.');
    expect(deckData(seed, { today: '2031-11-16' }).coverLine).toBe('Investor deck. November 2031.');
    expect(deckData(seed, { today: 'soon' }).coverLine).toBe('Investor deck.');
  });

  it('is plain JSON', () => {
    for (const p of [seed, full(), pitched(full(), { slides: [{ id: 'a', layout: 'stats', stats: [], scrim: 4, eyebrow: undefined }, { id: 'b', layout: 'text', body: undefined }] })]) {
      const d = deckData(p, { today: '2031-11-16' });
      expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
    }
    const s = deckData(pitched(seed, { slides: [{ id: 'a', layout: 'photo', body: 'x', scrim: 4 }] })).slides[0];
    expect(s.scrim).toBe(1);
  });

  it('is deterministic and does not read the clock', () => {
    const inc = defaultIncentives(seed);
    const p: Project = { ...full(), incentives: { ...inc, startDate: '2027-03-01', ca: { ...inc.ca, enabled: true } }, calendar: { from: '2027-03', to: '2027-04', dayOne: '2027-03-01', workDays: [1, 2, 3, 4, 5], skipHolidays: true, events: [] } };
    const now = deckData(p);
    expect(deckData(p)).toStrictEqual(now);
    expect(deckWarnings(p)).toStrictEqual(deckWarnings(p));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2041-07-04T12:00:00Z'));   // every application window long closed
    expect(new Date().getFullYear()).toBe(2041);
    expect(deckData(p)).toStrictEqual(now);
    expect(defaultSlides(p)).toStrictEqual(defaultSlides(full()));
    expect(byLayout(p, 'timeline').milestones.map(m => m.id)).toEqual(['ca-window', 'shoot']);
  });
});

describe('a look book slide', () => {
  const book = (): LookImage[] => [
    { id: 'w1', dataUrl: 'data:image/png;base64,AAAA', caption: 'The motel', section: 'world', credit: 'Ada Example' },
    { id: 't1', dataUrl: 'data:image/png;base64,AAAB', caption: '', section: 'tone' },
    { id: 'w2', dataUrl: 'data:image/png;base64,AAAC', caption: 'The road', section: 'world' },
    { id: 'gone', dataUrl: '', caption: 'Not in this browser', section: 'world' },
    ...Array.from({ length: 7 }, (_, i): LookImage => ({ id: `c${i}`, dataUrl: `data:image/png;base64,AAA${i}`, caption: `Face ${i}`, section: 'character' })),
  ];
  const withLook = (spec: Partial<SlideSpec>, lookbook = book()): Project => pitched(seed, { lookbook, slides: [{ id: 'cover', layout: 'cover' }, { id: 'look', layout: 'look', ...spec }] });
  const look = (p: Project) => byLayout(p, 'look');

  it('takes the first six of the look book, or of one section, unless pictures are chosen by hand', () => {
    expect(MAX_LOOKS).toBe(6);
    expect(look(withLook({})).pictures.map(x => x.imageId)).toEqual(['w1', 't1', 'w2', 'c0', 'c1', 'c2']);   // a picture with nothing to show is passed over
    expect(look(withLook({ lookSection: 'world' })).pictures.map(x => x.imageId)).toEqual(['w1', 'w2']);
    expect(look(withLook({ lookSection: 'character' })).pictures).toHaveLength(6);
    expect(look(withLook({ lookSection: 'reference' })).pictures).toEqual([]);
    expect(look(withLook({ looks: ['w2', 'c5', 'w1'] })).pictures.map(x => x.imageId)).toEqual(['w2', 'c5', 'w1']);   // in the order they were chosen
    expect(look(withLook({ looks: ['w2', 'nope', 'gone', 'w2', 'w1'] })).pictures.map(x => x.imageId)).toEqual(['w2', 'w1']);
    expect(look(withLook({ looks: [], lookSection: 'world' })).pictures).toEqual([]);                      // chosen by hand, none chosen yet: the section is not used
    expect(look(withLook({ looks: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'] })).pictures).toHaveLength(6);
    expect(lookPictures({ id: 'x', layout: 'look' }, [])).toEqual([]);
  });
  it('carries each caption and credit, or neither when captions are off, and puts its pictures in the file', () => {
    const d = deckData(withLook({ looks: ['w1', 't1'] }));
    expect(byLayout(withLook({ looks: ['w1', 't1'] }), 'look').pictures).toEqual([{ imageId: 'w1', caption: 'The motel', credit: 'Ada Example' }, { imageId: 't1' }]);
    expect(d.images.map(i => i.id).sort()).toEqual(['t1', 'w1']);                                         // only the pictures a slide shows
    expect(look(withLook({ looks: ['w1'], captions: false })).pictures).toEqual([{ imageId: 'w1' }]);
  });
  it('has no picture behind it, whatever the file says', () => {
    const s = look(withLook({ imageId: 'w1', scrim: 0.4, headline: 'The look' }));
    expect(s.imageId).toBeUndefined(); expect(s.scrim).toBeUndefined(); expect(s.headline).toBe('The look');
    expect(deckWarnings(withLook({ imageId: 'nope', looks: ['w1'] }))).toEqual([]);
  });
  it('reads anything a hand-edited file holds without failing', () => {
    const p = withLook({ looks: [7, null, 'w1', { id: 'w2' }, 'w1'] as never, lookSection: 'everything' as never, captions: 'no' as never });
    expect(look(p).pictures).toEqual([{ imageId: 'w1', caption: 'The motel', credit: 'Ada Example' }]);
    expect(look(withLook({ looks: 'w1' as never })).pictures).toHaveLength(6);                              // not a list: not chosen by hand
  });
  it('says so when it would be empty, when a chosen picture has gone, and when too many are chosen', () => {
    const says = (p: Project) => deckWarnings(p).filter(w => w.slideId === 'look').map(w => [w.where, w.message]);
    expect(says(withLook({ looks: ['w1'] }))).toEqual([]);
    expect(says(withLook({}, []))).toEqual([['looks', 'The look book has no pictures yet, so this slide is empty. Add some to the Look book.']]);
    expect(says(withLook({ looks: [] }))).toEqual([['looks', 'No pictures are chosen for this slide yet, so it is empty.']]);
    expect(says(withLook({ lookSection: 'reference' }))).toEqual([['looks', 'The look book has no pictures in that section, so this slide is empty.']]);
    expect(says(withLook({ looks: ['w1', 'lost', 'lost2'] }))).toEqual([['looks', '2 of the pictures chosen for this slide are no longer in the look book, so they are left off.']]);
    expect(says(withLook({ looks: ['w1', 'lost'] }))[0][1]).toMatch(/^1 of the pictures chosen for this slide is no longer/);
    expect(says(withLook({ looks: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }))).toEqual([['looks', 'This slide has 7 pictures chosen; a slide holds 6 at most, so the rest are left off.']]);
  });
});

describe('the plan says who is making the film', () => {
  it('counts the crew, and names the SAG-AFTRA agreement only when there are speaking parts and the author has not turned it off', () => {
    const t = byLayout(seed, 'timeline');
    expect(t.facts.find(f => f.label === 'crew')!.value).toBe(String(seed.participants.filter(x => x.group === 'crew').length));
    expect(t.agreement).toMatch(/^Budgeted under the SAG-AFTRA .+ agreement\.$/);
    const off = pitched(seed, { slides: [{ id: 'plan', layout: 'timeline', agreement: false }] });
    expect('agreement' in byLayout(off, 'timeline')).toBe(false);
    const noCast: Project = { ...seed, board: { ...seed.board, castList: [] } };
    expect('agreement' in byLayout(noCast, 'timeline')).toBe(false);
    const noCrew: Project = { ...seed, participants: seed.participants.filter(x => x.group !== 'crew') };
    expect(byLayout(noCrew, 'timeline').facts.some(f => f.label === 'crew')).toBe(false);
  });
});

describe('a label a box repeats', () => {
  it('is dropped from the start of the text, and only from there', () => {
    expect(unlabel('Primary: women in their 40s', 'primary')).toBe('women in their 40s');
    expect(unlabel('How we reach them: the podcast', 'how we reach them')).toBe('the podcast');
    expect(unlabel('Women first', 'primary')).toBe('Women first');
  });
});

describe('hand-edited and newer project files', () => {
  const withSlides = (slides: unknown): Project => {
    const p = withPitch(applyDeal(sampleProject()));
    return { ...p, pitch: { ...p.pitch!, slides: slides as never } };
  };

  it('drops slides it cannot read instead of failing the whole deck', () => {
    const p = withSlides([
      null, 42, { id: 'x', layout: 'hologram' }, { layout: 'text' },
      { id: 'a', layout: 'text', body: 7, columns: [{ label: 'One' }, null] },
      { id: 'b', layout: 'team', aside: { title: 'Hoped-for cast' } },
      { id: 'c', layout: 'stats', stats: [{ value: '1 in 3', label: 'x', source: 99 }, { value: 'no', label: 'source' }], lead: { value: '9' } },
      { id: 'd', layout: 'cards', cards: [null, { title: 'Only a title' }] },
    ]);
    const d = deckData(p);
    expect(d.slides.map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
    const a = d.slides[0]; expect(a.layout === 'text' && a.body).toBe('7');
    expect(a.layout === 'text' && a.aside).toEqual([{ label: 'One', lines: [] }]);
    const c = d.slides[2]; expect(c.layout === 'stats' && c.stats.map(s => s.source)).toEqual(['99']);
    expect(c.layout === 'stats' && c.lead).toBeUndefined();
    const cards = d.slides[3]; expect(cards.layout === 'cards' && cards.cards).toEqual([{ id: 'card1', title: 'Only a title', body: '' }]);
    expect(deckWarnings(p).some(w => w.slideId === 'deck' && /^1 slide was made in a newer version of ProfitShare and cannot be shown here\.$/.test(w.message))).toBe(true);
  });

  it('gives nobody a link ending the deck reads as a switch', () => {
    const p0 = withPitch(applyDeal(sampleProject()));
    const rec = (id: string, slug: string) => ({ id, slug, name: `Reader ${id}`, coverLine: '', lead: 'with-grants' as const });
    const p: Project = { ...p0, pitch: { ...p0.pitch!, recipients: [rec('1', 'without'), rec('2', 'With Grants'), rec('3', 'ada-without'), rec('4', 'ada'), null as never] } };
    expect(deckData(p).recipients.map(r => r.slug)).toEqual(['ada']);
    expect(deckWarnings(p).filter(w => /is reserved/.test(w.message)).map(w => w.slideId)).toEqual(['recipient:1', 'recipient:2', 'recipient:3']);
    expect(deckWarnings(p).filter(w => /is reserved/.test(w.message)).map(w => w.where)).toEqual(['recipient:0', 'recipient:1', 'recipient:2']);   // where in the list, for a page to link to
    expect(deckWarnings(p).find(w => /is reserved/.test(w.message))!.message).toContain('such as without-film');
    for (const s of ['with', 'without', 'with-grants', 'without-grants', 'x-without', 'x-with']) expect(reservedSlug(s)).toBe(true);
    for (const s of ['ada', 'withers', 'without-a-doubt', 'grants']) expect(reservedSlug(s)).toBe(false);
  });

  it('leaves out revenue cases nobody typed, and says so', () => {
    const p = withPitch(applyDeal(sampleProject()));
    const bare: Project = { ...p, pitch: { ...p.pitch!, revenue: [] } };
    expect(deckData(bare).paths.cases).toEqual([]);
    expect(deckWarnings(bare).some(w => w.slideId === 'numbers' && /No receipts are typed/.test(w.message) && w.where === 'revenue')).toBe(true);
  });
});

describe('font files in the deck', () => {
  const FONT = 'data:font/woff2;base64,d09GMgABAAAAAA==';   // invented bytes: nothing here parses them
  const file = (over: Partial<FontFile> = {}): FontFile => ({ id: 'f1', role: 'title', family: 'Invented Slab', dataUrl: FONT, embedOk: false, ...over });
  const withFonts = (fontFiles: unknown): Project => pitched(seed, { design: { ...defaultDesign(), fontFiles: fontFiles as FontFile[] } });

  it('a project with no font files has no fontFaces field at all: old files give the deck they always gave', () => {
    expect('fontFaces' in deckData(seed).theme).toBe(false);
    expect('fontFaces' in deckData(withFonts([])).theme).toBe(false);
    expect('fontFaces' in deckData(withFonts(undefined)).theme).toBe(false);
    expect(deckData(withFonts([])).version).toBe(1);
    expect(deckWarnings(seed).some(w => w.slideId === 'design')).toBe(false);
  });
  it('carries each attached file into the theme by role, family and address, and nothing else', () => {
    const theme = deckData(withFonts([file(), file({ id: 'f2', role: 'body', family: 'Invented Sans', embedOk: true })]), { fonts: 'all' }).theme;
    expect(theme.fontFaces).toEqual([{ family: 'Invented Slab', src: FONT, role: 'title' }, { family: 'Invented Sans', src: FONT, role: 'body' }]);
    expect(theme.fonts).toEqual({ title: '', body: '' });   // the stacks are the design's own; the runtime puts the faces in front
  });
  it('one file a role (the first wins), with the family name cleaned', () => {
    const faces = fontFacesOf(withFonts([file({ family: 'First "; } x' }), file({ id: 'f2', family: 'Second' }), file({ id: 'f3', role: 'body', family: '  Body   Face ' })]), false);
    expect(faces.map(f => [f.role, f.family])).toEqual([['title', 'First x'], ['body', 'Body Face']]);
  });
  it('leaves out a file with no name, one that is not a font, one still in the browser store, and anything malformed', () => {
    const p = withFonts([
      file({ family: '!!!' }),
      file({ id: 'f2', role: 'body', dataUrl: 'https://example.com/font.woff2' }),
      null, 'x', { id: 'f5', role: 'caption', family: 'Odd', dataUrl: FONT, embedOk: true },
    ]);
    expect(fontFacesOf(p)).toEqual([]);
    expect('fontFaces' in deckData(p).theme).toBe(false);
    expect(fontFacesOf(withFonts([file({ dataUrl: 'idb:font:f1' })]))).toEqual([]);   // not back from the browser store yet
    expect(fontFacesOf(withFonts([file({ dataUrl: '' })]))).toEqual([]);
    expect(fontFacesOf(withFonts('nonsense'))).toEqual([]);
    expect(fontFacesOf(withFonts([file({ dataUrl: 'data:text/html;base64,PGI+' })]))).toEqual([]);
  });
  it('the embeddable deck carries only the files the author cleared to travel', () => {
    const p = withFonts([file(), file({ id: 'f2', role: 'body', family: 'Invented Sans', embedOk: true })]);
    expect(fontFacesOf(p, false).map(f => f.family)).toEqual(['Invented Slab', 'Invented Sans']);
    expect(fontFacesOf(p, true).map(f => f.family)).toEqual(['Invented Sans']);
    expect(fontFacesOf(p).map(f => f.family)).toEqual(['Invented Sans']);                       // the default is what a deck that is sent may carry
    expect(deckData(p).theme.fontFaces).toEqual([{ family: 'Invented Sans', src: FONT, role: 'body' }]);
    expect('fontFaces' in deckData(withFonts([file()])).theme).toBe(false);                    // nothing cleared to travel: nothing travels
    expect(deckData(p, { fonts: 'embeddable' }).theme.fontFaces).toEqual([{ family: 'Invented Sans', src: FONT, role: 'body' }]);
    expect(deckData(p, { fonts: 'all' }).theme.fontFaces).toHaveLength(2);
    expect('fontFaces' in deckData(withFonts([file()]), { fonts: 'embeddable' }).theme).toBe(false);
    expect(fontFacesOf(withFonts([file({ embedOk: 'yes' as unknown as boolean })]), true)).toEqual([]);   // only a real tick counts
  });
  it('warns about a font file the deck cannot use', () => {
    const msgs = (fontFiles: unknown) => deckWarnings(withFonts(fontFiles)).filter(w => w.slideId === 'design').map(w => w.message);
    expect(msgs([file()])).toEqual([]);
    expect(msgs([file({ family: '' })])[0]).toMatch(/title font file has no name/);
    expect(msgs([file({ role: 'body', dataUrl: 'data:text/plain;base64,AAAA' })])[0]).toMatch(/body font file "Invented Slab" is not a font/);
    expect(msgs([file({ dataUrl: '' })])[0]).toMatch(/missing from this browser/);
    expect(msgs([file({ dataUrl: 'idb:font:f1' })])).toEqual([]);   // on its way back from the browser store
  });
  it('the deck stays plain JSON with the files in it', () => {
    const d = deckData(withFonts([file()]));
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});

describe('the deck and its warnings read anything', () => {
  const garbage = (over: Record<string, unknown>): Project => { const q = withPitch(seed); return { ...q, pitch: { ...q.pitch!, ...over } as Pitch }; };
  it('null and nonsense in every list is skipped, not thrown on', () => {
    const p = garbage({
      slides: [null, 7, 'x', [], { id: 'ok', layout: 'stats', headline: 'Fine', stats: [null, 3, { id: 's', value: '1', label: 'one', source: '' }], lead: 'no', cards: 'no' },
        { id: 'c', layout: 'cards', cards: [null, 'x', { title: 'A card' }, { id: 5 }] }, { id: 'p', layout: 'photo', imageId: 'gone' }, { layout: 'text' }],
      recipients: [null, 4, 'x', {}, { name: 'No id', slug: 'no-id' }, { id: 'r', name: 9, slug: null }],
      lookbook: [null, 'x', { id: 'pic' }, { id: 'good', dataUrl: 'data:image/png;base64,AAAA', caption: null }],
      design: { ...defaultDesign(), fontFiles: [null, 'x', 3, { role: 'title' }, { id: 'f', role: 'body', family: 'Ok Face', dataUrl: 12 }] },
    });
    expect(() => deckData(p)).not.toThrow();
    expect(() => deckWarnings(p)).not.toThrow();
    expect(deckData(p).slides.map(s => s.id)).toEqual(['ok', 'c', 'p']);
    expect(deckData(p).recipients.map(r => r.slug)).toEqual(['no-id']);
    const w = deckWarnings(p);
    expect(w.find(x => x.where === 'stat:s')?.message).toBe('The number "1" has no source, so it is left off the deck.');
    expect(w.some(x => x.where === 'picture' && x.slideId === 'p')).toBe(true);
    expect(w.filter(x => x.slideId === 'design').map(x => x.message)).toEqual(['The body font file "Ok Face" is missing from this browser. Attach it again under Design system.']);   // the entries that are not font files are not reported as ones
    for (const slides of ['text', 5, {}, null]) expect(() => { deckData(garbage({ slides })); deckWarnings(garbage({ slides })); }).not.toThrow();
    for (const recipients of ['text', 5, {}]) expect(() => { deckData(garbage({ recipients })); deckWarnings(garbage({ recipients })); }).not.toThrow();
  });
  it('a number or a person nobody has started typing is not a problem yet', () => {
    const blank = garbage({ slides: [{ id: 'a', layout: 'stats', stats: [{ id: 's1', value: '', label: '', source: '' }], lead: { value: '', text: '', source: '' } }], recipients: [{ id: 'r', name: '', slug: '', coverLine: '', lead: 'with-grants' }] });
    expect(deckWarnings(blank)).toEqual([]);
    const begun = garbage({ slides: [{ id: 'a', layout: 'stats', stats: [{ id: 's1', value: '', label: 'a share', source: '' }], lead: { value: '7 in 10', text: '', source: '' } }], recipients: [{ id: 'r', name: 'Ada Example', slug: '', coverLine: '', lead: 'with-grants' }] });
    expect(deckWarnings(begun).map(w => w.where)).toEqual(['lead', 'stat:s1', 'recipient:0']);
    expect(deckWarnings(begun).map(w => w.message)).toEqual(['The big number "7 in 10" has no source, so it is left off the deck.', 'The number has no source, so it is left off the deck.', 'Ada Example has no link ending, so there is no deck link for them.']);
  });
  it('names the panels and tabs the way the page names them', () => {
    const all = [...deckWarnings(seed), ...deckWarnings(garbage({ slides: [{ id: 'n', layout: 'numbers' }] }))].map(w => w.message).join(' ');
    expect(all).toContain('What it could make');
    expect(all).not.toMatch(/under Revenue|\bstat\b|lead number|slug/i);
  });
  it('takes CSS variables out of a font stack: they mean nothing inside a deck file', () => {
    const d = defaultDesign();
    const theme = deckData(pitched(seed, { design: { ...d, fonts: { title: '"Invented Slab", var(--font-title)', body: 'var(--font-body), "Invented Sans",  serif' } } })).theme;
    expect(theme.fonts).toEqual({ title: '"Invented Slab"', body: '"Invented Sans", serif' });
    expect(deckData(pitched(seed, { design: { ...d, fonts: { title: 'var(--font-title)', body: 5 as unknown as string } } })).theme.fonts).toEqual({ title: '', body: '' });
  });
});

describe('papers in the deck\'s data', () => {
  const cardsSlide = (extra: Record<string, unknown> = {}) => ({ id: 'gap', layout: 'cards', cards: [{ id: 'c1', title: 'One', body: 'First.' }, { id: 'c2', title: 'Two', body: 'Second.' }], ...extra });
  const designed = (design: Record<string, unknown>, slides: unknown[] = [cardsSlide()]) => pitched(seed, { design: { ...defaultDesign(), ...design } as never, slides: slides as SlideSpec[] });
  it('an old project says nothing about paper, and its deck says nothing either: its cards are drawn plain', () => {
    const d = deckData(full());
    expect('paper' in d.theme).toBe(false); expect('hand' in d.theme).toBe(false); expect('tilt' in d.theme).toBe(false);
    for (const s of d.slides) expect('paper' in s, s.id).toBe(false);
    expect(JSON.stringify(deckData(seed))).not.toMatch(/"paper"|"hand"|"tilt"/);
  });
  it('carries the design system\'s paper, handwriting and tilt into the theme, each only when it is set', () => {
    for (const paper of ['postcard', 'letter', 'notebook', 'torn'] as const) expect(deckData(designed({ paper })).theme.paper).toBe(paper);
    expect('paper' in deckData(designed({ paper: 'plain' })).theme).toBe(false);   // plain is what a deck with no word for it draws
    expect(deckData(designed({ hand: true, tilt: true })).theme).toMatchObject({ hand: true, tilt: true });
    const off = deckData(designed({ hand: false, tilt: false })).theme;
    expect('hand' in off).toBe(false); expect('tilt' in off).toBe(false);
  });
  it('takes only words from the list: anything else in a hand-edited file is the plain card, and never reaches the deck', () => {
    for (const raw of ['mixed', 'Torn', 'url(x)', '<img src=x>', 7, null, ['torn'], { a: 1 }, true]) {
      const d = deckData(designed({ paper: raw, hand: 'yes', tilt: 1 }, [cardsSlide({ paper: raw === 'mixed' ? 'everything' : raw })]));
      expect('paper' in d.theme, String(raw)).toBe(false);
      expect('hand' in d.theme).toBe(false); expect('tilt' in d.theme).toBe(false);
      expect('paper' in d.slides[0], String(raw)).toBe(false);
      expect(JSON.stringify(d)).not.toMatch(/url\(x\)|<img/);
    }
  });
  it('carries a slide\'s own paper, mixed included, on the slides that draw a card and on no other', () => {
    const slides = [{ id: 'cover', layout: 'cover', paper: 'postcard' }, cardsSlide({ paper: 'mixed' }), { ...cardsSlide({ paper: 'torn' }), id: 'ways', layout: 'ways' },
      { id: 'proof', layout: 'stats', paper: 'notebook', quote: { text: 'An invented line.', by: 'Somebody invented' } }, { id: 'team', layout: 'team', paper: 'letter' },
      { id: 'words', layout: 'text', body: 'x', paper: 'torn' }, { id: 'plan', layout: 'timeline', paper: 'postcard' }, { id: 'ask', layout: 'ask', paper: 'mixed' }, { id: 'plain', layout: 'cards', paper: 'plain', cards: [{ id: 'p1', title: 'P', body: '' }] }];
    const d = deckData(designed({ paper: 'letter' }, slides));
    expect(Object.fromEntries(d.slides.map(s => [s.id, s.paper]))).toEqual({ cover: 'postcard', gap: 'mixed', ways: 'torn', proof: 'notebook', team: 'letter', words: undefined, plan: undefined, ask: undefined, plain: 'plain' });
    expect(d.theme.paper).toBe('letter');
    expect(deckWarnings(designed({ paper: 'letter' }, slides)).filter(w => /paper/i.test(w.message))).toEqual([]);
  });
  it('an old project says nothing about a shade, and neither does its deck: its papers are the card colour', () => {
    expect(JSON.stringify(deckData(full()))).not.toMatch(/paperShade/);
    expect(JSON.stringify(deckData(designed({ paper: 'letter' }, [cardsSlide({ paper: 'mixed' })])))).not.toMatch(/paperShade/);
    expect('paperShade' in deckData(designed({ paperShade: 'theme' })).theme).toBe(false);   // the card colour is what a deck with no word for it uses
  });
  it('carries the design system\'s shade into the theme and a slide\'s own onto the slides that draw a card', () => {
    for (const paperShade of ['white', 'cream', 'aged', 'kraft', 'newsprint'] as const) expect(deckData(designed({ paperShade })).theme.paperShade).toBe(paperShade);
    const slides = [{ id: 'cover', layout: 'cover', paperShade: 'kraft' }, cardsSlide({ paperShade: 'theme', paper: 'torn' }), { ...cardsSlide({ paperShade: 'white' }), id: 'ways', layout: 'ways' },
      { id: 'proof', layout: 'stats', paperShade: 'cream', quote: { text: 'An invented line.', by: 'Somebody invented' } }, { id: 'team', layout: 'team', paperShade: 'newsprint' },
      { id: 'words', layout: 'text', body: 'x', paperShade: 'aged' }, { id: 'plan', layout: 'timeline', paperShade: 'aged' }, { id: 'none', layout: 'cards', cards: [{ id: 'p1', title: 'P', body: '' }] }];
    const d = deckData(designed({ paperShade: 'aged' }, slides));
    expect(d.theme.paperShade).toBe('aged');
    // 'theme' on a slide is kept: it sends that one slide back to the card colour in a deck of another shade
    expect(Object.fromEntries(d.slides.map(s => [s.id, s.paperShade]))).toEqual({ cover: 'kraft', gap: 'theme', ways: 'white', proof: 'cream', team: 'newsprint', words: undefined, plan: undefined, none: undefined });
    expect(d.slides.find(s => s.id === 'gap')!.paper).toBe('torn');
    expect(deckWarnings(designed({ paperShade: 'aged' }, slides))).toEqual(deckWarnings(designed({}, slides.map(({ paperShade: _s, ...rest }: Record<string, unknown>) => rest))));   // a shade is never something to fix
  });
  it('takes only shades from the list: anything else in a hand-edited file is the card colour, and never reaches the deck', () => {
    for (const raw of ['Aged', 'aged ', 'sepia', 'url(x)', '<img src=x>', 7, null, ['aged'], { a: 1 }, true]) {
      const d = deckData(designed({ paperShade: raw }, [cardsSlide({ paperShade: raw })]));
      expect('paperShade' in d.theme, String(raw)).toBe(false);
      expect('paperShade' in d.slides[0], String(raw)).toBe(false);
      expect(JSON.stringify(d)).not.toMatch(/url\(x\)|<img|sepia/);
    }
  });
  it('gives the same deck for the same project, papers and all', () => {
    const p = designed({ paper: 'torn', paperShade: 'aged', hand: true }, [cardsSlide({ paper: 'mixed', paperShade: 'kraft' })]);
    expect(deckData(p)).toEqual(deckData(p));
  });
});
