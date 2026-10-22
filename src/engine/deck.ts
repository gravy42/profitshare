// The investor deck as data: a list of slides built from the pitch, the budget, the schedule, the look book and
// the research. The Pitch tab renders the same list on screen and to print (16:9 pages, PDF via the print dialog).
import type { LookImage, Project } from './types';
import { withPitch, compGroups, compStats, projections, CASES, LOOK_SECTIONS } from './pitch';
import { topSheet, rollupTotal } from './budget';
import { applyDeal } from './deal';
import { sagReport } from './sag';
import { shootDays, parkedScenes } from './board';
import { recoupableBudget } from './waterfall';
import { shootDates, withCalendar } from './calendar';
import { incentiveProceeds } from './incentives';

export type Slide = { image?: LookImage } & (   // in the split layout any slide but a look slide can carry a photo on its left
  | { kind: 'title'; title: string; version: string; logline: string; byline: string }
  | { kind: 'text'; heading: string; body: string }
  | { kind: 'closing'; signoff: string; title: string }
  | { kind: 'images'; heading: string; images: LookImage[] }
  | { kind: 'audience'; primary: string; secondary: string; notes: string }
  | { kind: 'comps'; groups: { group: string; rows: { title: string; year: string; distributor: string; budget: number | null; worldwide: number | null; multiple: number | null }[]; medianMultiple: number | null }[] }
  | { kind: 'plan'; scenes: number; parked: number; days: number; first: string | null; last: string | null; sets: string[]; cast: number; crew: number; tier: string; qualifies: string }
  | { kind: 'numbers'; sections: { name: string; total: number }[]; contingency: number; cashBudget: number; investors: number; incentives: number; pointsValue: number; deferred: number }
  | { kind: 'deal'; recoupPct: number; poolPct: number; model: string; tiers: { name: string; multiplier: number; people: number }[]; cases: { label: string; gross: number; net: number; investors: number; multiple: number }[]; budget: number }
  | { kind: 'team'; members: { name: string; role: string; bio: string }[] }
  | { kind: 'research'; items: { kind: string; title: string; body: string; url?: string }[] }
  | { kind: 'ask'; body: string; cashBudget: number });

const SECTION_NAME: Record<string, string> = { ATL: 'Above the line', PRODUCTION: 'Production', POST: 'Post-production', OTHER: 'Other' };
const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

