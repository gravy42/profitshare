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
