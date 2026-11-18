// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { deckData, defaultSlides } from '../engine/deckData';
import { allSwitches, pathFor } from '../engine/pathMath';
import { defaultDeckRules, defaultDesign, withPitch } from '../engine/pitch';
import type { LookImage, Project, SlideSpec } from '../engine/types';
import type { DeckData, DeckSlide } from './data';
import { money, moneyParts, multiple, percent, shares100 } from './format';
import { cleanFamily, faceName, fontSrcOk, shortHash } from './fonts';
import { CENTRE_UNDER, shouldCentre, cleanFontFaces, cleanPaths, cleanRecipients, contrastRatio, DEFAULT_LEGAL, deckColors, fillAsk, fontStack, initialSwitches, MAX_SOURCES, mixColors, mountDeck, overflows, parseColor, parseHash, readableOn, reservedSlug, safeColor, str, textSafe } from './runtime';
import type { DeckHandle } from './runtime';
import { scrimLight, veilBoxes, footBand, shadeNeeded, readColor, VEILED, VEIL_LABEL, VEIL_NEAR, VEIL_PAD, VEIL_SNAP, FOOT_RISE, SHADE_SPARE } from './runtime';

// Only the invented sample film, dressed with invented content so that every layout appears.
const pic = (id: string): LookImage => ({ id, dataUrl: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" id="${id}"/>`, caption: `Picture ${id}`, section: 'tone' });

function fixture(): DeckData {
  const base = withPitch(applyDeal({ ...sampleProject(), name: 'Salt Flat' }));
  const p0: Project = {
    ...base,
    waterfall: { ...base.waterfall, nonRecoupable: 200_000, sponsorFeePct: 8 },
    pitch: {
      ...base.pitch!,
      logline: 'A surveyor finds a town the maps left out. Nobody there wants to be found.',
      why: 'First invented paragraph.\n\nSecond invented paragraph.',
      audience: { primary: 'Primary: invented adults', secondary: '', notes: 'How we reach them: invented screenings.' },
      sections: [],
      comps: [
        { id: 'c1', title: 'Alkali Sisters (invented)', year: '2027', distributor: '', budget: 500_000, domestic: 0, worldwide: 4_000_000, note: '', source: '', group: 'Festival path' },
        { id: 'c2', title: 'Benchmark (invented)', year: '2030', distributor: '', budget: 2_000_000, domestic: 0, worldwide: 2_600_000, note: '', source: '', group: 'Direct' },
      ],
      revenue: [{ id: 'rv', source: 'All', low: 500_000, mid: 2_250_000, high: 6_000_000 }],
      feePct: 20,
      research: [
        { id: 'm1', kind: 'market', title: 'Gap card one', body: 'Invented finding one.' },
        { id: 'm2', kind: 'market', title: 'Gap card two', body: 'Invented finding two.' },
        { id: 'm3', kind: 'market', title: 'Gap card three', body: 'Invented finding three.' },
      ],
      team: [{ id: 't1', name: 'Ada Example', role: 'Writer and director', bio: 'Invented person.' }],
      ask: '',
      lookbook: [pic('img_a'), pic('img_b')],
      design: { ...defaultDesign(), deck: { ...defaultDeckRules(), coverImageId: 'img_a', closingImageId: 'img_b', signoff: 'an invented sign-off' } },
      recipients: [
        { id: 'r1', slug: 'dana-invented', name: 'Dana Invented', coverLine: 'Prepared for Dana Invented.', note: 'A note only Dana should read.', lead: 'with-grants', highlightCardId: 'give' },
        { id: 'r2', slug: 'placeholder-fund', name: 'The Placeholder Fund', coverLine: 'Prepared for The Placeholder Fund.', note: 'A note only the Fund should read.', lead: 'without-grants', highlightCardId: 'invest' },
        { id: 'r3', slug: 'quiet', name: 'Quiet Person', coverLine: '', lead: 'with-grants' },
      ],
    },
  };
  const edit: Record<string, Partial<SlideSpec>> = {
    cover: { byline: 'Written and directed by Ada Example' },
    logline: { imageId: 'img_a', headline: 'A town on no map.', punch: 'And a woman paid to draw it.' },
    why: { headline: 'I know this place.', closing: 'An invented closing line.', columns: [{ label: 'Where', lines: ['An invented dry lake'] }, { label: 'When', lines: ['Spring 2031'] }] },
    gap: { headline: 'Nobody is making this film.' },
    opportunity: { headline: 'Small films pay back.', closing: 'An invented callout.' },
    audience: {
      lead: { value: '7 in 10', text: 'invented ticket buyers.', source: 'Invented Survey, 2030' },
      stats: [{ id: 's1', value: '41%', label: 'an invented share', source: 'Invented Survey, 2030' }],
      quote: { text: 'I would drive two hours to see this.', by: 'an invented respondent' },
    },
    team: { aside: { title: 'Also attached', lines: ['Editor: Dee Fictional'], footnote: 'All invented.' } },
    plan: { milestones: [{ id: 'ms1', when: 'March 2031', what: 'Invented shoot' }, { id: 'ms2', when: 'Autumn 2031', what: 'Invented premiere' }], closing: 'An invented plan note.' },
    model: { body: 'An invented model paragraph.', closing: 'The same terms for everyone.' },
    numbers: { body: 'An invented numbers paragraph.' },
    ask: { nextStep: 'Next step: an invented call.', contact: 'ben@example.com' },
  };
  const slides = defaultSlides(p0).map(s => ({ ...s, ...(edit[s.id] ?? {}) }));
  const data = deckData({ ...p0, pitch: { ...p0.pitch!, slides } }, { today: '2031-01-15' });
  // two more invented sources, so there are eight combinations to walk
  data.paths.sources.push({ key: 'credit', label: 'Invented tax credit', amount: 90_000, on: false, note: 'not yet applied for' }, { key: 'perks', label: 'Invented perks', amount: 12_500, on: true });
  return data;
}

const LAYOUTS: DeckSlide['layout'][] = ['cover', 'photo', 'text', 'cards', 'stats', 'timeline', 'comps', 'team', 'model', 'ways', 'numbers', 'ask', 'closing'];
const mounted: DeckHandle[] = [];
function mount(data: DeckData, opts: Parameters<typeof mountDeck>[2] = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const handle = mountDeck(host, data, opts);
  mounted.push(handle);
  const root = (host.shadowRoot ?? host) as ParentNode;
  const slide = (layout: string) => root.querySelector<HTMLElement>(`section[data-layout="${layout}"]`)!;
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  return { host, handle, root, slide, part, text: () => (root as unknown as Node).textContent ?? '' };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const h of mounted.splice(0)) h.destroy();
  document.body.replaceChildren();
  window.location.hash = '';
});

describe('the fixture', () => {
  it('has every layout', () => {
    expect([...new Set(fixture().slides.map(s => s.layout))].sort()).toEqual([...LAYOUTS].sort());
  });
});

