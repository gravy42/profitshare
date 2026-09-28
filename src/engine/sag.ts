import type { LineItem, Project, SagTier, SagTierId } from './types';
import { lineSubtotal, topSheet } from './budget';

/** SAG-AFTRA theatrical minimums. Low-budget rates effective 7/1/2026 (3 %/yr through 2030).
 *  Caps: ULB ≤ $300K, MLB ≤ $700K (DIC → $1.05M), LBA ≤ $2M (DIC → $3.75M). Basic Agreement above that.
 *  P&H: 22 % for principals from 9/6/2026 on low-budget agreements.
 *  Sources: sagindie.org 2026 contract notice; SAG-AFTRA MLB agreement text.
 *  Check sagaftra.org before you sign anything; these numbers move every July. */
export const SAG_TIERS: SagTier[] = [
  { id: 'ULB',   name: 'Ultra Low Budget',    dayRate: 257,  weeklyRate: null, cap: 300_000,   dicCap: 300_000,   phRate: 0.22, effective: '2026-07-01' },
  { id: 'MLB',   name: 'Moderate Low Budget', dayRate: 449,  weeklyRate: 1560, cap: 700_000,   dicCap: 1_050_000, phRate: 0.22, effective: '2026-07-01' },
  { id: 'LBA',   name: 'Low Budget',          dayRate: 834,  weeklyRate: 2896, cap: 2_000_000, dicCap: 3_750_000, phRate: 0.22, effective: '2026-07-01' },
  { id: 'BASIC', name: 'Theatrical Basic',    dayRate: 1321, weeklyRate: 4585, cap: null,      dicCap: null,      phRate: 0.22, effective: '2026-07-01' },
];

export const sagTier = (id: SagTierId) => SAG_TIERS.find(t => t.id === id)!;

export function tierCap(t: SagTier, dic: boolean): number | null {
  return dic ? t.dicCap : t.cap;
}

/** The cheapest tier whose ceiling covers a given total production cost. */
export function qualifyingTier(totalProductionCost: number, dic: boolean): SagTier {
  for (const t of SAG_TIERS) {
    const cap = tierCap(t, dic);
    if (cap === null || totalProductionCost <= cap) return t;
  }
  return SAG_TIERS[SAG_TIERS.length - 1];
}

/** Cast lines = SAG day/week lines carrying a SAG fringe. */
export function isSagPerformerLine(l: LineItem): boolean {
  return (l.unit === 'DAY' || l.unit === 'WEEK') && l.fringes.some(f => /SAG/i.test(f) && !/BG/i.test(f));
}

export interface SagReport {
  totalProductionCost: number;   // what SAG measures: cash + deferred + contingency
  cashBudget: number;
  deferredTotal: number;
  dic: boolean;
  target: SagTier;
  targetCap: number | null;
  fits: boolean;
  headroom: number;              // cap − TPC (negative = over)
  qualifying: SagTier;           // cheapest tier the current numbers qualify for
  performerDays: number;
  castScaleCostAtTier: Record<SagTierId, number>; // scale wages only (no P&H/agent) at each tier's day rate
  notes: string[];
}

export function sagReport(p: Project): SagReport {
  const ts = topSheet(p);
  const tpc = p.sag.includeContingency ? ts.totalProductionCost : ts.totalProductionCost - ts.contingency;
  const target = sagTier(p.sag.targetTier);
  const cap = tierCap(target, p.sag.dic);
  const performerDays = p.lines.filter(isSagPerformerLine).reduce((n, l) => n + (l.unit === 'WEEK' ? l.amount * 5 : l.amount), 0);
  const castScaleCostAtTier = Object.fromEntries(SAG_TIERS.map(t => [t.id, performerDays * t.dayRate])) as Record<SagTierId, number>;
  const notes: string[] = [];
  if (ts.deferredTotal > 0) notes.push(`$${ts.deferredTotal.toLocaleString()} of deferred pay counts toward total production cost. Convert fixed deferments to points if you need to get under a cap.`);
  if (ts.pointsValue > 0) notes.push(`$${ts.pointsValue.toLocaleString()} of cash value has been converted to points and is outside the budget.`);
  const scaleWages = p.lines.filter(isSagPerformerLine).reduce((n, l) => n + lineSubtotal(l), 0);
  if (scaleWages > 0 && Math.abs(scaleWages / Math.max(1, performerDays) - target.dayRate) > 1)
    notes.push(`Cast lines average $${Math.round(scaleWages / Math.max(1, performerDays))}/day but the target tier scale is $${target.dayRate}/day. Use "Re-rate cast" to reprice.`);
  return {
    totalProductionCost: tpc, cashBudget: ts.cashBudget, deferredTotal: ts.deferredTotal, dic: p.sag.dic,
    target, targetCap: cap, fits: cap === null || tpc <= cap, headroom: cap === null ? Infinity : cap - tpc,
    qualifying: qualifyingTier(tpc, p.sag.dic), performerDays, castScaleCostAtTier, notes,
  };
}

