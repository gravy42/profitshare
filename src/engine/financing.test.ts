import { describe, it, expect } from 'vitest';
import { sampleProject } from '../data/seed';
import { topSheet } from './budget';
import { afterDeferrals, recoupableBudget, sponsorFee, sponsorNet, waterfallReport } from './waterfall';
import { projections, withPitch } from './pitch';
import { preLetterKeep, prepDaysAfterLetter } from './incentives';
import { CA_MIN_WAGE, highestMinWage, outOfZonePctFromLocations } from './locations';
import { defaultDeal } from './deal';
import { sagReport } from './sag';
import type { LineItem, Project } from './types';

const seed = sampleProject();
/** The sample with one wage line turned into a fixed deferral. */
const withDeferral = (): Project => {
  const l = seed.lines.find(x => x.unit === 'DAY' && x.amount > 0 && x.rate > 0 && x.payType === 'cash')!;
  return { ...seed, lines: seed.lines.map(x => x.id === l.id ? { ...x, payType: 'deferred' as const } : x) };
};

describe('deferred pay in the waterfall', () => {
  it('comes off the top, before investors and the pool split anything', () => {
    expect(afterDeferrals(25_000, 10_000)).toEqual({ paid: 10_000, rest: 0 });
    expect(afterDeferrals(25_000, 100_000)).toEqual({ paid: 25_000, rest: 75_000 });
    const p = withDeferral(); const owed = topSheet(p).deferredTotal;
    expect(owed).toBeGreaterThan(0);
    const r = waterfallReport(p);
    expect(r.deferred).toBeCloseTo(owed, 2);
    r.scenarios.forEach((s, i) => {
      expect(r.deferredPaid[i]).toBeCloseTo(Math.min(owed, s), 2);
      expect(r.deferredPaid[i] + r.pools[i] + r.investors[i]).toBeCloseTo(s, 2);   // every dollar goes somewhere, once
    });
  });
  it('pays nothing extra when the budget defers nothing', () => {
    const r = waterfallReport(seed);
    expect(r.deferred).toBe(0);
    r.scenarios.forEach((s, i) => expect(r.pools[i] + r.investors[i]).toBeCloseTo(s, 2));
  });
  it('shows in the pitch projections too', () => {
    const p = withPitch(withDeferral());
    const q = { ...p, pitch: { ...p.pitch!, revenue: [{ id: 'r', source: 'all', low: 100_000, mid: 1_000_000, high: 5_000_000 }], feePct: 20 } };
    const pr = projections(q); const owed = topSheet(q).deferredTotal;
    expect(pr.mid.deferred).toBeCloseTo(owed, 2);
    expect(pr.mid.deferred + pr.mid.investors + pr.mid.pool).toBeCloseTo(pr.mid.net, 2);
  });
});

describe('fiscal sponsor fee', () => {
  it('only the money left after the fee reaches the film', () => {
    const w = { ...seed.waterfall, nonRecoupable: 400_000, sponsorFeePct: 8 };
    expect(sponsorFee(w)).toBe(32_000);
    expect(sponsorNet(w)).toBe(368_000);
    expect(recoupableBudget({ ...seed, waterfall: w })).toBeCloseTo(topSheet(seed).cashBudget - 368_000, 2);
    expect(sponsorNet({ ...seed.waterfall, nonRecoupable: 400_000 })).toBe(400_000);   // no fee set: unchanged
  });
});

describe('prep before the allocation letter', () => {
  const line = (description: string, amount: number, unit: LineItem['unit'] = 'DAY'): LineItem =>
    ({ id: description, accountId: '2101', description, amount, unit, rate: 30, multiplier: 14, fringes: [], tags: [], payType: 'cash' });
  it('counts the weekdays between the letter and the first day of photography', () => {
    expect(prepDaysAfterLetter('2027-02-22', '2027-03-08')).toBe(10);   // two working weeks
    expect(prepDaysAfterLetter('2027-02-22', '2027-02-22')).toBe(0);
  });
  it('keeps only the prep days after the letter; shoot, wrap and post lines are untouched', () => {
    const keep = preLetterKeep(seed, '2027-02-22', '2027-03-08');
    expect(keep(line('Prep', 20))).toBeCloseTo(0.5, 5);     // 10 of 20 prep days fall after the letter
    expect(keep(line('Prep', 8))).toBe(1);                  // a short prep sits wholly after it
    expect(keep(line('Location scout', 40))).toBeCloseTo(0.25, 5);
    expect(keep(line('Shoot', 20))).toBe(1);
    expect(keep(line('Wrap', 5))).toBe(1);
    expect(keep(line('Post', 60))).toBe(1);
    expect(keep(line('Prep allowance', 1, 'ALLOW'))).toBe(1);   // purchases carry no dates: left in
  });
  it('drops a camera test only when the calendar puts one before the letter', () => {
    const cal = (date: string): Project => ({ ...seed, calendar: { from: '', to: '', workDays: [1, 2, 3, 4, 5], skipHolidays: true, events: [{ id: 'e', date, label: 'Camera test', kind: 'test' }] } });
    expect(preLetterKeep(cal('2026-12-17'), '2027-02-22', '2027-03-08')(line('Camera test: operator', 1))).toBe(0);
    expect(preLetterKeep(cal('2027-03-01'), '2027-02-22', '2027-03-08')(line('Camera test: operator', 1))).toBe(1);
  });
});

describe('where you shoot', () => {
  const at = (locations: Project['locations']): Project => ({ ...seed, locations });
  it('gives the share of the shoot outside the Los Angeles zone', () => {
    expect(outOfZonePctFromLocations(seed)).toBeNull();     // no list: the typed percentage stands
    expect(outOfZonePctFromLocations(at([
      { id: 'a', name: 'City', days: 12, outsideLaZone: false, minWage: 18.42 },
      { id: 'b', name: 'Coast', days: 3, outsideLaZone: true, minWage: CA_MIN_WAGE },
      { id: 'c', name: 'Ranch', days: 5, outsideLaZone: false, minWage: CA_MIN_WAGE },
    ]))).toBe(15);
  });
  it('finds the highest local minimum wage, the state rate when nothing is listed', () => {
    expect(highestMinWage(seed)).toBe(CA_MIN_WAGE);
    expect(highestMinWage(at([{ id: 'a', name: 'City', days: 20, outsideLaZone: false, minWage: 18.42 }, { id: 'b', name: 'Coast', days: 0, outsideLaZone: true, minWage: CA_MIN_WAGE }]))).toBe(18.42);
    expect(defaultDeal(seed).nonShoot.cashHourly).toBe(CA_MIN_WAGE);
  });
});

describe('SAG pension & health', () => {
  it('says so when the budget fringe and the tier rate disagree', () => {
    const off = { ...seed, fringes: seed.fringes.map(f => /^SAG.?AFTRA$/i.test(f.id) ? { ...f, rate: 0.21 } : f) };
    const has = seed.fringes.some(f => /^SAG.?AFTRA$/i.test(f.id));
    if (has) expect(sagReport(off).notes.some(n => /pension & health/.test(n))).toBe(true);
    const on = { ...seed, fringes: seed.fringes.map(f => /^SAG.?AFTRA$/i.test(f.id) ? { ...f, rate: 0.22 } : f) };
    expect(sagReport(on).notes.some(n => /pension & health/.test(n))).toBe(false);
  });
});
