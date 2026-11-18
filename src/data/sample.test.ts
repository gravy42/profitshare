// @vitest-environment jsdom
// The sample as "Load the sample" opens it: an invented film with a whole pitch deck. This is the product's demo, so
// it is held to what the app asks of any deck: nothing to fix, every colour readable, nothing real in it. Whether a
// slide overflows can only be measured in a browser (tools/smoke.mjs and the stage's Chrome run do that); here the
// structure is checked as far as jsdom can draw it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleDemo, sampleProject } from './seed';
import type { Project } from '../engine/types';
import { applyDeal, withDeal } from '../engine/deal';
import { adoptBoardDays, dood, syncCastDaysFromBoard } from '../engine/board';
import { topSheet } from '../engine/budget';
import budgetJson from './sample-budget.json';
import { deckChecks, slideText } from '../engine/aiDeck';
import { deckData, deckWarnings, defaultSlides } from '../engine/deckData';
import { LAYOUTS, highlightChoices, readSlides, validRecipients } from '../engine/deckEdit';
import { checkTheme } from '../engine/palette';
import { pathFor } from '../engine/pathMath';
import { cleanMotion } from '../deck-runtime/motion';
import { money } from '../deck-runtime/format';
import { contrastRatio, deckColors, mountDeck, paperColors, paperUnder, type DeckHandle } from '../deck-runtime/runtime';

const demo = applyDeal(sampleDemo());
const pitch = demo.pitch!;
const deck = deckData(demo, { today: '2030-09-01' });
const mounted: DeckHandle[] = [];
afterEach(() => { for (const h of mounted.splice(0)) h.destroy(); document.body.replaceChildren(); });

describe('the sample with no pitch content (the fixture other tests pin their figures to)', () => {
  it('is what it always was: no pitch, no grants, and the draft deck an old project gives', () => {
    const bare = sampleProject();
    expect(bare.pitch).toBeUndefined();
    expect(bare.waterfall.nonRecoupable).toBeUndefined();
    expect(defaultSlides(applyDeal(bare)).map(s => s.id)).toEqual(['cover', 'plan', 'model', 'ways', 'numbers', 'ask']);
  });
  it('the demo changes nothing in the budget or on the board', () => {
    const bare = sampleProject(), full = sampleDemo();
    expect(full.lines).toEqual(bare.lines);
    expect(full.board.scenes).toEqual(bare.board.scenes);
    expect(full.board.castList).toEqual(bare.board.castList);
    expect(full.board.strips.map(x => x.type)).toEqual(bare.board.strips.map(x => x.type));
    expect(full.participants).toEqual(bare.participants);
    expect(topSheet(applyDeal(full))).toEqual(topSheet(applyDeal(bare)));
    expect({ ...full.waterfall, nonRecoupable: undefined, sponsorFeePct: undefined }).toEqual({ ...bare.waterfall, nonRecoupable: undefined, sponsorFeePct: undefined });
  });
  it('is made new each time: changing one copy does not change the next', () => {
    const a = sampleDemo(); a.pitch!.slides![0].id = 'changed'; a.pitch!.lookbook!.length = 0;
    expect(sampleDemo().pitch!.slides![0].id).toBe('cover');
    expect(sampleDemo().pitch!.lookbook).toHaveLength(11);
  });
});

