import type { Participant, PointsTier, Project, Waterfall } from './types';
import { incentiveProceeds } from './incentives';
import { topSheet } from './budget';
import { afterDeferrals, investorsAt, poolAt } from './split';

// The split arithmetic lives in split.ts (no dependencies, so it can run outside the app); re-exported here so
// existing imports keep working.
export { afterDeferrals, investorsAt, poolAt } from './split';

/** Points for one participant: days × tier multiplier × personal bonus, or a fixed block when the deal sets one. */
export function participantPoints(pt: Participant, tiers: PointsTier[]): number {
  if (pt.fixedPoints != null && pt.fixedPoints > 0) return pt.fixedPoints;
  const tier = tiers.find(t => t.id === pt.tierId);
  return pt.days * (tier?.multiplier ?? 1) * (pt.bonusMultiplier || 1);
}

export function totalPoints(p: Project): number {
  return p.participants.reduce((n, pt) => n + participantPoints(pt, p.tiers), 0);
}

interface PayoutRow {
  participant: Participant;
  points: number;
  share: number; // fraction of the pool
  payouts: number[]; // one per scenario
  cashPay: number; // what the budget pays them in cash (from linked lines)
}

interface WaterfallReport {
  budget: number; // what the waterfall recoups: the cash budget less non-recoupable money
  totalPoints: number;
  scenarios: number[];
  deferred: number; // fixed deferred pay owed from first proceeds
  deferredPaid: number[]; // how much of it each scenario pays, before the split
  pools: number[];
  investors: number[];
  rows: PayoutRow[];
}

/** The part of the cash budget investors put in and expect back: the budget less grants, donations and the
 *  tax credits and perks switched on under Incentives. */
export function recoupableBudget(p: Project): number {
  const left = topSheet(p).cashBudget - sponsorNet(p.waterfall) - incentiveProceeds(p);
  return left < 0.005 ? 0 : left; // under half a cent is nothing
}

/** What the fiscal sponsor keeps of the grants and donations, and what reaches the film. */
/** A hand-edited file can carry a negative figure; grants are never negative money. */
const grantsOf = (w: Waterfall): number => Math.max(0, w.nonRecoupable ?? 0);
export const sponsorFee = (w: Waterfall): number =>
  (grantsOf(w) * Math.max(0, Math.min(100, w.sponsorFeePct ?? 0))) / 100;
export const sponsorNet = (w: Waterfall): number => grantsOf(w) - sponsorFee(w);

export function waterfallReport(p: Project): WaterfallReport {
  const budget = recoupableBudget(p);
  const tp = totalPoints(p) || 1;
  const scenarios = p.waterfall.scenarios;
  const deferred = topSheet(p).deferredTotal;
  const split = scenarios.map(r => afterDeferrals(deferred, r));
  const pools = split.map(s => poolAt(p.waterfall, budget, s.rest));
  const investors = split.map(s => investorsAt(p.waterfall, budget, s.rest));
  const cashByParticipant = new Map<string, number>();
  for (const l of p.lines) {
    if (!l.participantId || l.payType === 'points') continue;
    cashByParticipant.set(
      l.participantId,
      (cashByParticipant.get(l.participantId) ?? 0) + l.amount * l.rate * l.multiplier,
    );
  }
  const rows: PayoutRow[] = p.participants
    .map(pt => {
      const pts = participantPoints(pt, p.tiers);
      return {
        participant: pt,
        points: pts,
        share: pts / tp,
        payouts: pools.map(pool => (pool * pts) / tp),
        cashPay: cashByParticipant.get(pt.id) ?? 0,
      };
    })
    .sort((a, b) => b.points - a.points);
  return { budget, totalPoints: tp, scenarios, deferred, deferredPaid: split.map(s => s.paid), pools, investors, rows };
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
  return { ...p, participants: p.participants.map(pt => (days.has(pt.id) ? { ...pt, days: days.get(pt.id)! } : pt)) };
}
