import { describe, it, expect } from 'vitest';
import { starterProject, applyStarter } from './starter';
import { sampleProject, blankProject } from '../data/seed';
import { clearDayBreaks, shootDays, adoptBoardDays, syncCastDaysFromBoard } from './board';
import { applyDeal, withDeal } from './deal';
import { topSheet } from './budget';
import { isPayrollLine, isSagPerformerLine } from './sag';

const board = () => clearDayBreaks(sampleProject().board);

describe('starter budget from a script', () => {
  it('sizes days to the pages, prices cast at the tier, crews up and fills allowances', () => {
    const { project: p, report } = starterProject(board(), { title: 'TEST FILM', tier: 'MLB', rates: 'ballpark', pagesPerDay: 6 });
    expect(report.shootDays).toBe(Math.ceil(report.pages / 6));
    expect(shootDays(p.board).length).toBe(report.shootDays);
    expect(p.shootDays).toBe(report.shootDays);
    expect(report.cast).toBe(p.board.castList.length);
    expect(report.crew).toBeGreaterThan(30);
    // every cast member has a SAG line linked to a participant that carries their cast id
    for (const c of p.board.castList) {
      const pt = p.participants.find(x => x.castId === c.id)!;
      expect(pt).toBeTruthy();
      const l = p.lines.find(x => x.participantId === pt.id)!;
      expect(isSagPerformerLine(l)).toBe(true);
      expect(l.rate).toBeCloseTo(449 / 8, 1);
    }
    // every wage line links to a participant and every participant has a line
    const pids = new Set(p.participants.map(x => x.id));
    for (const l of p.lines.filter(isPayrollLine)) expect(pids.has(l.participantId!)).toBe(true);
    for (const pt of p.participants) expect(p.lines.some(l => l.participantId === pt.id)).toBe(true);
    // ballpark: the DP is above the gaffer is above a grip
    const rate = (acct: string) => p.lines.find(l => l.accountId === acct && l.description === 'Shoot')!.rate;
    expect(rate('2601')).toBeGreaterThan(rate('2701'));
    expect(rate('2701')).toBeGreaterThan(rate('2804'));
    // allowances exist and are sized by days
    const camera = p.lines.find(l => l.accountId === '2611')!;
    expect(camera.rate).toBe(1500 * report.shootDays);
    expect(p.lines.every(l => l.tags.includes('starter'))).toBe(true);
    expect(p.lines.filter(l => l.unit === 'ALLOW').every(l => l.notes)).toBe(true);
    // priced
    expect(report.cashBudget).toBeGreaterThan(300_000);
    expect(report.cashBudget).toBeLessThan(2_000_000);
    expect(topSheet(applyDeal(p)).cashBudget).toBe(report.cashBudget);
  });
  it('everyone at scale puts every crew line on the tier rate; the board owns the cast days after normalising', () => {
    const { project: p } = starterProject(board(), { title: 'T', tier: 'LBA', rates: 'scale', pagesPerDay: 5 });
    for (const l of p.lines.filter(l => isPayrollLine(l) && !isSagPerformerLine(l) && !/background/i.test(l.description) && l.accountId !== '1301')) expect(l.rate).toBeCloseTo(834 / 8, 1);
    const n = syncCastDaysFromBoard(adoptBoardDays(withDeal(p)));
    const lead = n.participants.find(x => x.tierId === 'lead')!;
    const shoot = n.lines.find(l => l.participantId === lead.id && l.description === 'Shoot')!;
    expect(shoot.daysFrom).toBe('board');
    expect(n.lines.find(l => l.participantId === lead.id && /Rehearsal/.test(l.description))!.amount).toBe(1);
  });
  it('tags add the people they imply', () => {
    const b = board();
    b.scenes[0] = { ...b.scenes[0], elements: { ...b.scenes[0].elements, Animals: ['cat'], Stunts: ['fall from the roof'] } };
    const { project: p, report } = starterProject(b, { title: 'T', tier: 'MLB', rates: 'scale', pagesPerDay: 5 });
    expect(report.extras.join(' ')).toMatch(/stunt coordinator/);
    expect(report.extras.join(' ')).toMatch(/animal wrangler/);
    expect(p.participants.find(x => x.name === 'Animal Wrangler')!.followsElements).toEqual([{ category: 'Animals', item: 'cat' }]);
    expect(p.lines.some(l => l.accountId === '1501' && l.daysFrom === 'board')).toBe(true);
  });
});

describe('starter into an existing project', () => {
  it('keeps the board\'s own day breaks, the name and the day length, and adds the accounts the template needs', () => {
    const s = sampleProject();
    const base = { ...blankProject({ name: 'MY FILM', version: 'Blue', chartOfAccounts: 'empty' }), board: s.board, dayHours: 10 as const };
    const { project: p, report } = applyStarter(base, { title: 'ignored', tier: 'LBA', rates: 'ballpark', pagesPerDay: 3, crew: 'full' });
    expect(report.shootDays).toBe(shootDays(s.board).length);   // the 12 breaks the sample ships with, not pages ÷ 3
    expect(p.name).toBe('MY FILM'); expect(p.version).toBe('Blue'); expect(p.dayHours).toBe(10);
    expect(p.accounts.length).toBeGreaterThan(100);              // the empty chart was filled from the standard one
    expect(p.lines.every(l => p.accounts.some(a => a.number === l.accountId))).toBe(true);
    const dp = p.lines.find(l => l.accountId === '2601' && l.description === 'Shoot')!;
    expect(dp.multiplier).toBe(11);                               // a 10-hour shoot day
  });
});