// The stripboard owns the cast's shoot days: every project that comes into the app goes through `normalize` in
// src/store.ts, which is the chain below, and the cast lines take the day-out-of-days count. A sample whose budget was
// written with other day counts would show one total in its files and another on screen, so the generator
// (tools/make-sample.mjs) reads the cast days off the board, and this holds it there.
describe('the sample agrees with its own stripboard', () => {
  const SAMPLE_TOTAL = 805_312.06;                       // the one figure the README, the tests and the demo quote
  const load = (p: Project): Project => syncCastDaysFromBoard(adoptBoardDays(withDeal(p)));   // `normalize` in src/store.ts
  const plain = (p: Project) => p.lines.map(l => ({ ...l, daysFrom: undefined }));             // the flag is the only thing loading may add
  for (const [name, make] of [['sampleProject()', sampleProject], ['sampleDemo()', sampleDemo]] as const) {
    it(`${name}: loading it changes no line, no person's days and no total`, () => {
      const before = make(), after = load(before);
      expect(plain(after)).toEqual(plain(before));
      expect(after.participants).toEqual(before.participants);
      expect(topSheet(after)).toEqual(topSheet(before));
      expect(topSheet(applyDeal(after))).toEqual(topSheet(applyDeal(before)));
      expect(topSheet(before).cashBudget).toBe(SAMPLE_TOTAL);
      expect(topSheet(applyDeal(after)).cashBudget).toBe(SAMPLE_TOTAL);   // what the top sheet shows once the sample is open
      expect(load(after)).toEqual(after);                                 // and a second load has nothing left to do
    });
  }
  it('the total the generator wrote into the file is that same figure', () => {
    expect((budgetJson as { totals: { grandTotal: number } }).totals.grandTotal).toBe(SAMPLE_TOTAL);
  });
  it('every cast line carries the days the board gives that part, and the board owns each of those lines', () => {
    const p = load(sampleProject());
    const cast = p.participants.filter(x => x.castId != null);
    expect(cast).toHaveLength(7);                        // eight speaking parts on the cast list; DEL is in no scene, so no line
    const onBoard = new Map(dood(p.board).map(r => [r.castId, r.total]));
    for (const pt of cast) {
      const owned = p.lines.filter(l => l.participantId === pt.id && l.daysFrom === 'board');
      expect(owned).toHaveLength(1);
      expect([pt.name, owned[0].amount]).toEqual([pt.name, onBoard.get(pt.castId!)]);
      expect([pt.name, pt.days]).toEqual([pt.name, onBoard.get(pt.castId!)]);
    }
    expect(cast.map(x => [x.name, x.days])).toEqual([['LENA', 11], ['JUNE', 10], ['WALT', 3], ['RANGER PRICE', 3], ['THE MECHANIC', 2], ['KID', 2], ['WAITRESS', 2]]);
    // the agent fees are a tenth of the same days at scale
    const fees = p.lines.filter(l => /^Agent fee/.test(l.description)).map(l => l.rate);
    expect(fees).toEqual([11 * 449, 10 * 449]);
  });
});

