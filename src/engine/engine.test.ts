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

import { applyDeal, withDeal, dealControlledIds } from './deal';
describe('the deal layer', () => {
  it('is the identity for a project with default terms', () => {
    const p = withDeal(seed);
    const e = applyDeal(p);
    expect(topSheet(e).cashBudget).toBeCloseTo(topSheet(seed).cashBudget, 2);
    expect(dealControlledIds(p, e).size).toBe(0);
  });
  it('reproduces everyone-at-scale + premiums + floor from terms, and never touches the raw lines', () => {
    const p = withDeal(seed);
    const terms = { ...p, dayHours: 10 as const, deal: { ...p.deal!, pay: { ...p.deal!.pay, model: 'everyone-at-scale' as const, crewBasis: 'MLB' as const, premiums: { producers: 'points' as const, script: 'points' as const, allowances: 'delete' as const } }, producers: { count: 1, days: 30 }, nonShoot: { enabled: true, cashHourly: 16.9, rest: 'points' as const } } };
    const e = applyDeal(terms);
    // by hand, in the same order
    let h = setDayHours({ ...p, dayHours: 12 }, 10);
    const prods = h.participants.filter(x => x.id.startsWith('p_producer'));
    h = { ...h, participants: [...h.participants.filter(x => !x.id.startsWith('p_producer')), { ...prods[0], days: 30 }] };
    h = everyoneAtScale(h, 'MLB', { premiums: 'keep', producerDays: 30, crewDayRate: 449 });
    h = { ...h, lines: h.lines.flatMap(l => /ALLOWANCE$/.test(l.description) ? [] : (l.accountId === '1201' && /^Fee$/.test(l.description)) || (l.accountId === '1102' && /script purchase/i.test(l.description)) ? [{ ...l, payType: 'points' as const }] : [l]) };
    h = floorNonShootDays(h, { cashHourly: 16.9, rest: 'points' });
    expect(topSheet(e).cashBudget).toBeCloseTo(topSheet(h).cashBudget, 2);
    expect(e.lines.filter(l => l.accountId === '1201' && isPayrollLine(l) && l.payType === 'cash').map(l => l.amount)).toEqual([12, 18]);  // one producer: 12 shoot + 18 floored
    expect(terms.lines).toEqual(seed.lines);                                   // raw untouched
    expect(dealControlledIds(terms, e).size).toBeGreaterThan(20);
  });
  it('fills missing terms on an old project file', () => {
    const { deal, ...old } = withDeal(seed);
    const p = withDeal(old as any);
    expect(p.deal!.pay.model).toBe('as-budgeted');
    expect(p.deal!.producers.days).toBe(seed.shootDays + 40);
  });
});

import { parseScreenplayText, parseScreenplayLines, linesFromText } from './importers/screenplay';
import { linesFromPdfItems } from './importers/pdfScript';

