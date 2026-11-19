// Funding paths for a project: the sources that can come off the investor raise (grants, the credits, local
// perks) and, for every on/off combination of them, what investors fund and get back. The math is in pathMath.ts;
// this file only reads the project. Pass the effective project (after applyDeal), as everywhere in the engine.
import type { Project } from './types';
import { topSheet } from './budget';
import { incentiveReport, withIncentives } from './incentives';
import { CASES, withPitch } from './pitch';
import { sponsorFee, sponsorNet } from './waterfall';
import { allSwitches, pathFor } from './pathMath';
import type { PathInputs, PathResult, PathSource } from './pathMath';

const CASE_LABEL = { low: 'Low', mid: 'Mid', high: 'High' } as const;

/** What can come off the investor raise, in the order an investor reads it. A source worth nothing is left out;
 *  a credit the film is eligible for but has not switched on is listed with `on: false`. */
export function fundingSources(p: Project): PathSource[] {
  const out: PathSource[] = [];
  const grants = sponsorNet(p.waterfall);
  if (grants > 0) {
    const src: PathSource = { key: 'grants', label: 'Grants and fiscal sponsorship', amount: grants, on: true };
    if (sponsorFee(p.waterfall) > 0) src.note = `net of the sponsor's ${p.waterfall.sponsorFeePct}% fee`;
    out.push(src);
  }
  if (!p.incentives) return out;
  const inc = withIncentives(p);
  // a credit's net is 0 while it is switched off, so each is figured on a copy with it forced on
  const ca = incentiveReport({ ...p, incentives: { ...inc, ca: { ...inc.ca, enabled: true } } }).ca.net;
  if (ca > 0) out.push({ key: 'ca', label: 'California tax credit', amount: ca, on: inc.ca.enabled });
  const federal = incentiveReport({ ...p, incentives: { ...inc, federal: { ...inc.federal, enabled: true } } }).federal
    .net;
  if (federal > 0)
    out.push({
      key: 'federal',
      label: 'Federal production credit',
      amount: federal,
      on: inc.federal.enabled,
      note: 'proposed, not yet law',
    });
  const perks = incentiveReport(p).perksTotal;
  if (perks > 0) out.push({ key: 'perks', label: 'Local perks', amount: perks, on: true });
  return out;
}

export function pathInputs(p: Project): PathInputs {
  const ts = topSheet(p);
  const pitch = withPitch(p).pitch!;
  const w = p.waterfall;
  return {
    cashBudget: ts.cashBudget,
    deferred: ts.deferredTotal,
    sources: fundingSources(p),
    waterfall: { model: w.model, recoupPct: w.recoupPct, poolPct: w.poolPct, grossSharePct: w.grossSharePct },
    cases: CASES.map(c => ({ label: CASE_LABEL[c], gross: pitch.revenue.reduce((n, r) => n + (r[c] || 0), 0) })),
    feePct: pitch.feePct,
  };
}

interface FundingPath extends PathResult {
  current: boolean;
}

/** Every path, all sources on first. Exactly one is `current`: the one whose switches are the project as saved. */
export function fundingPaths(p: Project): FundingPath[] {
  const inputs = pathInputs(p);
  return allSwitches(inputs.sources).map(sw => ({
    ...pathFor(inputs, sw),
    current: inputs.sources.every(s => sw[s.key] === s.on),
  }));
}