describe('the sample deck', () => {
  it('has fourteen slides in the default order, one of every layout, none hidden', () => {
    expect(pitch.slides!.map(s => s.id)).toEqual(['cover', 'why', 'gap', 'opportunity', 'audience', 'story', 'look', 'team', 'plan', 'model', 'ways', 'numbers', 'ask', 'closing']);
    expect([...pitch.slides!.map(s => s.layout)].sort()).toEqual(LAYOUTS.map(l => l.id).sort());
    expect(deck.slides).toHaveLength(14);
    expect(readSlides(pitch.slides).map(s => [s.id, s.layout, s.motion])).toEqual(pitch.slides!.map(s => [s.id, s.layout, s.motion]));   // the editor reads every one of them
  });
  it('has nothing to fix: no warnings, and nothing the checks behind Read my deck find', () => {
    expect(deckWarnings(demo)).toEqual([]);
    expect(deckChecks(deck)).toEqual([]);
  });
  it('says what each slide is for: the logline on the cover, sourced findings, comps, sourced numbers, a team, a plan, three ways in, an ask with a next step and a way to answer', () => {
    const by = Object.fromEntries(deck.slides.map(s => [s.id, s])) as Record<string, any>;
    expect(by.cover.tagline).toBe(pitch.logline);
    expect(by.gap.cards).toHaveLength(3);
    for (const c of by.gap.cards) { expect(c.kicker).toBe('Invented finding'); expect(c.footnote).toMatch(/^Invented .+, 20(29|30)$/); }
    expect(by.opportunity.bars).toHaveLength(4);
    for (const b of by.opportunity.bars) expect(b.label).toMatch(/\(invented\)$/);
    expect(by.audience.lead.source).toBe('Invented Audience Survey, 2030');
    expect(by.audience.stats).toHaveLength(3);
    for (const s of by.audience.stats) expect(s.source).toMatch(/^Invented .+, 2030$/);
    expect(by.team.members).toHaveLength(4);
    expect(by.team.aside.footnote).toBe('Everyone on this slide is invented.');
    expect(by.plan.milestones).toHaveLength(4);
    expect(by.plan.facts.map((f: { label: string }) => f.label)).toEqual(['shoot days', 'scenes', 'sets', 'speaking parts', 'crew', 'cash budget']);
    expect(by.plan.agreement).toMatch(/^Budgeted under the SAG-AFTRA .+ agreement\.$/);
    expect(by.look.pictures.map((x: { imageId: string }) => x.imageId)).toEqual(['look_motel', 'look_door', 'look_pool', 'look_moon', 'look_dunes', 'look_road']);
    for (const x of by.look.pictures) { expect(deck.images.some(i => i.id === x.imageId)).toBe(true); expect(x.caption).toMatch(/drawn for the sample/); }
    expect(by.ways.cards.map((c: { id: string }) => c.id)).toEqual(['invest', 'give', 'lend']);
    expect(by.ask.withGrants).not.toBe(by.ask.withoutGrants);
    expect(by.ask.nextStep).toMatch(/call/);
    expect(by.ask.contact).toBe('wren@example.com');
    expect(by.cover.footnote).toMatch(/A sample deck\. The film, the people, the studies and every figure in it are invented\./);
  });
  it('has two asks and three revenue cases with sensible multiples: the low case loses money and says so', () => {
    expect(deck.paths.sources.map(s => s.key)).toEqual(['grants']);
    expect(deck.paths.sources[0].amount).toBe(83_700);
    const cases = pathFor(deck.paths).cases.map(c => Math.round(c.multiple * 10) / 10);
    expect(cases[0]).toBeLessThan(1);
    expect(cases[1]).toBeGreaterThan(1.2); expect(cases[1]).toBeLessThan(2);
    expect(cases[2]).toBeGreaterThan(2); expect(cases[2]).toBeLessThan(4);
    expect(pathFor(deck.paths, { grants: false }).investors).toBeGreaterThan(pathFor(deck.paths).investors);
    expect((deck.slides.find(s => s.id === 'numbers') as { body: string }).body).toContain('In the low case investors do not get their money back.');
  });
  it('is sent to two invented people: one opens on the raise without grants, one has a card picked out', () => {
    expect(deck.recipients).toEqual([
      expect.objectContaining({ slug: 'ada-example', name: 'Ada Example', lead: 'without-grants' }),
      expect.objectContaining({ slug: 'placeholder-fund', name: 'Placeholder Fund', lead: 'with-grants', highlightCardId: 'give' }),
    ]);
    for (const r of deck.recipients) { expect(r.coverLine).toMatch(/^Prepared for /); expect(r.note!.length).toBeGreaterThan(20); expect(r.note!.length).toBeLessThanOrEqual(240); }
    expect(validRecipients(pitch.recipients)).toHaveLength(2);
    expect(highlightChoices(pitch.slides!).map(c => c.id)).toContain('give');
  });
  it('moves a little: cards one at a time on two slides, the audience numbers count up, no headline is typed', () => {
    const moving = Object.fromEntries(pitch.slides!.filter(s => s.motion).map(s => [s.id, s.motion]));
    expect(moving).toEqual({ gap: { entrance: 'drop', order: 'one-by-one', stagger: 140 }, audience: { count: true }, ways: { order: 'one-by-one', stagger: 160 } });
    for (const s of pitch.slides!) expect(cleanMotion(s.motion, s.layout)).toEqual(s.motion);
    expect(pitch.deckMotion).toBeUndefined();
    expect(pitch.slides!.some(s => s.motion?.marker)).toBe(false);   // a travelling picture is the author's to add: none is shipped
  });
});

