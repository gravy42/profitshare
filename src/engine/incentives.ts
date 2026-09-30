// Production incentives: what the film gets back, from whom, and when. Nothing here changes what the film
// spends; it changes who puts the money in. Credits come off what investors fund and recoup, the way grants do.
//
// Sources (checked Sept 30, 2026):
//  California Film & Television Tax Credit Program 4.0, as amended by AB 1138 (2025): 35% base for independent
//    films, +5% out of the Los Angeles zone, +10% local-hire labor outside the zone, +5% VFX, up to +2% Career
//    Pathways trainees; first $20M of qualified expenditures; $1M minimum budget; 75% of principal photography
//    days (or of the budget) in California; above-the-line wages don't qualify; independent films may sell the
//    credit or take it as a refund (90% over five years); principal photography must start within 180 days of the
//    credit allocation letter (CAL). Program funding $750M a year, $75M of it for independents.
//    film.ca.gov · wrapbook.com/production-incentives/us/independent-project-ca · ep.com/production-incentives/us/california
//  Motion Picture, Television, and Entertainment Revitalization Act, introduced Sept 24, 2026 (Friedman, Moran,
//    Scott, Schiff et al.): a transferable 20% credit on labor for American workers, +5% each for independent
//    productions, rural opportunity zones or disaster areas, $10M of wages across ten states, and growing domestic
//    production, to 30%; productions over $1M with 75% of photography days in the US; for productions beginning
//    in taxable years after Dec 31, 2026. Not law. friedman.house.gov
//  Other California incentives (film.ca.gov/tax-credit/other-california-film-incentives): free permits and no
//    location fees on state property, no state hotel tax, LA city-owned locations free, Santa Clarita permit
//    subsidies for tax-credit productions, city rebates elsewhere.
import type { Incentives, Project } from './types';
import { lineFringes, lineSubtotal, topSheet } from './budget';
import { isPayrollLine, isSagPerformerLine } from './sag';

export const CA_BASE = 0.35, CA_OUT_OF_ZONE = 0.05, CA_LOCAL_HIRE = 0.10, CA_VFX = 0.05, CA_TRAINEE = 0.005, CA_TRAINEE_MAX = 4;
export const CA_QUALIFIED_CAP = 20_000_000, CA_MIN_BUDGET = 1_000_000, CA_REFUND_SHARE = 0.90, CA_REFUND_YEARS = 5;
export const CA_CAREER_PATHWAYS_FEE = 0.0025;                 // of the allocation
export const CA_DAYS_TO_START = 180;                           // from the CAL
export const FED_BASE = 0.20, FED_BONUS = 0.05, FED_MAX = 0.30, FED_MIN_BUDGET = 1_000_000;
export const FED_FIRST_START = '2027-01-01';                   // productions beginning in taxable years after Dec 31, 2026

/** FY 2026–27 application windows for feature films (independent films apply in the same windows). */
export const CA_WINDOWS = [
  { apply: 'Aug 10–12, 2026', close: '2026-08-12', cal: '2026-09-21' },
  { apply: 'Jan 11–13, 2027', close: '2027-01-13', cal: '2027-02-22' },
  { apply: 'May 3–5, 2027', close: '2027-05-05', cal: '2027-06-14' },
];

export const LOCAL_PERKS = [
  { id: 'state-locations', label: 'State property: free permits, no location fees', hint: 'beaches, parks, roads, state buildings; you pay the monitor' },
  { id: 'la-locations', label: 'Los Angeles city-owned locations, free', hint: 'FilmLA still charges the permit' },
  { id: 'hotel-tax', label: 'No state hotel tax on crew housing', hint: 'most cities waive theirs after 30 days' },
  { id: 'santa-clarita', label: 'Santa Clarita permit subsidy and hotel-tax refund', hint: 'for productions in the state tax credit program' },
  { id: 'la-business-tax', label: 'LA city production tax capped', hint: '$145 on the first $5M, then $1.30 per $1,000' },
];

