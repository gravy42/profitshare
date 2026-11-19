import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sampleProject } from '../data/seed';
import { topSheet } from './budget';
import { applyDeal } from './deal';
import { defaultIncentives, incentiveReport } from './incentives';
import { CASES, projections, withPitch } from './pitch';
import * as split from './split';
import * as waterfall from './waterfall';
import { recoupableBudget } from './waterfall';
import { allSwitches, pathFor } from './pathMath';
import type { PathInputs, PathSource } from './pathMath';
import { fundingPaths, fundingSources, pathInputs } from './paths';
import type { Project } from './types';

// Only the invented sample film and variants of it.
const seed = applyDeal(sampleProject());
/** The sample with revenue cases on the pitch, so the split has something to split. */
const withCases = (p: Project): Project => {
  const q = withPitch(p);
  return {
    ...q,
    pitch: {
      ...q.pitch!,
      revenue: [{ id: 'r', source: 'all', low: 400_000, mid: 2_000_000, high: 6_000_000 }],
      feePct: 20,
    },
  };
};
/** The sample is under the credits' $1M floor; triple its rates so it qualifies (as the incentives tests do). */
const big = (): Project => {
  const s = sampleProject();
  return applyDeal({ ...s, lines: s.lines.map(l => ({ ...l, rate: l.rate * 3 })) });
};
const incentives = (p: Project, ca: boolean, fed: boolean, perks: Record<string, number> = {}): Project => {
  const d = defaultIncentives(p);
  return { ...p, incentives: { ...d, ca: { ...d.ca, enabled: ca }, federal: { ...d.federal, enabled: fed }, perks } };
};
/** One wage line turned into a fixed deferral. */
const withDeferral = (p: Project): Project => {
  const l = p.lines.find(x => x.unit === 'DAY' && x.amount > 0 && x.rate > 0 && x.payType === 'cash')!;
  return { ...p, lines: p.lines.map(x => (x.id === l.id ? { ...x, payType: 'deferred' as const } : x)) };
};

const recoupFirst = { model: 'recoup-first' as const, recoupPct: 120, poolPct: 50, grossSharePct: 10 };
const offTheGross = { ...recoupFirst, model: 'off-the-gross' as const };
const src = (key: string, amount: number, on = true): PathSource => ({ key, label: key, amount, on });
const inputs = (over: Partial<PathInputs> = {}): PathInputs => ({
  cashBudget: 1_000_000,
  deferred: 0,
  sources: [],
  waterfall: recoupFirst,
  feePct: 20,
  cases: [
    { label: 'Low', gross: 500_000 },
    { label: 'Mid', gross: 2_500_000 },
    { label: 'High', gross: 8_000_000 },
  ],
  ...over,
});

describe('the split, on its own', () => {
  it('still splits the way it did', () => {
    expect(split.poolAt(recoupFirst, 100_000, 100_000)).toBe(0); // under 120% back: nothing for the pool yet
    expect(split.poolAt(recoupFirst, 100_000, 320_000)).toBe(100_000); // half of what is left after 120,000
    expect(split.investorsAt(recoupFirst, 100_000, 320_000)).toBe(220_000);
    expect(split.poolAt(offTheGross, 90_000, 100_000)).toBeCloseTo(10_000, 6); // 10% from dollar one
    expect(split.poolAt(offTheGross, 90_000, 220_000)).toBeCloseTo(12_000 + 50_000, 6); // investors recoup at 120,000, then half
    expect(split.afterDeferrals(25_000, 10_000)).toEqual({ paid: 10_000, rest: 0 });
    expect(split.afterDeferrals(25_000, 100_000)).toEqual({ paid: 25_000, rest: 75_000 });
  });
  it('is still what waterfall.ts exports', () => {
    expect(waterfall.poolAt).toBe(split.poolAt);
    expect(waterfall.investorsAt).toBe(split.investorsAt);
    expect(waterfall.afterDeferrals).toBe(split.afterDeferrals);
  });
});