describe('the sample\'s papers', () => {
  it('uses them together: the title on a postcard, the gap a mix, the quote a torn note, the team\'s card a letter, the ways in as postcards, in handwriting, all of it on aged paper', () => {
    expect(Object.fromEntries(pitch.slides!.filter(s => s.paper).map(s => [s.id, s.paper]))).toEqual({ cover: 'postcard', gap: 'mixed', audience: 'torn', team: 'letter', ways: 'postcard' });
    expect(pitch.design!.hand).toBe(true);
    expect(pitch.design!.paperShade).toBe('aged');
    expect(deck.theme.paperShade).toBe('aged');
    expect(pitch.slides!.some(s => 'paperShade' in s)).toBe(false);   // one shade throughout: no slide names its own
    expect(pitch.design!.paper).toBeUndefined();   // any slide that says nothing is a plain card
    expect(pitch.design!.tilt).toBeUndefined();
    expect(deck.theme.hand).toBe(true);
    expect('paper' in deck.theme).toBe(false);
    expect(deckWarnings(demo)).toEqual([]);
    expect(deckChecks(deck)).toEqual([]);
  });
  it('draws them: one postcard under the title, a notebook page, a torn page and a letter side by side, and nothing on a line', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    mounted.push(mountDeck(host, deck));
    const root = host.shadowRoot!;
    const papers = (id: string) => [...root.querySelectorAll<HTMLElement>(`section[data-slide-id="${id}"] .psd-card`)].map(c => c.dataset.paper);
    expect(papers('cover')).toEqual(['postcard']);
    expect(papers('gap')).toEqual(['notebook', 'torn', 'letter']);
    expect(papers('audience')).toEqual(['torn']);
    expect(papers('team')).toEqual(['letter']);
    expect(papers('ways')).toEqual(['postcard', 'postcard', 'postcard']);
    const drawn = [...root.querySelectorAll<HTMLElement>('.psd-card')];
    expect(drawn).toHaveLength(9);
    for (const c of drawn) { expect(c.dataset.shade).toBe('aged'); expect(c.querySelector<HTMLElement>(':scope > .psd-pp')!.style.getPropertyValue('--psd-pp-marks')).toMatch(/^radial-gradient\(/); }
    expect(new Set(drawn.map(c => c.querySelector<HTMLElement>(':scope > .psd-pp')!.style.getPropertyValue('--psd-pp-marks'))).size).toBe(9);   // no two sheets aged alike
    expect(root.querySelector('.psd')!.classList.contains('psd-hand')).toBe(true);
    expect(root.querySelectorAll('.psd-hang, .psd-rope, .psd-pinned, .psd-rail')).toHaveLength(0);
    for (const c of root.querySelectorAll<HTMLElement>('.psd-card')) expect(c.style.getPropertyValue('--r')).toBe('');   // every card straight
  });
  it('every paper it uses keeps its words readable on aged paper: on the sheet, on every mark of age and on the darkest they come to together', () => {
    for (const style of ['postcard', 'notebook', 'torn', 'letter'] as const) {
      const t = paperColors(deck.theme.colors, style, 'aged');
      for (const surface of paperUnder(t)) {
        expect(contrastRatio(t['--psd-card-ink'], surface), style).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(t['--psd-card-muted'], surface), style).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t['--psd-card-accent'], surface), style).toBeGreaterThanOrEqual(4.5);
      }
      expect(t['--psd-card']).not.toBe(pitch.design!.card);   // the paper is the shade's own colour, not the design's card
      expect(t['--psd-card']).toBe(paperColors(null, style, 'aged')['--psd-card']);
    }
  });
  it('names nothing real on its stamps and postmarks: they are shapes with no words at all', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    mounted.push(mountDeck(host, deck));
    for (const layer of host.shadowRoot!.querySelectorAll('.psd-pp')) { expect(layer.textContent).toBe(''); expect(layer.querySelectorAll('img, svg')).toHaveLength(0); }
  });
});