/** Categories that don't qualify for the California credit by default: the qualified-individual list (writers,
 *  producers, directors, principal cast and their travel) plus publicity. Stunts (1500) stay in: stunt performers
 *  and coordinators qualify. Everything is a checkbox on the tab. */
export const CA_DEFAULT_EXCLUDED = (p: Project) =>
  p.categories.filter(c => (c.section === 'ATL' && !/STUNT/i.test(c.name)) || /PUBLICITY|MARKETING|DISTRIBUTION|FINANC/i.test(c.name)).map(c => c.number);

export function defaultIncentives(p: Project): Incentives {
  return {
    startDate: '2027-03-01',
    ca: { enabled: false, excludedCategories: CA_DEFAULT_EXCLUDED(p), caSharePct: 100, outOfZonePct: 0, localHirePct: 0, vfx: false, trainees: 0, monetize: 'transfer', transferCents: 90, bridge: true, bridgeCostPct: 8, auditCost: 15_000 },
    federal: { enabled: false, includeAtl: true, independent: true, rural: false, transferCents: 90, bridge: false, bridgeCostPct: 8 },
    perks: {},
  };
}

export const withIncentives = (p: Project): Incentives => {
  const d = defaultIncentives(p);
  const i = p.incentives;
  return i ? { ...d, ...i, ca: { ...d.ca, ...i.ca }, federal: { ...d.federal, ...i.federal }, perks: { ...(i.perks ?? {}) } } : d;
};

export interface Line { label: string; amount: number }
export interface CreditReport {
  enabled: boolean;
  eligible: boolean;             // meets the program's floor
  qualifiedWages: number;        // wages that count, before fringes
  qualifiedFringes: number;
  qualifiedNonWage: number;      // vendors, rentals, locations, post: the non-payroll spend that counts
  qualified: number;             // the base the credit is figured on, after any cap
  capped: boolean;
  parts: Line[];                 // base credit and each uplift
  gross: number;                 // the credit as certified
  costs: Line[];                 // what it costs to get and turn into cash
  net: number;                   // what lands in the film's account
  rate: number;                  // net ÷ budget to raise
  notes: string[];
}
export interface WindowFit { apply: string; cal: string; startBy: string; fits: boolean; closed: boolean }
export interface IncentiveReport {
  ca: CreditReport;
  federal: CreditReport;
  perks: Line[];
  perksTotal: number;
  total: number;                 // everything that comes back
  duringProduction: number;      // in the bank for the shoot (bridged credits and perks)
  afterDelivery: number;         // arrives after the audit and the tax filing
  windows: WindowFit[];
  window: WindowFit | null;      // the one to apply in for the planned start
  federalDateOk: boolean;
}