export function deckSlides(p0: Project, byline = ''): Slide[] {
  const p = withPitch(p0); const pitch = p.pitch!;
  const e = applyDeal(p); const ts = topSheet(e); const sag = sagReport(e);
  const days = shootDays(p.board); const parked = parkedScenes(p.board);
  const cal = withCalendar(p).calendar!; const dates = shootDates(p.board, cal);
  const dated = [...dates.values()].filter(Boolean).sort();
  const out: Slide[] = [];
  const rules = pitch.design?.deck;
  const lookbook = (pitch.lookbook ?? []).filter(i => i.dataUrl.startsWith('data:'));   // pictures still loading or missing stay off the slides
  const byId = (id?: string) => (id ? lookbook.find(i => i.id === id) : undefined);
  const cover = byId(rules?.coverImageId), closing = byId(rules?.closingImageId);
  const split = rules?.layout === 'split';
  // in the split layout the pictures are the deck's look: every slide takes one, in look book order, the cover and
  // closing pictures left out; what is left over gets a look slide of its own (a single picture, bleeding) up to six
  const pool = lookbook.filter(i => i.id !== cover?.id && i.id !== closing?.id && i.section !== 'reference');
  let pi = 0;
  const used = new Set<string>();
  const take = (): LookImage | undefined => { if (!split || !pool.length) return undefined; const img = pool[pi++ % pool.length]; used.add(img.id); return img; };
  const push = (s: Slide) => { out.push(s.kind === 'images' || s.kind === 'closing' ? s : { ...s, image: s.image ?? take() }); };
  push({ kind: 'title', title: p.name, version: p.version, logline: pitch.logline, byline, image: cover });
  if (pitch.why.trim()) push({ kind: 'text', heading: 'Why this film, why now', body: pitch.why });
  for (const sec of pitch.sections) if (sec.heading.trim() || sec.body.trim()) push({ kind: 'text', heading: sec.heading, body: sec.body });
  if (pitch.audience.primary || pitch.audience.secondary || pitch.audience.notes) push({ kind: 'audience', ...pitch.audience });
  if (pitch.comps.length) push({ kind: 'comps', groups: compGroups(pitch.comps).map(g => ({ group: g.group, rows: g.comps.map(c => ({ title: c.title, year: c.year, distributor: c.distributor, budget: c.budget, worldwide: c.worldwide, multiple: c.budget && c.worldwide ? c.worldwide / c.budget : null })), medianMultiple: compStats(g.comps).medianMultiple })) });
  const sets = [...new Set(p.board.scenes.filter(s => !s.unit).map(s => s.set.trim()).filter(Boolean))];
  const crew = p.participants.filter(x => x.group === 'crew').length;
  if (p.board.scenes.length || p.lines.length) push({ kind: 'plan', scenes: p.board.scenes.length - parked.length, parked: parked.length, days: days.length, first: dated[0] ?? null, last: dated[dated.length - 1] ?? null, sets, cast: p.board.castList.length, crew, tier: sag.target.name, qualifies: sag.qualifying.name + (sag.dic ? ' with Diversity in Casting' : '') });
  if (p.lines.length) push({ kind: 'numbers', sections: ts.sections.map(s => ({ name: SECTION_NAME[s.section] ?? s.section, total: rollupTotal(s) })), contingency: ts.contingency, cashBudget: ts.cashBudget, investors: recoupableBudget(p), incentives: incentiveProceeds(e), pointsValue: ts.pointsValue, deferred: ts.deferredTotal });
  const pr = projections(p);
  const hasCases = pitch.revenue.some(r => r.low || r.mid || r.high);
  push({ kind: 'deal', recoupPct: p.waterfall.recoupPct, poolPct: p.waterfall.poolPct, model: p.waterfall.model,
    tiers: p.tiers.map(t => ({ name: t.name, multiplier: t.multiplier, people: p.participants.filter(x => x.tierId === t.id).length })).filter(t => t.people),
    cases: hasCases ? CASES.map(c => ({ label: c, gross: pr[c].gross, net: pr[c].net, investors: pr[c].investors, multiple: pr[c].multiple })) : [], budget: recoupableBudget(p) });
  const team = (pitch.team ?? []).filter(t => t.name.trim());
  if (team.length) push({ kind: 'team', members: team });
  const research = (pitch.research ?? []).filter(r => r.title.trim() || r.body.trim());
  for (const group of chunk(research, 4)) push({ kind: 'research', items: group });
  // the look: in the split layout, the pictures no slide took, one to a slide, up to six; in the plain layout, four to a slide by section
  const atAsk = out.length;
  if (split) {
    const left = pool.filter(i => !used.has(i.id)).slice(0, 6);
    for (const img of left) out.push({ kind: 'images', heading: LOOK_SECTIONS.find(x => x.id === img.section)?.label ?? 'The look', images: [img] });
  } else {
    for (const ls of LOOK_SECTIONS.filter(x => x.id !== 'reference')) {
      const imgs = lookbook.filter(i => i.section === ls.id && i.id !== cover?.id && i.id !== closing?.id);
      for (const group of chunk(imgs, 4)) out.push({ kind: 'images', heading: ls.label, images: group });
    }
  }
  // look slides sit after the case and before the plan, where a reader wants to see the film before the money
  const look = out.splice(atAsk);
  const beforePlan = out.findIndex(s => s.kind === 'audience' || s.kind === 'comps' || s.kind === 'plan');
  out.splice(beforePlan < 0 ? out.length : beforePlan, 0, ...look);
  if ((pitch.ask ?? '').trim() || p.lines.length) push({ kind: 'ask', body: pitch.ask ?? '', cashBudget: ts.cashBudget });
  if (closing || rules?.signoff) out.push({ kind: 'closing', image: closing, signoff: rules?.signoff ?? '', title: p.name });
  return out;
}