describe('the sample\'s look', () => {
  const DRAWN = ['look_sign', 'look_motel', 'look_door', 'look_flats', 'look_moon', 'look_dunes', 'look_road', 'look_pool', 'look_sun', 'look_wagon'];
  const svgOf = (id: string) => atob(pitch.lookbook!.find(i => i.id === id)!.dataUrl.split(',')[1]);
  it('has ten pictures drawn by the generator and the film\'s mark, each captioned, under 120 kB of drawing together', () => {
    expect(pitch.lookbook!.map(i => i.id)).toEqual([...DRAWN, 'look_mark']);
    let bytes = 0;
    for (const i of pitch.lookbook!) {
      expect(i.dataUrl).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
      expect(i.caption).toMatch(/\(drawn for the sample\)$/);
      expect(['tone', 'world', 'reference']).toContain(i.section);
      const svg = atob(i.dataUrl.split(',')[1]).replace(' xmlns="http://www.w3.org/2000/svg"', '');
      bytes += svg.length;
      expect(svg).not.toMatch(/<script|<image|<foreignObject|<text|<filter|<style|href|https?:|url\((?!#)/i);   // shapes only: nothing that runs, nothing that loads, no font to miss
      expect(svg).toMatch(/^<svg width="\d+" height="\d+" viewBox="0 0 \d+ \d+">/);
    }
    expect(bytes).toBeLessThan(120_000);
    expect(new Set(pitch.lookbook!.map(i => i.caption)).size).toBe(11);
    expect(new Set(pitch.lookbook!.map(i => i.dataUrl)).size).toBe(11);
    expect(readFileSync(resolve(process.cwd(), 'src/data/sample-pitch.json')).length).toBeLessThan(250_000);
  });
  it('the ten are one set: the same size, the same grain, drawn in layers, and each a picture of its own', () => {
    for (const id of DRAWN) {
      const svg = svgOf(id);
      expect(svg, id).toMatch(/width="1600" height="900" viewBox="0 0 1600 900"/);
      expect(svg.match(/<pattern /g), id).toHaveLength(2);                          // the grain: two tiles of specks
      expect(svg.match(/<linearGradient /g)!.length, id).toBeGreaterThanOrEqual(1);   // a sky
      expect((svg.match(/<(polygon|rect|circle|ellipse|path) /g) ?? []).length, id).toBeGreaterThan(12);
      expect(svg.length, id).toBeGreaterThan(2_500); expect(svg.length, id).toBeLessThan(20_000);
      for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) { expect(ref.startsWith(`${id}-g`), `${id} ${ref}`).toBe(true); expect(svg).toContain(`id="${ref}"`); }   // every gradient is the picture's own
      expect(svg, id).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  it('uses nine of them: the motel sign behind the cover, the flats behind the story, six on the look book slide, the wagon behind the closing slide', () => {
    expect(deck.images.map(i => i.id).sort()).toEqual(['look_door', 'look_dunes', 'look_flats', 'look_moon', 'look_motel', 'look_pool', 'look_road', 'look_sign', 'look_wagon']);
    expect(Object.fromEntries(deck.slides.filter(s => s.imageId).map(s => [s.id, s.imageId]))).toEqual({ cover: 'look_sign', story: 'look_flats', closing: 'look_wagon' });
    expect(pitch.design!.deck).toMatchObject({ coverImageId: 'look_sign', closingImageId: 'look_wagon' });
  });
  it('has a design system named for the film whose every colour passes the palette\'s own checks, and the deck\'s', () => {
    const d = pitch.design!;
    expect(d.name).toBe('Salt Flat');
    expect(checkTheme({ ...d.colors, card: d.card! }).filter(c => !c.pass)).toEqual([]);
    const c = deckColors(deck.theme.colors);
    for (const k of ['--psd-ink', '--psd-accent-text', '--psd-accent2-text', '--psd-muted-text', '--psd-soft', '--psd-legal']) expect(contrastRatio(c[k], c['--psd-bg']), k).toBeGreaterThanOrEqual(4.5);
    for (const k of ['--psd-card-ink', '--psd-card-accent', '--psd-card-muted']) expect(contrastRatio(c[k], c['--psd-card']), k).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c['--psd-row-text'], c['--psd-row'])).toBeGreaterThanOrEqual(4.5);
    // the text colours are the design's own: the deck did not have to move any of them
    expect(c['--psd-accent-text']).toBe(d.colors.accent); expect(c['--psd-accent2-text']).toBe(d.colors.accent2); expect(c['--psd-muted-text']).toBe(d.colors.muted);
  });
});

describe('the sample is invented, all of it', () => {
  const words = JSON.stringify({ ...pitch, lookbook: pitch.lookbook!.map(i => i.caption) });
  it('names no address but example.com and no link at all', () => {
    expect(words).not.toMatch(/https?:|www\./i);
    expect(words.match(/[\w.+-]+@[\w.-]+/g)).toEqual(['wren@example.com']);
  });
  it('marks every comparable film and every source as invented', () => {
    for (const c of pitch.comps) expect(c.title).toMatch(/ \(invented\)$/);
    const sources = [...pitch.research!.map(r => r.url!), ...pitch.slides!.flatMap(s => [s.lead?.source, ...(s.stats ?? []).map(x => x.source)]).filter((x): x is string => !!x)];
    expect(sources.length).toBeGreaterThan(5);
    for (const s of sources) expect(s).toMatch(/^Invented /);
  });
  it('does not name the film the app\'s footer is signed for', () => {
    expect(words).not.toMatch(/alone girl/i);
    expect(deck.slides.flatMap(s => slideText(s).map(t => t.text)).join(' ')).not.toMatch(/alone girl/i);
  });
});

describe('the sample deck, drawn', () => {
  it('draws fourteen slides with one heading each, the film in every footer, and its movement as words from the list', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    mounted.push(mountDeck(host, deck));
    const sections = [...host.shadowRoot!.querySelectorAll<HTMLElement>('section.psd-slide')];
    expect(sections.map(s => s.dataset.slideId)).toEqual(deck.slides.map(s => s.id));
    for (const s of sections) {
      expect(s.querySelectorAll('h1, h2').length, s.dataset.slideId).toBe(1);
      expect(s.querySelector('.psd-foot-film')!.textContent).toBe('SALT FLAT');
    }
    const by = (id: string) => sections.find(s => s.dataset.slideId === id)!;
    expect(by('gap').dataset.enter).toBe('drop');
    expect(by('gap').style.getPropertyValue('--psd-gap')).toBe('140ms');
    expect(by('ways').style.getPropertyValue('--psd-gap')).toBe('160ms');
    expect(by('audience').querySelectorAll('.psd-num')).toHaveLength(4);
    expect(by('cover').querySelector('.psd-typed')).toBeNull();
    expect(by('cover').querySelector('img.psd-bg')).not.toBeNull();
    expect(by('numbers').querySelector('[data-part="investors"]')!.textContent).toBe(money(pathFor(deck.paths).investors, 'USD'));
    expect(host.shadowRoot!.querySelectorAll('.psd-mark')).toHaveLength(0);
  });
  it('each person\'s copy is theirs: Ada opens on the whole raise, the Fund has Give picked out', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const h = mountDeck(host, deck, { recipient: 'ada-example' }); mounted.push(h);
    const root = host.shadowRoot!;
    expect(root.querySelector('[data-part="cover-line"]')!.textContent).toBe('Prepared for Ada Example.');
    expect(root.querySelector('[data-part="investors"]')!.textContent).toBe(money(deck.paths.cashBudget, 'USD'));
    expect(root.querySelectorAll('.psd-highlight')).toHaveLength(0);
    h.setRecipient('placeholder-fund');
    expect(root.querySelector('[data-part="investors"]')!.textContent).toBe(money(deck.paths.cashBudget - 83_700, 'USD'));
    expect([...root.querySelectorAll<HTMLElement>('.psd-highlight')].map(e => e.dataset.cardId)).toEqual(['give']);
    expect(root.textContent).not.toContain('Ada');
  });
});

describe('the generator', () => {
  it('writes the same files every time it runs', () => {
    const files = ['sample-pitch.json', 'sample-budget.json', 'sample-board.json'].map(f => resolve(process.cwd(), 'src/data', f));
    const before = files.map(f => readFileSync(f, 'utf8'));
    execFileSync('node', ['tools/make-sample.mjs'], { cwd: process.cwd(), stdio: 'pipe' });
    expect(files.map(f => readFileSync(f, 'utf8'))).toEqual(before);
  }, 30_000);
});