describe('one funding path', () => {
  it('with no other source, investors fund the whole budget', () => {
    const r = pathFor(inputs());
    expect(r.investors).toBe(1_000_000);
    expect(r.switches).toEqual({});
    expect(r.cases.map(c => c.label)).toEqual(['Low', 'Mid', 'High']);
    expect(r.cases[1].fees).toBe(500_000);
    expect(r.cases[1].net).toBe(2_000_000);
    expect(r.cases[1].toInvestors).toBe(1_600_000); // 1.2M back, then half of 800,000
    expect(r.cases[1].toPool).toBe(400_000);
    expect(r.cases[1].multiple).toBeCloseTo(1.6, 10);
  });
  it('switching a source off raises the investor money by exactly its amount', () => {
    const i = inputs({ sources: [src('grants', 150_000), src('ca', 220_000)] });
    const all = pathFor(i);
    expect(all.investors).toBe(630_000);
    expect(pathFor(i, { ca: false }).investors - all.investors).toBe(220_000);
    expect(pathFor(i, { grants: false }).investors - all.investors).toBe(150_000);
    expect(pathFor(i, { grants: false, ca: false }).investors).toBe(1_000_000);
  });
  it('a switch that is left out falls back to the source as saved', () => {
    const i = inputs({ sources: [src('grants', 150_000), src('ca', 220_000, false)] });
    expect(pathFor(i).investors).toBe(850_000); // the credit is saved off
    expect(pathFor(i).switches).toEqual({ grants: true, ca: false });
    expect(pathFor(i, {}).investors).toBe(850_000);
    expect(pathFor(i, { ca: true }).switches).toEqual({ grants: true, ca: true });
    expect(pathFor(i, { ca: true }).investors).toBe(630_000);
    expect(pathFor(i, { grants: false, nonsense: true }).switches).toEqual({ grants: false, ca: false }); // unknown keys are ignored
  });
  it('pays deferred money first, and every dollar of net goes somewhere, once', () => {
    for (const w of [recoupFirst, offTheGross]) {
      const i = inputs({ deferred: 450_000, waterfall: w, sources: [src('grants', 150_000)] });
      for (const sw of allSwitches(i.sources)) {
        const r = pathFor(i, sw);
        expect(r.cases[0].deferredPaid).toBe(400_000); // a low case that cannot cover the deferrals pays what it has
        expect(r.cases[0].toInvestors).toBe(0);
        expect(r.cases[0].toPool).toBe(0);
        expect(r.cases[1].deferredPaid).toBe(450_000);
        for (const c of r.cases) expect(c.deferredPaid + c.toInvestors + c.toPool).toBeCloseTo(c.net, 6);
      }
    }
    const without = pathFor(inputs()),
      withDef = pathFor(inputs({ deferred: 450_000 }));
    expect(withDef.cases[2].toInvestors).toBeLessThan(without.cases[2].toInvestors);
  });
  it('never asks investors for less than nothing', () => {
    const r = pathFor(inputs({ sources: [src('grants', 900_000), src('ca', 400_000)] }));
    expect(r.investors).toBe(0);
    for (const c of r.cases) {
      expect(c.multiple).toBe(0);
      expect(Number.isFinite(c.toInvestors)).toBe(true);
    }
  });
});

describe('every combination of switches', () => {
  it('gives 2^n of them, all-on first, none twice', () => {
    expect(allSwitches([])).toEqual([{}]);
    for (const n of [1, 2, 3, 4]) {
      const sources = Array.from({ length: n }, (_, k) => src(`s${k}`, 1000 * (k + 1), k % 2 === 0));
      const all = allSwitches(sources);
      expect(all.length).toBe(2 ** n);
      expect(Object.values(all[0]).every(Boolean)).toBe(true);
      expect(Object.values(all[all.length - 1]).some(Boolean)).toBe(false);
      for (const sw of all) expect(Object.keys(sw)).toEqual(sources.map(s => s.key));
      expect(new Set(all.map(sw => JSON.stringify(sw))).size).toBe(2 ** n);
      expect(allSwitches(sources)).toEqual(all); // the same order every time
    }
    expect(allSwitches([src('a', 1), src('b', 1)])).toEqual([
      { a: true, b: true },
      { a: true, b: false },
      { a: false, b: true },
      { a: false, b: false },
    ]);
  });
});