describe('mountDeck', () => {
  it('mounts into a shadow root with the stylesheet, one section per slide', () => {
    const data = fixture();
    const { host, handle, root } = mount(data, { css: '.psd{color:red}' });
    expect(host.shadowRoot).toBeTruthy();
    expect(host.shadowRoot!.querySelector('style')!.textContent).toBe('.psd{color:red}');
    expect(root.querySelectorAll('section').length).toBe(data.slides.length);
    expect(handle.slideCount).toBe(data.slides.length);
    const deck = root.querySelector<HTMLElement>('.psd')!;
    expect(deck.tabIndex).toBe(0);
    expect(deck.getAttribute('aria-label')).toContain('Salt Flat');
    expect(deck.style.getPropertyValue('--psd-bg')).toBe(data.theme.colors.bg);
    expect(deck.style.getPropertyValue('--psd-title-font')).toContain('"Special Elite", "Courier New", monospace');
    expect(deck.style.getPropertyValue('--psd-body-font')).toContain('"Work Sans", system-ui, sans-serif');
  });

  it('labels every slide and numbers it in the footer with the film', () => {
    const data = fixture();
    const { root } = mount(data);
    const sections = [...root.querySelectorAll('section')];
    sections.forEach((s, i) => {
      expect(s.getAttribute('aria-label')).toBeTruthy();
      expect(s.querySelector('.psd-foot-n')!.textContent).toBe(`${i + 1} / ${sections.length}`);
      expect(s.querySelector('.psd-foot-film')!.textContent).toBe('Salt Flat');
    });
    const gap = data.slides.find(s => s.id === 'gap')!;
    expect(root.querySelector('section[data-slide-id="gap"]')!.getAttribute('aria-label')).toBe(gap.eyebrow);
  });

  it('draws the key content of every layout', () => {
    const data = fixture();
    const { slide } = mount(data);
    const by = <L extends DeckSlide['layout']>(l: L) => data.slides.find(s => s.layout === l) as Extract<DeckSlide, { layout: L }>;
    const t = (l: string) => slide(l).textContent ?? '';

    expect(t('cover')).toContain('Salt Flat');
    expect(t('cover')).toContain(data.coverLine);
    expect(t('cover')).toContain(by('cover').tagline);
    expect(t('cover')).toContain('Written and directed by Ada Example');
    expect(slide('cover').querySelector('img.psd-bg')!.getAttribute('alt')).toBe('Picture img_a');

    expect(slide('photo').querySelector('.psd-h1')!.textContent).toBe('A town on no map.');
    expect(slide('photo').querySelector('.psd-punch')!.textContent).toBe('And a woman paid to draw it.');
    expect(t('photo')).toContain('Nobody there wants to be found.');

    expect(slide('text').querySelectorAll('.psd-p').length).toBe(2);
    expect(slide('text').querySelectorAll('.psd-aside-col').length).toBe(2);
    expect(t('text')).toContain('An invented closing line.');

    expect(slide('cards').querySelectorAll('.psd-card').length).toBe(3);
    expect(t('cards')).toContain('Gap card two');

    expect(t('stats')).toContain('7 in 10');
    expect(t('stats')).toContain('Invented Survey, 2030');
    expect(slide('stats').querySelectorAll('.psd-stat').length).toBe(1);
    expect(slide('stats').querySelector('.psd-quote')!.textContent).toContain('I would drive two hours');

    expect(slide('timeline').querySelectorAll('.psd-fact').length).toBe(by('timeline').facts.length);
    expect(slide('timeline').querySelectorAll('.psd-mile').length).toBe(2);
    const mile = slide('timeline').querySelector('.psd-mile')!;
    expect(mile.querySelector('.psd-when')!.compareDocumentPosition(mile.querySelector('.psd-what')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const bars = [...slide('comps').querySelectorAll('.psd-bar-row')];
    expect(bars.length).toBe(2);
    expect(bars[0].querySelector('.psd-bar-val')!.textContent).toBe('8.0x');
    expect((bars[0].querySelector('.psd-bar-fill') as HTMLElement).style.getPropertyValue('--w')).toBe('100%');
    expect(t('comps')).toContain('Festival path');
    expect(t('comps')).toContain('An invented callout.');

    expect(t('team')).toContain('Ada Example · Writer and director');
    expect(slide('team').querySelector('.psd-team-aside')!.textContent).toContain('Editor: Dee Fictional');

    expect(slide('model').querySelectorAll('.psd-step').length).toBe(by('model').steps.length);
    expect(slide('model').querySelectorAll('.psd-arrow').length).toBe(by('model').steps.length - 1);

    expect(slide('ways').querySelectorAll('.psd-card').length).toBe(by('ways').cards.length);
    expect(t('numbers')).toContain('Budget to raise');
    expect(t('numbers')).toContain('Investors fund');
    expect(t('ask')).toContain('Next step: an invented call.');
    expect(t('ask')).toContain('ben@example.com');
    expect(t('closing')).toContain('Salt Flat');
    expect(t('closing')).toContain('an invented sign-off');
  });

  it('inserts text as text: markup in the data never becomes an element', () => {
    const data = fixture();
    const evil = '<img src=x onerror="window.__pwned = 1">';
    for (const s of data.slides) { s.headline = evil; s.punch = `<script>window.__pwned = 2</script>`; s.footnote = '<b>bold</b>'; }
    data.film = '<i>Film</i>';
    data.legal = '<u>legal</u>';
    data.recipients[0].note = '<a href="javascript:alert(1)">x</a>';
    const { root, slide } = mount(data, { recipient: 'dana-invented' });
    expect(root.querySelectorAll('img:not(.psd-bg), script, u, a, [onerror], [href]').length).toBe(0);
    expect(slide('text').querySelector('.psd-h1')!.textContent).toBe(evil);
    expect(slide('text').querySelector('.psd-h1')!.children.length).toBe(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('drops colours and pictures that could reach the network', () => {
    const data = fixture();
    data.theme.colors.bg = 'url(https://example.com/x.png)';
    data.theme.fonts.title = 'Evil; } body { display:none';
    data.images[0].src = 'https://example.com/tracker.png';
    const { root, slide } = mount(data);
    const deck = root.querySelector<HTMLElement>('.psd')!;
    expect(deck.style.getPropertyValue('--psd-bg')).toBe('#ffffff');
    expect(deck.style.getPropertyValue('--psd-title-font')).not.toMatch(/[;{}]/);
    expect(slide('cover').querySelector('img')).toBeNull();
  });

  it('skips a slide with an unknown layout and a picture id that matches nothing', () => {
    const data = fixture();
    (data.slides as unknown[]).splice(1, 0, { id: 'mystery', layout: 'hologram' });
    data.slides.find(s => s.layout === 'photo')!.imageId = 'missing';
    const { handle, root, slide } = mount(data);
    expect(handle.slideCount).toBe(data.slides.length - 1);
    expect(root.querySelector('[data-slide-id="mystery"]')).toBeNull();
    expect(slide('photo').querySelector('img')).toBeNull();
  });

  it('renders nothing for empty optional parts', () => {
    const data = fixture();
    const stats = data.slides.find(s => s.layout === 'stats') as Extract<DeckSlide, { layout: 'stats' }>;
    delete stats.lead; delete stats.quote; delete stats.note; stats.stats = []; delete stats.body;
    const team = data.slides.find(s => s.layout === 'team') as Extract<DeckSlide, { layout: 'team' }>;
    delete team.aside;
    const ask = data.slides.find(s => s.layout === 'ask') as Extract<DeckSlide, { layout: 'ask' }>;
    ask.nextStep = ''; ask.contact = '';
    const { slide } = mount(data);
    expect(slide('stats').querySelector('.psd-lead, .psd-quote, .psd-stats, .psd-note, .psd-stats-top')).toBeNull();
    expect(slide('team').querySelector('.psd-card')).toBeNull();
    expect(slide('ask').querySelector('.psd-next, .psd-contact')).toBeNull();
    expect(slide('ask').querySelector('[data-part="ask-note"]')).toBeNull();
  });
});

describe('the numbers slide', () => {
  const readCases = (slide: HTMLElement) => [...slide.querySelectorAll<HTMLElement>('tr[data-case]')].map(tr => ({
    label: tr.dataset.case,
    gross: tr.querySelector('[data-col="gross"]')!.textContent,
    net: tr.querySelector('[data-col="net"]')!.textContent,
    toInvestors: tr.querySelector('[data-col="toInvestors"]')!.textContent,
    multiple: tr.querySelector('[data-col="multiple"]')!.textContent,
  }));

  it('matches pathFor for every combination as the toggles are clicked', () => {
    const data = fixture();
    const { slide, part } = mount(data);
    const numbers = slide('numbers');
    const buttons = [...numbers.querySelectorAll<HTMLButtonElement>('button.psd-toggle')];
    expect(buttons.map(b => b.dataset.key)).toEqual(data.paths.sources.map(s => s.key));
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(data.paths.sources.map(s => String(s.on)));
    for (const [i, src] of data.paths.sources.entries()) {
      expect(buttons[i].textContent).toContain(src.label);
      expect(buttons[i].textContent).toContain(money(src.amount, data.currency));
      if (src.note) expect(buttons[i].textContent).toContain(src.note);
    }
    expect(part('budget').textContent).toBe(money(data.paths.cashBudget, data.currency));

    const combos = allSwitches(data.paths.sources);
    expect(combos.length).toBe(8);
    const rows = [...numbers.querySelectorAll<HTMLElement>('.psd-combos tbody tr')];
    expect(rows.length).toBe(8);
    combos.forEach((sw, i) => expect(rows[i].lastElementChild!.textContent).toBe(money(pathFor(data.paths, sw).investors, data.currency)));

    for (const sw of combos) {
      for (const b of buttons) if ((b.getAttribute('aria-pressed') === 'true') !== sw[b.dataset.key!]) b.click();
      const want = pathFor(data.paths, sw);
      expect(part('investors').textContent).toBe(money(want.investors, data.currency));
      expect(readCases(numbers)).toEqual(want.cases.map(c => ({
        label: c.label, gross: money(c.gross, data.currency), net: money(c.net, data.currency), toInvestors: money(c.toInvestors, data.currency), multiple: multiple(c.multiple),
      })));
      const current = rows.filter(r => r.getAttribute('aria-current') === 'true');
      expect(current.length).toBe(1);
      expect(current[0].dataset.combo).toBe(data.paths.sources.map(s => (sw[s.key] ? '1' : '0')).join(''));
      // the stacked bar: switched-on sources and investors as shares of the budget
      const segs = [...numbers.querySelectorAll<HTMLElement>('.psd-seg')];
      expect(segs.length).toBe(data.paths.sources.length + 1);
      data.paths.sources.forEach((s, i) => expect(parseFloat(segs[i].style.flexBasis)).toBeCloseTo(sw[s.key] ? (s.amount / data.paths.cashBudget) * 100 : 0, 6));
      expect(parseFloat(segs[segs.length - 1].style.flexBasis)).toBeCloseTo((want.investors / data.paths.cashBudget) * 100, 6);
    }
  });

  it('starts with grants off when the lead is without grants, and setSwitch/setLead follow', () => {
    const data = fixture();
    const { handle, slide, part } = mount(data, { lead: 'without-grants' });
    const grants = slide('numbers').querySelector('button[data-key="grants"]')!;
    expect(grants.getAttribute('aria-pressed')).toBe('false');
    expect(slide('numbers').querySelector('button[data-key="perks"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(part('investors').textContent).toBe(money(pathFor(data.paths, { grants: false }).investors, data.currency));
    handle.setLead('with-grants');
    expect(grants.getAttribute('aria-pressed')).toBe('true');
    expect(part('investors').textContent).toBe(money(pathFor(data.paths).investors, data.currency));
    handle.setSwitch('credit', true);
    expect(part('investors').textContent).toBe(money(pathFor(data.paths, { credit: true }).investors, data.currency));
    handle.setSwitch('no-such-source', true);
    expect(part('investors').textContent).toBe(money(pathFor(data.paths, { credit: true }).investors, data.currency));
  });

  it('always shows a legal line, even when the deck has none', () => {
    const data = fixture();
    const withLegal = mount(data);
    expect(withLegal.part('legal').textContent).toBe(data.legal);
    const without = mount({ ...data, legal: '   ' });
    expect(without.part('legal').textContent).toBe(DEFAULT_LEGAL);
    expect(DEFAULT_LEGAL.length).toBeGreaterThan(40);
  });

  it('in static mode has no buttons, only labelled chips, and adds the static class', () => {
    const data = fixture();
    const { root, slide, handle } = mount(data, { static: true });
    const deck = root.querySelector<HTMLElement>('.psd')!;
    expect(deck.classList.contains('psd-static')).toBe(true);
    expect(deck.hasAttribute('tabindex')).toBe(false);
    expect(slide('numbers').querySelectorAll('button').length).toBe(0);
    expect(root.querySelectorAll('button').length).toBe(0);
    const chips = [...slide('numbers').querySelectorAll<HTMLElement>('.psd-chip')];
    expect(chips.map(c => c.dataset.on)).toEqual(data.paths.sources.map(s => String(s.on)));
    expect(chips[0].textContent).toContain('Included');
    expect(chips[1].textContent).toContain('Not included');
    expect([...root.querySelectorAll('section')].every(s => s.classList.contains('psd-seen'))).toBe(true);
    expect(document.getElementById('psd-page-style')!.textContent).toContain('@page psd-deck');
    handle.destroy();
    expect(document.getElementById('psd-page-style')).toBeNull();
  });
});

describe('the ask slide', () => {
  it('fills {investors} and {grants} and changes with the grants toggle', () => {
    const data = fixture();
    const { slide, part } = mount(data);
    const grants = data.paths.sources.find(s => s.key === 'grants')!;
    const on = pathFor(data.paths), off = pathFor(data.paths, { grants: false });
    const body = () => part('ask-body').textContent ?? '';
    expect(body()).toContain(`We are raising ${money(on.investors, data.currency)} from investors.`);
    expect(body()).toContain(`cover another ${money(grants.amount, data.currency)} of the budget`);
    expect(body()).not.toMatch(/[{}]/);
    expect(part('ask-body').querySelector('.psd-ask-first')!.textContent).toBe(`We are raising ${money(on.investors, data.currency)} from investors. `);
    expect([...part('ask-body').querySelectorAll('.psd-amt')].map(e => e.textContent)).toEqual([money(on.investors, data.currency), money(grants.amount, data.currency)]);

    slide('numbers').querySelector<HTMLButtonElement>('button[data-key="grants"]')!.click();
    expect(body()).toContain(`We are raising ${money(off.investors, data.currency)} from investors.`);
    expect(body()).toContain('That is the whole raise if no grant comes in');
    expect(body()).not.toMatch(/[{}]/);
  });

  it('uses withGrants and takes the token out cleanly when the deck has no grants source', () => {
    const data = fixture();
    data.paths.sources = data.paths.sources.filter(s => s.key !== 'grants');
    const ask = data.slides.find(s => s.layout === 'ask') as Extract<DeckSlide, { layout: 'ask' }>;
    ask.withGrants = 'We need {investors}. Grants add {grants}.';
    ask.withoutGrants = 'WRONG';
    const { part } = mount(data, { lead: 'without-grants' });
    expect(part('ask-body').textContent).toBe(`We need ${money(pathFor(data.paths).investors, data.currency)}. Grants add.`);
  });
});

describe('recipients', () => {
  it('swaps the cover line, the note, the highlight and the lead, and leaves nothing of anyone else', () => {
    const data = fixture();
    const { handle, slide, part, text, root } = mount(data);
    const noNote = () => expect(root.querySelector('[data-part="ask-note"]')).toBeNull();
    const highlighted = () => [...slide('ways').querySelectorAll<HTMLElement>('.psd-highlight')].map(e => e.dataset.cardId);
    const grantsOn = () => slide('numbers').querySelector('button[data-key="grants"]')!.getAttribute('aria-pressed');

    expect(part('cover-line').textContent).toBe(data.coverLine);
    expect(highlighted()).toEqual([]);
    noNote();
    for (const r of data.recipients) { expect(text()).not.toContain(r.name); if (r.note) expect(text()).not.toContain(r.note); }

    handle.setRecipient('dana-invented');
    expect(part('cover-line').textContent).toBe('Prepared for Dana Invented.');
    expect(part('ask-note').textContent).toBe('A note only Dana should read.');
    expect(highlighted()).toEqual(['give']);
    expect(grantsOn()).toBe('true');
    expect(text()).not.toContain('Placeholder Fund');
    expect(text()).not.toContain('A note only the Fund should read.');

    handle.setRecipient('placeholder-fund');
    expect(part('cover-line').textContent).toBe('Prepared for The Placeholder Fund.');
    expect(part('ask-note').textContent).toBe('A note only the Fund should read.');
    expect(highlighted()).toEqual(['invest']);
    expect(grantsOn()).toBe('false');
    expect(text()).not.toContain('Dana');
    expect(text()).not.toContain('A note only Dana should read.');

    handle.setRecipient('quiet');   // no cover line of their own, no note, no highlight
    expect(part('cover-line').textContent).toBe(data.coverLine);
    noNote();
    expect(highlighted()).toEqual([]);
    expect(grantsOn()).toBe('true');
    expect(text()).not.toContain('Placeholder Fund');

    handle.setRecipient(null);
    expect(part('cover-line').textContent).toBe(data.coverLine);
    handle.setRecipient('nobody-we-know');
    expect(part('cover-line').textContent).toBe(data.coverLine);
  });

  it('never puts recipient slugs or other recipients in the markup', () => {
    const data = fixture();
    const { host } = mount(data, { recipient: 'dana-invented' });
    const html = host.shadowRoot!.innerHTML;
    expect(html).not.toContain('placeholder-fund');
    expect(html).not.toContain('Placeholder Fund');
    expect(html).not.toContain('Quiet Person');
  });

  it('lets opts.lead override the recipient’s lead', () => {
    const { slide } = mount(fixture(), { recipient: 'placeholder-fund', lead: 'with-grants' });
    expect(slide('numbers').querySelector('button[data-key="grants"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('follows location.hash when useHash is on, and ignores it when off', () => {
    const data = fixture();
    window.location.hash = '#dana-invented-without';
    const off = mount(data);
    expect(off.part('cover-line').textContent).toBe(data.coverLine);
    const on = mount(data, { useHash: true });
    expect(on.part('cover-line').textContent).toBe('Prepared for Dana Invented.');
    expect(on.slide('numbers').querySelector('button[data-key="grants"]')!.getAttribute('aria-pressed')).toBe('false');
    window.location.hash = '#placeholder-fund';
    window.dispatchEvent(new Event('hashchange'));
    expect(on.part('cover-line').textContent).toBe('Prepared for The Placeholder Fund.');
    window.location.hash = '#someone-else';
    window.dispatchEvent(new Event('hashchange'));
    expect(on.part('cover-line').textContent).toBe(data.coverLine);
    expect(on.text()).not.toContain('Placeholder Fund');
    on.handle.destroy();
    window.location.hash = '#dana-invented';
    window.dispatchEvent(new Event('hashchange'));   // nothing left listening
    expect(on.host.shadowRoot!.childNodes.length).toBe(0);
  });
});

describe('parseHash', () => {
  const slugs = ['dana', 'dana-invented', 'placeholder-fund', 'go-with'];
  it('reads the general deck, a slug, a lead, and falls back on anything unknown', () => {
    expect(parseHash('', slugs)).toEqual({ slug: null });
    expect(parseHash('#', slugs)).toEqual({ slug: null });
    expect(parseHash('#dana', slugs)).toEqual({ slug: 'dana' });
    expect(parseHash('#dana-without', slugs)).toEqual({ slug: 'dana', lead: 'without-grants' });
    expect(parseHash('#dana-with', slugs)).toEqual({ slug: 'dana', lead: 'with-grants' });
    expect(parseHash('#dana-invented', slugs)).toEqual({ slug: 'dana-invented' });
    expect(parseHash('#dana-invented-without', slugs)).toEqual({ slug: 'dana-invented', lead: 'without-grants' });
    expect(parseHash('#placeholder-fund-with', slugs)).toEqual({ slug: 'placeholder-fund', lead: 'with-grants' });
    expect(parseHash('#go-with', slugs)).toEqual({ slug: 'go-with' });               // a slug that ends like a lead is still the slug
    expect(parseHash('#go-with-without', slugs)).toEqual({ slug: 'go-with', lead: 'without-grants' });
    expect(parseHash('#without', slugs)).toEqual({ slug: null, lead: 'without-grants' });
    expect(parseHash('#with', slugs)).toEqual({ slug: null, lead: 'with-grants' });
    expect(parseHash('#DANA-Invented', slugs)).toEqual({ slug: 'dana-invented' });
    expect(parseHash('#nobody', slugs)).toEqual({ slug: null });
    expect(parseHash('#nobody-without', slugs)).toEqual({ slug: null });
    expect(parseHash('#dana-inv', slugs)).toEqual({ slug: null });
    expect(parseHash('#%E0%A4%A', slugs)).toEqual({ slug: null });
  });
});

describe('helpers', () => {
  it('initialSwitches turns only the grants source off for a without-grants lead', () => {
    const sources = [{ key: 'grants', on: true }, { key: 'ca', on: false }, { key: 'perks', on: true }];
    expect(initialSwitches(sources, 'with-grants')).toEqual({ grants: true, ca: false, perks: true });
    expect(initialSwitches(sources, 'without-grants')).toEqual({ grants: false, ca: false, perks: true });
  });
  it('fillAsk fills or removes the tokens', () => {
    expect(fillAsk('Raise {investors}, grants {grants}.', '$1', '$2').map(p => p.text).join('')).toBe('Raise $1, grants $2.');
    expect(fillAsk('Raise {investors}; the {grants} would come off.', '$1', null).map(p => p.text).join('')).toBe('Raise $1; the would come off.');
    expect(fillAsk('Only {investors}', '$1', '$2')).toEqual([{ text: 'Only ' }, { text: '$1', amount: true }]);
    expect(fillAsk('', '$1', '$2')).toEqual([]);
  });
  it('overflows compares injected sizes', () => {
    expect(overflows({ width: 1000, height: 500 }, { width: 1000, height: 500 })).toBe(false);
    expect(overflows({ width: 1000, height: 500 }, { width: 1000, height: 502 })).toBe(false);   // within tolerance
    expect(overflows({ width: 1000, height: 500 }, { width: 1000, height: 503 })).toBe(true);
    expect(overflows({ width: 1000, height: 500 }, { width: 1010, height: 400 })).toBe(true);
    expect(overflows({ width: 1000, height: 500 }, { width: 1000, height: 520 }, 30)).toBe(false);
    expect(overflows({ width: 0, height: 0 }, { width: 10, height: 10 })).toBe(false);          // not laid out (jsdom)
  });
  it('checkOverflow reports the slides whose box is smaller than its content', () => {
    const { handle, root } = mount(fixture());
    expect(handle.checkOverflow()).toEqual([]);   // jsdom lays nothing out
    const box = root.querySelectorAll<HTMLElement>('.psd-box')[2];
    for (const [k, v] of Object.entries({ clientWidth: 1000, clientHeight: 500, scrollWidth: 1000, scrollHeight: 640 })) Object.defineProperty(box, k, { configurable: true, value: v });
    expect(handle.checkOverflow()).toEqual([2]);
    expect(root.querySelectorAll('section')[2].getAttribute('data-overflow')).toBe('true');
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 500 });
    expect(handle.checkOverflow()).toEqual([]);
    expect(root.querySelectorAll('section')[2].getAttribute('data-overflow')).toBe('false');
  });
  it('safeColor, fontStack and readableOn', () => {
    expect(safeColor('#abc', '#fff')).toBe('#abc');
    expect(safeColor('rgb(1, 2, 3)', '#fff')).toBe('rgb(1, 2, 3)');
    expect(safeColor('url(x)', '#fff')).toBe('#fff');
    expect(safeColor('red; background:url(x)', '#fff')).toBe('#fff');
    expect(safeColor(undefined, '#fff')).toBe('#fff');
    expect(fontStack('"My Face", Georgia', 'serif')).toBe('"My Face", Georgia, serif');
    expect(fontStack('', 'serif')).toBe('serif');
    expect(fontStack('"Unbalanced', 'serif')).toBe('serif');
    expect(readableOn('#ffffff', '#fefefe', '#000000')).toBe('#000000');
    expect(readableOn('#000000', '#111111', '#ffffff')).toBe('#ffffff');
  });
  it('formats money, multiples and shares', () => {
    expect(money(627758.05, 'USD')).toBe('$627,758');
    expect(money(-0.2, 'USD')).toBe('$0');
    expect(money(1200, 'EUR')).toBe('€1,200');
    expect(money(1200, 'not a code')).toContain('1,200');
    expect(multiple(8)).toBe('8.0x');
    expect(multiple(1.26)).toBe('1.3x');
    expect(percent(0.2267)).toBe('23%');
  });
});

describe('destroy', () => {
  it('empties the host and stops answering', () => {
    const { host, handle, root } = mount(fixture(), { css: '.x{}' });
    const button = root.querySelector<HTMLButtonElement>('button.psd-toggle')!;
    const before = root.querySelector('[data-part="investors"]')!.textContent;
    handle.destroy();
    expect(host.shadowRoot!.childNodes.length).toBe(0);
    expect(host.classList.contains('psd-host')).toBe(false);
    expect(handle.slideCount).toBe(0);
    button.click();   // detached and unlistened: nothing happens, nothing throws
    handle.setSwitch('grants', false); handle.setRecipient('dana-invented'); handle.setLead('without-grants'); handle.goTo(3);
    expect(root.querySelector('[data-part="investors"]')).toBeNull();
    expect(before).toBeTruthy();
    handle.destroy();
  });
  it('can mount again into the same host', () => {
    const data = fixture();
    const first = mount(data);
    first.handle.destroy();
    const again = mountDeck(first.host, data);
    mounted.push(again);
    expect(first.host.shadowRoot!.querySelectorAll('section').length).toBe(data.slides.length);
  });
  it('falls back to the host itself where there is no shadow DOM', () => {
    const data = fixture();
    const host = document.createElement('div');
    (host as unknown as { attachShadow: unknown }).attachShadow = undefined;
    const handle = mountDeck(host, data, { css: '.x{}' });
    expect(host.querySelectorAll('section').length).toBe(data.slides.length);
    expect(host.querySelector('style')).toBeTruthy();
    handle.destroy();
    expect(host.childNodes.length).toBe(0);
  });
});

describe('what the runtime may import', () => {
  const here = resolve(process.cwd(), 'src/deck-runtime');
  // every way a module can be named: from '…', import '…', import('…'), require('…'), with any of the three quotes
  const importsOf = (src: string) => [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g)].map(m => m[2]);
  it('the scanner sees static, side-effect, dynamic and backtick imports', () => {
    const sample = ["import a from './a';", 'import "./b";', "const c = await import('./c');", 'const d = await import(`./d`);', "const e = require('./e');", "export { f } from './f';"].join('\n');
    expect(importsOf(sample)).toEqual(['./a', './b', './c', './d', './e', './f']);
    expect('const d = await import(`../ui/${x}`);').toMatch(/\bimport\s*\(/);
  });
  const allowed: Record<string, string[]> = {
    'runtime.ts': ['../engine/pathMath', './data', './format', './fonts', './motion', './paper'],
    'motion.ts': ['./data'],   // the movement vocabulary: types only come in
    'paper.ts': ['./data'],    // the papers' vocabulary and the arithmetic of their edges: types only come in
    'format.ts': [],
    'fonts.ts': [],
    'data.ts': ['../engine/pathMath'],
    'exportHtml.ts': ['./data', './fonts', './hash'],   // the page a deck is sent as: text in, text out
    'hash.ts': [],
  };
  for (const file of Object.keys(allowed)) {
    it(`${file} imports only its neighbours and the pure math modules`, () => {
      const src = readFileSync(resolve(here, file), 'utf8');
      const found = importsOf(src);
      for (const spec of found) expect(allowed[file].includes(spec), `${file} imports ${spec}`).toBe(true);
      expect(src, `${file} has a dynamic import or a require`).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
      if (file === 'runtime.ts') expect(found).toContain('../engine/pathMath');
      if (file === 'data.ts' || file === 'motion.ts' || file === 'paper.ts') expect(src).not.toMatch(/^import (?!type\b)/m);   // types only
    });
    it(`${file} builds no markup from strings and runs no strings as code`, () => {
      const src = readFileSync(resolve(here, file), 'utf8');
      expect(src).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|\bfetch\s*\(|XMLHttpRequest|https?:\/\//);
    });
  }
  it('the engine modules the runtime uses import nothing but each other and types', () => {
    for (const file of ['pathMath.ts', 'split.ts']) {
      const src = readFileSync(resolve(process.cwd(), 'src/engine', file), 'utf8');
      for (const spec of importsOf(src)) expect(['./split', './types'].includes(spec), `${file} imports ${spec}`).toBe(true);
    }
  });
});

// ---------- review fixes ----------

const STRESS_THEMES = [
  { bg: '#f7f3ea', ink: '#1c1a17', accent: '#c2410c', accent2: '#1d4ed8', muted: '#6b665e', card: '#ffffff', cardInk: '#1c1a17', line: '#8a8378' },
  { bg: '#ffffff', ink: '#111111', accent: '#f5b700', accent2: '#00b4d8', muted: '#8a8a8a', card: '#fff8dc', cardInk: '#222222', line: '#bbbbbb' },
  { bg: '#1b1d24', ink: '#e6e6e6', accent: '#3a3f52', accent2: '#2a2e3d', muted: '#5a5f70', card: '#22252e', cardInk: '#d8d8d8', line: '#343846' },
  { bg: '#f4f1ec', ink: '#3b3a38', accent: '#d9c9a8', accent2: '#c8d3e0', muted: '#b9b4ab', card: '#f0ece4', cardInk: '#4a4844', line: '#ddd8cf' },
];
const key = (e: Element, type: string, init: KeyboardEventInit = {}) => e.dispatchEvent(new KeyboardEvent('keydown', { key: type, bubbles: true, cancelable: true, composed: true, ...init }));
const currentIndex = (root: ParentNode) => [...root.querySelectorAll('section')].findIndex(s => s.hasAttribute('data-current'));
/** Everything in the shadow tree: text, every attribute, hidden nodes and all. */
const everything = (host: HTMLElement) => host.shadowRoot!.innerHTML;

describe('colour', () => {
  it('parses, mixes and measures', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#15151b')).toEqual([21, 21, 27]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('tomato')).toBeNull();
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('tomato', '#ffffff')).toBe(0);
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColors('#102030', '#ffffff', 0)).toBe('#102030');
    expect(mixColors('tomato', '#ffffff', 0.5)).toBe('tomato');
  });
  it('textSafe leaves a colour that passes alone and moves one that fails only as far as it must', () => {
    expect(textSafe('#1d4ed8', ['#f7f3ea'], '#1c1a17')).toBe('#1d4ed8');
    const fixed = textSafe('#f5b700', ['#ffffff'], '#111111');
    expect(fixed).not.toBe('#f5b700');
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed, '#ffffff')).toBeLessThan(6.5);   // not all the way to the ink
    expect(contrastRatio(textSafe('#888888', ['#808080'], '#909090'), '#808080')).toBeGreaterThanOrEqual(4.5);   // an ink that cannot help: black or white
    expect(textSafe('tomato', ['#ffffff'], '#111111')).toBe('#111111');
  });
  for (const theme of STRESS_THEMES) {
    it(`every text colour derived from ${theme.bg} / ${theme.accent} reaches 4.5:1`, () => {
      const v = deckColors(theme);
      expect(v['--psd-accent']).toBe(theme.accent);   // fills keep the theme's own colours
      expect(v['--psd-accent2']).toBe(theme.accent2);
      const panel = mixColors(theme.bg, v['--psd-ink'], 0.07);
      for (const name of ['--psd-ink', '--psd-accent-text', '--psd-accent2-text', '--psd-muted-text', '--psd-soft', '--psd-legal']) {
        expect(contrastRatio(v[name], theme.bg), `${name} on the background`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(v[name], panel), `${name} on a panel`).toBeGreaterThanOrEqual(4.5);
      }
      for (const name of ['--psd-card-ink', '--psd-card-accent', '--psd-card-muted']) expect(contrastRatio(v[name], v['--psd-card']), name).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v['--psd-row-text'], v['--psd-row'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v['--psd-row-ink'], v['--psd-row'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v['--psd-on-accent'], theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v['--psd-on-accent2'], theme.accent2)).toBeGreaterThanOrEqual(4.5);
      // on a picture slide: the same, with 15% of anything showing through the scrim
      const p = deckColors(theme, 0.15);
      for (const name of Object.keys(p)) for (const behind of ['#000000', '#ffffff']) {
        expect(contrastRatio(p[name], mixColors(theme.bg, behind, 0.15)), `${name} over a ${behind} picture`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it('sets the derived colours on the deck and, stricter, on a picture slide; the scrim is at least 85%', () => {
    const data = fixture();
    data.theme.colors = { ...STRESS_THEMES[1] };
    const { root, slide } = mount(data);
    const deck = root.querySelector<HTMLElement>('.psd')!;
    expect(deck.style.getPropertyValue('--psd-accent')).toBe('#f5b700');
    expect(contrastRatio(deck.style.getPropertyValue('--psd-accent-text'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const cover = slide('cover');
    expect(cover.classList.contains('psd-has-picture')).toBe(true);
    expect(contrastRatio(cover.style.getPropertyValue('--psd-accent-text'), mixColors('#ffffff', '#000000', 0.15))).toBeGreaterThanOrEqual(4.5);
    expect(parseFloat(cover.querySelector<HTMLElement>('.psd-scrim')!.style.getPropertyValue('--psd-scrim'))).toBeGreaterThanOrEqual(85);
    expect(slide('text').style.getPropertyValue('--psd-accent-text')).toBe('');
  });
  it('a theme in colours it cannot measure is passed through, and nothing throws', () => {
    const data = fixture();
    data.theme.colors = { bg: 'white', ink: 'black', accent: 'oklch(0.7 0.2 30)', accent2: 'teal', muted: 'gray', card: 'ivory', cardInk: 'black', line: 'gray' };
    const { root } = mount(data);
    expect(root.querySelector<HTMLElement>('.psd')!.style.getPropertyValue('--psd-accent')).toBe('oklch(0.7 0.2 30)');
  });
});

describe('fit and overflow', () => {
  const size = (e: Element, v: Record<string, number>) => { for (const [k, n] of Object.entries(v)) Object.defineProperty(e, k, { configurable: true, value: n }); };
  it('steps a slide that overflows down through the sizes, keeps the first that fits, and starts again from the top each time', () => {
    const { handle, root } = mount(fixture());
    const section = root.querySelectorAll<HTMLElement>('section')[2], box = section.querySelector<HTMLElement>('.psd-box')!;
    size(box, { clientWidth: 1000, clientHeight: 500, scrollWidth: 1000 });
    // fits only once the type is at 1.25
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => (section.style.getPropertyValue('--psd-fs') ? 500 : 560) });
    expect(handle.checkOverflow()).toEqual([]);
    expect(section.style.getPropertyValue('--psd-fs')).toBe('1.25');
    expect(section.dataset.overflow).toBe('false');
    expect(handle.checkOverflow()).toEqual([]);                       // idempotent
    expect(section.style.getPropertyValue('--psd-fs')).toBe('1.25');
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 500 });   // the content got shorter: back to full size
    handle.checkOverflow();
    expect(section.style.getPropertyValue('--psd-fs')).toBe('');
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 900 });   // nothing helps: smallest size, flagged
    expect(handle.checkOverflow()).toEqual([2]);
    expect(section.style.getPropertyValue('--psd-fs')).toBe('1.1');
    expect(section.dataset.overflow).toBe('true');
  });
  it('counts a child that sticks out of its column sideways', () => {
    const { handle, root, slide } = mount(fixture());
    const numbers = slide('numbers'), index = [...root.querySelectorAll('section')].indexOf(numbers);
    size(numbers.querySelector('.psd-box')!, { clientWidth: 1000, clientHeight: 500, scrollWidth: 1000, scrollHeight: 500 });
    expect(handle.checkOverflow()).toEqual([]);
    size(numbers.querySelector('.psd-num-left')!, { clientWidth: 400, scrollWidth: 460 });
    expect(handle.checkOverflow()).toEqual([index]);
    expect(numbers.dataset.overflow).toBe('true');
  });
  it('sizes the big figure by its length and stacks the pair when it is long', () => {
    const big = (budget: number, currency = 'USD') => {
      const data = fixture(); data.paths.cashBudget = budget; data.currency = currency;
      for (const s of data.paths.sources) s.on = false;
      const figs = mount(data).slide('numbers').querySelector<HTMLElement>('.psd-figs')!;
      return [figs.dataset.size, figs.classList.contains('psd-figs-stack')];
    };
    expect(big(811_758)).toEqual(['l', false]);          // $811,758
    expect(big(1_811_758)).toEqual(['m', true]);         // $1,811,758
    expect(big(12_811_758)).toEqual(['m', true]);        // $12,811,758
    expect(big(128_117_580)).toEqual(['s', true]);       // $128,117,580
    expect(big(128_117_580, 'JPY')).toEqual(['s', true]);
  });
  it('sizes headlines and the cover title by their length, and the team list by its head count', () => {
    const data = fixture();
    const text = data.slides.find(s => s.layout === 'text')!;
    text.headline = 'A headline that runs a good deal longer than forty-five characters'; text.punch = '';
    const cards = data.slides.find(s => s.layout === 'cards')!;
    cards.headline = 'x'.repeat(90);
    const cover = data.slides.find(s => s.layout === 'cover') as Extract<DeckSlide, { layout: 'cover' }>;
    cover.title = 'A Title Of More Than Twenty Characters';
    const team = data.slides.find(s => s.layout === 'team') as Extract<DeckSlide, { layout: 'team' }>;
    team.members = Array.from({ length: 5 }, (_, i) => ({ name: `Person ${i} Invented`, role: 'Role', bio: 'Invented.' }));
    const { slide } = mount(data);
    expect(slide('text').querySelector('.psd-h')!.classList.contains('psd-h-long')).toBe(true);
    expect(slide('cards').querySelector('.psd-h')!.classList.contains('psd-h-xlong')).toBe(true);
    expect(slide('photo').querySelector('.psd-h')!.className).toBe('psd-h psd-rise');
    expect(slide('cover').querySelector('.psd-title')!.classList.contains('psd-title-long')).toBe(true);
    expect(slide('team').querySelector('.psd-team')!.classList.contains('psd-team-cols')).toBe(true);
    expect(mount(fixture()).slide('team').querySelector('.psd-team')!.classList.contains('psd-team-cols')).toBe(false);
  });
  it('marks a slide that is only its headline', () => {
    const data = fixture();
    const text = data.slides.find(s => s.layout === 'text') as Extract<DeckSlide, { layout: 'text' }>;
    text.body = ''; text.aside = []; text.closing = ''; text.footnote = 'Small print stays.';
    const { slide } = mount(data);
    expect(slide('text').classList.contains('psd-only-head')).toBe(true);
    expect(slide('cards').classList.contains('psd-only-head')).toBe(false);
  });
});

describe('the numbers slide, made clearer', () => {
  it('says what the control is, live and static, and captions both tables', () => {
    const data = fixture();
    (data.slides.find(s => s.layout === 'numbers') as Extract<DeckSlide, { layout: 'numbers' }>).body = '';
    const liveDeck = mount(data).slide('numbers');
    expect(liveDeck.querySelector('.psd-toggles-lab .psd-screen')!.textContent).toBe('Switch a source on or off');
    expect(liveDeck.querySelector('.psd-toggles-lab .psd-paper')!.textContent).toBe('Funding sources');
    expect(liveDeck.querySelector('.psd-cases caption')!.textContent).toBeTruthy();
    expect(liveDeck.querySelector('.psd-combos caption')!.textContent).toContain('Investors fund');
    const staticDeck = mount(data, { static: true }).slide('numbers');
    expect(staticDeck.querySelector('.psd-toggles-lab')!.textContent).toBe('Funding sources');
    expect(staticDeck.querySelector('[data-part="legal"]')!.textContent).toBe(data.legal);   // the legal line is in the PDF too
  });
  it('names each combination in the row itself, not in an aria-label on the row, and draws its marks as shapes', () => {
    const { slide } = mount(fixture());
    const rows = [...slide('numbers').querySelectorAll<HTMLElement>('.psd-combos tbody tr')];
    expect(rows.every(r => !r.hasAttribute('aria-label'))).toBe(true);
    expect(rows[0].querySelector('th[scope="row"] .psd-vh')!.textContent).toBe('With Grants and fiscal sponsorship + Invented tax credit + Invented perks');
    expect(rows[7].querySelector('th[scope="row"] .psd-vh')!.textContent).toBe('Investors alone');
    expect(rows[0].querySelectorAll('.psd-mark .psd-ic-check').length).toBe(3);
    expect(rows[7].querySelectorAll('.psd-mark .psd-ic-dash').length).toBe(3);
    expect(rows[0].querySelector('.psd-mark')!.textContent).toBe('on');
    expect(rows.every(r => r.firstElementChild!.classList.contains('psd-cur') && !!r.firstElementChild!.querySelector('.psd-ic-tri'))).toBe(true);
    // no glyph ticks, pointers or arrows anywhere in the deck
    expect(slide('numbers').textContent).not.toMatch(/[✓–▸→]/);
    expect(slide('model').textContent).not.toMatch(/→/);
    expect(slide('model').querySelectorAll('.psd-arrow .psd-ic-arrow').length).toBe(2);
  });
  it('with more than three sources shows this selection, everything on and investors alone, never 2^n rows', () => {
    const data = fixture();
    data.paths.sources.push({ key: 'presale', label: 'Invented presale', amount: 60_000, on: false });
    const { slide, handle } = mount(data);
    const numbers = slide('numbers');
    const rows = () => [...numbers.querySelectorAll<HTMLElement>('.psd-combos tbody tr')];
    const shown = () => rows().filter(r => !r.hidden);
    const amount = (r: HTMLElement) => r.lastElementChild!.textContent;
    expect(rows().length).toBe(3);
    expect(shown().map(r => r.querySelector('th')!.textContent)).toEqual(['This selection', 'Everything on', 'Investors alone']);
    expect(amount(shown()[0])).toBe(money(pathFor(data.paths).investors, data.currency));
    expect(amount(shown()[1])).toBe(money(pathFor(data.paths, { grants: true, credit: true, perks: true, presale: true }).investors, data.currency));
    expect(amount(shown()[2])).toBe(money(data.paths.cashBudget, data.currency));
    expect(shown().map(r => r.getAttribute('aria-current'))).toEqual(['true', null, null]);
    handle.setSwitch('credit', true); handle.setSwitch('presale', true);   // now everything is on: the selection row folds into it
    expect(shown().map(r => r.querySelector('th')!.textContent)).toEqual(['Everything on', 'Investors alone']);
    expect(shown().map(r => r.getAttribute('aria-current'))).toEqual(['true', null]);
    expect(rows()[0].hasAttribute('aria-current')).toBe(false);
    for (const k of ['grants', 'credit', 'perks', 'presale']) handle.setSwitch(k, false);
    expect(shown().map(r => r.getAttribute('aria-current'))).toEqual([null, 'true']);
  });
  it('reads at most eight sources from a file, however many it holds', () => {
    const data = fixture();
    data.paths.sources = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, label: `Invented source ${i}`, amount: 1000, on: i % 2 === 0 }));
    const { slide } = mount(data);
    expect(MAX_SOURCES).toBe(8);
    expect(slide('numbers').querySelectorAll('.psd-toggle').length).toBe(8);
    expect(slide('numbers').querySelectorAll('.psd-combos tbody tr').length).toBe(3);
    expect(slide('numbers').querySelectorAll('.psd-seg').length).toBe(9);
  });
  it('the bar, its label and its legend agree, and the percentages total 100', () => {
    const data = fixture();
    data.paths.cashBudget = 300_000;
    data.paths.sources = [
      { key: 'grants', label: 'Invented grants', amount: 100_000, on: true },
      { key: 'credit', label: 'Invented credit', amount: 100_000, on: true },
      { key: 'perks', label: 'Invented perks', amount: 50_000, on: false },
    ];
    const { slide, handle } = mount(data);
    const numbers = slide('numbers');
    const legend = () => [...numbers.querySelectorAll<HTMLElement>('.psd-legend-item')].filter(li => !li.hidden).map(li => li.textContent);
    const label = () => numbers.querySelector('.psd-stack')!.getAttribute('aria-label');
    expect(legend()).toEqual(['Invented grants34%', 'Invented credit33%', 'Investors33%']);   // thirds: 34 + 33 + 33
    expect(label()).toBe('Share of the budget: Invented grants 34%, Invented credit 33%, Investors 33%');
    expect(numbers.querySelector('.psd-stack')!.textContent).toBe('');   // nothing is written inside the bar
    handle.setSwitch('perks', true);
    expect(legend()).toEqual(['Invented grants33%', 'Invented credit33%', 'Invented perks17%', 'Investors17%']);
    expect(label()).toContain('Invented perks 17%');
    for (const k of ['grants', 'credit', 'perks']) handle.setSwitch(k, false);
    expect(legend()).toEqual(['Investors100%']);
    expect(label()).toBe('Share of the budget: Investors 100%');
  });
  it('shares100 always totals 100', () => {
    expect(shares100([1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares100([184_000, 627_758.05])).toEqual([23, 77]);
    expect(shares100([1, 0, 999])).toEqual([0, 0, 100]);
    expect(shares100([0, 0])).toEqual([0, 0]);
    expect(shares100([NaN, -5, 10])).toEqual([0, 0, 100]);
    for (const a of [[3, 3, 3, 3, 3, 3, 3], [1, 2, 3, 4, 5, 6], [0.5, 99.5], [12.5, 12.5, 12.5, 62.5]]) expect(shares100(a).reduce((x, y) => x + y, 0)).toBe(100);
  });
  it('the fee note carries the fee the cases were worked out with', () => {
    const data = fixture();
    const { slide } = mount(data);
    expect(data.paths.feePct).toBe(20);
    expect(slide('numbers').querySelector('.psd-casenote')!.textContent).toContain('20%');
    const mid = [...slide('numbers').querySelectorAll('tr[data-case]')][1];
    expect(mid.querySelector('[data-col="gross"]')!.textContent).toBe('$2,250,000');
    expect(mid.querySelector('[data-col="net"]')!.textContent).toBe('$1,800,000');   // 20% off the top
  });
  it('with no revenue cases leaves out the returns table and its fee note, and keeps the funding side', () => {
    const data = fixture();
    data.paths.cases = [];
    const { slide } = mount(data);
    const numbers = slide('numbers');
    expect(numbers.querySelector('.psd-cases')).toBeNull();
    expect(numbers.querySelector('.psd-casenote')).toBeNull();
    expect(numbers.querySelectorAll('thead th').length).toBe(5);   // only the tick matrix's own header (a pointer column, three sources, the amount)
    expect(numbers.textContent).not.toMatch(/Receipts|To investors|Multiple/);
    expect(numbers.querySelector('.psd-combos')).toBeTruthy();
    expect(numbers.querySelectorAll('.psd-toggle').length).toBe(3);
    expect(numbers.querySelector('[data-part="investors"]')!.textContent).toBe(money(pathFor(data.paths).investors, data.currency));
    data.paths.sources = [];
    const bare = mount(data).slide('numbers');
    expect(bare.querySelector('table')).toBeNull();
    expect(bare.querySelector('.psd-numbers')!.classList.contains('psd-one')).toBe(true);
    expect(bare.querySelector('[data-part="legal"]')).toBeTruthy();
  });
  it('sets a currency symbol the title face may not have in the body face, and leaves the dollar alone', () => {
    const eur = fixture(); eur.currency = 'EUR';
    const inv = mount(eur).part('investors');
    expect(inv.querySelector('.psd-sym')!.textContent).toBe('€');
    expect(inv.textContent).toBe(money(pathFor(eur.paths).investors, 'EUR'));
    expect(mount(fixture()).part('investors').querySelector('.psd-sym')).toBeNull();
    expect(moneyParts(1200, 'JPY')).toEqual([{ text: '¥', symbol: true }, { text: '1,200' }]);
    expect(moneyParts(1200, 'not a code').map(p => p.text).join('')).toContain('1,200');
  });
});

describe('the ask slide, after review', () => {
  it('leaves out a headline that only repeats the eyebrow, and keeps one that says something', () => {
    const data = fixture();
    const ask = data.slides.find(s => s.layout === 'ask')!;
    ask.eyebrow = 'The ask'; ask.headline = ' the ASK ';
    expect(mount(data).slide('ask').querySelector('.psd-h')).toBeNull();
    ask.headline = 'What we need from you';
    expect(mount(data).slide('ask').querySelector('.psd-h1')!.textContent).toBe('What we need from you');
  });
  it('never shows more grant money than there is budget, and a covered budget prints no NaN, Infinity or minus zero', () => {
    const data = fixture();
    data.paths.cashBudget = 5_000_000;
    data.paths.sources = [{ key: 'grants', label: 'Invented grants', amount: 50_000_000, on: true }];
    const { part, slide, text } = mount(data);
    expect(part('investors').textContent).toBe('$0');
    expect(part('ask-body').textContent).toContain('We are raising $0 from investors.');
    expect(part('ask-body').textContent).toContain('cover another $5,000,000 of the budget');
    expect(text()).not.toContain('$50,000,000 of the budget');
    expect(text()).not.toMatch(/NaN|Infinity|-0|-\$|e\+/);
    expect([...slide('numbers').querySelectorAll('[data-col="multiple"]')].map(e => e.textContent)).toEqual(['0.0x', '0.0x', '0.0x']);
    expect(slide('numbers').querySelector('.psd-stack')!.getAttribute('aria-label')).toBe('Share of the budget: Invented grants 100%');
  });
});

describe('keyboard and focus', () => {
  it('pages with the arrows, PageDown, Home and End, and stops at the ends', () => {
    vi.useFakeTimers();
    const { root } = mount(fixture());
    const deck = root.querySelector<HTMLElement>('.psd')!;
    const n = root.querySelectorAll('section').length;
    const press = (k: string, init?: KeyboardEventInit) => { key(deck, k, init); vi.advanceTimersByTime(2000); return currentIndex(root); };
    expect(currentIndex(root)).toBe(0);
    expect(press('ArrowRight')).toBe(1);
    expect(press('ArrowDown')).toBe(2);
    expect(press('PageDown')).toBe(3);
    expect(press(' ')).toBe(4);
    expect(press('ArrowLeft')).toBe(3);
    expect(press('ArrowUp')).toBe(2);
    expect(press('PageUp')).toBe(1);
    expect(press(' ', { shiftKey: true })).toBe(0);
    expect(press('ArrowLeft')).toBe(0);
    expect(press('End')).toBe(n - 1);
    expect(press('ArrowRight')).toBe(n - 1);
    expect(press('Home')).toBe(0);
    expect(press('ArrowRight', { ctrlKey: true })).toBe(0);
    expect(press('a')).toBe(0);
  });
  it('lands every one of a run of quick presses', () => {
    vi.useFakeTimers();
    const { root } = mount(fixture());
    const deck = root.querySelector<HTMLElement>('.psd')!;
    for (let i = 0; i < 5; i++) { key(deck, 'ArrowRight'); vi.advanceTimersByTime(60); }
    expect(currentIndex(root)).toBe(5);
    for (let i = 0; i < 3; i++) key(deck, 'ArrowLeft');
    expect(currentIndex(root)).toBe(2);
  });
  it('steps from where a scroll is going, not from where the view still is, while it is in flight', () => {
    vi.useFakeTimers();
    // a laid-out deck whose view never moves (jsdom does not scroll): every stage stays where it started
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const stage = this.classList.contains('psd-stage') ? [...this.parentElement!.children].indexOf(this) : 0;
      const sized = this.classList.contains('psd') || this.classList.contains('psd-stage');
      const top = stage * 900;
      return { x: 0, y: top, top, left: 0, width: sized ? 1600 : 0, height: sized ? 900 : 0, right: sized ? 1600 : 0, bottom: top + (sized ? 900 : 0), toJSON() { return {}; } } as DOMRect;
    });
    const { root } = mount(fixture());
    const deck = root.querySelector<HTMLElement>('.psd')!;
    for (let i = 0; i < 5; i++) { key(deck, 'ArrowRight'); vi.advanceTimersByTime(60); }
    expect(currentIndex(root)).toBe(5);
    vi.advanceTimersByTime(3000);   // the flight is over and the view (here) never moved: the next press steps from the view
    key(deck, 'ArrowRight');
    expect(currentIndex(root)).toBe(1);
  });
  it('makes every slide but the current one inert, and not in a static or stacked deck', () => {
    const { root, handle } = mount(fixture());
    const inert = () => [...root.querySelectorAll('section')].map(s => s.hasAttribute('inert'));
    expect(inert().filter(x => !x).length).toBe(1);
    expect(inert()[0]).toBe(false);
    handle.goTo(11);
    expect(inert()[11]).toBe(false);
    expect(inert().filter(x => !x).length).toBe(1);
    expect(mount(fixture(), { static: true }).root.querySelectorAll('[inert]').length).toBe(0);
    const stackedDeck = mount(fixture(), { stacked: true });
    expect(stackedDeck.root.querySelector('.psd')!.classList.contains('psd-stacked')).toBe(true);
    expect(stackedDeck.root.querySelectorAll('[inert]').length).toBe(0);
    stackedDeck.handle.goTo(3);   // paging still works when stacked
    expect(currentIndex(stackedDeck.root)).toBe(3);
    expect(stackedDeck.root.querySelectorAll('[inert]').length).toBe(0);
    const toggle = stackedDeck.slide('numbers').querySelector<HTMLButtonElement>('button.psd-toggle')!;
    toggle.focus();
    key(toggle, 'ArrowLeft');     // paged away from a focused toggle: focus goes to the deck here too
    expect(stackedDeck.host.shadowRoot!.activeElement).toBe(stackedDeck.root.querySelector('.psd'));
  });
  it('moves focus left on another slide to the deck, so a hidden toggle never takes Enter or Space', () => {
    const { root, host, handle, slide } = mount(fixture());
    const deck = root.querySelector<HTMLElement>('.psd')!;
    const numbers = [...root.querySelectorAll('section')].indexOf(slide('numbers'));
    handle.goTo(numbers);
    const toggle = slide('numbers').querySelector<HTMLButtonElement>('button.psd-toggle')!;
    toggle.focus();
    expect(host.shadowRoot!.activeElement).toBe(toggle);
    key(toggle, 'ArrowRight');
    expect(currentIndex(root)).toBe(numbers + 1);
    expect(host.shadowRoot!.activeElement).toBe(deck);
    expect(slide('numbers').hasAttribute('inert')).toBe(true);
    handle.goTo(numbers);
    toggle.focus();
    key(toggle, ' ');   // Space on a button is the button's, not a page turn
    expect(currentIndex(root)).toBe(numbers);
    expect(host.shadowRoot!.activeElement).toBe(toggle);
  });
  it('does not take focus when it mounts, and pages from the page only when asked to', () => {
    vi.useFakeTimers();
    const plain = mount(fixture());
    expect(plain.host.shadowRoot!.activeElement).toBeNull();
    expect(document.activeElement).toBe(document.body);
    key(document.body, 'ArrowRight');
    expect(currentIndex(plain.root)).toBe(0);
    const paged = mount(fixture(), { pageKeys: true });
    key(document.body, 'ArrowRight');
    expect(currentIndex(paged.root)).toBe(1);
    expect(currentIndex(plain.root)).toBe(0);
    const input = document.createElement('input'); document.body.appendChild(input);
    key(input, 'ArrowRight');   // a key meant for something else on the page
    expect(currentIndex(paged.root)).toBe(1);
  });
});

describe('small hosts', () => {
  const sized = (w: number, h: number) => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const deck = this.classList.contains('psd');
    return { x: 0, y: 0, top: 0, left: 0, width: deck ? w : 0, height: deck ? h : 0, right: deck ? w : 0, bottom: deck ? h : 0, toJSON() { return {}; } } as DOMRect;
  });
  const classes = (w: number, h: number, opts: Parameters<typeof mountDeck>[2] = {}) => { sized(w, h); const c = mount(fixture(), opts).root.querySelector('.psd')!.className; vi.restoreAllMocks(); return c; };
  it('stacks below 600px wide or when a slide would be under 420px tall, and not otherwise', () => {
    expect(classes(390, 844)).toContain('psd-stacked');     // phone, upright
    expect(classes(844, 390)).toContain('psd-stacked');     // phone, on its side
    expect(classes(599, 2000)).toContain('psd-stacked');
    expect(classes(1024, 768)).not.toContain('psd-stacked');
    expect(classes(1600, 900)).not.toContain('psd-stacked');
    expect(classes(1200, 0)).toBe('psd psd-unbounded');     // no height of its own: slides at the page's width
    expect(classes(500, 0)).toContain('psd-stacked');
    expect(classes(390, 844, { stacked: false })).not.toContain('psd-stacked');
    expect(classes(390, 844, { stacked: false })).toBe('psd psd-scaled');   // a scaled preview, with no pixel floor under small print
    expect(classes(1600, 900, { stacked: true })).toContain('psd-stacked');
    expect(classes(390, 844, { static: true })).toBe('psd psd-static');
  });
  it('follows the host as it is resized, and nothing is inert while stacked', () => {
    vi.useFakeTimers();
    let fire: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { fire = cb; } observe() {} disconnect() {} });
    sized(1600, 900);
    const { root } = mount(fixture());
    const deck = root.querySelector('.psd')!;
    expect(deck.classList.contains('psd-stacked')).toBe(false);
    expect(root.querySelectorAll('[inert]').length).toBe(root.querySelectorAll('section').length - 1);
    vi.restoreAllMocks(); sized(390, 844);
    fire(); fire(); vi.advanceTimersByTime(200);
    expect(deck.classList.contains('psd-stacked')).toBe(true);
    expect(root.querySelectorAll('[inert]').length).toBe(0);
    vi.restoreAllMocks(); sized(1600, 900);
    fire(); vi.advanceTimersByTime(200);
    expect(deck.classList.contains('psd-stacked')).toBe(false);
    expect(root.querySelectorAll('[inert]').length).toBe(root.querySelectorAll('section').length - 1);
  });
});

