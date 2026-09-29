import type { Account, Board, Category, LineItem, Participant, PointsTier, Project, Waterfall } from '../engine/types';
import budgetJson from './sample-budget.json';
import boardJson from './sample-board.json';
import coaJson from './chart-of-accounts.json';
import { CA_FRINGES_2026 } from '../engine/importers/shamelXlsx';

export const DEFAULT_TIERS: PointsTier[] = [
  { id: 'lead', name: 'Lead (took scale)', multiplier: 2 },
  { id: 'director', name: 'Writer / Director', multiplier: 2 },
  { id: 'name', name: 'Name actor', multiplier: 1.75 },
  { id: 'producer', name: 'Producer', multiplier: 1.5 },
  { id: 'hod', name: 'Department head', multiplier: 1.5 },
  { id: 'cast', name: 'Supporting cast', multiplier: 1.25 },
  { id: 'key', name: 'Key crew', multiplier: 1.25 },
  { id: 'crew', name: 'Crew', multiplier: 1 },
  { id: 'general', name: 'General / PA / day player', multiplier: 1 },
];

export const DEFAULT_WATERFALL: Waterfall = {
  model: 'off-the-gross', recoupPct: 120, poolPct: 50, grossSharePct: 40,
  scenarios: [1_500_000, 3_000_000, 6_000_000],
};

const tierForRate = (rate: number): string =>
  rate >= 35 ? 'hod' : rate >= 30 ? 'key' : rate >= 22 ? 'crew' : 'general';

/** Build participants + line links from a Shamel-style budget. Cast lines carry "CAST #n: NAME"
 *  header rows; crew accounts carry "[NAME]" / "#1: [NAME]" header rows followed by prep/shoot/wrap lines. */
export function deriveParticipants(lines: LineItem[], accounts: { number: string; name: string }[], board: Board, shootDays: number) {
  const participants: Participant[] = [];
  const linked = lines.map(l => ({ ...l }));
  const accName = new Map(accounts.map(a => [a.number, a.name]));
  const castByName = new Map(board.castList.map(c => [c.name.toUpperCase(), c.id]));

  let current: Participant | null = null;
  let currentAcct = '';
  for (const l of linked) {
    const acct = l.accountId;
    if (acct !== currentAcct) { current = null; currentAcct = acct; }
    const n = parseInt(acct, 10);
    const isCastAcct = n >= 1401 && n <= 1403;
    const isCrewAcct = (n >= 2100 && n < 3500) || acct === '1301' || acct === '4001' || acct === '4002';
    if (!isCastAcct && !isCrewAcct) continue;

    const castHeader = /^CAST #(\d+):\s*(.+)$/i.exec(l.description);
    if (isCastAcct && castHeader) {
      const name = castHeader[2].trim();
      const castId = castByName.get(name.toUpperCase()) ?? parseInt(castHeader[1], 10);
      const tier = acct === '1401' ? (castId === 1 ? 'lead' : 'name') : acct === '1402' ? 'cast' : 'general';
      current = { id: `p_cast_${castId}`, name, role: acct === '1401' ? 'Principal cast' : acct === '1402' ? 'Supporting cast' : 'Day player',
        group: 'cast', tierId: tier, days: 0, bonusMultiplier: 1, castId };
      participants.push(current);
      continue;
    }
    const crewHeader = /\[NAME\]|^#\d+:|^DRIVER #|^KEY SET PA|^SET PA|^ART PA/i.test(l.description) && l.amount === 0;
    if (isCrewAcct && crewHeader) {
      const base = accName.get(acct) ?? acct;
      const idx = participants.filter(p => p.role === base).length + 1;
      const title = base.replace(/S$/, '') ;
      // "#1: Dana Okafor (Line producer)" carries a name; "[NAME]" and "#2: [NAME]" are empty template slots
      const named = /^#\d+:\s*(.+)$/.exec(l.description)?.[1]?.trim();
      const name = named && !/\[NAME\]/i.test(named) ? named : `${title}${idx > 1 || /^#\d/.test(l.description) ? ' #' + idx : ''}`.replace(/  +/g, ' ');
      current = { id: `p_${acct}_${idx}`, name, role: base, group: 'crew', tierId: 'crew', days: 0, bonusMultiplier: 1 };
      participants.push(current);
      continue;
    }
    // A wage line carries payroll fringes. Rentals and purchases priced per day/week are not people.
    const isPayroll = l.amount > 0 && l.rate > 0 && l.fringes.some(f => /FICA/i.test(f));
    const isCastAllowance = l.amount > 0 && l.rate > 0 && current?.group === 'cast' && /allowance/i.test(l.description);
    if (isPayroll || isCastAllowance) {
      if (!current) {
        const base = accName.get(acct) ?? acct;
        current = { id: `p_${acct}_1`, name: base, role: base, group: 'crew', tierId: 'crew', days: 0, bonusMultiplier: 1 };
        participants.push(current);
      }
      if (current.group === 'crew' && isPayroll) {
        current.tierId = acct === '1301' ? 'director' : tierForRate(l.unit === 'WEEK' ? l.rate / 70 : l.rate);
      }
      l.participantId = current.id;
      // Cast days come from DAY lines only (a 4-week star allowance is money, not days worked).
      if (l.unit === 'DAY') current.days += l.amount;
      else if (l.unit === 'WEEK' && current.group === 'crew') current.days += l.amount * 5;
    }
  }
  // Producers: fees are allowances, so give them a working-days figure to edit.
  let prodIdx = 0;
  for (const l of linked) {
    if (l.accountId === '1201' && /^Fee$/i.test(l.description) && l.amount > 0) {
      prodIdx += 1;
      const pt: Participant = { id: `p_producer_${prodIdx}`, name: `Producer #${prodIdx}`, role: 'Producer', group: 'producer',
        tierId: 'producer', days: shootDays + 40, bonusMultiplier: 1 };
      participants.push(pt);
      l.participantId = pt.id;
    }
  }
  // Director is also the writer here: link the script purchase to the director participant.
  const director = participants.find(p => p.id.startsWith('p_1301'));
  if (director) {
    director.name = 'Writer / Director'; director.role = 'Writer / Director'; director.group = 'producer';
    for (const l of linked) if (l.accountId === '1102' && l.amount > 0) l.participantId = director.id;
  }
  // Drop header rows that never got a wage line (empty template slots like "#2: [NAME]" with no days).
  const keep = participants.filter(pt => pt.days > 0 || pt.group === 'producer');
  const keepIds = new Set(keep.map(pt => pt.id));
  for (const l of linked) if (l.participantId && !keepIds.has(l.participantId)) delete l.participantId;
  return { participants: keep, lines: linked };
}