describe('funding sources of a project', () => {
  it('the sample as it ships has none', () => {
    expect(fundingSources(seed)).toEqual([]);
  });
  it('grants come in net of the fiscal sponsor fee', () => {
    const p = { ...seed, waterfall: { ...seed.waterfall, nonRecoupable: 200_000, sponsorFeePct: 8 } };
    const s = fundingSources(p);
    expect(s.map(x => x.key)).toEqual(['grants']);
    expect(s[0]).toMatchObject({ label: 'Grants and fiscal sponsorship', amount: 184_000, on: true });
    expect(s[0].note).toMatch(/8%/);
    const noFee = fundingSources({ ...seed, waterfall: { ...seed.waterfall, nonRecoupable: 200_000 } });
    expect(noFee[0].amount).toBe(200_000);
    expect(noFee[0].note).toBeUndefined();
  });
  it('lists the California credit when it is on, at what the incentives report nets', () => {
    const p = incentives(big(), true, false);
    expect(topSheet(p).cashBudget).toBeGreaterThan(1_000_000);
    const ca = fundingSources(p).find(x => x.key === 'ca')!;
    expect(ca).toMatchObject({ label: 'California tax credit', on: true });
    expect(ca.amount).toBeGreaterThan(0);
    expect(ca.amount).toBeCloseTo(incentiveReport(p).ca.net, 2);
  });
  it('lists a credit the film could take but has not switched on, as off, at the same amount', () => {
    const off = fundingSources(incentives(big(), false, false));
    expect(off.map(x => x.key)).toEqual(['ca', 'federal']);
    expect(off.every(x => !x.on)).toBe(true);
    expect(off[1].note).toBe('proposed, not yet law');
    const on = fundingSources(incentives(big(), true, true));
    expect(on.map(x => x.on)).toEqual([true, true]);
    expect(on.map(x => x.amount)).toEqual(off.map(x => x.amount));
  });
  it('keeps the order grants, California, federal, perks', () => {
    const p = incentives({ ...big(), waterfall: { ...big().waterfall, nonRecoupable: 50_000 } }, true, false, {
      'state-locations': 12_000,
      'hotel-tax': 0,
    });
    const s = fundingSources(p);
    expect(s.map(x => x.key)).toEqual(['grants', 'ca', 'federal', 'perks']);
    expect(s[3]).toMatchObject({ label: 'Local perks', amount: 12_000, on: true });
    expect(s.map(x => x.on)).toEqual([true, true, false, true]);
  });
  it('leaves out a source worth nothing', () => {
    // under the $1M floor neither credit is worth anything, switched on or not; a perk with no estimate is worth 0
    expect(fundingSources(incentives(seed, true, true, { 'hotel-tax': 0 }))).toEqual([]);
    expect(fundingSources({ ...seed, waterfall: { ...seed.waterfall, nonRecoupable: 0, sponsorFeePct: 8 } })).toEqual(
      [],
    );
    // no incentives object: only the grants, even on a film over the floor
    expect(
      fundingSources({ ...big(), waterfall: { ...big().waterfall, nonRecoupable: 50_000 } }).map(x => x.key),
    ).toEqual(['grants']);
  });
});

describe('funding paths of a project', () => {
  /** The current path must be the numbers every other tab shows. */
  const reconciles = (p: Project) => {
    const paths = fundingPaths(p);
    const current = paths.filter(x => x.current);
    expect(current.length).toBe(1);
    expect(paths.length).toBe(2 ** fundingSources(p).length);
    const cur = current[0],
      pr = projections(p);
    expect(cur.investors).toBeCloseTo(recoupableBudget(p), 2);
    CASES.forEach((c, i) => {
      expect(cur.cases[i].gross).toBeCloseTo(pr[c].gross, 2);
      expect(cur.cases[i].fees).toBeCloseTo(pr[c].fees, 2);
      expect(cur.cases[i].net).toBeCloseTo(pr[c].net, 2);
      expect(cur.cases[i].deferredPaid).toBeCloseTo(pr[c].deferred, 2);
      expect(cur.cases[i].toInvestors).toBeCloseTo(pr[c].investors, 2);
      expect(cur.cases[i].toPool).toBeCloseTo(pr[c].pool, 2);
      expect(cur.cases[i].multiple).toBeCloseTo(pr[c].multiple, 6);
    });
    return paths;
  };
  it('reads the budget, the deferrals, the deal and the cases from the project', () => {
    const p = withCases(withDeferral(seed));
    const i = pathInputs(p);
    expect(i.cashBudget).toBe(topSheet(p).cashBudget);
    expect(i.deferred).toBe(topSheet(p).deferredTotal);
    expect(i.deferred).toBeGreaterThan(0);
    expect(i.cases).toEqual([
      { label: 'Low', gross: 400_000 },
      { label: 'Mid', gross: 2_000_000 },
      { label: 'High', gross: 6_000_000 },
    ]);
    expect(i.feePct).toBe(20);
    expect(i.waterfall).toEqual({
      model: p.waterfall.model,
      recoupPct: p.waterfall.recoupPct,
      poolPct: p.waterfall.poolPct,
      grossSharePct: p.waterfall.grossSharePct,
    });
    expect(pathInputs(seed).cases.map(c => c.label)).toEqual(['Low', 'Mid', 'High']); // a project with no pitch yet still has three cases
  });
  it('a film with no grants and no incentives has one path, and it is the current one', () => {
    const paths = reconciles(withCases(seed));
    expect(paths.length).toBe(1);
    expect(paths[0].current).toBe(true);
    expect(paths[0].switches).toEqual({});
    expect(paths[0].investors).toBe(topSheet(seed).cashBudget);
  });
  it('the current path is the investor money and the projections the rest of the app shows', () => {
    const granted = (p: Project): Project => ({
      ...p,
      waterfall: { ...p.waterfall, nonRecoupable: 200_000, sponsorFeePct: 8 },
    });
    reconciles(withCases(granted(seed)));
    reconciles(withCases(withDeferral(granted(seed))));
    reconciles(withCases(granted(incentives(big(), true, false))));
    reconciles(withCases(granted(incentives(big(), false, false))));
    reconciles(withCases(withDeferral(granted(incentives(big(), true, true, { 'state-locations': 12_000 })))));
    reconciles(
      withCases({
        ...granted(incentives(big(), false, true)),
        waterfall: { ...granted(big()).waterfall, model: 'off-the-gross' },
      }),
    );
    reconciles(granted(seed)); // no revenue cases typed in yet
  });
  it('puts the all-on path first and marks the saved one, wherever it falls', () => {
    const p = withCases({
      ...incentives(big(), true, false),
      waterfall: { ...big().waterfall, nonRecoupable: 200_000, sponsorFeePct: 8 },
    });
    const paths = reconciles(p);
    expect(paths.length).toBe(8);
    expect(paths[0].switches).toEqual({ grants: true, ca: true, federal: true });
    expect(paths[0].current).toBe(false); // the federal credit is saved off
    expect(paths.find(x => x.current)!.switches).toEqual({ grants: true, ca: true, federal: false });
    const allOff = paths[paths.length - 1];
    expect(allOff.investors).toBe(topSheet(p).cashBudget);
    const sum = fundingSources(p).reduce((n, s) => n + s.amount, 0);
    expect(allOff.investors - paths[0].investors).toBeCloseTo(sum, 2);
    for (const path of paths)
      for (const c of path.cases) expect(c.deferredPaid + c.toInvestors + c.toPool).toBeCloseTo(c.net, 2);
  });
});