describe('recipients, isolated', () => {
  const others = (data: DeckData, slug: string | null) => data.recipients.filter(r => r.slug !== slug).flatMap(r => [r.name, r.note ?? '', r.slug, r.coverLine].filter(Boolean));
  const mine = (data: DeckData, slug: string) => { const r = data.recipients.find(x => x.slug === slug)!; return [r.coverLine, r.note ?? ''].filter(Boolean); };
  it('after every switch, nothing of anyone else is anywhere in the tree: text, attributes, hidden nodes', () => {
    const data = fixture();
    const { host, handle } = mount(data, { useHash: true });
    const check = (slug: string | null) => {
      const all = everything(host);
      for (const secret of others(data, slug)) expect(all, `"${secret}" while showing ${slug}`).not.toContain(secret);
      if (slug) for (const own of mine(data, slug)) expect(all).toContain(own);
    };
    check(null);
    for (const slug of ['dana-invented', 'placeholder-fund', 'quiet', 'dana-invented', 'quiet', null, 'placeholder-fund', 'nobody-we-know']) {
      handle.setRecipient(slug);
      check(data.recipients.some(r => r.slug === slug) ? slug : null);
    }
    for (const [hash, slug] of [['#dana-invented', 'dana-invented'], ['#quiet', 'quiet'], ['#placeholder-fund-with', 'placeholder-fund'], ['#quiet-without', 'quiet'], ['#dana-invented-without', 'dana-invented'], ['', null], ['#placeholder-fund', 'placeholder-fund'], ['#without', null]] as const) {
      window.location.hash = hash;
      window.dispatchEvent(new Event('hashchange'));
      check(slug);
    }
  });
  it('takes the previous note out of the document when the next recipient has none', () => {
    const data = fixture();
    const { host, handle, root } = mount(data, { recipient: 'dana-invented' });
    expect(root.querySelector('[data-part="ask-note"]')!.textContent).toBe('A note only Dana should read.');
    handle.setRecipient('quiet');
    expect(root.querySelector('[data-part="ask-note"]')).toBeNull();
    expect(root.querySelectorAll('.psd-ask-note').length).toBe(0);
    expect(everything(host)).not.toContain('only Dana');
    handle.setRecipient('placeholder-fund');
    expect(root.querySelectorAll('[data-part="ask-note"]').length).toBe(1);
    handle.setRecipient(null);
    expect(root.querySelector('[data-part="ask-note"]')).toBeNull();
  });
  it('marks the highlighted card as current, and only that one', () => {
    const { handle, slide } = mount(fixture(), { recipient: 'dana-invented' });
    const current = () => [...slide('ways').querySelectorAll<HTMLElement>('.psd-card[aria-current="true"]')].map(e => e.dataset.cardId);
    expect(current()).toEqual(['give']);
    handle.setRecipient('placeholder-fund');
    expect(current()).toEqual(['invest']);
    handle.setRecipient('quiet');
    expect(current()).toEqual([]);
    expect(slide('ways').querySelector('[aria-current]')).toBeNull();
  });
  it('setRecipient resets every switch and forgets a lead; setLead moves only the grants switch', () => {
    const data = fixture();   // saved: grants on, credit off, perks on
    const { handle, slide } = mount(data, { recipient: 'dana-invented', lead: 'without-grants' });
    const on = () => Object.fromEntries([...slide('numbers').querySelectorAll<HTMLElement>('button.psd-toggle')].map(b => [b.dataset.key, b.getAttribute('aria-pressed') === 'true']));
    expect(on()).toEqual({ grants: false, credit: false, perks: true });          // opts.lead overrides Dana's with-grants lead
    handle.setSwitch('credit', true); handle.setSwitch('perks', false);
    handle.setLead('with-grants');
    expect(on()).toEqual({ grants: true, credit: true, perks: false });           // only grants moved
    handle.setLead('without-grants');
    expect(on()).toEqual({ grants: false, credit: true, perks: false });
    handle.setRecipient('dana-invented');
    expect(on()).toEqual({ grants: true, credit: false, perks: true });           // everything back to Dana's opening, the lead forgotten
    handle.setLead('without-grants');
    handle.setRecipient('placeholder-fund');
    expect(on()).toEqual({ grants: false, credit: false, perks: true });          // the Fund's own lead
    handle.setLead('with-grants');
    handle.setRecipient(null);
    expect(on()).toEqual({ grants: true, credit: false, perks: true });
    handle.setLead('nonsense' as never);                                          // anything but without-grants is with-grants
    expect(on().grants).toBe(true);
  });
  it('normalises a recipient’s lead and ignores recipients it cannot address', () => {
    const cleaned = cleanRecipients([
      { slug: 'a', name: 'A Invented', coverLine: 'For A.', lead: 'without-grants' },
      { slug: 'b', name: 'B Invented', lead: 'sideways' },
      { slug: 'c', name: 'C Invented' },
      { name: 'No Slug Invented', coverLine: 'For nobody.' },
      { slug: '', name: 'Empty Slug Invented' },
      { slug: 7, name: 'Number Slug Invented' },
      { slug: 'a', name: 'Second A Invented' },
      { slug: 'with', name: 'W' }, { slug: 'without', name: 'W' }, { slug: 'with-grants', name: 'W' }, { slug: 'without-grants', name: 'W' },
      { slug: 'go-with', name: 'W' }, { slug: 'go-without', name: 'W' }, { slug: 'Go-WITH', name: 'W' },
      null, 'text', [1],
    ]);
    expect(cleaned.map(r => [r.slug, r.lead])).toEqual([['a', 'without-grants'], ['b', 'with-grants'], ['c', 'with-grants'], ['7', 'with-grants']]);
    expect(cleaned[0].name).toBe('A Invented');
    for (const s of ['with', 'without', 'with-grants', 'without-grants', 'x-with', 'x-without']) expect(reservedSlug(s), s).toBe(true);
    for (const s of ['within', 'withouts', 'with-x', 'grants', 'dana-invented', 'x-with-grants']) expect(reservedSlug(s), s).toBe(false);
  });
  it('never opens on a recipient with no slug, whatever the caller leaves out', () => {
    const data = fixture();
    (data.recipients as unknown[]).unshift({ name: 'Slugless Invented', coverLine: 'Prepared for Slugless Invented.', note: 'A slugless note.', lead: 'without-grants', highlightCardId: 'give' });
    for (const opts of [{}, { recipient: undefined }, { recipient: '' }, { recipient: null as never }]) {
      const { host, part, slide } = mount(data, opts);
      expect(part('cover-line').textContent).toBe(data.coverLine);
      expect(everything(host)).not.toContain('Slugless');
      expect(slide('numbers').querySelector('button[data-key="grants"]')!.getAttribute('aria-pressed')).toBe('true');
    }
  });
});

