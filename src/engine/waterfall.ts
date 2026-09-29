import type { Participant, PointsTier, Project, Waterfall } from './types';
import { topSheet } from './budget';

/** Points for one participant: days × tier multiplier × personal bonus. */
export function participantPoints(pt: Participant, tiers: PointsTier[]): number {
  const tier = tiers.find(t => t.id === pt.tierId);
  return pt.days * (tier?.multiplier ?? 1) * (pt.bonusMultiplier || 1);
}

export function totalPoints(p: Project): number {
  return p.participants.reduce((n, pt) => n + participantPoints(pt, p.tiers), 0);
}

/** Size of the cast & crew pool at a given producer's-net revenue.
 *  recoup-first: investors take recoupPct % of the cash budget back first, then poolPct % of the rest funds the pool.
 *  off-the-gross (the Sing Sing model): the pool takes grossSharePct % from dollar one until investors have
 *  recouped recoupPct % of the budget from their share; after that the split flips to poolPct %. */
export function poolAt(w: Waterfall, budget: number, revenue: number): number {
  const recoup = w.recoupPct / 100, pool = w.poolPct / 100;
  if (w.model === 'recoup-first') return Math.max(0, revenue - budget * recoup) * pool;
  const gross = w.grossSharePct / 100, invShare = 1 - gross;
  const rStar = invShare > 0 ? (budget * recoup) / invShare : Infinity; // revenue at which investors have recouped
  return revenue <= rStar ? gross * revenue : gross * rStar + pool * (revenue - rStar);
}

export function investorsAt(w: Waterfall, budget: number, revenue: number): number {
  return Math.max(0, revenue - poolAt(w, budget, revenue));
}

export interface PayoutRow {
  participant: Participant;
  points: number;
  share: number;               // fraction of the pool
  payouts: number[];           // one per scenario
  cashPay: number;             // what the budget pays them in cash (from linked lines)
}

export interface WaterfallReport {
  budget: number;              // what the waterfall recoups: the cash budget less non-recoupable money
  totalPoints: number;
  scenarios: number[];
  pools: number[];
  investors: number[];
  rows: PayoutRow[];
}

/** The part of the cash budget investors put in and expect back: the budget less grants and donations. */
export function recoupableBudget(p: Project): number {
  return Math.max(0, topSheet(p).cashBudget - (p.waterfall.nonRecoupable ?? 0));
}

export function waterfallReport(p: Project): WaterfallReport {
  const budget = recoupableBudget(p);
  const tp = totalPoints(p) || 1;
  const scenarios = p.waterfall.scenarios;
  const pools = scenarios.map(r => poolAt(p.waterfall, budget, r));
  const investors = scenarios.map(r => investorsAt(p.waterfall, budget, r));
  const cashByParticipant = new Map<string, number>();
  for (const l of p.lines) {
    if (!l.participantId || l.payType === 'points') continue;
    cashByParticipant.set(l.participantId, (cashByParticipant.get(l.participantId) ?? 0) + l.amount * l.rate * l.multiplier);
  }
  const rows: PayoutRow[] = p.participants.map(pt => {
    const pts = participantPoints(pt, p.tiers);
    return { participant: pt, points: pts, share: pts / tp, payouts: pools.map(pool => pool * pts / tp),
      cashPay: cashByParticipant.get(pt.id) ?? 0 };
  }).sort((a, b) => b.points - a.points);
  return { budget, totalPoints: tp, scenarios, pools, investors, rows };
}

/** Sum of days on budget lines linked to each participant → update participant.days. */
export function syncDaysFromBudget(p: Project): Project {
  const group = new Map(p.participants.map(pt => [pt.id, pt.group]));
  const days = new Map<string, number>();
  for (const l of p.lines) {
    if (!l.participantId) continue;
    // Cast weeks are allowances (star money), not days worked; crew weeks are 5 days.
    const weekDays = group.get(l.participantId) === 'cast' ? 0 : l.amount * 5;
    const d = l.unit === 'DAY' ? l.amount : l.unit === 'WEEK' ? weekDays : 0;
    days.set(l.participantId, (days.get(l.participantId) ?? 0) + d);
  }
  return { ...p, participants: p.participants.map(pt => days.has(pt.id) ? { ...pt, days: days.get(pt.id)! } : pt) };
}