describe('paths under awkward inputs', () => {
  const freeze = <T>(o: T): T => {
    if (o && typeof o === 'object') {
      Object.values(o as object).forEach(freeze);
      Object.freeze(o);
    }
    return o;
  };
  it('reads every revenue line and the fee from the project, and leaves the project alone', () => {
    const q = withPitch(seed);
    const p = freeze({
      ...q,
      pitch: {
        ...q.pitch!,
        feePct: 17.5,
        revenue: [
          { id: 'a', source: 'one', low: 100_000.37, mid: 900_000, high: 2_500_000 },
          { id: 'b', source: 'two', low: 50_000, mid: 400_000.5, high: 1_500_000 },
        ],
      },
    }) as Project;
    const cur = fundingPaths(p).find(x => x.current)!;
    const pr = projections(p);
    expect(cur.cases.map(c => c.gross)).toEqual([150_000.37, 1_300_000.5, 4_000_000]);
    CASES.forEach((c, i) => {
      expect(cur.cases[i].fees).toBeCloseTo(pr[c].gross * 0.175, 2);
      expect(cur.cases[i].toInvestors).toBeCloseTo(pr[c].investors, 2);
      expect(cur.cases[i].toPool).toBeCloseTo(pr[c].pool, 2);
    });
  });
  it('treats negative grants as none, and a covered budget as nothing to fund', () => {
    const neg = withCases({ ...seed, waterfall: { ...seed.waterfall, nonRecoupable: -50_000 } });
    expect(fundingPaths(neg).find(x => x.current)!.investors).toBeCloseTo(recoupableBudget(neg), 2);
    expect(recoupableBudget(neg)).toBeCloseTo(topSheet(neg).cashBudget, 2);
    const covered = withCases({
      ...seed,
      waterfall: { ...seed.waterfall, nonRecoupable: topSheet(seed).cashBudget - 1e-9 },
    });
    const cur = fundingPaths(covered).find(x => x.current)!;
    expect(cur.investors).toBe(0);
    expect(recoupableBudget(covered)).toBe(0);
    for (const c of cur.cases) {
      expect(c.multiple).toBe(0);
      expect(Number.isFinite(c.toPool)).toBe(true);
    }
  });
});

describe('what the path math depends on', () => {
  const imports = (file: string) =>
    [
      ...readFileSync(resolve(process.cwd(), 'src/engine', file), 'utf8').matchAll(
        /^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+['"]([^'"]+)['"]/gm,
      ),
    ].map(m => ({ typeOnly: !!m[2], from: m[3] }));
  it('split.ts imports nothing but types', () => {
    const found = imports('split.ts');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(i => i.typeOnly)).toBe(true);
  });
  it('pathMath.ts imports only the split and types', () => {
    const found = imports('pathMath.ts');
    expect(found.some(i => i.from === './split' && !i.typeOnly)).toBe(true);
    for (const i of found) expect(i.typeOnly || i.from === './split').toBe(true);
  });
  it('neither reaches for anything by require or dynamic import', () => {
    for (const f of ['split.ts', 'pathMath.ts'])
      expect(readFileSync(resolve(process.cwd(), 'src/engine', f), 'utf8')).not.toMatch(
        /\brequire\(|\bimport\(|^\s*import\s+['"]/m,
      );
  });
});