describe('lifecycle', () => {
  it('a second mount on a host replaces the first; the stale handle can do nothing to the new deck', () => {
    const data = fixture();
    const first = mount(data, { useHash: true });
    const second = mountDeck(first.host, data, { useHash: true });
    mounted.push(second);
    const sections = () => first.host.shadowRoot!.querySelectorAll('section').length;
    expect(sections()).toBe(data.slides.length);
    expect(first.handle.slideCount).toBe(0);     // the first deck has gone
    first.handle.destroy();                      // a stale destroy: a no-op
    first.handle.setRecipient('dana-invented'); first.handle.setSwitch('grants', false); first.handle.goTo(4);
    expect(sections()).toBe(data.slides.length);
    expect(first.host.classList.contains('psd-host')).toBe(true);
    const line = () => first.host.shadowRoot!.querySelector('[data-part="cover-line"]')!.textContent;
    expect(line()).toBe(data.coverLine);
    window.location.hash = '#dana-invented';
    window.dispatchEvent(new Event('hashchange'));   // the new deck still listens, once
    expect(line()).toBe('Prepared for Dana Invented.');
    second.destroy();
    expect(first.host.shadowRoot!.childNodes.length).toBe(0);
  });
  it('keeps the shared page rule until the last deck that needs it has gone', () => {
    const data = fixture();
    const style = () => document.querySelectorAll('#psd-page-style').length;
    const a = mount(data, { static: true }), b = mount(data, { static: true }), c = mount(data);
    expect(style()).toBe(1);
    a.handle.destroy();
    expect(style()).toBe(1);
    a.handle.destroy();   // twice: still counted once
    expect(style()).toBe(1);
    b.handle.destroy();
    expect(style()).toBe(1);   // the live deck prints too
    c.handle.destroy();
    expect(style()).toBe(0);
    const d = mount(data, { static: true });
    expect(style()).toBe(1);
    d.handle.destroy();
    expect(style()).toBe(0);
  });
  it('leaves no listener, observer or timer behind', () => {
    window.location.hash = '#dana-invented';   // before the clock is faked: jsdom announces the change on a timer of its own
    vi.useFakeTimers();
    const liveListeners = new Set<string>();
    const targets: [string, EventTarget][] = [['window', window], ['document', document]];
    const watch = (name: string, t: EventTarget) => {
      const add = t.addEventListener.bind(t), remove = t.removeEventListener.bind(t);
      const ids = new Map<unknown, number>(); let next = 0;
      const id = (type: string, fn: unknown) => { if (!ids.has(fn)) ids.set(fn, next++); return `${name}:${type}:${ids.get(fn)}`; };
      vi.spyOn(t, 'addEventListener').mockImplementation(((type: string, fn: never, o?: never) => { liveListeners.add(id(type, fn)); add(type, fn, o); }) as never);
      vi.spyOn(t, 'removeEventListener').mockImplementation(((type: string, fn: never, o?: never) => { liveListeners.delete(id(type, fn)); remove(type, fn, o); }) as never);
    };
    for (const [name, t] of targets) watch(name, t);
    const observers = { made: 0, live: 0 };
    const Observer = class { constructor(_cb: unknown) { observers.made++; observers.live++; } observe() {} unobserve() {} disconnect() { observers.live--; } };
    vi.stubGlobal('ResizeObserver', Observer);
    vi.stubGlobal('IntersectionObserver', Observer);

    const host = document.createElement('div');
    document.body.appendChild(host);
    watch('host', host);
    const data = fixture();
    const handle = mountDeck(host, data, { useHash: true, pageKeys: true, css: '.x{}' });
    expect([...liveListeners].sort()).toEqual(['document:fullscreenchange:1', 'document:keydown:0', 'window:hashchange:0']);
    expect(observers.made).toBe(2);
    handle.goTo(3); handle.setSwitch('grants', false);
    host.shadowRoot!.querySelector('.psd')!.dispatchEvent(new Event('scroll'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    // a remount on the same host, mid-flight: the first deck's listeners go with it
    const again = mountDeck(host, data, { useHash: true, pageKeys: true });
    expect(liveListeners.size).toBe(3);
    expect(observers.live).toBe(2);
    again.goTo(5);
    again.destroy();
    handle.destroy();
    expect([...liveListeners]).toEqual([]);
    expect(observers.live).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.shadowRoot!.childNodes.length).toBe(0);
    expect(document.getElementById('psd-page-style')).toBeNull();
    // two static decks side by side
    const h2 = document.createElement('div'); document.body.appendChild(h2);
    const s1 = mountDeck(host, data, { static: true }), s2 = mountDeck(h2, data, { static: true });
    s1.destroy();
    expect(h2.shadowRoot!.querySelectorAll('section').length).toBe(data.slides.length);
    expect(document.getElementById('psd-page-style')).toBeTruthy();
    s2.destroy();
    expect([...liveListeners]).toEqual([]);
    expect(observers.live).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.getElementById('psd-page-style')).toBeNull();
  });
});