describe('screenplay importers', () => {
  const fountain = readFileSync(resolve(__dirname, '../../tools/fixtures/SaltFlat_Script.fountain'), 'utf8');

  it('reads a Fountain script: title, scenes, time of day, eighths, speaking and named cast', () => {
    const r = parseScreenplayText(fountain);
    expect(r.title).toBe('SALT FLAT');
    expect(r.pages).toBe(3);
    expect(r.board.scenes).toHaveLength(9);
    const [s1, , s3, s4, , , s7, s8] = r.board.scenes;
    expect(s1).toMatchObject({ ie: 'EXT', set: 'DESERT HIGHWAY', tod: 'DAWN', pages: '1' });
    expect(s1.cast.map(c => c.name).sort()).toEqual(['JUNE', 'LENA']);
    expect(s3.cast.map(c => c.name)).toContain('THE MECHANIC');
    expect(s4.set).toBe('GAS STATION DINER');
    expect(s7.cast.map(c => c.name)).toEqual(['LENA']);                       // silent: named in action in Title Case
    expect(s8.cast.map(c => c.name).sort()).toEqual(['JUNE', 'WALT']);       // WALT (CONT'D) folds into WALT
    expect(r.board.castList.map(c => c.name)).toEqual(['JUNE', 'LENA', 'WALT', 'THE MECHANIC', 'WAITRESS', 'KID']);   // most scenes first
    const eighths = r.board.scenes.reduce((t, s) => t + s.eighths, 0);
    expect(eighths).toBeGreaterThanOrEqual(20); expect(eighths).toBeLessThanOrEqual(28);   // about 3 pages
    expect(s1.synopsis).toMatch(/^Two sisters push/);
    expect(r.board.strips).toHaveLength(9);
  });

  it('handles Fountain forcing, scene numbers, INT./EXT., dual dialogue and shouted action', () => {
    const r = parseScreenplayText(`
.FLASHBACK - THE KITCHEN #4A#

Mother stirs a pot.

12 INT./EXT. CAR - MOVING - NIGHT 12

THE CAR SWERVES OFF THE ROAD AND ROLLS TWICE.

@McCLANE
Yippee.

DEL ^
Same.

RAY/EVE
Together.

CUT TO:

ext. salt flat - day

Nothing.
`);
    const [a, b, c] = r.board.scenes;
    expect(a).toMatchObject({ ie: 'INT', set: 'FLASHBACK - THE KITCHEN', number: '4A' });
    expect(b).toMatchObject({ ie: 'I/E', set: 'CAR - MOVING', tod: 'NIGHT', number: '12' });
    expect(b.cast.map(x => x.name).sort()).toEqual(['DEL', 'EVE', 'MCCLANE', 'RAY']);
    expect(b.synopsis).toMatch(/^THE CAR SWERVES/);
    expect(c).toMatchObject({ ie: 'EXT', set: 'SALT FLAT', tod: 'DAY' });
  });

  it('reads pdftotext-style indented text and form-feed page breaks', () => {
    const text = ['                                                            1.', '', 'INT. ROOM - DAY', '', 'A man, BOB, waits.', '', '                       BOB', '           Well.', '', '                       ANN (V.O.)', '           Hi.',
      '\f                                                            2.', '', 'EXT. YARD - LATER', '', 'Bob leaves. NOT A CUE.', ''].join('\n');
    const r = parseScreenplayText(text);
    expect(r.board.scenes).toHaveLength(2);
    expect(r.board.scenes[0].cast.map(c => c.name)).toEqual(['BOB', 'ANN']);
    expect(r.board.scenes[1].cast.map(c => c.name)).toEqual(['BOB']);
    expect(r.board.scenes[1]).toMatchObject({ tod: 'LATER', pages: '2' });
    const m = parseScreenplayText(['INT. A - DAY', '', 'Go.', '', '                       McCLANE', '           Yippee.', ''].join('\n') + '\n'.repeat(60));
    expect(m.board.scenes[0].cast.map(c => c.name)).toEqual(['MCCLANE']);
    expect(linesFromText(text).lines.filter(l => l.text).length).toBeGreaterThan(8);
  });

  it('reads text copied out of a PDF: no indents, no blank lines, page numbers top and bottom', () => {
    const page = (n: number, body: string[]) => [`${n}.`, ...body, `${n}.`];
    const text = [
      'SALT FLAT', 'Written by', 'Somebody', 'FADE IN:',
      'EXT. DESERT HIGHWAY - DAWN', 'LENA (34) steers. JUNE (26) pushes the wagon from the back, sweating.', 'JUNE', "That's it. That's the whole plan.", 'LENA', 'The plan was Reno.', 'Lena looks at the horizon like it owes her money, then kicks the tire.',
      'ON CARD: SHE WAITED AT THE WINDOW.', 'KNOCK, KNOCK, KNOCK!', 'Nobody answers the door of the wagon.',
      ...page(2, ['INT. STATION WAGON - CONTINUOUS', 'June finds a letter. A photo of Walt falls out of it onto the seat.', 'JUNE', 'Lena.', 'LENA (O.S.)', 'Not now.', '(MORE)']),
      ...page(3, ['LENA (CONT\'D)', 'Really not now.', 'TEN MINUTES LATER', 'June puts it back exactly where it was in the glovebox.', 'EXT. GAS STATION - DAY', 'The wagon on a flatbed. WALT wipes his hands on a rag.', 'WALT', 'Transmission.', 'EVERYONE', 'No!']),
    ].join('\n');
    const r = parseScreenplayText(text);
    expect(r.title).toBe('SALT FLAT');
    expect(r.pages).toBe(3);
    expect(r.board.scenes.map(s => s.pages)).toEqual(['1', '2-3', '3']);
    expect(r.board.scenes[0].cast.map(c => c.name)).toEqual(['JUNE', 'LENA']);          // KNOCK, KNOCK, KNOCK! is not a cue
    expect(r.board.scenes[1].cast.map(c => c.name)).toEqual(['JUNE', 'LENA']);          // "a photo of Walt" is a mention, not Walt
    expect(r.board.scenes[2].cast.map(c => c.name)).toEqual(['WALT']);                  // EVERYONE is not a part
    expect(r.board.scenes[2].synopsis).toMatch(/^The wagon on a flatbed/);
    expect(r.board.scenes[1].synopsis).toMatch(/^June finds a letter/);
  });

  it('turns positioned PDF text into lines with page labels, indents and blank-line gaps', () => {
    const P = (items: [number, number, string][]) => ({ items: items.map(([x, y, s]) => ({ x, y, w: s.length * 7.2, s })), height: 792 });
    const pages = [P([[540, 740, '1.'], [108, 700, 'INT. ROOM - DAY'], [108, 676, 'A room. '], [160, 676, 'BOB waits.'], [266, 640, 'BOB'], [180, 628, 'Well.'], [108, 100, 'The end of the page.']]),
      P([[540, 740, '2.'], [108, 700, 'EXT. YARD - DAY'], [108, 676, 'Bob leaves.']])];
    const lines = linesFromPdfItems(pages);
    expect(lines.map(l => l.text)).toEqual(['1.', '', 'INT. ROOM - DAY', '', 'A room. BOB waits.', '', 'BOB', 'Well.', '', 'The end of the page.', '2.', '', 'EXT. YARD - DAY', '', 'Bob leaves.']);
    expect(lines[6]).toMatchObject({ indent: 266, page: '1' });
    expect(lines[12].page).toBe('2');
    const r = parseScreenplayLines(lines, { cueIndent: 90 });
    expect(r.board.scenes.map(s => s.set)).toEqual(['ROOM', 'YARD']);
    expect(r.board.scenes[0].cast.map(c => c.name)).toEqual(['BOB']);
    expect(r.board.scenes[0].eighths).toBe(8);
    expect(r.board.scenes[1].cast.map(c => c.name)).toEqual(['BOB']);
  });
});

