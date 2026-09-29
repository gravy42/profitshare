import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const fx = (f: string) => resolve(process.cwd(), 'tools/fixtures', f);
import { sampleProject, PROFIT_SHARE_PRESET_MATCH } from '../data/seed';
import budgetJson from '../data/sample-budget.json';
import { lineFringes, lineSubtotal, topSheet, setPayType, rollupCashTotal } from './budget';
const rollupCash = (ts: ReturnType<typeof topSheet>) => rollupCashTotal(ts.subtotal);
import { sagReport, rerateCast, qualifyingTier } from './sag';
import { poolAt, waterfallReport, syncDaysFromBudget } from './waterfall';
import { autoDayBreaks, dood, insertDayBreak, moveStrip, shootDays, syncCastDaysFromBoard, totalEighths } from './board';
import { parseSex } from './importers/sex';
import { parseFdx } from './importers/fdx';
import { parseShamelXlsx } from './importers/shamelXlsx';

const seed = sampleProject();

describe('budget engine', () => {
  // The fringe model (rate + per-line wage cap) was fitted against a real 858-line Shamel Studio export and
  // reproduced every line to the cent; that budget is private, so the shipped tests use the invented sample.
  it('matches the totals the sample generator computed independently', () => {
    const ts = topSheet(seed);
    const t = (budgetJson as any).totals;
    expect(seed.lines.length).toBe(154);
    expect(ts.subtotal.cash + ts.subtotal.cashFringes).toBeCloseTo(t.subtotal, 2);
    expect(ts.contingency).toBeCloseTo(t.contingency, 2);
    expect(ts.cashBudget).toBeCloseTo(811_758.05, 2);
    expect(ts.deferredTotal).toBe(0);
  });
  it('caps FUI and SUI at the first $7,000 of wages per line', () => {
    const dp = seed.lines.find(l => l.accountId === '2601' && l.description === 'Shoot')!;
    const wages = lineSubtotal(dp);                       // 12 × 35.71 × 14 = 5,999.28 (under the cap)
    expect(wages).toBeCloseTo(5_999.28, 2);
    expect(lineFringes(dp, seed.fringes)).toBeCloseTo(wages * (0.062 + 0.0145 + 0.006 + 0.062 + 0.0448 + 0.0175), 1);
    const lp = seed.lines.find(l => l.accountId === '2101' && l.description === 'Prep')!; // 20 × 35.71 × 14 = 9,998.80 (over)
    const w2 = lineSubtotal(lp);
    expect(lineFringes(lp, seed.fringes)).toBeCloseTo(w2 * (0.062 + 0.0145 + 0.0448 + 0.0175) + 7000 * (0.006 + 0.062), 1);
  });
  it('moves money out of the cash budget when a line becomes points, and drops a SAG tier', () => {
    let p = seed;
    for (const l of p.lines) if (PROFIT_SHARE_PRESET_MATCH(l)) p = setPayType(p, l.id, 'points');
    const ts = topSheet(p);
    expect(ts.pointsValue).toBe(105_000);                  // two producer fees, the script, the star allowance
    expect(ts.cashBudget).toBeCloseTo(696_258.05, 2);
    expect(sagReport(seed).qualifying.id).toBe('LBA');
    expect(sagReport(p).qualifying.id).toBe('MLB');
  });
  it('keeps deferred pay inside total production cost', () => {
    const l = seed.lines.find(x => x.accountId === '1201' && /^Fee$/.test(x.description))!;
    const p = setPayType(seed, l.id, 'deferred');
    const ts = topSheet(p);
    expect(ts.deferredTotal).toBe(40_000);
    expect(ts.totalProductionCost).toBeCloseTo(ts.cashBudget + 40_000, 2);
  });
});

describe('SAG tiers', () => {
  it('picks the cheapest tier that fits', () => {
    expect(qualifyingTier(650_000, false).id).toBe('MLB');
    expect(qualifyingTier(1_000_000, false).id).toBe('LBA');
    expect(qualifyingTier(1_000_000, true).id).toBe('MLB');
    expect(qualifyingTier(2_500_000, false).id).toBe('BASIC');
    expect(qualifyingTier(2_500_000, true).id).toBe('LBA');
  });
  it('counts 42 performer days in the sample and reprices them', () => {
    const r = sagReport(seed);
    expect(r.performerDays).toBe(42);
    expect(r.castScaleCostAtTier.MLB).toBe(42 * 449);
    const p = rerateCast(seed, 'LBA');
    expect(sagReport(p).castScaleCostAtTier.LBA).toBe(42 * 834);
    const lena = p.lines.find(l => l.accountId === '1401' && l.unit === 'DAY' && l.amount === 12)!;
    expect(lena.rate).toBe(834);
    const agent = p.lines.find(l => l.accountId === '1401' && /agent fee/i.test(l.description))!;
    expect(agent.rate).toBe(12 * 834);
  });
});

