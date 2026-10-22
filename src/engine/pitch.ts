import type { Comp, DeckRules, LookImage, Pitch, PitchDesign, PitchSection, Project, ResearchItem, RevenueLine, TeamMember } from './types';
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

export const defaultDesign = (): PitchDesign => ({ name: '', colors: { bg: '#15151b', ink: '#f3efe4', accent: '#e8b84a', accent2: '#91a9d9', muted: '#a9a39a' }, fonts: { title: '', body: '' }, notes: '', deck: defaultDeckRules() });
export const defaultDeckRules = (): DeckRules => ({ layout: 'plain', eyebrow: false, bleed: 0.55, signoff: '' });

export const withPitch = (p: Project): Project => {
  const b = p.pitch;
  if (b && b.sections && b.lookbook && b.research && b.team && b.ask != null) return p;
  const base = b ?? defaultPitch();
  return { ...p, pitch: { ...base, sections: base.sections ?? [], lookbook: base.lookbook ?? [], research: base.research ?? [], team: base.team ?? [], ask: base.ask ?? '' } };
};

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newComp = (partial: Partial<Comp> = {}): Comp => ({ id: uid('comp'), title: '', year: '', distributor: '', budget: null, domestic: null, worldwide: null, note: '', source: '', ...partial });
export const newRevenueLine = (source = ''): RevenueLine => ({ id: uid('rv'), source, low: 0, mid: 0, high: 0 });
export const newSection = (heading = ''): PitchSection => ({ id: uid('sec'), heading, body: '' });
export const newLookImage = (dataUrl: string, section: LookImage['section'] = 'tone'): LookImage => ({ id: uid('img'), dataUrl, caption: '', section });
export const newResearch = (kind: ResearchItem['kind'] = 'market'): ResearchItem => ({ id: uid('rs'), kind, title: '', body: '', url: '' });
export const newTeamMember = (): TeamMember => ({ id: uid('tm'), name: '', role: '', bio: '' });
export const LOOK_SECTIONS: { id: LookImage['section']; label: string }[] = [{ id: 'tone', label: 'Tone' }, { id: 'world', label: 'The world' }, { id: 'character', label: 'Characters' }, { id: 'reference', label: 'References' }];
export const RESEARCH_KINDS: { id: ResearchItem['kind']; label: string }[] = [{ id: 'market', label: 'Market' }, { id: 'audience', label: 'Audience' }, { id: 'comp', label: 'Comparable' }, { id: 'press', label: 'Press' }, { id: 'other', label: 'Other' }];

/** Rough size of the project as saved (pictures live in their own store and are not counted). */
export const projectBytes = (p: Project): number => JSON.stringify({ ...p, pitch: p.pitch ? { ...p.pitch, lookbook: (p.pitch.lookbook ?? []).map(i => ({ ...i, dataUrl: '' })) } : undefined }).length;

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