describe('hostile and hand-edited data', () => {
  const tryMount = (data: unknown, opts: Parameters<typeof mountDeck>[2] = {}) => mount(data as DeckData, opts);
  it('str takes text from anything', () => {
    expect([str('a'), str(4), str(NaN), str(null), str(undefined), str({}), str([1]), str(true)]).toEqual(['a', '4', '', '', '', '', '', '']);
  });
  it('mounts whatever is missing', () => {
    for (const data of [null, undefined, 42, 'deck', [], {}, { slides: 'no' }, { slides: [null, 3, 'x', [], {}] }, { ...fixture(), paths: undefined }, { ...fixture(), paths: null }, { ...fixture(), paths: 'x' },
      { ...fixture(), paths: { cashBudget: '9', sources: 'no', cases: null } }, { ...fixture(), paths: { sources: [null, 4, { key: 'grants' }] } }, { ...fixture(), theme: null, images: null, recipients: 'x', currency: 7, legal: 9, film: null }]) {
      expect(() => tryMount(data), JSON.stringify(data)?.slice(0, 60)).not.toThrow();
      expect(() => tryMount(data, { static: true })).not.toThrow();
    }
    const { text, root } = tryMount({ ...fixture(), paths: undefined });
    expect(text()).not.toMatch(/NaN|undefined|Infinity|\[object/);
    expect(root.querySelector('[data-part="investors"]')!.textContent).toBe('$0');
    expect(root.querySelector('[data-part="legal"]')!.textContent).toBe(fixture().legal);
  });
  it('mounts every layout with nulls in its lists and anything in its text fields', () => {
    const junk: unknown[] = [null, undefined, 7, true, {}, [], { x: 1 }, ['a', null]];
    for (const bad of junk) {
      const data = fixture() as unknown as { slides: Record<string, unknown>[] };
      for (const s of data.slides) {
        for (const k of Object.keys(s)) {
          if (k === 'layout') continue;
          if (Array.isArray(s[k])) s[k] = [null, bad, ...(s[k] as unknown[]).map(item => (item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).map(f => [f, bad])) : bad)), 5];
          else s[k] = bad;
        }
      }
      let deck!: ReturnType<typeof mount>;
      expect(() => { deck = tryMount(data); }, `with ${JSON.stringify(bad)}`).not.toThrow();
      expect(deck.handle.slideCount).toBe(LAYOUTS.length);
      expect(deck.text()).not.toMatch(/undefined|\[object|NaN/);
      expect(() => { deck.handle.setRecipient('dana-invented'); deck.handle.setLead('without-grants'); deck.handle.goTo(99); deck.handle.checkOverflow(); }).not.toThrow();
    }
  });
  it('skips layouts it does not know, including names every object has', () => {
    const data = fixture();
    const n = data.slides.length;
    (data.slides as unknown[]).push({ id: 'a', layout: 'constructor' }, { id: 'b', layout: 'toString' }, { id: 'c', layout: '__proto__' }, { id: 'd', layout: 5 }, { id: 'e' }, { id: 'f', layout: 'hologram' });
    expect(tryMount(data).handle.slideCount).toBe(n);
  });
  it('drops sources with reserved or repeated keys, and keeps its switches off every prototype', () => {
    const cleaned = cleanPaths({
      cashBudget: 1000, cases: [{ label: 'Mid', gross: 5000 }, null, { label: 3, gross: 'x' }], feePct: '20', waterfall: null,
      sources: [{ key: '__proto__', label: 'P', amount: 1, on: true }, { key: 'constructor', label: 'C', amount: 1, on: true }, { key: 'prototype', label: 'T', amount: 1, on: true },
        { key: 'grants', label: 'Invented grants', amount: 100, on: true }, { key: 'grants', label: 'Again', amount: 900, on: true }, { key: '', amount: 5 }, { label: 'No key', amount: 5 }, null,
        { key: 'toString', label: 'Odd but allowed', amount: -50, on: 1 }, { key: 'hasOwnProperty', amount: 'lots', on: false }],
    });
    expect(cleaned.sources.map(s => [s.key, s.label, s.amount, s.on])).toEqual([['grants', 'Invented grants', 100, true], ['toString', 'Odd but allowed', 0, true], ['hasOwnProperty', 'hasOwnProperty', 0, false]]);
    expect(cleaned.cases).toEqual([{ label: 'Mid', gross: 5000 }, { label: '3', gross: 0 }]);
    expect(cleaned.feePct).toBe(0);
    expect(cleaned.waterfall.model).toBe('off-the-gross');
    const sw = initialSwitches(cleaned.sources, 'with-grants');
    expect(Object.getPrototypeOf(sw)).toBeNull();
    expect(sw.toString).toBe(true);

    const data = fixture();
    (data.paths.sources as unknown[]).unshift({ key: '__proto__', label: 'Proto source', amount: 5, on: true }, { key: 'constructor', label: 'Ctor source', amount: 5, on: true });
    data.paths.sources.push({ key: 'grants', label: 'Twice', amount: 1, on: true }, { key: 'toString', label: 'Invented odd key', amount: 10_000, on: false });
    const before = Object.keys(Object.prototype).length;
    const { slide, handle, part, text } = tryMount(data);
    const keys = [...slide('numbers').querySelectorAll<HTMLElement>('button.psd-toggle')].map(b => b.dataset.key);
    expect(keys).toEqual(['grants', 'credit', 'perks', 'toString']);
    expect(text()).not.toMatch(/Proto source|Ctor source|Twice/);
    const clean = cleanPaths(data.paths);
    expect(part('investors').textContent).toBe(money(pathFor(clean).investors, 'USD'));
    handle.setSwitch('__proto__', true); handle.setSwitch('constructor', true);
    expect(part('investors').textContent).toBe(money(pathFor(clean).investors, 'USD'));
    handle.setSwitch('toString', true);
    slide('numbers').querySelector<HTMLButtonElement>('button[data-key="toString"]')!.click();
    slide('numbers').querySelector<HTMLButtonElement>('button[data-key="toString"]')!.click();
    expect(part('investors').textContent).toBe(money(pathFor(clean, { toString: true } as Record<string, boolean>).investors, 'USD'));
    expect(Object.keys(Object.prototype).length).toBe(before);
    expect(({} as Record<string, unknown>).grants).toBeUndefined();
  });
  it('ignores recipients with reserved link endings, so a link ending never means two things', () => {
    const data = fixture();
    data.recipients.push({ slug: 'without', name: 'Reserved Invented', coverLine: 'Prepared for Reserved.', lead: 'with-grants' }, { slug: 'dana-invented-without', name: 'Shadow Invented', coverLine: 'Prepared for Shadow.', lead: 'with-grants' });
    window.location.hash = '#without';
    const a = mount(data, { useHash: true });
    expect(a.part('cover-line').textContent).toBe(data.coverLine);
    expect(a.slide('numbers').querySelector('button[data-key="grants"]')!.getAttribute('aria-pressed')).toBe('false');
    window.location.hash = '#dana-invented-without';
    window.dispatchEvent(new Event('hashchange'));
    expect(a.part('cover-line').textContent).toBe('Prepared for Dana Invented.');
    a.handle.setRecipient('without');
    expect(a.part('cover-line').textContent).toBe(data.coverLine);
    expect(everything(a.host)).not.toMatch(/Reserved|Shadow/);
  });
});

