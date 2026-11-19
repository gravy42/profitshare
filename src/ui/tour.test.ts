// The tour's steps, its memory, and the truth of what it says about the sample film. If the sample or the engine
// changes so that a step is no longer true, a test here fails and the step's words in tour.ts need another look.
import { describe, expect, it } from 'vitest';
import { TOUR_KEY, TOUR_STEPS, SAMPLE_NAME, clampStep, dismissTourCard, isLastStep, isSampleOpen, nextStep, prevStep, tourCardDismissed } from './tour';
import { GLOSSARY } from './glossary';
import { sampleDemo } from '../data/seed';
import { applyDeal, withDeal, PRESET_GROUPS } from '../engine/deal';
import { topSheet } from '../engine/budget';
import { sagReport } from '../engine/sag';
import { waterfallReport } from '../engine/waterfall';
import type { Project } from '../engine/types';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

describe('the steps', () => {
  it('are five or six, each with words, a place to go and a named button', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(5); expect(TOUR_STEPS.length).toBeLessThanOrEqual(6);
    expect(new Set(TOUR_STEPS.map(s => s.id)).size).toBe(TOUR_STEPS.length);
    for (const s of TOUR_STEPS) {
      expect(s.title.length, s.id).toBeGreaterThan(3);
      expect(s.body.length, s.id).toBeGreaterThan(0);
      expect(['deal', 'topsheet', 'points', 'pitch']).toContain(s.tab);
      expect(s.goName.startsWith(s.go), `${s.id}: the spoken name starts with the words on the button`).toBe(true);
    }
  });
  it('never give a button the exact name of a tab, or of the Start screen\'s own sample button', () => {
    // the browser walk (tools/browsers.mjs) finds tabs and "Load the sample" by name; a second match would break it
    const taken = ['Start', 'Deal', 'Top sheet & budget', 'Stripboard', 'Calendar', 'Call sheets', 'Breakdowns', 'Points & waterfall', 'SAG tier', 'Incentives', 'Pitch', 'About'];
    for (const s of TOUR_STEPS) { expect(taken).not.toContain(s.goName); expect(taken).not.toContain(s.go); expect(s.goName.toLowerCase()).not.toContain('load the sample'); }
  });
  it('only link to glossary words that exist', () => {
    const ids = new Set(GLOSSARY.map(t => t.id));
    for (const s of TOUR_STEPS) { expect(s.terms.length, s.id).toBeGreaterThan(0); for (const t of s.terms) expect(ids.has(t), `${s.id} → ${t}`).toBe(true); }
  });
  it('keep the house rules: no em-dashes, and the film this was built for is not named', () => {
    const all = TOUR_STEPS.flatMap(s => [s.title, s.go, s.goName, ...s.body]).join('\n');
    expect(all).not.toMatch(/[—–]/);
    expect(all).not.toMatch(/alone girl/i);
  });
});

describe('moving between steps', () => {
  const last = TOUR_STEPS.length - 1;
  it('goes forward and back one at a time', () => { expect(nextStep(0)).toBe(1); expect(prevStep(3)).toBe(2); });
  it('stops at both ends', () => { expect(prevStep(0)).toBe(0); expect(nextStep(last)).toBe(last); });
  it('puts any odd number back on the list', () => {
    expect(clampStep(-4)).toBe(0); expect(clampStep(99)).toBe(last); expect(clampStep(2.7)).toBe(2); expect(clampStep(NaN)).toBe(0);
  });
  it('knows the last step', () => { expect(isLastStep(last)).toBe(true); expect(isLastStep(0)).toBe(false); });
});

describe('remembering the dismissal', () => {
  it('shows the invitation to a browser that has never seen it', () => { expect(tourCardDismissed(memory())).toBe(false); });
  it('remembers one dismissal', () => {
    const m = memory(); dismissTourCard(m);
    expect(m.getItem(TOUR_KEY)).toBe('1'); expect(tourCardDismissed(m)).toBe(true);
  });
  it('does not fall over when the browser refuses storage', () => {
    const locked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(tourCardDismissed(locked)).toBe(false);
    expect(() => dismissTourCard(locked)).not.toThrow();
    expect(tourCardDismissed(null)).toBe(false); expect(() => dismissTourCard(null)).not.toThrow();
  });
});