import { autoTag, addElement, removeElement, addCast, autoTagBoard } from './breakdown';

describe('breakdown tagger', () => {
  it('reads a first pass of tags off the scene text, from action only', () => {
    const scene: any = { id: 'sc1', set: "SAM'S CAR (DRIVING)", synopsis: '', cast: [{ id: 1, name: 'SAM' }], elements: {}, text: [
      'SAM PENN (45) rides her long board past her beat-up little green car. JACK, an orange tabby cat, watches.',
      "Sam's cell phone RINGS. A TEXT MESSAGE from COLIN stares back at her. No purse.",
      'She trips on nothing and almost face-plants on the floor.',
      '                    SAM', '          I love my truck and my dog.', 'ON CARD: WE WERE PERFECTLY INTELLIGENT PEOPLE.', 'CLASSIC JAZZ blasts.',
    ].join('\n') };
    const e = autoTag(scene, ['SAM', 'COLIN']);
    expect(e.Vehicles).toEqual(['Little green car']);                    // "sam's car" from the heading folds into it
    expect(e.Vehicles.join()).not.toMatch(/truck/);                       // dialogue is not on set
    expect(e.Animals).toEqual(['Orange tabby cat']);
    expect(e.Props).toEqual(['Long board', 'Cell phone']);                 // not the CARD in the insert
    expect(e.Props.join()).not.toMatch(/purse/);                          // "No purse" is a negation
    expect(e.Sound).toEqual(['Rings']);
    expect(e['Visual Effects']).toEqual(expect.arrayContaining(['On card insert', 'phone screen: text message']));
    expect(e.Stunts).toEqual(['She trips on nothing and almost face-plants on the floor']);
    expect(e.Music).toEqual(['Classic jazz']);
    expect(e['Special Equipment']).toEqual(['car mount / process trailer']);
    expect(e.Extras ?? []).not.toContain('we were perfectly intelligent people');
  });
  it('keeps hand-made tags across auto-tag, and edits chips and cast', () => {
    const board: any = { castList: [{ id: 1, name: 'SAM' }], scenes: [{ id: 'sc1', number: '1', ie: 'INT', set: 'ROOM', tod: 'DAY', pages: '1', eighths: 8, synopsis: '', location: '', scriptDay: '', cast: [{ id: 1, name: 'SAM' }], elements: { Props: ['hero mug'] }, text: 'Sam drinks coffee from a mug.' }], strips: [{ type: 'scene', sceneId: 'sc1' }], targetEighthsPerDay: 44 };
    const b1 = autoTagBoard(board);
    expect(b1.scenes[0].elements.Props).toContain('hero mug');
    const b2 = addElement(b1, 'sc1', 'Wardrobe', ' robe ');
    expect(b2.scenes[0].elements.Wardrobe).toEqual(['robe']);
    const b3 = removeElement(b2, 'sc1', 'Wardrobe', 'robe');
    expect(b3.scenes[0].elements.Wardrobe).toBeUndefined();
    const b4 = addCast(b3, 'sc1', 'jack');
    expect(b4.castList.map(c => c.name)).toEqual(['SAM', 'JACK']);
    expect(b4.scenes[0].cast.map(c => c.id)).toEqual([1, 2]);
  });
});