describe('formatting, against strings written by hand', () => {
  it('money rounds to whole units and never prints a minus zero', () => {
    expect(money(627758.05, 'USD')).toBe('$627,758');
    expect(money(627758.5, 'USD')).toBe('$627,759');
    expect(money(627758.49, 'USD')).toBe('$627,758');
    expect(money(0.49, 'USD')).toBe('$0');
    expect(money(0.5, 'USD')).toBe('$1');
    expect(money(-0.49, 'USD')).toBe('$0');
    expect(money(-0, 'USD')).toBe('$0');
    expect(money(-0.004, 'USD')).toBe('$0');
    expect(money(-1234.4, 'USD')).toBe('-$1,234');
    expect(money(999999.5, 'USD')).toBe('$1,000,000');
    expect(money(128117580, 'USD')).toBe('$128,117,580');
    expect(money(1811758, 'EUR')).toBe('€1,811,758');
    expect(money(1811758.6, 'JPY')).toBe('¥1,811,759');
    expect(money(1811758, 'GBP')).toBe('£1,811,758');
    expect(money(1811758, 'CAD')).toBe('CA$1,811,758');
    expect(money(1e21, 'USD')).toBe('$1,000,000,000,000,000,000,000');
    expect(money(1200, '')).toBe('$1,200');
    expect(money(NaN, 'USD')).toBe('—');
    expect(money(Infinity, 'USD')).toBe('—');
    expect(money('12' as never, 'USD')).toBe('—');
  });
  it('multiples and shares never print a minus zero or an exponent', () => {
    expect(multiple(8)).toBe('8.0x');
    expect(multiple(1.25)).toBe('1.3x');
    expect(multiple(1.24)).toBe('1.2x');
    expect(multiple(0)).toBe('0.0x');
    expect(multiple(-0)).toBe('0.0x');
    expect(multiple(-0.04)).toBe('0.0x');
    expect(multiple(0.04)).toBe('0.0x');
    expect(multiple(-0.06)).toBe('-0.1x');
    expect(multiple(999.94)).toBe('999.9x');
    expect(multiple(999.96)).toBe('999x+');
    expect(multiple(1000)).toBe('999x+');
    expect(multiple(1e21)).toBe('999x+');
    expect(multiple(1e300)).toBe('999x+');
    expect(multiple(-1e21)).toBe('-999x+');
    expect(multiple(NaN)).toBe('—');
    expect(multiple(Infinity)).toBe('—');
    expect(percent(0.2267)).toBe('23%');
    expect(percent(-0.001)).toBe('0%');
    expect(percent(NaN)).toBe('—');
    for (const n of [0, -0, 1e-9, -1e-9, 0.05, 123.456, 1e6, 1e21, 1e300, -1e300]) {
      expect(multiple(n)).not.toMatch(/e|-0\.0x/);
      expect(money(n, 'USD')).not.toMatch(/e|-\$0$/);
    }
  });
});

// A font file, as the app would attach it. The bytes are invented: no browser in these tests ever parses them.
const FONT = 'data:font/woff2;base64,d09GMgABAAAAAA==';
const OTHER_FONT = 'data:application/octet-stream;base64,AAEAAAAKAIAAAwAg';

describe('font files', () => {
  /** A stand-in for the browser's FontFace and document.fonts, which jsdom does not have. */
  function stubFonts() {
    const made: { family: string; src: string; status: string; load: () => Promise<unknown> }[] = [];
    const set = new Set<unknown>();
    class Face { status = 'unloaded'; constructor(public family: string, public src: string) { made.push(this); } load() { this.status = 'loaded'; return Promise.resolve(this); } }
    vi.stubGlobal('FontFace', Face);
    (window as unknown as { FontFace: unknown }).FontFace = Face;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (f: unknown) => { set.add(f); }, delete: (f: unknown) => set.delete(f), ready: Promise.resolve() } });
    return { made, set };
  }
  afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; delete (window as unknown as { FontFace?: unknown }).FontFace; });
  const withFaces = (faces: unknown): DeckData => { const d = fixture(); (d.theme as unknown as { fontFaces: unknown }).fontFaces = faces; return d; };
  const stackOf = (root: ParentNode, which: 'title' | 'body') => (root.querySelector('.psd') as HTMLElement).style.getPropertyValue(`--psd-${which}-font`);

  it('takes only a base64 font data URL as a source', () => {
    for (const ok of [FONT, OTHER_FONT, 'data:font/ttf;base64,AAEAAAA=', 'data:font/otf;base64,T1RUTw==', 'data:application/font-woff;base64,d09GRg==', 'data:application/x-font-ttf;base64,AAEAAAA=', 'data:application/font-sfnt;base64,AAEA', 'DATA:FONT/WOFF2;BASE64,d09GMg=='])
      expect(fontSrcOk(ok)).toBe(true);
    for (const bad of ['', 'https://example.com/a.woff2', '//example.com/a.woff2', 'a.woff2', 'blob:https://example.com/1', 'data:text/html;base64,PGI+', 'data:image/png;base64,iVBOR', 'data:font/woff2,plain', 'data:font/woff2;base64,', 'data:font/woff2;base64,AA"); x{}', 'data:font/woff2;base64,AAAA) format("woff2"), url(https://example.com/a.woff2', 'data:font/woff2;base64,AA AA', 'data:font/woff2;base64,AA\nAA', 'data:application/javascript;base64,AAAA', 'data:application/octet-streamx;base64,AAAA', ' data:font/woff2;base64,AAAA', 42, null, undefined, {}])
      expect(fontSrcOk(bad)).toBe(false);
  });
  it('cleans a family name down to letters, digits, spaces and hyphens', () => {
    expect(cleanFamily('Invented Grotesk-2')).toBe('Invented Grotesk-2');
    expect(cleanFamily('  Made   Up  ')).toBe('Made Up');
    expect(cleanFamily('x"; } body { display: none } @import url(https://example.com/a.css); "')).toBe('x body display none import urlhttpsexample.coma.css'.replace(/\./g, ''));
    expect(cleanFamily('a\\b</style>')).toBe('abstyle');
    expect(cleanFamily("O'Invented")).toBe('OInvented');
    expect(cleanFamily('é字')).toBe('');
    expect(cleanFamily('A'.repeat(200))).toHaveLength(60);
    for (const v of [null, undefined, 7, {}, []]) expect(cleanFamily(v)).toBe('');
    expect(faceName('title', 'Invented Grotesk', FONT)).toBe(`psd-title Invented Grotesk ${shortHash(FONT)}`);
    expect(faceName('title', 'Invented Grotesk', FONT)).toMatch(/^psd-title Invented Grotesk [a-z0-9]{1,7}$/);
    expect(faceName('body', 'Invented Grotesk', FONT)).not.toBe(faceName('title', 'Invented Grotesk', FONT));        // one name a role
    expect(faceName('title', 'Invented Grotesk', OTHER_FONT)).not.toBe(faceName('title', 'Invented Grotesk', FONT));   // and one a file
    expect(shortHash('')).toBe(shortHash(''));
    expect(shortHash('a')).not.toBe(shortHash('b'));
  });
  it('drops every face a hand-edited file gets wrong, and reads eight at most', () => {
    expect(cleanFontFaces([
      { family: 'Good One', src: FONT, role: 'title' },
      { family: 'Remote', src: 'https://example.com/a.woff2', role: 'title' },
      { family: '"; }', src: FONT, role: 'body' },
      { family: 'No Role', src: FONT },
      { family: 'Odd Role', src: FONT, role: 'caption' },
      'text', null, 5,
      { family: 'Good <Two>', src: OTHER_FONT, role: 'body' },
    ])).toEqual([{ family: 'Good One', src: FONT, role: 'title' }, { family: 'Good Two', src: OTHER_FONT, role: 'body' }]);
    expect(cleanFontFaces(Array.from({ length: 12 }, (_, i) => ({ family: `F ${i}`, src: FONT, role: 'body' })))).toHaveLength(8);
    for (const v of [undefined, null, 'x', 3, {}]) expect(cleanFontFaces(v)).toEqual([]);
  });
  it('registers each face with the document and puts it in front of its role\'s stack', () => {
    const { made, set } = stubFonts();
    const { root, handle } = mount(withFaces([{ family: 'Invented Slab', src: FONT, role: 'title' }, { family: 'Invented Sans', src: OTHER_FONT, role: 'body' }]), { css: '.x{}' });
    expect(made.map(f => f.family)).toEqual([faceName('title', 'Invented Slab', FONT), faceName('body', 'Invented Sans', OTHER_FONT)]);
    expect(made[0].src).toBe(`url("${FONT}")`);
    expect(set.size).toBe(2);
    expect(stackOf(root, 'title')).toMatch(/^"psd-title Invented Slab [a-z0-9]+", /);
    expect(stackOf(root, 'title')).toContain('Special Elite');   // the built-in fallback is still behind it
    expect(stackOf(root, 'title')).not.toContain('Invented Sans');
    expect(stackOf(root, 'body')).toMatch(/^"psd-body Invented Sans [a-z0-9]+", /);
    expect(stackOf(root, 'body')).toContain('Work Sans');
    // nothing is written into the shadow tree as a rule, and nothing into the document's head but the page rule
    expect([...(root as ParentNode).querySelectorAll('style')].map(st => st.textContent)).toEqual(['.x{}']);
    expect(document.head.textContent).not.toContain('font-face');
    handle.destroy();
    expect(set.size).toBe(0);   // the faces go with the deck
  });
  it('never lets a hostile family name or address reach the stylesheet', () => {
    const { made, set } = stubFonts();
    const { root } = mount(withFaces([
      { family: 'Evil"; } .psd { display: none } @import url(https://evil.invalid/x.css); "', src: FONT, role: 'title' },
      { family: 'Remote', src: 'https://evil.invalid/a.woff2', role: 'body' },
      { family: 'Breakout', src: 'data:font/woff2;base64,AAAA"), url("https://evil.invalid/a.woff2', role: 'body' },
      { family: 'Script', src: 'javascript:alert(1)', role: 'body' },
    ]));
    expect(made).toHaveLength(1);
    expect(made[0].family).toMatch(/^psd-title [A-Za-z0-9 -]+$/);
    expect(set.size).toBe(1);
    const title = stackOf(root, 'title'), body = stackOf(root, 'body');
    for (const stack of [title, body]) { expect(stack).not.toMatch(/[;{}()@:/\\]/); expect(stack).not.toContain('evil.invalid'); expect((stack.match(/"/g) ?? []).length % 2).toBe(0); }
    expect(body).not.toContain('Remote');
    expect(body).not.toContain('Breakout');
    expect((root as unknown as Node).textContent).not.toContain('evil.invalid');
  });
  it('shares one registration between decks that carry the same file, and keeps it across a remount', () => {
    const { made, set } = stubFonts();
    const data = withFaces([{ family: 'Invented Slab', src: FONT, role: 'title' }]);
    const a = mount(data), b = mount(data);
    expect(made).toHaveLength(1);
    expect(set.size).toBe(1);
    const again = mountDeck(a.host, data);   // a remount on the same host: the face is never dropped and read again
    mounted.push(again);
    expect(made).toHaveLength(1);
    expect(set.size).toBe(1);
    a.handle.destroy();                      // the handle that was replaced: nothing to let go of twice
    expect(set.size).toBe(1);
    again.destroy();
    expect(set.size).toBe(1);                // the other deck still uses it
    b.handle.destroy();
    expect(set.size).toBe(0);
    mounted.push(mountDeck(a.host, withFaces([{ family: 'Invented Slab', src: OTHER_FONT, role: 'title' }])));   // another file under the same name is another face
    expect(made).toHaveLength(2);
  });
  it('a title file and a body file with the same family name are two faces, each in its own stack', () => {
    const { made, set } = stubFonts();
    const { root } = mount(withFaces([{ family: 'Same Name', src: FONT, role: 'title' }, { family: 'Same Name', src: OTHER_FONT, role: 'body' }]));
    expect(made).toHaveLength(2);
    expect(new Set(made.map(f => f.family)).size).toBe(2);
    expect(set.size).toBe(2);
    const title = made.find(f => f.src === `url("${FONT}")`)!.family, body = made.find(f => f.src === `url("${OTHER_FONT}")`)!.family;
    expect(stackOf(root, 'title').startsWith(`"${title}", `)).toBe(true);
    expect(stackOf(root, 'title')).not.toContain(body);
    expect(stackOf(root, 'body').startsWith(`"${body}", `)).toBe(true);
    expect(stackOf(root, 'body')).not.toContain(title);
  });
  it('two live decks with one family name and different files do not share a face', () => {
    const { made, set } = stubFonts();
    const a = mount(withFaces([{ family: 'Same Name', src: FONT, role: 'title' }]));
    const b = mount(withFaces([{ family: 'Same Name', src: OTHER_FONT, role: 'title' }]));
    expect(made).toHaveLength(2);
    expect(made[0].family).not.toBe(made[1].family);
    expect(stackOf(a.root, 'title')).toContain(made[0].family);
    expect(stackOf(a.root, 'title')).not.toContain(made[1].family);
    expect(stackOf(b.root, 'title')).toContain(made[1].family);
    a.handle.destroy();
    expect(set.size).toBe(1);
    expect([...set][0]).toBe(made[1]);   // the other deck's face is still there
  });
  it('a mount that fails lets go of the faces it took', () => {
    const { made, set } = stubFonts();
    const data = withFaces([{ family: 'Invented Slab', src: FONT, role: 'title' }]);
    Object.defineProperty(data, 'slides', { get() { throw new Error('a getter that throws'); } });
    const host = document.createElement('div'); document.body.appendChild(host);
    expect(() => mountDeck(host, data)).toThrow('a getter that throws');
    expect(made).toHaveLength(1);
    expect(set.size).toBe(0);
    const ok = mount(withFaces([{ family: 'Invented Slab', src: FONT, role: 'title' }]));   // and the next mount starts clean
    expect(set.size).toBe(1);
    ok.handle.destroy();
    expect(set.size).toBe(0);
  });
  it('fits the slides again once a face has loaded', async () => {
    const { made } = stubFonts();
    const { handle } = mount(withFaces([{ family: 'Invented Slab', src: FONT, role: 'title' }]));
    const spy = vi.spyOn(handle, 'checkOverflow');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(made[0].status).toBe('loaded');
    expect(spy).not.toHaveBeenCalled();   // the deck refits itself: nobody has to ask
    expect(handle.checkOverflow()).toEqual([]);
  });
  it('mounts without the FontFace API (and with one that throws): the stack still names the face', () => {
    const plain = mount(withFaces([{ family: 'Invented Slab', src: FONT, role: 'title' }]));
    expect(stackOf(plain.root, 'title')).toMatch(/^"psd-title Invented Slab [a-z0-9]+", /);
    vi.stubGlobal('FontFace', class { constructor() { throw new Error('no'); } });
    (window as unknown as { FontFace: unknown }).FontFace = (globalThis as unknown as { FontFace: unknown }).FontFace;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: () => { throw new Error('no'); }, delete: () => false, ready: Promise.resolve() } });
    expect(() => mount(withFaces([{ family: 'Invented Slab', src: FONT, role: 'title' }]))).not.toThrow();
    expect(() => mount(withFaces('nonsense'))).not.toThrow();
  });
  it('a deck with no font files is drawn exactly as before', () => {
    const { made } = stubFonts();
    const { root } = mount(fixture());
    expect(made).toHaveLength(0);
    expect(stackOf(root, 'title')).not.toContain('psd-');
  });
});

