// The split itself: who gets what of a dollar of producer's net. Pure arithmetic over plain numbers, with no
// imports beyond types, so the same code can run outside the app (the deck's own small runtime).
import type { Waterfall } from './types';

/** The terms the split reads; a whole Waterfall satisfies it. */
export type SplitTerms = Pick<Waterfall, 'model' | 'recoupPct' | 'poolPct' | 'grossSharePct'>;

/** Size of the cast & crew pool at a given producer's-net revenue.
 *  recoup-first: investors take recoupPct % of the cash budget back first, then poolPct % of the rest funds the pool.
 *  off-the-gross (the Sing Sing model): the pool takes grossSharePct % from dollar one until investors have
 *  recouped recoupPct % of the budget from their share; after that the split flips to poolPct %. */
export function poolAt(w: SplitTerms, budget: number, revenue: number): number {
  const recoup = w.recoupPct / 100, pool = w.poolPct / 100;
  if (w.model === 'recoup-first') return Math.max(0, revenue - budget * recoup) * pool;
  const gross = w.grossSharePct / 100, invShare = 1 - gross;
  const rStar = invShare > 0 ? (budget * recoup) / invShare : Infinity; // revenue at which investors have recouped
  return revenue <= rStar ? gross * revenue : gross * rStar + pool * (revenue - rStar);
}

export function investorsAt(w: SplitTerms, budget: number, revenue: number): number {
  return Math.max(0, revenue - poolAt(w, budget, revenue));
}

/** Deferred pay is a fixed IOU paid from first proceeds: it comes off the top before investors and the pool split
 *  anything. Returns what a given revenue pays of it and what is left to split. */
export function afterDeferrals(deferred: number, revenue: number): { paid: number; rest: number } {
  const paid = Math.max(0, Math.min(deferred, revenue));
  return { paid, rest: Math.max(0, revenue - paid) };
}