describe('waterfall', () => {
  it('recoup-first pays nothing until investors recoup', () => {
    const w = { model: 'recoup-first' as const, recoupPct: 110, poolPct: 50, grossSharePct: 40, scenarios: [] };
    expect(poolAt(w, 1_000_000, 1_000_000)).toBe(0);
    expect(poolAt(w, 1_000_000, 2_100_000)).toBe(500_000);
  });
  it('off-the-gross pays from dollar one', () => {
    const w = { model: 'off-the-gross' as const, recoupPct: 120, poolPct: 50, grossSharePct: 40, scenarios: [] };
    expect(poolAt(w, 1_000_000, 500_000)).toBe(200_000);
    const rStar = 1_200_000 / 0.6;
    expect(poolAt(w, 1_000_000, rStar + 100)).toBeCloseTo(0.4 * rStar + 50, 2);
  });
  it('shares the pool by points and links cash pay', () => {
    const r = waterfallReport(seed);
    const sum = r.rows.reduce((n, row) => n + row.share, 0);
    expect(sum).toBeCloseTo(1, 6);
    const lena = r.rows.find(x => x.participant.castId === 1)!;
    expect(lena.participant.name).toBe('LENA');
    expect(lena.participant.days).toBe(12);
    expect(lena.cashPay).toBeCloseTo(12 * 449 + 15_000, 2); // scale + star allowance
    expect(seed.participants.find(x => x.id === 'p_2601_1')!.name).toBe('Ines Calderón (Director of photography)');
    const synced = syncDaysFromBudget(seed);
    expect(synced.participants.find(x => x.castId === 1)!.days).toBe(12);
  });
});

describe('board', () => {
  it('sample has 26 scenes totalling 69 6/8 pages, strips in shooting order', () => {
    expect(seed.board.scenes.length).toBe(26);
    expect(totalEighths(seed.board)).toBe(558);
    expect(seed.board.strips[0]).toEqual({ type: 'scene', sceneId: 'sc3' });   // gas station first, not scene 1
    expect(seed.board.strips.some(s => s.type === 'daybreak')).toBe(false);
  });
  it('auto day breaks respect the target and DOOD counts days', () => {
    const b = autoDayBreaks(seed.board, 48);
    const days = shootDays(b);
    expect(days.every(d => d.eighths <= 48 || d.scenes.length === 1)).toBe(true);
    expect(days.length).toBeGreaterThanOrEqual(12);
    const rows = dood(b);
    const lena = rows.find(r => r.castId === 1)!;
    expect(lena.total).toBe(days.filter(d => d.castIds.includes(1)).length);
  });
  it('moves strips and syncs cast days into the budget', () => {
    let b = insertDayBreak(seed.board, 6);
    b = moveStrip(b, 0, 3);
    expect((b.strips[2] as any).sceneId).toBe('sc3');
    const p = syncCastDaysFromBoard({ ...seed, board: autoDayBreaks(seed.board, 48) });
    const lena = p.participants.find(x => x.castId === 1)!;
    const line = p.lines.find(l => l.participantId === lena.id && l.unit === 'DAY')!;
    expect(line.amount).toBe(lena.days);
    expect(lena.days).toBeGreaterThan(8);
  });
});