describe('the preview options', () => {
  it('opens on the slide asked for, and says nothing about it', () => {
    const seen: number[] = [];
    const { root, handle } = mount(fixture(), { startAt: 3, onSlide: i => seen.push(i) });
    const sections = [...root.querySelectorAll('section')];
    expect(sections.findIndex(s => s.hasAttribute('data-current'))).toBe(3);
    expect(sections.filter(s => !s.hasAttribute('inert'))).toHaveLength(1);
    expect(seen).toEqual([]);
    handle.goTo(5);
    expect(seen).toEqual([5]);
    handle.goTo(5);
    expect(seen).toEqual([5]);   // only a change is reported
    handle.goTo(0);
    expect(seen).toEqual([5, 0]);
  });
  it('clamps a start that is out of range, and ignores one that is not a number', () => {
    const n = fixture().slides.length;
    const at = (startAt: unknown) => [...mount(fixture(), { startAt: startAt as number }).root.querySelectorAll('section')].findIndex(s => s.hasAttribute('data-current'));
    expect(at(999)).toBe(n - 1);
    expect(at(-4)).toBe(0);
    expect(at(NaN)).toBe(0);
    expect(at('2')).toBe(0);
    expect(at(1.6)).toBe(2);
  });
  it('after the host is resized the deck goes back to the slide it was on', () => {
    vi.useFakeTimers();
    let fire: () => void = () => undefined;
    class RO { constructor(cb: () => void) { fire = cb; } observe() { /* held in `fire` */ } disconnect() { /* nothing */ } }
    vi.stubGlobal('ResizeObserver', RO);
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
    const { root, handle } = mount(fixture());
    const deck = root.querySelector('.psd') as HTMLElement;
    Object.defineProperty(deck, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(deck, 'clientHeight', { configurable: true, value: 400 });
    const calls: ScrollToOptions[] = [];
    deck.scrollTo = ((o: ScrollToOptions) => { calls.push(o); }) as typeof deck.scrollTo;
    handle.goTo(4);
    calls.length = 0;
    fire(); vi.advanceTimersByTime(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].behavior).toBe('instant');
    expect([...root.querySelectorAll('section')].findIndex(s => s.hasAttribute('data-current'))).toBe(4);
    handle.goTo(0); calls.length = 0;
    fire(); vi.advanceTimersByTime(200);
    expect(calls).toHaveLength(0);   // on the first slide there is nowhere to go back to
    delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  });
  describe('a resize that re-snaps the scroll', () => {
    /** A deck laid out by hand (jsdom lays nothing out): 600px slides, the scroll offset under the test's control. */
    function laidOut(onSlide: (i: number) => void) {
      vi.useFakeTimers();
      let fire: () => void = () => undefined;
      class RO { constructor(cb: () => void) { fire = cb; } observe() { /* held in `fire` */ } disconnect() { /* nothing */ } }
      vi.stubGlobal('ResizeObserver', RO);
      (window as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
      const { root, handle } = mount(fixture(), { onSlide });
      const deck = root.querySelector('.psd') as HTMLElement;
      let top = 0;
      Object.defineProperty(deck, 'scrollHeight', { configurable: true, value: 7800 });
      Object.defineProperty(deck, 'clientHeight', { configurable: true, value: 600 });
      const rect = (t: number, h: number) => ({ top: t, bottom: t + h, left: 0, right: 1200, width: 1200, height: h, x: 0, y: t, toJSON: () => ({}) }) as DOMRect;
      deck.getBoundingClientRect = () => rect(0, 600);
      [...root.querySelectorAll<HTMLElement>('.psd-stage')].forEach((st, i) => {
        st.getBoundingClientRect = () => rect(i * 600 - top, 600);
        Object.defineProperty(st, 'offsetTop', { configurable: true, get: () => i * 600 });
      });
      const jumps: number[] = [];
      deck.scrollTo = ((o: ScrollToOptions) => { if (o.behavior === 'instant') jumps.push(o.top ?? 0); top = o.top ?? 0; }) as typeof deck.scrollTo;
      const current = () => [...root.querySelectorAll('section')].findIndex(s => s.hasAttribute('data-current'));
      const snapTo = (i: number) => { top = i * 600; deck.dispatchEvent(new Event('scroll')); };
      vi.advanceTimersByTime(1000);   // the mount's own first resize notice has run its course
      return { handle, deck, current, snapTo, resize: () => fire(), jumps, cleanup: () => { delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver; } };
    }
    it('without a resize, a scroll that settles on another slide is followed (the reader paged by hand)', () => {
      const seen: number[] = [];
      const t = laidOut(i => seen.push(i));
      t.handle.goTo(4); vi.advanceTimersByTime(2000);
      seen.length = 0;
      t.snapTo(1); vi.advanceTimersByTime(200);
      expect(t.current()).toBe(1);
      expect(seen).toEqual([1]);
      t.cleanup();
    });
    it.each([['the scroll comes first, then the resize notice', true], ['the resize notice comes first, then the scroll', false]])('%s: the slide and the selection stay', (_name, scrollFirst) => {
      const seen: number[] = [];
      const t = laidOut(i => seen.push(i));
      t.handle.goTo(4); vi.advanceTimersByTime(2000);
      seen.length = 0; t.jumps.length = 0;
      if (scrollFirst) { t.snapTo(1); vi.advanceTimersByTime(5); t.resize(); } else { t.resize(); vi.advanceTimersByTime(5); t.snapTo(1); }
      vi.advanceTimersByTime(130);          // the scroll would have settled by now
      expect(t.current()).toBe(4);
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(30);           // the resize handler runs: back to the slide the deck was on
      expect(t.jumps).toEqual([2400]);
      t.deck.dispatchEvent(new Event('scroll'));   // the scroll that jump made
      vi.advanceTimersByTime(250);
      expect(t.current()).toBe(4);
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(400);          // thawed: the reader's own scrolling is followed again
      t.snapTo(2); vi.advanceTimersByTime(200);
      expect(t.current()).toBe(2);
      expect(seen).toEqual([2]);
      t.cleanup();
    });
    it('entering or leaving full screen counts as a resize', () => {
      const seen: number[] = [];
      const t = laidOut(i => seen.push(i));
      t.handle.goTo(3); vi.advanceTimersByTime(2000);
      seen.length = 0; t.jumps.length = 0;
      document.dispatchEvent(new Event('fullscreenchange'));
      t.snapTo(0); vi.advanceTimersByTime(600);
      expect(t.current()).toBe(3);
      expect(seen).toEqual([]);
      expect(t.jumps).toEqual([1800]);
      t.cleanup();
    });
    it('paging with the handle still works while a resize is settling', () => {
      const seen: number[] = [];
      const t = laidOut(i => seen.push(i));
      t.resize();
      t.handle.goTo(2);
      expect(t.current()).toBe(2);
      expect(seen).toEqual([2]);
      t.cleanup();
    });
  });
  it('a listener that throws does not stop the deck paging', () => {
    const { root, handle } = mount(fixture(), { onSlide: () => { throw new Error('listener'); } });
    expect(() => handle.goTo(2)).not.toThrow();
    expect([...root.querySelectorAll('section')].findIndex(s => s.hasAttribute('data-current'))).toBe(2);
  });
  it('with motion off every slide is in its final state, and the deck still pages and switches', () => {
    const Observer = vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() }));
    vi.stubGlobal('IntersectionObserver', Observer);
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
    const { root, handle, slide } = mount(fixture(), { motion: false });
    const deck = root.querySelector('.psd')!;
    expect(deck.classList.contains('psd-still')).toBe(true);
    expect(deck.classList.contains('psd-static')).toBe(false);
    expect([...root.querySelectorAll('section')].every(s => s.classList.contains('psd-seen'))).toBe(true);
    expect(Observer).not.toHaveBeenCalled();
    expect(slide('numbers').querySelectorAll('button.psd-toggle').length).toBeGreaterThan(0);   // still the live slide
    expect((deck as HTMLElement).tabIndex).toBe(0);
    handle.goTo(1);
    expect(root.querySelectorAll('section')[1].hasAttribute('data-current')).toBe(true);
    expect(mount(fixture()).root.querySelector('.psd')!.classList.contains('psd-still')).toBe(false);
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  });
  it('the stylesheet holds a still deck where it lands', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/deck-runtime/deck.css'), 'utf8');
    expect(css).toMatch(/\.psd-still \.psd-rise \{ opacity: 1; transform: none; \}/);
    expect(css).toMatch(/\.psd-still \.psd-bar-fill \{ width: var\(--w, 0%\); \}/);
  });
  it('a recipient\'s card is picked out on a cards slide as well as a ways slide', () => {
    const data = fixture();
    const cards = data.slides.find(s => s.layout === 'cards') as Extract<DeckSlide, { layout: 'cards' }>;
    const target = cards.cards[1].id;
    data.recipients = [{ slug: 'ada-example', name: 'Ada Example', coverLine: '', lead: 'with-grants', highlightCardId: target }];
    const { slide, handle } = mount(data, { recipient: 'ada-example' });
    const lit = () => [...slide('cards').querySelectorAll<HTMLElement>('.psd-highlight')].map(e => e.dataset.cardId);
    expect(lit()).toEqual([target]);
    expect(slide('cards').querySelector('.psd-highlight')!.getAttribute('aria-current')).toBe('true');
    expect(slide('ways').querySelectorAll('.psd-highlight')).toHaveLength(0);
    handle.setRecipient(null);
    expect(lit()).toEqual([]);
  });
});

describe('the scratch page', () => {
  const run = (...args: string[]) => execFileSync('node', [resolve(process.cwd(), 'tools/deck-scratch.mjs'), ...args], { encoding: 'utf8' });
  it('writes no recipient unless one is named, and then only that one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psd-scratch-'));
    const data = fixture();
    data.film = 'Salt </script><script>window.__pwned = 1</script> Flat';
    writeFileSync(join(dir, 'deck.json'), JSON.stringify(data));
    const general = join(dir, 'general.html'), dana = join(dir, 'dana.html');
    expect(run(join(dir, 'deck.json'), general)).toMatch(/left out 3 recipients/);
    const g = readFileSync(general, 'utf8');
    for (const r of data.recipients) for (const secret of [r.name, r.slug, r.note].filter(Boolean)) expect(g).not.toContain(secret as string);
    expect(g).not.toContain('</script><script>window.__pwned');
    expect(run(join(dir, 'deck.json'), dana, '--recipient', 'dana-invented')).not.toMatch(/left out/);
    const d = readFileSync(dana, 'utf8');
    expect(d).toContain('Prepared for Dana Invented.');
    for (const secret of ['Placeholder Fund', 'placeholder-fund', 'A note only the Fund should read.', 'Quiet Person']) expect(d).not.toContain(secret);
    expect(() => run(join(dir, 'deck.json'), join(dir, 'x.html'), '--recipient', 'nobody')).toThrow();
  }, 60_000);
});

describe('a slide with little on it', () => {
  it('is centred when its content fills under seven tenths of its room, and only then', () => {
    expect(CENTRE_UNDER).toBe(0.7);
    expect(shouldCentre(600, 200)).toBe(true);
    expect(shouldCentre(600, 419)).toBe(true);
    expect(shouldCentre(600, 420)).toBe(false);
    expect(shouldCentre(600, 590)).toBe(false);
    expect(shouldCentre(600, 900)).toBe(false);     // overflowing: never
    expect(shouldCentre(0, 0)).toBe(false);         // not laid out: nothing can be said
    expect(shouldCentre(600, 0)).toBe(false);
    expect(shouldCentre(-5, 10)).toBe(false);
  });
  it('the stylesheet centres the content block, keeps the small print at the foot, and never centres a stacked deck', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/deck-runtime/deck.css'), 'utf8');
    expect(css).toMatch(/\.psd-centre \.psd-box::before \{ content: ""; flex: 1 1 0; \}/);
    expect(css).toMatch(/\.psd-centre \.psd-box::after \{ content: ""; flex: 1\.3 1 0; order: 1; \}/);
    expect(css).toMatch(/\.psd-centre \.psd-footnote \{ order: 2; margin-top: 0; \}/);
    expect(css).toMatch(/\.psd-stacked \.psd-centre \.psd-box::before, \.psd-stacked \.psd-centre \.psd-box::after \{ content: none; \}/);
    expect(css).not.toMatch(/psd-centre[^{]*\{[^}]*text-align/);   // still set from the left
  });
  it('is decided from what is measured: with no layout to measure (here), no slide is marked', () => {
    const { root, handle } = mount(fixture());
    handle.checkOverflow();
    expect(root.querySelectorAll('.psd-centre')).toHaveLength(0);
  });
  it('marks a short slide and leaves a full one, the numbers slide and a picture slide alone, when there are sizes to measure', () => {
    const { root, handle } = mount(fixture());
    const sections = [...root.querySelectorAll<HTMLElement>('section.psd-slide')];
    // give every slide a 900 px box with 100 px of padding, and content 200 px tall (short) or 700 px (full on the team slide)
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    for (const sec of sections) {
      const box = sec.querySelector<HTMLElement>('.psd-box')!;
      Object.defineProperty(box, 'clientHeight', { value: 900, configurable: true });
      Object.defineProperty(box, 'clientWidth', { value: 1600, configurable: true });
      Object.defineProperty(box, 'scrollHeight', { value: 900, configurable: true });
      Object.defineProperty(box, 'scrollWidth', { value: 1600, configurable: true });
      box.style.paddingTop = '50px'; box.style.paddingBottom = '50px';
      const kids = [...box.children].filter(k => !k.classList.contains('psd-footnote')) as HTMLElement[];
      const tall = sec.dataset.layout === 'team' ? 700 : 200;
      kids.forEach((k, i) => { k.getBoundingClientRect = () => rect(100 + (i * tall) / kids.length, 100 + ((i + 1) * tall) / kids.length) as DOMRect; });
    }
    handle.checkOverflow();
    const centred = sections.filter(s => s.classList.contains('psd-centre')).map(s => s.dataset.layout);
    for (const layout of ['text', 'cards', 'ways', 'stats', 'timeline', 'comps', 'model', 'ask']) expect(centred, layout).toContain(layout);
    for (const layout of ['team', 'numbers', 'cover', 'photo', 'closing']) expect(centred, layout).not.toContain(layout);
    // the mark is taken off before the next measure, and a stacked deck never has it
    const narrow = mount(fixture(), { stacked: true });
    narrow.handle.checkOverflow();
    expect(narrow.root.querySelectorAll('.psd-centre')).toHaveLength(0);
  });
});

// ---------- the scrim over a picture: strong behind the words only ----------

