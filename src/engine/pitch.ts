import type { Comp, Pitch, PitchSection, Project, RevenueLine } from './types';
import { recoupableBudget, investorsAt, poolAt } from './waterfall';

export const defaultPitch = (): Pitch => ({
  logline: '', why: '',
  audience: { primary: '', secondary: '', notes: '' },
  sections: [],
  comps: [],
  revenue: [
    { id: 'rv_dom', source: 'Domestic (theatrical + streaming license)', low: 0, mid: 0, high: 0 },
    { id: 'rv_intl', source: 'International sales', low: 0, mid: 0, high: 0 },
    { id: 'rv_tvod', source: 'TVOD / AVOD / library', low: 0, mid: 0, high: 0 },
  ],
  feePct: 20,
  deck: '',
  sources: [],
});

export const withPitch = (p: Project): Project => (p.pitch ? (p.pitch.sections ? p : { ...p, pitch: { ...p.pitch, sections: [] } }) : { ...p, pitch: defaultPitch() });

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newComp = (partial: Partial<Comp> = {}): Comp => ({ id: uid('comp'), title: '', year: '', distributor: '', budget: null, domestic: null, worldwide: null, note: '', source: '', ...partial });
export const newRevenueLine = (source = ''): RevenueLine => ({ id: uid('rv'), source, low: 0, mid: 0, high: 0 });
export const newSection = (heading = ''): PitchSection => ({ id: uid('sec'), heading, body: '' });

export const DEFAULT_GROUP = 'Comparable films';
/** Comps grouped by the argument they support, in first-seen order; ungrouped comps come first. */
export function compGroups(comps: Comp[]): { group: string; comps: Comp[] }[] {
  const order: string[] = []; const m = new Map<string, Comp[]>();
  for (const c of comps) { const g = c.group?.trim() || DEFAULT_GROUP; if (!m.has(g)) { m.set(g, []); order.push(g); } m.get(g)!.push(c); }
  return order.map(group => ({ group, comps: m.get(group)! }));
}

/** Worldwide gross over budget, when both are known. */
export const compMultiple = (c: Comp) => (c.budget && c.worldwide ? c.worldwide / c.budget : null);

export interface CompStats { n: number; medianMultiple: number | null; medianWorldwide: number | null; medianBudget: number | null }
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function compStats(comps: Comp[]): CompStats {
  return {
    n: comps.length,
    medianMultiple: median(comps.map(compMultiple).filter((x): x is number => x != null)),
    medianWorldwide: median(comps.map(c => c.worldwide).filter((x): x is number => x != null)),
    medianBudget: median(comps.map(c => c.budget).filter((x): x is number => x != null)),
  };
}

export type Case = 'low' | 'mid' | 'high';
export const CASES: Case[] = ['low', 'mid', 'high'];

export interface Projection { gross: number; fees: number; net: number; investors: number; pool: number; multiple: number }

/** Three cases: gross receipts by source, fees off the top, what reaches the film, then the waterfall as set on the Deal tab. */
export function projections(p: Project): Record<Case, Projection> {
  const pitch = withPitch(p).pitch!;
  const budget = recoupableBudget(p);
  const out = {} as Record<Case, Projection>;
  for (const c of CASES) {
    const gross = pitch.revenue.reduce((n, r) => n + (r[c] || 0), 0);
    const fees = gross * pitch.feePct / 100;
    const net = gross - fees;
    const investors = investorsAt(p.waterfall, budget, net);
    out[c] = { gross, fees, net, investors, pool: poolAt(p.waterfall, budget, net), multiple: budget > 0 ? investors / budget : 0 };
  }
  return out;
}

/** Push the three net figures into the Deal tab's revenue scenarios so the Points tab shows the same cases. */
export function adoptProjectionsAsScenarios(p: Project): Project {
  const pr = projections(p);
  return { ...p, waterfall: { ...p.waterfall, scenarios: CASES.map(c => Math.round(pr[c].net)) } };
}