describe('importers', () => {
  it('parses a Movie Magic .sex board (fixture written by tools/make-sample.mjs in the layout Shamel exports)', () => {
    const buf = readFileSync(fx('SaltFlat_Board.sex'));
    const b = parseSex(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(b.scenes.length).toBe(26);
    expect(b.scenes.find(s => s.number === '4')!.eighths).toBe(36);
    expect(b.scenes.find(s => s.number === '4')!.cast.map(c => c.name)).toEqual(['LENA', 'JUNE', 'WAITRESS']);
    expect(b.scenes.find(s => s.number === '3')!.elements.Vehicles).toEqual(['station wagon', 'tow truck']);
    expect(b.strips.map(s => (s as any).sceneId).slice(0, 3)).toEqual(['sc3', 'sc5', 'sc20']);  // board order, not script order
    expect(b.castList.find(c => c.name === 'LENA')!.id).toBe(1);
  });
  it('parses a Shamel-layout .xlsx budget and reconciles it', () => {
    const buf = readFileSync(fx('Budget_SaltFlat_Draft3.xlsx'));
    const imp = parseShamelXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(imp.lines.length).toBe(154);
    expect(imp.accounts.length).toBe(seed.accounts.length);
    expect(imp.shootDays).toBe(12);
    expect(imp.reported.grandTotal).toBeCloseTo(811_758.05, 2);
    const p = { ...seed, categories: imp.categories, accounts: imp.accounts, fringes: imp.fringes, lines: imp.lines };
    expect(topSheet(p).cashBudget).toBeCloseTo(imp.reported.grandTotal!, 2);
  });
  it('parses a Final Draft file', () => {
    const xml = readFileSync(fx('sample.fdx'), 'utf8');
    const b = parseFdx(xml);
    expect(b.scenes.length).toBe(3);
    expect(b.scenes[0].ie).toBe('EXT');
    expect(b.scenes[0].eighths).toBe(2);
    expect(b.scenes[2].eighths).toBe(27);
    expect(b.scenes[2].cast.map(c => c.name)).toEqual(['WAITRESS', 'LENA', 'JUNE']);
    expect(b.castList.map(c => c.name)).toContain('LENA');
  });
});

import { parseBudgetFile } from './importers/budget';
import { blankProject, standardChartOfAccounts } from '../data/seed';
import { addAccount, addCategory, addLine, removeLine, toggleLineFringe, upsertFringe } from './budget';

const toBuf = (f: string) => { const b = readFileSync(fx(f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe('generic budget import (Movie Magic Budgeting / Excel / CSV exports)', () => {
  it('reads an MMB-style CSV with account header rows, hourly multipliers and fringe dollars', () => {
    const imp = parseBudgetFile(toBuf('mmb-export.csv'), 'mmb-export.csv', standardChartOfAccounts());
    expect(imp.source).toBe('generic');
    expect(imp.lines).toHaveLength(7);
    expect(imp.accounts.map(a => a.number)).toEqual(['1102', '1201', '2101', '2102', '4001']);
    expect(imp.accounts.find(a => a.number === '2102')!.name).toBe('1ST ASSISTANT DIRECTOR');
    expect(imp.categories.map(c => c.number)).toEqual(['1100', '1200', '2100', '4000']);
    const ad = imp.lines.find(l => l.description === '1st AD')!;
    expect(ad.accountId).toBe('2102'); expect(ad.amount).toBe(25); expect(ad.multiplier).toBe(14); expect(ad.rate).toBe(35.29); expect(ad.unit).toBe('DAY');
    // fringe dollars with no names → synthetic fringe that reproduces the amount
    const p = { ...blankProject({ chartOfAccounts: 'empty' }), categories: imp.categories, accounts: imp.accounts, fringes: imp.fringes, lines: imp.lines };
    expect(lineFringes(ad, p.fringes)).toBeCloseTo(1259.85, 0);
    const ts = topSheet(p);
    expect(rollupCash(ts)).toBeCloseTo(224_534.26, 0);
    expect(imp.reportedTotal).toBeCloseTo(220_180.82, 2); // subtotal column, before fringes
    // the "Total" row at the bottom was not imported as a line
    expect(imp.lines.some(l => /^total$/i.test(l.description))).toBe(false);
  });
  it('reads an Excel sheet with a category column, repeated account numbers, named fringes, and skips a cover sheet', () => {
    const imp = parseBudgetFile(toBuf('generic-budget.xlsx'), 'generic-budget.xlsx', standardChartOfAccounts());
    expect(imp.lines).toHaveLength(6);
    expect(imp.accounts.find(a => a.number === '1401')!.name).toBe('PRINCIPAL CAST'); // name from the standard chart
    expect(imp.categories.find(c => c.number === '3400')!.name).toBe('LOCATIONS');
    const dp = imp.lines.find(l => l.description === 'DP')!;
    expect(dp.fringes).toEqual(['FICA1', 'FICA2', 'FUI', 'SUI (CA)', 'WC (CA)', 'PAYROLL FEE']);
    expect(dp.multiplier).toBe(1);
    expect(imp.warnings).toEqual([]);
  });
  it('still routes a Shamel workbook to the Shamel importer', () => {
    const imp = parseBudgetFile(toBuf('Budget_SaltFlat_Draft3.xlsx'), 'Budget_SaltFlat_Draft3.xlsx');
    expect(imp.source).toBe('shamel');
    expect(imp.lines).toHaveLength(154);
  });
});

describe('building a budget from scratch', () => {
  it('starts with the standard chart of accounts and no money', () => {
    const p = blankProject({ name: 'Test', shootDays: 12 });
    expect(p.categories.length).toBe(32); expect(p.accounts.length).toBe(272); expect(p.lines).toEqual([]);
    expect(topSheet(p).cashBudget).toBe(0);
  });
  it('adds categories, accounts, lines and fringes and rolls them up', () => {
    let p = blankProject({ chartOfAccounts: 'empty' });
    p = addCategory(p, '2600', 'CAMERA');
    p = addAccount(p, '2600', '2601', 'DP');
    const r = addLine(p, '2601', { description: 'DP', amount: 20, unit: 'DAY', rate: 494 });
    p = r.project;
    p = upsertFringe(p, { id: 'FLAT10', name: 'Flat 10', rate: 0.1, cap: null });
    p = toggleLineFringe(p, r.line.id, 'FLAT10');
    const ts = topSheet(p);
    expect(ts.subtotal.cash).toBe(9880); expect(ts.subtotal.cashFringes).toBe(988);
    expect(ts.sections[1].categories[0].category.name).toBe('CAMERA');
    p = removeLine(p, r.line.id);
    expect(topSheet(p).cashBudget).toBe(0);
  });
});

import { fitDayBreaks } from './board';
describe('fit day breaks', () => {
  it('splits into exactly the shoot days with the lightest possible heaviest day', () => {
    const b = fitDayBreaks(seed.board, 12);
    const days = shootDays(b);
    expect(days.length).toBe(12);
    const heaviest = Math.max(...days.map(d => d.eighths));
    expect(heaviest).toBeLessThanOrEqual(60);            // 7 4/8 pages; greedy-at-6 needed 16 days
    expect(b.strips.filter(s => s.type === 'scene').map(s => (s as any).sceneId)).toEqual(seed.board.strips.map(s => (s as any).sceneId));
  });
});

import { everyoneAtScale, isPayrollLine, isSagPerformerLine } from './sag';
describe('everyone at scale (the Sing Sing model)', () => {
  it('prices every wage line hourly off the 8-hour scale with overtime, gives producers wage lines, moves premiums to points', () => {
    const p = everyoneAtScale(seed, 'MLB', { premiums: 'points' });   // 12-hour days: crew 14 paid hours, cast 15
    const hourly = 56.13;                                               // 449 / 8
    for (const l of p.lines.filter(l => isPayrollLine(l) && l.unit === 'DAY')) {
      expect(l.rate).toBe(hourly);
      expect([14, 15, 18]).toContain(l.multiplier);
    }
    const dp = p.lines.find(l => l.accountId === '2601' && l.description === 'Shoot')!;
    expect(lineSubtotal(dp) / dp.amount).toBeCloseTo(785.82, 1);       // a 12-hour crew day
    const lena = p.lines.find(l => l.accountId === '1401' && l.unit === 'DAY' && l.amount === 12)!;
    expect(lena.multiplier).toBe(15); expect(lineSubtotal(lena) / 12).toBeCloseTo(841.95, 1);   // a 12-hour SAG day
    const agent = p.lines.find(l => l.accountId === '1401' && /agent fee/i.test(l.description))!;
    expect(agent.rate).toBeCloseTo(lineSubtotal(lena), 2);
    const prod = p.lines.filter(l => l.accountId === '1201' && isPayrollLine(l));
    expect(prod).toHaveLength(2);
    expect(prod[0].amount).toBe(52); expect(prod[0].rate).toBe(hourly); expect(prod[0].multiplier).toBe(14);
    expect(p.participants.find(x => x.id === 'p_producer_1')!.days).toBe(52);
    expect(p.lines.filter(l => /^Fee$/.test(l.description)).every(l => l.payType === 'points')).toBe(true);
    expect(topSheet(p).pointsValue).toBe(105_000);
  });
  it('can delete the premiums instead', () => {
    const p = everyoneAtScale(seed, 'MLB', { premiums: 'delete' });
    expect(p.lines.some(l => /ALLOWANCE$/.test(l.description))).toBe(false);
    expect(topSheet(p).pointsValue).toBe(0);
  });
});

import { setDayHours, PAID_HOURS } from './budget';
describe('10- and 12-hour days', () => {
  it('swaps paid-hours multipliers for crew and cast and round-trips', () => {
    const scale = everyoneAtScale(seed, 'MLB', { premiums: 'points' });
    const ten = setDayHours(scale, 10);
    const dp = ten.lines.find(l => l.accountId === '2601' && l.description === 'Shoot')!;
    expect(dp.multiplier).toBe(PAID_HOURS[10].day);
    expect(lineSubtotal(dp) / dp.amount).toBeCloseTo(617.43, 1);      // 449 + 2 hours at 1.5x
    const lena = ten.lines.find(l => l.accountId === '1401' && l.unit === 'DAY' && l.amount === 12)!;
    expect(lena.multiplier).toBe(11);
    expect(topSheet(ten).cashBudget).toBeLessThan(topSheet(scale).cashBudget);
    // a raw hourly budget gets cheaper with fewer hours and comes back exactly
    const raw = setDayHours(seed, 10);
    expect(raw.lines.find(l => l.accountId === '2601' && l.description === 'Shoot')!.multiplier).toBe(11);
    expect(topSheet(raw).cashBudget).toBeLessThan(topSheet(seed).cashBudget);
    expect(topSheet(setDayHours(raw, 12)).cashBudget).toBeCloseTo(topSheet(seed).cashBudget, 2);
  });
});

describe('crew on a different scale than cast', () => {
  it('prices crew and producers at the chosen 8-hour rate while cast stay at the tier', () => {
    const p = everyoneAtScale(seed, 'LBA', { premiums: 'points', crewDayRate: 449 });
    const dp = p.lines.find(l => l.accountId === '2601' && l.description === 'Shoot')!;
    expect(dp.rate).toBe(56.13);
    const lena = p.lines.find(l => l.accountId === '1401' && l.unit === 'DAY' && l.amount === 12)!;
    expect(lena.rate).toBe(104.25);   // 834 / 8
    const prod = p.lines.find(l => l.accountId === '1201' && isPayrollLine(l))!;
    expect(prod.rate).toBe(56.13);
  });
});

import { floorNonShootDays } from './sag';
describe('prep / wrap / post days at a cash floor', () => {
  it('splits non-shoot days into a floor line and a back-end balance, keeps days and points, lowers cash', () => {
    const scale = everyoneAtScale(seed, 'LBA', { premiums: 'points' });
    const p = floorNonShootDays(scale, { cashHourly: 16.9, rest: 'points' });
    const prep = p.lines.find(l => l.accountId === '2601' && /^Prep \(cash floor\)/.test(l.description))!;
    expect(prep.rate).toBe(16.9); expect(prep.amount).toBe(8); expect(prep.participantId).toBeTruthy();
    const bal = p.lines.find(l => l.accountId === '2601' && /Prep balance/.test(l.description))!;
    expect(bal.rate).toBeCloseTo(104.25 - 16.9, 2); expect(bal.payType).toBe('points'); expect(bal.participantId).toBeUndefined();
    const shoot = p.lines.find(l => l.accountId === '2601' && l.description === 'Shoot')!;
    expect(shoot.rate).toBe(104.25);                                            // shoot days untouched
    const prod = p.lines.filter(l => l.accountId === '1201' && isPayrollLine(l) && l.payType === 'cash');
    expect(prod.map(l => l.amount)).toEqual([12, 40, 12, 40]);                  // shoot at scale, 40 prep/post at the floor
    expect(topSheet(p).cashBudget).toBeLessThan(topSheet(scale).cashBudget);
    expect(syncDaysFromBudget(p).participants.find(x => x.id === 'p_producer_1')!.days).toBe(52);   // days unchanged
    expect(floorNonShootDays(p, { cashHourly: 16.9, rest: 'points' }).lines.length).toBe(p.lines.length); // idempotent
  });
});

import { recoupableBudget } from './waterfall';
describe('non-recoupable financing', () => {
  it('shrinks what investors recoup, so the pool flips sooner', () => {
    const half = { ...seed, waterfall: { ...seed.waterfall, nonRecoupable: 400_000 } };
    expect(recoupableBudget(half)).toBeCloseTo(topSheet(seed).cashBudget - 400_000, 2);
    const a = waterfallReport(seed), b = waterfallReport(half);
    expect(b.pools[1]).toBeGreaterThan(a.pools[1]);       // at $3M, more reaches the crew when less has to be recouped
  });
});