describe('the scrim behind the words of a picture slide', () => {
  const sheet = readFileSync(resolve(process.cwd(), 'src/deck-runtime/deck.css'), 'utf8');
  const frame = { x: 0, y: 0, w: 1600, h: 900 }, EM = 20;
  const inside = (t: { x: number; y: number; w: number; h: number }, boxes: ReturnType<typeof veilBoxes>, f = frame) => boxes.some(b => {
    const l = f.x + (b.left / 100) * f.w, a = f.y + (b.top / 100) * f.h, r = l + (b.width / 100) * f.w, bt = a + (b.height / 100) * f.h;
    return l <= t.x + 1e-6 && a <= t.y + 1e-6 && r >= t.x + t.w - 1e-6 && bt >= t.y + t.h - 1e-6;
  });
  it('the light part follows the author\'s own setting, never under 10% and never over 30%', () => {
    expect(scrimLight(0)).toBe(10); expect(scrimLight(0.1)).toBe(10); expect(scrimLight(0.25)).toBe(10);
    expect(scrimLight(0.45)).toBe(18); expect(scrimLight(0.5)).toBe(20); expect(scrimLight(0.7)).toBe(28);
    expect(scrimLight(0.75)).toBe(30); expect(scrimLight(1)).toBe(30); expect(scrimLight(7)).toBe(30); expect(scrimLight(-3)).toBe(10);
    for (const raw of [undefined, null, NaN, Infinity, '0.2', {}, []]) expect(scrimLight(raw), String(raw)).toBe(28);   // nothing usable: the default, 0.7
    for (let a = 0; a <= 1; a += 0.05) { expect(scrimLight(a)).toBeGreaterThanOrEqual(10); expect(scrimLight(a)).toBeLessThanOrEqual(30); expect(scrimLight(a + 0.05)).toBeGreaterThanOrEqual(scrimLight(a)); }
  });
  it('a block of text gets a box that holds all of it and half an em more on every side, in percentages of the slide', () => {
    const t = { x: 400, y: 300, w: 480, h: 180 };
    const [b] = veilBoxes([t], frame, EM);
    expect(b).toEqual({ left: 24.37, top: 32.22, width: 31.26, height: 22.23 });   // 390 to 890 across, 290 to 490 down, rounded outward
    expect(VEIL_PAD).toBe(0.5);
    expect((b.left / 100) * 1600).toBeLessThanOrEqual(400 - 10); expect(((b.left + b.width) / 100) * 1600).toBeGreaterThanOrEqual(880 + 10);
    expect((b.top / 100) * 900).toBeLessThanOrEqual(300 - 10); expect(((b.top + b.height) / 100) * 900).toBeGreaterThanOrEqual(480 + 10);
    // wherever the slide sits on the page, and at any size
    expect(veilBoxes([{ x: 400 + 37, y: 300 + 512, w: 480, h: 180 }], { x: 37, y: 512, w: 1600, h: 900 }, EM)).toEqual([b]);
    expect(veilBoxes([{ x: 200, y: 150, w: 240, h: 90 }], { x: 0, y: 0, w: 800, h: 450 }, EM / 2)).toEqual([b]);
  });
  it('no pixel of any text is ever outside a box: many slides of made-up text, with labels joined and edges snapped', () => {
    let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let n = 0; n < 300; n++) {
      const f = { x: rand() * 200, y: rand() * 4000, w: 300 + rand() * 1700, h: 0 }; f.h = f.w * 0.5625;
      const em = f.w * 0.014, texts = Array.from({ length: 1 + Math.floor(rand() * 9) }, () => { const w = em * (2 + rand() * 60), h = em * (0.6 + rand() * (rand() < 0.5 ? 1.4 : 9)); return { x: f.x + rand() * Math.max(1, f.w - w), y: f.y + rand() * Math.max(1, f.h - h), w: Math.min(w, f.w), h: Math.min(h, f.h) }; });
      const boxes = veilBoxes(texts, f, em);
      for (const t of texts) expect(inside(t, boxes, f), `slide ${n}`).toBe(true);
      for (const b of boxes) { expect(b.left).toBeGreaterThanOrEqual(0); expect(b.top).toBeGreaterThanOrEqual(0); expect(b.left + b.width).toBeLessThanOrEqual(100.001); expect(b.top + b.height).toBeLessThanOrEqual(100.001); expect(b.width).toBeGreaterThan(0); expect(b.height).toBeGreaterThan(0); }
      expect(boxes.length).toBeLessThanOrEqual(texts.length);
      expect(veilBoxes(texts, f, em)).toEqual(boxes);   // the same answer every time
    }
  });
  it('a heading and the paragraphs under it share one box, so the shade has one plain shape; text far away, or beside it, keeps its own', () => {
    const eyebrow = { x: 126, y: 388, w: 230, h: 22 }, headline = { x: 126, y: 428, w: 1326, h: 62 }, para = { x: 126, y: 520, w: 970, h: 130 }, para2 = { x: 126, y: 676, w: 960, h: 86 };
    const boxes = veilBoxes([eyebrow, headline, para, para2], frame, 22.4);
    expect(boxes).toHaveLength(1);                                              // not a step for every line
    expect((boxes[0].left / 100) * 1600).toBeLessThanOrEqual(126 - 11); expect(boxes[0].left).toBeGreaterThan(VEIL_SNAP);   // it stops where the words do: the picture shows beside it
    expect(((boxes[0].left + boxes[0].width) / 100) * 1600).toBeGreaterThanOrEqual(1452 + 11); expect(boxes[0].left + boxes[0].width).toBeLessThan(100 - VEIL_SNAP);
    expect((boxes[0].top / 100) * 900).toBeLessThanOrEqual(388 - 11); expect(((boxes[0].top + boxes[0].height) / 100) * 900).toBeGreaterThanOrEqual(762 + 11);
    expect(VEIL_LABEL).toBe(2.2); expect(VEIL_NEAR).toBe(1.6);
    const title = { x: 500, y: 380, w: 600, h: 110 }, signoff = { x: 640, y: 512, w: 320, h: 20 }, far = { x: 640, y: 700, w: 320, h: 20 };
    expect(veilBoxes([title, signoff], frame, 22.4)).toHaveLength(1);
    expect(veilBoxes([title, far], frame, 22.4)).toHaveLength(2);
    expect(veilBoxes([title, { ...signoff, x: 1200 }], frame, 22.4)).toHaveLength(2);   // beside it, not under it: not joined
    expect(veilBoxes([para, { ...para2, y: 900 - 86 - 30 }], frame, 22.4)).toHaveLength(2);   // two paragraphs a long way apart stay two
    for (const t of [eyebrow, headline, para, para2]) expect(inside(t, boxes)).toBe(true);
  });
  it('a box that ends right at an edge of the slide runs off it; anything further in stops where its words do', () => {
    expect(VEIL_SNAP).toBe(3);
    const [a] = veilBoxes([{ x: 40, y: 400, w: 300, h: 100 }], frame, 22.4);   // 28.8 px in: under 3% of 1600
    expect(a.left).toBe(0);
    const [b] = veilBoxes([{ x: 126, y: 400, w: 300, h: 100 }], frame, 22.4);  // the usual margin: over 3%
    expect(b.left).toBeGreaterThan(3);
    const mid = veilBoxes([{ x: 600, y: 400, w: 400, h: 100 }], frame, 22.4)[0];
    expect(mid.left).toBeGreaterThan(30); expect(mid.top).toBeGreaterThan(40); expect(mid.left + mid.width).toBeLessThan(70); expect(mid.top + mid.height).toBeLessThan(60);
    expect(veilBoxes([{ x: 600, y: 30, w: 400, h: 60 }], frame, 22.4)[0].top).toBe(0);
  });
  it('the footer has a band along the bottom, starting a little above its words, and no boxes in the corners', () => {
    expect(FOOT_RISE).toBe(2.6);
    const film = { x: 126, y: 856, w: 80, h: 14 }, page = { x: 1418, y: 852, w: 56, h: 18 };
    const band = footBand([film, page], frame, 22.4)!;
    expect(band.top).toBeLessThan((852 / 900) * 100);                          // above the highest of the words
    expect((band.top / 100) * 900).toBeCloseTo(852 - 22.4 * 3.1, 0);           // by the rise and the usual padding
    expect(footBand([{ x: 0, y: 20, w: 50, h: 10 }], frame, 22.4)).toEqual({ top: 0 });   // never above the slide
    expect(footBand([], frame, 22.4)).toBeNull();
    expect(footBand([{ x: 0, y: 5000, w: 50, h: 10 }, { x: NaN, y: 0, w: 5, h: 5 }, { x: 5, y: 5, w: 0, h: 5 }], frame, 22.4)).toBeNull();
    expect(footBand([film], { x: 0, y: 0, w: 0, h: 0 }, 22.4)).toBeNull();
    expect(footBand([film], frame, NaN)!.top).toBeCloseTo((856 / 900) * 100, 1);   // no type size: from the words themselves
  });
  it('the shade is only as strong as the picture needs: nothing over a dark picture, a lot over a white one, never past the old scrim', () => {
    const fill = (r: number, g: number, b: number, n = 40) => Array.from({ length: n }, () => [r, g, b, 255]).flat();
    const bg = '#141428', white = '#ffffff';
    expect(shadeNeeded(fill(10, 10, 20), bg, white, false, 0.1)).toBe(SHADE_SPARE);            // already readable: only the spare
    const salt = shadeNeeded(fill(215, 215, 220), bg, white, false, 0.1);
    expect(salt).toBeGreaterThanOrEqual(0.4); expect(salt).toBeLessThan(0.85);                   // pale salt under white words: a good deal, but less than the old scrim
    expect(shadeNeeded(fill(120, 80, 110), bg, white, false, 0.1)).toBe(SHADE_SPARE);             // a dusk sky: white words already read on it
    const haze = shadeNeeded(fill(175, 140, 160), bg, white, false, 0.1);
    expect(haze).toBeGreaterThan(SHADE_SPARE); expect(haze).toBeLessThan(salt);                   // a paler sky: somewhere between
    expect(shadeNeeded(fill(175, 140, 160), bg, white, true, 0.1)).toBeLessThan(haze);            // large words need less
    expect(shadeNeeded(fill(175, 140, 160), bg, white, false, 0.3)).toBeLessThanOrEqual(haze);    // a heavier wash has done some of the work
    expect(shadeNeeded(fill(255, 255, 255), bg, '#777788', false, 0)).toBe(0.85);                 // words that cannot be saved: the ceiling, as before
    // a few bright pixels (a moon, a star) do not darken the whole shade; a tenth of the picture does
    const speck = [...fill(10, 10, 20, 97), ...fill(255, 255, 240, 3)], patch = [...fill(10, 10, 20, 88), ...fill(255, 255, 240, 12)];
    expect(shadeNeeded(speck, bg, white, false, 0.1)).toBe(SHADE_SPARE);
    expect(shadeNeeded(patch, bg, white, false, 0.1)).toBeGreaterThan(0.4);
    // the answer really does give the contrast it promises
    for (const px of [[215, 215, 220], [120, 80, 110], [240, 200, 60], [90, 140, 200]]) {
      const k = shadeNeeded(fill(px[0], px[1], px[2]), bg, white, false, 0.1), b = [20, 20, 40];
      const washed = px.map((v, i) => v + (b[i] - v) * 0.1), under = washed.map((v, i) => Math.round(v + (b[i] - v) * k));
      expect(contrastRatio(white, `rgb(${under.join(',')})`), String(px)).toBeGreaterThanOrEqual(4.5);
    }
    // nothing to read: the old scrim
    for (const bad of [[], [1, 2], null as unknown as number[]]) expect(shadeNeeded(bad, bg, white, false, 0.1)).toBe(0.85);
    expect(shadeNeeded(fill(1, 2, 3), 'not a colour', white, false, 0.1)).toBe(0.85);
    expect(shadeNeeded(fill(1, 2, 3), bg, 'var(--x)', false, 0.1)).toBe(0.85);
    expect(shadeNeeded(fill(1, 2, 3), bg, white, false, NaN)).toBe(0.85);
    expect(shadeNeeded([NaN, 0, 0, 255], bg, white, false, 0.1)).toBe(0.85);
  });
  it('reads a colour the way a browser reports one', () => {
    expect(readColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]); expect(readColor('#0a141e')).toEqual([10, 20, 30]);
    expect(readColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
    expect(readColor('color(srgb 1 0.5 0)')).toEqual([255, 127.5, 0]); expect(readColor('color(srgb 0.2 0.2 0.2 / 0.6)')).toEqual([51, 51, 51]);
    for (const bad of ['', 'red-ish', 'var(--x)', 'color(display-p3 1 0 0)']) expect(readColor(bad), bad).toBeNull();
  });
  it('takes nonsense without throwing: a block with no size gets no box, a slide with no size gets none at all', () => {
    expect(veilBoxes([], frame, EM)).toEqual([]);
    expect(veilBoxes([{ x: 10, y: 10, w: 0, h: 20 }, { x: 10, y: 10, w: 20, h: 0 }, { x: NaN, y: 0, w: 5, h: 5 }, { x: 0, y: 0, w: Infinity, h: 5 }], frame, EM)).toEqual([]);
    expect(veilBoxes([{ x: 5000, y: 5000, w: 50, h: 50 }, { x: -900, y: -900, w: 50, h: 50 }], frame, EM)).toEqual([]);   // wholly off the slide
    for (const f of [{ x: 0, y: 0, w: 0, h: 900 }, { x: 0, y: 0, w: 1600, h: 0 }, { x: 0, y: 0, w: NaN, h: NaN }]) expect(veilBoxes([{ x: 1, y: 1, w: 9, h: 9 }], f, EM)).toEqual([]);
    for (const em of [0, -4, NaN, Infinity]) { const [b] = veilBoxes([{ x: 400, y: 300, w: 480, h: 180 }], frame, em); expect(b.left).toBe(25); expect(b.top).toBe(33.33); expect(b.width).toBeGreaterThanOrEqual(30); expect(b.width).toBeLessThanOrEqual(30.02); expect(b.height).toBeGreaterThanOrEqual(20); expect(b.height).toBeLessThanOrEqual(20.02); }   // no padding to add: the text's own box
    expect(veilBoxes([{ x: 400, y: 300, w: 480, h: 180 }, { x: 400, y: 300, w: 480, h: 180 }], frame, EM)).toHaveLength(1);
  });
  it('a slide that has not been measured keeps its scrim over the whole picture: the boxes are an empty layer, on the three layouts whose picture shows', () => {
    expect([...VEILED].sort()).toEqual(['closing', 'cover', 'photo']);
    const data = fixture();
    const text = data.slides.find(s => s.layout === 'text')!; text.imageId = data.images[0].id;
    for (const opts of [{}, { static: true }, { stacked: true }, { motion: false }]) {
      const { slide, root } = mount(data, opts);
      for (const layout of ['cover', 'photo', 'closing']) {
        const s = slide(layout); if (!s.querySelector('.psd-bg')) continue;
        const veils = s.querySelector<HTMLElement>('.psd-scrim > .psd-veils')!;
        expect(veils, layout).not.toBeNull();
        expect(veils.getAttribute('aria-hidden')).toBe('true');
        expect(veils.children).toHaveLength(0);          // jsdom lays nothing out: nothing was measured
        expect('veil' in s.dataset, layout).toBe(false);   // so the picture is under the scrim as it always was
        const scrim = s.querySelector<HTMLElement>('.psd-scrim')!;
        expect(parseFloat(scrim.style.getPropertyValue('--psd-scrim'))).toBeGreaterThanOrEqual(85);
        const light = parseFloat(scrim.style.getPropertyValue('--psd-scrim-light'));
        expect(light).toBeGreaterThanOrEqual(10); expect(light).toBeLessThanOrEqual(30);
      }
      expect(slide('cover').querySelector('.psd-veils')).not.toBeNull();
      expect(slide('text').querySelector('.psd-bg')).not.toBeNull();
      expect(slide('text').querySelector('.psd-veils')).toBeNull();   // a slide of text over a picture keeps the scrim everywhere
      expect((root as unknown as Element).querySelectorAll('.psd-veil')).toHaveLength(0);
    }
  });
  it('the stylesheet lightens the scrim only where the runtime has marked a slide as measured, and never on a printed page', () => {
    expect(sheet).toContain('.psd-veils { position: absolute; inset: 0; display: none; }');
    expect(sheet).toContain('.psd-slide[data-veil] .psd-veils { display: block; }');
    expect(sheet).toContain('.psd-slide[data-veil] .psd-scrim { background: color-mix(in srgb, var(--psd-bg) var(--psd-scrim-light, 25%), transparent); }');
    // the light wash is named in that one rule and nowhere else: without data-veil the old scrim stands
    expect(sheet.replace(/\/\*[\s\S]*?\*\//g, '').match(/--psd-scrim-light/g)).toHaveLength(1);
    expect(sheet).toContain('.psd-l-photo .psd-scrim, .psd-l-closing .psd-scrim { background: linear-gradient(to top, var(--s) 0%, var(--s) var(--psd-stop, 62%), var(--f) 100%); }');
    const veil = /\.psd-veil \{([^}]*)\}/.exec(sheet)![1];
    expect(veil).toContain('background: var(--psd-bg)'); expect(veil).toContain('opacity: var(--k, var(--psd-scrim, 85%))');   // as strong as the picture needs; not measured, the scrim's own strength
    const footRule = /\.psd-veil-foot \{([^}]*)\}/.exec(sheet)![1];
    expect(footRule).toContain('left: 0; right: 0; bottom: 0'); expect(footRule).toContain('opacity: var(--k, var(--psd-scrim, 85%))'); expect(footRule).toMatch(/linear-gradient\(to bottom, transparent/);
    expect(veil).toContain('mask-composite: intersect'); expect(veil).toContain('-webkit-mask-composite: source-in');
    expect(veil).toMatch(/#000 var\(--v\), #000 calc\(100% - var\(--v\)\)/);   // nothing fades inside the box itself: the fade is all in the padding round it
    expect(veil).toMatch(/margin: calc\(var\(--v\) \* -1\) 0 0 calc\(var\(--v\) \* -1\); padding: var\(--v\)/);
    expect(veil).not.toMatch(/blur\(|url\(/);
    const print = sheet.slice(sheet.indexOf('@media print'));
    expect(print).toContain('.psd-slide[data-veil] .psd-veils { display: none; }');
    expect(print).toContain('.psd-slide[data-veil] .psd-scrim { background: var(--s); }');
    expect(sheet).toContain('.psd-stacked :is(.psd-l-cover, .psd-l-photo) .psd-scrim { display: none; }');   // a phone: the picture is a band above the text, as before
  });
});