describe('telling the sample from someone\'s own film', () => {
  it('goes by the title, with something open', () => {
    expect(isSampleOpen(sampleDemo().name, true)).toBe(true);
    expect(isSampleOpen(' salt flat ', true)).toBe(true);
    expect(isSampleOpen(SAMPLE_NAME, false)).toBe(false);
    expect(isSampleOpen('Nine Miles', true)).toBe(false);
  });
});

describe('what the steps say about the sample is true', () => {
  const sample = sampleDemo();
  const read = (p: Project) => { const e = applyDeal(p); return { ts: topSheet(e), sag: sagReport(e), wf: waterfallReport(e) }; };
  const composer = sample.lines.find(l => l.accountId === '4101' && l.description === 'Composer (package)')!;

  it('step 2: everyone is paid up front, so deferred and points start at nothing', () => {
    const { ts } = read(sample);
    expect(ts.deferredTotal).toBe(0); expect(ts.pointsValue).toBe(0); expect(ts.cashBudget).toBeGreaterThan(0); expect(ts.contingency).toBeGreaterThan(0);
  });

  it('step 3: the composer line is there at $12,000, is not one the deal sets, and moving it to points lowers the budget to raise by it and its contingency', () => {
    expect(composer).toBeTruthy();
    expect(composer.amount * composer.rate * composer.multiplier).toBe(12000);
    expect(composer.payType).toBe('cash'); expect(composer.fringes).toHaveLength(0);
    expect(Object.values(PRESET_GROUPS).some(g => g.match(composer))).toBe(false);   // a line the deal sets would ignore the change
    expect(step3Text()).toContain('4100 Score & Music');
    expect(sample.categories.find(c => c.number === '4100')?.name.toLowerCase()).toBe('score & music');
    const before = read(sample).ts;
    const after = read({ ...sample, lines: sample.lines.map(l => l.id === composer.id ? { ...l, payType: 'points' as const } : l) }).ts;
    expect(after.pointsValue).toBe(12000);
    expect(before.cashBudget - after.cashBudget).toBeCloseTo(12000 * (1 + sample.contingencyPct / 100), 2);
  });

  it('step 4: the sample is over the Moderate Low Budget cap, and producer fees to points bring it closer but not under', () => {
    const start = read(sample).sag;
    expect(start.target.name).toBe('Moderate Low Budget'); expect(start.fits).toBe(false);
    const moved = withDeal({ ...sample, lines: sample.lines.map(l => l.id === composer.id ? { ...l, payType: 'points' as const } : l) });
    const withFees: Project = { ...moved, deal: { ...moved.deal!, pay: { ...moved.deal!.pay, premiums: { ...moved.deal!.pay.premiums, producers: 'points' } } } };
    const end = read(withFees).sag;
    expect(end.fits).toBe(false);
    expect(end.headroom).toBeGreaterThan(start.headroom);   // both negative: less far over
    expect(-start.headroom).toBeCloseTo(105312.06, 1); expect(-end.headroom).toBeCloseTo(20612.06, 1);   // the figures docs/guide-draft-notes.md quotes
    expect(PRESET_GROUPS.producers.label).toMatch(/^Producer fees/);
  });

  it('step 5: three revenue figures, with something for the pool and for investors at each', () => {
    const { wf } = read(sample);
    expect(wf.scenarios).toHaveLength(3);
    for (let i = 0; i < 3; i++) { expect(wf.pools[i]).toBeGreaterThan(0); expect(wf.investors[i]).toBeGreaterThan(0); }
    expect(wf.rows.length).toBeGreaterThan(0);
  });

  function step3Text() { return TOUR_STEPS.find(s => s.id === 'paytype')!.body.join(' '); }
});
