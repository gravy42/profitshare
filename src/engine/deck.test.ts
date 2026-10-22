import { describe, it, expect } from 'vitest';
import { deckSlides, fundingStack, researchSlides, unlabel } from './deck';
import { applyDeal } from './deal';
import { topSheet } from './budget';
import { projectBrief, draftPrompt } from '../ai';
import { sampleProject } from '../data/seed';
import { withPitch, newLookImage, newResearch, newTeamMember, defaultDesign, defaultDeckRules } from './pitch';

describe('the investor deck', () => {
  it('builds slides from the project and only shows what is there', () => {
    const p = withPitch(sampleProject());
    const base = deckSlides(p);
    expect(base[0]).toMatchObject({ kind: 'title', title: 'SALT FLAT' });
    expect(base.map(s => s.kind)).toContain('plan');
    expect(base.map(s => s.kind)).toContain('numbers');
    expect(base.map(s => s.kind)).toContain('deal');
    expect(base.map(s => s.kind)).not.toContain('team');
    const img = 'data:image/jpeg;base64,xx';
    const q = { ...p, pitch: { ...p.pitch!, why: 'Because.', lookbook: [1, 2, 3, 4, 5].map(n => newLookImage(img + n, 'tone')), research: [{ ...newResearch(), title: 'A finding' }], team: [{ ...newTeamMember(), name: 'A. Director', role: 'Director' }], ask: 'Units of $50K.' } };
    const split = deckSlides(q, 'a film by A. Director');
    expect(split.filter(s => s.image).length).toBeGreaterThan(0);     // the default layout puts the pictures on the slides
    expect(split.filter(s => s.kind === 'images')).toHaveLength(2);          // title, why and team took three of the five; the other two are look slides of one
    expect(split.filter(s => s.kind === 'images').every(s => s.kind === 'images' && s.images.length === 1)).toBe(true);
    expect(split.find(s => s.kind === 'comps' || s.kind === 'research')?.image).toBeUndefined();   // a data slide keeps the whole page
    q.pitch.design = { ...defaultDesign(), deck: { ...defaultDeckRules(), layout: 'plain' } };
    const slides = deckSlides(q, 'a film by A. Director');
    const kinds = slides.map(s => s.kind);
    expect(kinds.filter(k => k === 'images')).toHaveLength(2);       // plain: five pictures, a slide of four and a slide of one
    expect(kinds).toContain('team'); expect(kinds).toContain('research'); expect(kinds).toContain('ask');
    expect(slides[1]).toMatchObject({ kind: 'text', heading: 'Why this film, why now' });
    expect(slides[slides.length - 1]).toMatchObject({ kind: 'ask', body: 'Units of $50K.' });
    const numbers = slides.find(s => s.kind === 'numbers')!;
    expect(numbers.kind === 'numbers' && numbers.cashBudget).toBeGreaterThan(0);
  });
});

describe('the ask slide', () => {
  it('shows the whole stack and what the investor ask becomes without the rest of it', () => {
    const p = applyDeal(withPitch({ ...sampleProject(), waterfall: { ...sampleProject().waterfall, nonRecoupable: 100_000 } }));
    const cash = topSheet(p).cashBudget;
    const f = fundingStack(p);
    expect(f.sources[0]).toMatchObject({ label: 'Fiscal sponsorship and grants', amount: 100_000 });
    expect(f.sources[f.sources.length - 1].label).toBe('Investors');
    expect(f.sources.reduce((n, x) => n + x.amount, 0)).toBeCloseTo(cash, 0);     // the stack adds up to the budget
    expect(f.without.find(w => /sponsorship/.test(w.label))?.investors).toBeCloseTo(cash, 0);
    const slides = deckSlides(p);
    const numbers = slides.find(s => s.kind === 'numbers')!, ask = slides.find(s => s.kind === 'ask')!;
    expect(numbers.kind === 'numbers' && numbers.cashBudget).toBe(cash);         // the deal applied once, not twice
    expect(ask.kind === 'ask' && ask.investors).toBe(f.investors);
    expect(fundingStack(applyDeal(withPitch(sampleProject()))).without).toEqual([]);
  });
  it('fits research to the slide and drops the label a box repeats', () => {
    const short = { body: 'x'.repeat(100) }, long = { body: 'y'.repeat(600) };
    expect(researchSlides([short, short, short, short, short]).map(g => g.items.length)).toEqual([4, 1]);
    expect(researchSlides([long, short, short, long]).map(g => [g.items.length, g.wide])).toEqual([[2, true], [2, true]]);
    expect(researchSlides([short, short, short, long]).map(g => [g.items.length, g.wide])).toEqual([[3, false], [1, true]]);
    expect(unlabel('Primary: women in their 40s', 'primary')).toBe('women in their 40s');
    expect(unlabel('How we reach them: the podcast', 'how we reach them')).toBe('the podcast');
    expect(unlabel('Women first', 'primary')).toBe('Women first');
  });
});

describe('the AI brief', () => {
  it('describes the film from the project without inventing anything, and the prompts carry it', () => {
    const p = withPitch(sampleProject());
    const brief = projectBrief(p);
    expect(brief).toMatch(/FILM: SALT FLAT/);
    expect(brief).toMatch(/budget to raise \$8\d\d,\d{3}/);
    expect(brief).toMatch(/26 scenes/);
    expect(brief).toMatch(/12 shoot days/);
    expect(brief).toMatch(/SAG tier target/);
    expect(brief).not.toMatch(/LOGLINE/);                             // nothing written yet, nothing claimed
    const pr = draftPrompt('section', brief, 'Why women will show up');
    expect(pr).toMatch(/HEADING: Why women will show up/);
    expect(pr).toContain(brief);
  });
});
