// Funding paths as plain numbers: given the budget, the sources that can come off it and the deal, what investors
// have to put in and what they get back under any on/off combination of those sources. Imports only the split
// and types, so the deck's own small runtime can run the same math.
import { afterDeferrals, investorsAt, poolAt } from './split';
import type { SplitTerms } from './split';

/** One source of money that is not the investors'. `amount` is what it contributes when switched on (net, in
 *  dollars); `on` is whether it is switched on in the project as saved. */
export interface PathSource { key: string; label: string; amount: number; on: boolean; note?: string }

export interface PathInputs {
  cashBudget: number;        // the budget to raise
  deferred: number;          // fixed deferred pay, paid from first proceeds before any split
  sources: PathSource[];
  waterfall: SplitTerms;     // model, recoupPct, poolPct, grossSharePct
  cases: { label: string; gross: number }[];   // gross receipts per case, in order
  feePct: number;            // fees off the top, percent of gross
}
interface PathCase { label: string; gross: number; fees: number; net: number; deferredPaid: number; toInvestors: number; toPool: number; multiple: number }
export interface PathResult { switches: Record<string, boolean>; investors: number; cases: PathCase[] }

/** One path. A source counts when its switch is true; a switch that is left out falls back to the source's saved `on`. */
export function pathFor(inputs: PathInputs, switches: Record<string, boolean> = {}): PathResult {
  const resolved: Record<string, boolean> = {};
  let covered = 0;
  for (const s of inputs.sources) {
    const on = typeof switches[s.key] === 'boolean' ? switches[s.key] : s.on;
    resolved[s.key] = on;
    if (on) covered += s.amount;
  }
  const left = inputs.cashBudget - covered;
  const investors = left < 0.005 ? 0 : left;   // under half a cent is nothing: a covered budget must not produce a multiple
  const cases = inputs.cases.map(c => {
    const fees = c.gross * inputs.feePct / 100;
    const net = c.gross - fees;
    const { paid, rest } = afterDeferrals(inputs.deferred, net);   // deferred pay comes out of first proceeds, before the split
    const toInvestors = investorsAt(inputs.waterfall, investors, rest);
    return { label: c.label, gross: c.gross, fees, net, deferredPaid: paid, toInvestors, toPool: poolAt(inputs.waterfall, investors, rest), multiple: investors > 0 ? toInvestors / investors : 0 };
  });
  return { switches: resolved, investors, cases };
}

/** Every on/off combination of the sources (2^n), all-on first and all-off last; the first source is the slowest
 *  to change, so the order reads like a truth table. */
export function allSwitches(sources: Pick<PathSource, 'key'>[]): Record<string, boolean>[] {
  const keys = [...new Set(sources.map(s => s.key))];
  const n = keys.length;
  const out: Record<string, boolean>[] = [];
  for (let i = 0; i < 2 ** n; i++) {
    const combo: Record<string, boolean> = {};
    keys.forEach((k, j) => { combo[k] = Math.floor(i / 2 ** (n - 1 - j)) % 2 === 0; });
    out.push(combo);
  }
  return out;
}