/** The sample project: SALT FLAT, an invented 12-day, 26-scene SAG feature. Built by tools/make-sample.mjs;
 *  every name and number in it is fictional. */
export function sampleProject(): Project {
  const b = budgetJson as any;
  const board: Board = { ...(boardJson as any), targetEighthsPerDay: 48 };
  const rawLines: LineItem[] = b.lines.map((l: any) => ({ ...l }) as LineItem);
  const { participants, lines } = deriveParticipants(rawLines, b.accounts, board, b.shootDays);
  return {
    schemaVersion: 1,
    name: b.name, version: b.version, currency: 'USD', shootDays: b.shootDays, contingencyPct: b.contingencyPct,
    categories: b.categories, accounts: b.accounts, fringes: CA_FRINGES_2026.map(f => ({ ...f })), lines,
    participants, tiers: DEFAULT_TIERS.map(t => ({ ...t })), waterfall: { ...DEFAULT_WATERFALL },
    sag: { targetTier: 'MLB', dic: false, includeContingency: true },
    board,
    notes: 'Sample project. The strips are in shooting order (grouped by location) with no day breaks placed yet.',
  };
}

export { PRESET_GROUPS, PROFIT_SHARE_PRESET_MATCH, type PresetGroup } from '../engine/deal';

/** A standard feature chart of accounts (Movie Magic style numbering: 1100 Story & Screenplay … 5200 General Expenses), no lines. */
export function standardChartOfAccounts(): { categories: Category[]; accounts: Account[] } {
  const b = coaJson as any;
  return { categories: b.categories.map((c: Category) => ({ ...c })), accounts: b.accounts.map((a: Account) => ({ ...a })) };
}

export interface BlankOptions { name?: string; shootDays?: number; chartOfAccounts?: 'standard' | 'empty' }

export function blankProject(opts: BlankOptions = {}): Project {
  const coa = opts.chartOfAccounts === 'empty' ? { categories: [], accounts: [] } : standardChartOfAccounts();
  return {
    schemaVersion: 1, name: opts.name?.trim() || 'Untitled', version: 'v1', currency: 'USD', shootDays: opts.shootDays || 20, contingencyPct: 10,
    categories: coa.categories, accounts: coa.accounts, fringes: CA_FRINGES_2026.map(f => ({ ...f })), lines: [], participants: [],
    tiers: DEFAULT_TIERS.map(t => ({ ...t })), waterfall: { ...DEFAULT_WATERFALL },
    sag: { targetTier: 'MLB', dic: false, includeContingency: true },
    board: { castList: [], scenes: [], strips: [], targetEighthsPerDay: 44 },
  };
}