/** Reprice every SAG performer day/week line at a tier's minimum. Returns a new project. */
export function rerateCast(p: Project, tierId: SagTierId): Project {
  const t = sagTier(tierId);
  let lastPerformerWages = 0;
  const lines = p.lines.map(l => {
    if (isSagPerformerLine(l)) {
      const rate = l.unit === 'WEEK' ? (t.weeklyRate ?? t.dayRate * 5) : t.dayRate;
      const nl = { ...l, rate };
      lastPerformerWages = lineSubtotal(nl);
      return nl;
    }
    // Agent fee lines are modelled as ALLOW × wages × 0.1; keep them pinned to the repriced wages.
    if (/agent fee/i.test(l.description) && l.unit === 'ALLOW') return { ...l, rate: lastPerformerWages };
    return l;
  });
  return { ...p, sag: { ...p.sag, targetTier: tierId }, lines };
}

// ---------- the Sing Sing model: everyone on the same day rate ----------

/** A wage line: paid per day or week and carrying payroll fringes. */
export const isPayrollLine = (l: LineItem) =>
  (l.unit === 'DAY' || l.unit === 'WEEK') && l.amount > 0 && l.fringes.some(f => /FICA/i.test(f));

/** The fringe set the budget already uses on ordinary (non-SAG) payroll lines, so new wage lines match it. */
export function payrollFringeSet(p: Project): string[] {
  const counts = new Map<string, number>();
  for (const l of p.lines) if (isPayrollLine(l) && !isSagPerformerLine(l)) { const k = l.fringes.join('|'); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ? best.split('|') : p.fringes.filter(f => !/SAG/i.test(f.id)).map(f => f.id);
}

export interface EveryoneAtScaleOptions {
  /** what happens to producer fees, the script purchase and star/cast allowances */
  premiums: 'points' | 'deferred' | 'delete';
  /** days a producer works when no wage line exists for them yet (default: shoot days + 40 of prep/wrap/post) */
  producerDays?: number;
}

/** Pay everyone, above and below the line, the SAG day rate of a tier (weekly = the tier's weekly scale), keep the
 *  hours multiplier so a 12-hour crew day still totals one day's scale, move the above-scale premiums to points
 *  (or defer / delete them), and give producers and a writer a wage line at scale for their days if they have none. */
export function everyoneAtScale(p: Project, tierId: SagTierId, opts: EveryoneAtScaleOptions): Project {
  const t = sagTier(tierId);
  const weekly = t.weeklyRate ?? t.dayRate * 5;
  const fr = payrollFringeSet(p);
  let out = rerateCast(p, tierId);
  const premiums = (l: LineItem) =>
    (l.accountId === '1201' && /^Fee$/i.test(l.description)) ||
    (l.accountId === '1102' && /script purchase/i.test(l.description)) ||
    /^(STAR|CAST) ALLOWANCE$/i.test(l.description);

  let lines = out.lines.flatMap(l => {
    if (premiums(l)) return opts.premiums === 'delete' ? [] : [{ ...l, payType: opts.premiums }];
    if (isPayrollLine(l) && !isSagPerformerLine(l)) {
      const m = l.multiplier || 1;
      return [{ ...l, rate: Math.round(((l.unit === 'WEEK' ? weekly : t.dayRate) / m) * 100) / 100 }];
    }
    return [l];
  });

  // Producers: a wage line at scale for their days, linked to their participant, if they have no wage line yet.
  const producerDays = opts.producerDays ?? p.shootDays + 40;
  const producers = p.participants.filter(x => x.group === 'producer' && x.id.startsWith('p_producer'));
  const hasWage = (pid: string) => lines.some(l => l.participantId === pid && isPayrollLine(l));
  const addAfter = (accountId: string, line: LineItem) => {
    let at = -1; lines.forEach((l, i) => { if (l.accountId === accountId) at = i; });
    lines = [...lines.slice(0, at + 1), line, ...lines.slice(at + 1)];
  };
  producers.forEach((pt, i) => {
    if (hasWage(pt.id)) return;
    addAfter('1201', { id: `L_scale_prod_${i + 1}`, accountId: '1201', description: `${pt.name}: scale, prep / shoot / post`, amount: pt.days || producerDays,
      unit: 'DAY', rate: t.dayRate, multiplier: 1, fringes: fr, tags: ['ATL'], payType: 'cash', participantId: pt.id });
  });
  // A writer who is not already paid as director gets a wage line too.
  const director = p.participants.find(x => x.id.startsWith('p_1301'));
  const scriptLine = p.lines.find(l => l.accountId === '1102' && /script purchase/i.test(l.description));
  if (scriptLine && !(director && hasWage(director.id)) && !lines.some(l => l.accountId === '1102' && isPayrollLine(l))) {
    addAfter('1102', { id: 'L_scale_writer', accountId: '1102', description: 'Writer: scale, prep', amount: 10, unit: 'DAY', rate: t.dayRate,
      multiplier: 1, fringes: fr, tags: ['ATL'], payType: 'cash', participantId: scriptLine.participantId });
  }
  const participants = p.participants.map(pt => {
    const days = lines.filter(l => l.participantId === pt.id && isPayrollLine(l)).reduce((n, l) => n + (l.unit === 'WEEK' ? l.amount * 5 : l.amount), 0);
    return days > 0 ? { ...pt, days } : pt;
  });
  return { ...out, lines, participants };
}