const addDays = (iso: string, days: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const isWage = (l: Project['lines'][number]) => isPayrollLine(l) || isSagPerformerLine(l) || ((l.unit === 'DAY' || l.unit === 'WEEK' || l.unit === 'HOUR') && l.fringes.length > 0);

/** Cash spend by category, split into wages, their fringes, and everything else. Deferred and points don't count:
 *  nothing was paid. Contingency doesn't count either. */
function spendByCategory(p: Project) {
  const catOf = new Map(p.accounts.map(a => [a.number, a.categoryNumber]));
  const out = new Map<string, { wages: number; fringes: number; other: number }>();
  for (const l of p.lines) {
    if (l.payType !== 'cash') continue;
    const cat = catOf.get(l.accountId) ?? l.accountId.slice(0, 2) + '00';
    const r = out.get(cat) ?? { wages: 0, fringes: 0, other: 0 };
    const sub = lineSubtotal(l), fr = lineFringes(l, p.fringes);
    if (isWage(l)) { r.wages += sub; r.fringes += fr; } else r.other += sub + fr;
    out.set(cat, r);
  }
  return out;
}

const monetized = (gross: number, cents: number, bridge: boolean, bridgeCostPct: number, mode: 'transfer' | 'refund' | 'own-tax', costs: Line[]) => {
  if (mode === 'transfer' && cents < 100) costs.push({ label: `sold at ${cents}¢ on the dollar`, amount: gross * (1 - cents / 100) });
  if (mode === 'refund') costs.push({ label: `refund election: ${Math.round(CA_REFUND_SHARE * 100)}% over ${CA_REFUND_YEARS} years`, amount: gross * (1 - CA_REFUND_SHARE) });
  if (bridge && bridgeCostPct > 0) costs.push({ label: `bridge loan, ${bridgeCostPct}% interest and fees`, amount: gross * bridgeCostPct / 100 });
};

export function californiaCredit(p: Project, inc: Incentives): CreditReport {
  const i = inc.ca;
  const ts = topSheet(p);
  const notes: string[] = [];
  const spend = spendByCategory(p);
  const excluded = new Set(i.excludedCategories);
  let wages = 0, fringes = 0, other = 0, vfx = 0;
  for (const [cat, r] of spend) {
    if (excluded.has(cat)) continue;
    wages += r.wages; fringes += r.fringes; other += r.other * i.caSharePct / 100;
    if (/VISUAL EFFECTS|VFX/i.test(p.categories.find(c => c.number === cat)?.name ?? '')) vfx += r.wages + r.fringes + r.other * i.caSharePct / 100;
  }
  const raw = wages + fringes + other;
  const capped = raw > CA_QUALIFIED_CAP;
  const qualified = Math.min(raw, CA_QUALIFIED_CAP);
  const scale = raw > 0 ? qualified / raw : 0;
  const parts: Line[] = [{ label: `${Math.round(CA_BASE * 100)}% of qualified spend`, amount: qualified * CA_BASE }];
  if (i.outOfZonePct > 0) parts.push({ label: `+${Math.round(CA_OUT_OF_ZONE * 100)}% on the ${i.outOfZonePct}% shot outside the LA zone`, amount: qualified * i.outOfZonePct / 100 * CA_OUT_OF_ZONE });
  if (i.localHirePct > 0) parts.push({ label: `+${Math.round(CA_LOCAL_HIRE * 100)}% local hire on ${i.localHirePct}% of wages`, amount: (wages + fringes) * scale * i.localHirePct / 100 * CA_LOCAL_HIRE });
  if (i.vfx && vfx > 0) parts.push({ label: `+${Math.round(CA_VFX * 100)}% on visual effects`, amount: vfx * scale * CA_VFX });
  const trainees = Math.max(0, Math.min(CA_TRAINEE_MAX, Math.round(i.trainees)));
  if (trainees > 0) parts.push({ label: `+${trainees * 0.5}% for ${trainees} Career Pathways trainee${trainees === 1 ? '' : 's'}`, amount: qualified * trainees * CA_TRAINEE });
  const gross = parts.reduce((n, x) => n + x.amount, 0);
  const costs: Line[] = [];
  if (gross > 0) {
    costs.push({ label: 'Career Pathways contribution (0.25% of the allocation)', amount: gross * CA_CAREER_PATHWAYS_FEE });
    if (i.auditCost > 0) costs.push({ label: 'CPA audit', amount: i.auditCost });
    monetized(gross, i.transferCents, i.bridge, i.bridgeCostPct, i.monetize, costs);
  }
  const net = Math.max(0, gross - costs.reduce((n, x) => n + x.amount, 0));
  const eligible = ts.cashBudget >= CA_MIN_BUDGET;
  if (!eligible) notes.push(`Independent films need a budget of at least $${(CA_MIN_BUDGET / 1e6).toFixed(0)}M; this one is under.`);
  if (capped) notes.push('Qualified spend is over the $20M an independent film can claim on; the credit is figured on $20M.');
  notes.push('75% of principal photography days (or of the budget) must be in California; above-the-line wages never qualify.');
  if (i.monetize === 'own-tax') notes.push('Using the credit against the film’s own California tax only works if there is tax to use it against; most independents sell it.');
  return { enabled: i.enabled, eligible, qualifiedWages: wages * scale, qualifiedFringes: fringes * scale, qualifiedNonWage: other * scale, qualified, capped, parts, gross, costs, net: i.enabled && eligible ? net : 0, rate: ts.cashBudget ? net / ts.cashBudget : 0, notes };
}

export function federalCredit(p: Project, inc: Incentives): CreditReport {
  const i = inc.federal;
  const ts = topSheet(p);
  const spend = spendByCategory(p);
  const atl = new Set(p.categories.filter(c => c.section === 'ATL').map(c => c.number));
  let wages = 0, fringes = 0;
  for (const [cat, r] of spend) { if (!i.includeAtl && atl.has(cat)) continue; wages += r.wages; fringes += r.fringes; }
  const qualified = wages + fringes;
  let rate = FED_BASE;
  const parts: Line[] = [{ label: `${Math.round(FED_BASE * 100)}% of labor for American workers`, amount: qualified * FED_BASE }];
  if (i.independent && rate < FED_MAX) { rate += FED_BONUS; parts.push({ label: '+5% independent production', amount: qualified * FED_BONUS }); }
  if (i.rural && rate < FED_MAX) { rate += FED_BONUS; parts.push({ label: '+5% rural opportunity zone / disaster area days', amount: qualified * FED_BONUS }); }
  const gross = parts.reduce((n, x) => n + x.amount, 0);
  const costs: Line[] = [];
  if (gross > 0) monetized(gross, i.transferCents, i.bridge, i.bridgeCostPct, 'transfer', costs);
  const net = Math.max(0, gross - costs.reduce((n, x) => n + x.amount, 0));
  const eligible = ts.cashBudget >= FED_MIN_BUDGET;
  const notes = ['Introduced Sept 24, 2026; not law. Applies to productions beginning in taxable years after Dec 31, 2026, with 75% of photography days in the US. The bill text will say exactly which labor counts; until then this reads it as every wage line.'];
  if (!eligible) notes.push('Productions have to cost over $1M.');
  return { enabled: i.enabled, eligible, qualifiedWages: wages, qualifiedFringes: fringes, qualifiedNonWage: 0, qualified, capped: false, parts, gross, costs, net: i.enabled && eligible ? net : 0, rate: ts.cashBudget ? net / ts.cashBudget : 0, notes };
}

export function incentiveReport(p: Project): IncentiveReport {
  const inc = withIncentives(p);
  const ca = californiaCredit(p, inc);
  const federal = federalCredit(p, inc);
  const perks = LOCAL_PERKS.filter(k => k.id in inc.perks).map(k => ({ label: k.label, amount: Math.max(0, inc.perks[k.id] || 0) }));
  const perksTotal = perks.reduce((n, x) => n + x.amount, 0);
  const total = ca.net + federal.net + perksTotal;
  const duringProduction = (inc.ca.bridge ? ca.net : 0) + (inc.federal.bridge ? federal.net : 0) + perksTotal;
  const today = new Date().toISOString().slice(0, 10);
  const windows: WindowFit[] = CA_WINDOWS.map(w => {
    const startBy = addDays(w.cal, CA_DAYS_TO_START);
    return { apply: w.apply, cal: w.cal, startBy, closed: w.close < today, fits: inc.startDate >= w.cal && inc.startDate <= startBy };
  });
  const window = windows.find(w => w.fits && !w.closed) ?? null;
  return { ca, federal, perks, perksTotal, total, duringProduction, afterDelivery: total - duringProduction, windows, window, federalDateOk: inc.startDate >= FED_FIRST_START };
}

/** What comes off the money investors put in: every credit and perk that is switched on and eligible. */
export function incentiveProceeds(p: Project): number {
  if (!p.incentives) return 0;
  return incentiveReport(p).total;
}

export const fmtDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
