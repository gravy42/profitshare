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

export type Slide =
  | { kind: 'title'; title: string; version: string; logline: string; byline: string; image?: LookImage }
  | { kind: 'text'; heading: string; body: string; image?: LookImage }
  | { kind: 'closing'; image?: LookImage; signoff: string; title: string }
  | { kind: 'images'; heading: string; images: LookImage[] }
  | { kind: 'audience'; primary: string; secondary: string; notes: string }
  | { kind: 'comps'; groups: { group: string; rows: { title: string; year: string; distributor: string; budget: number | null; worldwide: number | null; multiple: number | null }[]; medianMultiple: number | null }[] }
  | { kind: 'plan'; scenes: number; parked: number; days: number; first: string | null; last: string | null; sets: string[]; cast: number; crew: number; tier: string; qualifies: string }
  | { kind: 'numbers'; sections: { name: string; total: number }[]; contingency: number; cashBudget: number; investors: number; incentives: number; pointsValue: number; deferred: number }
  | { kind: 'deal'; recoupPct: number; poolPct: number; model: string; tiers: { name: string; multiplier: number; people: number }[]; cases: { label: string; gross: number; net: number; investors: number; multiple: number }[]; budget: number }
  | { kind: 'team'; members: { name: string; role: string; bio: string }[] }
  | { kind: 'research'; items: { kind: string; title: string; body: string; url?: string }[] }
  | { kind: 'ask'; body: string; cashBudget: number };

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
  const lookbook = pitch.lookbook ?? [];
  const byId = (id?: string) => (id ? lookbook.find(i => i.id === id) : undefined);
  const cover = byId(rules?.coverImageId), closing = byId(rules?.closingImageId);
  // in the split layout, text slides each take a picture: the look book in order, cover and closing pictures left out,
  // and those pictures do not get a slide of their own as well
  const split = rules?.layout === 'split';
  const pool = split ? lookbook.filter(i => i.id !== cover?.id && i.id !== closing?.id && i.section !== 'reference') : [];
  let pi = 0;
  const nextImage = () => (pool.length ? pool[pi++ % pool.length] : undefined);
  const used = new Set<string>();
  out.push({ kind: 'title', title: p.name, version: p.version, logline: pitch.logline, byline, image: cover });
  if (pitch.why.trim()) { const image = nextImage(); if (image) used.add(image.id); out.push({ kind: 'text', heading: 'Why this film, why now', body: pitch.why, image }); }
  for (const sec of pitch.sections) if (sec.heading.trim() || sec.body.trim()) { const image = nextImage(); if (image) used.add(image.id); out.push({ kind: 'text', heading: sec.heading, body: sec.body, image }); }
  // references are for the filmmaker (a brand book's pages, a lighting reference); the deck shows tone, world and characters
  for (const ls of LOOK_SECTIONS.filter(x => x.id !== 'reference')) {
    const imgs = lookbook.filter(i => i.section === ls.id && !used.has(i.id) && i.id !== cover?.id && i.id !== closing?.id);
    for (const group of chunk(imgs, 4)) out.push({ kind: 'images', heading: ls.label, images: group });
  }
  if (pitch.audience.primary || pitch.audience.secondary || pitch.audience.notes) out.push({ kind: 'audience', ...pitch.audience });
  if (pitch.comps.length) out.push({ kind: 'comps', groups: compGroups(pitch.comps).map(g => ({ group: g.group, rows: g.comps.map(c => ({ title: c.title, year: c.year, distributor: c.distributor, budget: c.budget, worldwide: c.worldwide, multiple: c.budget && c.worldwide ? c.worldwide / c.budget : null })), medianMultiple: compStats(g.comps).medianMultiple })) });
  const sets = [...new Set(p.board.scenes.filter(s => !s.unit).map(s => s.set.trim()).filter(Boolean))];
  const crew = p.participants.filter(x => x.group === 'crew').length;
  if (p.board.scenes.length || p.lines.length) out.push({ kind: 'plan', scenes: p.board.scenes.length - parked.length, parked: parked.length, days: days.length, first: dated[0] ?? null, last: dated[dated.length - 1] ?? null, sets, cast: p.board.castList.length, crew, tier: sag.target.name, qualifies: sag.qualifying.name + (sag.dic ? ' with Diversity in Casting' : '') });
  if (p.lines.length) out.push({ kind: 'numbers', sections: ts.sections.map(s => ({ name: SECTION_NAME[s.section] ?? s.section, total: rollupTotal(s) })), contingency: ts.contingency, cashBudget: ts.cashBudget, investors: recoupableBudget(p), incentives: incentiveProceeds(e), pointsValue: ts.pointsValue, deferred: ts.deferredTotal });
  const pr = projections(p);
  const hasCases = pitch.revenue.some(r => r.low || r.mid || r.high);
  out.push({ kind: 'deal', recoupPct: p.waterfall.recoupPct, poolPct: p.waterfall.poolPct, model: p.waterfall.model,
    tiers: p.tiers.map(t => ({ name: t.name, multiplier: t.multiplier, people: p.participants.filter(x => x.tierId === t.id).length })).filter(t => t.people),
    cases: hasCases ? CASES.map(c => ({ label: c, gross: pr[c].gross, net: pr[c].net, investors: pr[c].investors, multiple: pr[c].multiple })) : [], budget: recoupableBudget(p) });
  const team = (pitch.team ?? []).filter(t => t.name.trim());
  if (team.length) out.push({ kind: 'team', members: team });
  const research = (pitch.research ?? []).filter(r => r.title.trim() || r.body.trim());
  for (const group of chunk(research, 4)) out.push({ kind: 'research', items: group });
  if ((pitch.ask ?? '').trim() || p.lines.length) out.push({ kind: 'ask', body: pitch.ask ?? '', cashBudget: ts.cashBudget });
  if (closing || rules?.signoff) out.push({ kind: 'closing', image: closing, signoff: rules?.signoff ?? '', title: p.name });
  return out;
}