import { renumberCast, castOrderByScenes, castOrderByAppearance } from './board';

describe('cast numbering', () => {
  const mk = () => {
    const r = parseScreenplayText(readFileSync(resolve(__dirname, '../../tools/fixtures/SaltFlat_Script.fountain'), 'utf8'));
    const p: any = { ...sampleProject(), board: r.board, participants: [{ id: 'p_cast_3', name: 'WALT', role: 'x', group: 'cast', tierId: 'cast', days: 0, bonusMultiplier: 1, castId: 3 }] };
    return p;
  };
  it('orders by scene count or by first appearance, and renumbers scenes and participants together', () => {
    const p = mk();
    expect(castOrderByScenes(p.board).slice(0, 3)).toEqual([1, 2, 3]);
    const byAppear = castOrderByAppearance(p.board);
    const names = (q: any) => q.board.castList.map((c: any) => `${c.id} ${c.name}`);
    const q = renumberCast(p, byAppear);
    expect(names(q)).toEqual(['1 JUNE', '2 LENA', '3 THE MECHANIC', '4 WAITRESS', '5 KID', '6 WALT']);
    expect(q.participants[0].castId).toBe(6);                                          // Walt's participant follows him
    const walt = q.board.scenes[7].cast.find((c: any) => c.name === 'WALT');
    expect(walt?.id).toBe(6);
    const r = renumberCast(q, [6]);                                                    // Walt to #1, everyone else shifts
    expect(names(r).slice(0, 2)).toEqual(['1 WALT', '2 JUNE']);
    expect(r.participants[0].castId).toBe(1);
  });
});
