// The investor deck as data: a list of slides built from the pitch, the budget, the schedule, the look book and
// the research. The Pitch tab renders the same list on screen, to a PDF and to print (16:9 pages).
import type { LookImage, Project } from './types';
import { withPitch, defaultDeckRules, compGroups, compStats, projections, CASES, LOOK_SECTIONS } from './pitch';
import { topSheet, rollupTotal } from './budget';
import { sagReport } from './sag';
import { shootDays, parkedScenes } from './board';
import { recoupableBudget } from './waterfall';
import { shootDates, withCalendar } from './calendar';
import { incentiveReport } from './incentives';

export type Slide = { image?: LookImage } & (   // in the split layout any slide but a look slide can carry a photo on its left
  | { kind: 'title'; title: string; version: string; logline: string; byline: string; art?: boolean }   // art: the picture is the cover and carries the title
  | { kind: 'text'; heading: string; body: string }
  | { kind: 'closing'; signoff: string; title: string }
  | { kind: 'images'; heading: string; images: LookImage[] }
  | { kind: 'audience'; primary: string; secondary: string; notes: string }
  | { kind: 'comps'; groups: { group: string; rows: { title: string; year: string; distributor: string; budget: number | null; worldwide: number | null; multiple: number | null }[]; medianMultiple: number | null }[] }
  | { kind: 'plan'; scenes: number; parked: number; days: number; first: string | null; last: string | null; sets: string[]; cast: number; crew: number; tier: string; qualifies: string }
  | { kind: 'numbers'; sections: { name: string; total: number }[]; contingency: number; cashBudget: number; investors: number; incentives: number; grants: number; pointsValue: number; deferred: number }
  | { kind: 'deal'; recoupPct: number; poolPct: number; model: string; tiers: { name: string; multiplier: number; people: number }[]; cases: { label: string; gross: number; net: number; investors: number; multiple: number }[]; budget: number }
  | { kind: 'team'; members: { name: string; role: string; bio: string }[] }
  | { kind: 'research'; items: { kind: string; title: string; body: string; url?: string }[]; wide: boolean }
  | { kind: 'ask'; body: string; cashBudget: number; sources: FundingSource[]; investors: number; without: { label: string; investors: number }[] });

/** One line of the financing stack: where a slice of the budget comes from and on what footing. */
export interface FundingSource { label: string; amount: number; terms: string }

/** Where the budget comes from, in the order an investor reads it: money that is never repaid, credits that come
 *  back from the state, and last the investors' own slice. `without` says what the investor ask becomes if the
 *  credits or the grants do not land, so a small ask never looks like the whole raise. */
export function fundingStack(p: Project): { sources: FundingSource[]; investors: number; without: { label: string; investors: number }[] } {
  const e = withPitch(p); const ts = topSheet(e);
  const grants = p.waterfall.nonRecoupable ?? 0;
  const inc = p.incentives ? incentiveReport(e) : null;
  const sources: FundingSource[] = [];
  if (grants > 0) sources.push({ label: 'Fiscal sponsorship and grants', amount: grants, terms: 'donations and grants; never repaid' });
  if (inc?.ca.enabled && inc.ca.net > 0) sources.push({ label: 'California Film & TV Tax Credit', amount: inc.ca.net, terms: `net, after the audit, sale${p.incentives!.ca.bridge ? ' and bridge loan' : ''}; awarded in the ${inc.window ? inc.window.apply : 'next'} application round` });
  if (inc?.federal.enabled && inc.federal.net > 0) sources.push({ label: 'Federal production credit', amount: inc.federal.net, terms: 'proposed in Congress, not yet law' });
  for (const k of inc?.perks ?? []) if (k.amount > 0) sources.push({ label: k.label, amount: k.amount, terms: 'local' });
  const investors = recoupableBudget(e);
  sources.push({ label: 'Investors', amount: investors, terms: `recoup ${p.waterfall.recoupPct}% first, then ${100 - p.waterfall.poolPct}% of net` });
  const without: { label: string; investors: number }[] = [];
  const credits = inc?.total ?? 0;
  if (credits > 0) without.push({ label: 'without the credits', investors: Math.max(0, ts.cashBudget - grants) });
  if (grants > 0 && credits > 0) without.push({ label: 'without the credits or the sponsorship', investors: ts.cashBudget });
  else if (grants > 0) without.push({ label: 'without the sponsorship', investors: ts.cashBudget });
  return { sources, investors, without };
}

/** "Primary: women who…" in the Primary box says the label twice; the slide keeps the label and drops the prefix. */
export const unlabel = (text: string, label: string) => text.replace(new RegExp(`^\\s*${label}\\s*[:.\\u2014-]\\s*`, 'i'), '');

/** Research slides: a long finding (over 260 characters) shares a slide with one other, short ones go four up. */
export function researchSlides<T extends { body: string }>(items: T[]): { items: T[]; wide: boolean }[] {
  const long = (r: T) => r.body.length > 260;
  const out: { items: T[]; wide: boolean }[] = [];
  let cur: T[] = [];
  const flush = () => { if (cur.length) out.push({ items: cur, wide: cur.some(long) }); cur = []; };
  for (const r of items) {
    const cap = long(r) || cur.some(long) ? 2 : 4;
    if (cur.length >= cap) flush();
    cur.push(r);
  }
  flush();
  return out;
}

const SECTION_NAME: Record<string, string> = { ATL: 'Above the line', PRODUCTION: 'Production', POST: 'Post-production', OTHER: 'Other' };
const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** The slides. `p0` is the project as the views see it, with the deal already applied (App passes that to every
 *  tab); applying it again here compounded the crew bump and put a budget on the deck that no other tab showed. */
export function deckSlides(p0: Project, byline = ''): Slide[] {
  const p = withPitch(p0); const pitch = p.pitch!;
  const e = p; const ts = topSheet(e); const sag = sagReport(e);
  const days = shootDays(p.board); const parked = parkedScenes(p.board);
  const cal = withCalendar(p).calendar!; const dates = shootDates(p.board, cal);
  const dated = [...dates.values()].filter(Boolean).sort();
  const out: Slide[] = [];
  const rules = pitch.design?.deck ?? defaultDeckRules();
  const lookbook = (pitch.lookbook ?? []).filter(i => i.dataUrl.startsWith('data:'));   // pictures still loading or missing stay off the slides
  const byId = (id?: string) => (id ? lookbook.find(i => i.id === id) : undefined);
  const cover = byId(rules?.coverImageId), closing = byId(rules?.closingImageId);
  const split = rules?.layout === 'split';
  // in the split layout the pictures are the deck's look: the title, the case and the team each take one, in look book
  // order, the cover and closing pictures left out; what is left over gets a look slide of its own (a single picture,
  // bleeding) up to six
  const seen = new Set<string>();   // a look book made from a PDF can hold the same picture twice; the deck shows it once
  const pool = lookbook.filter(i => i.id !== cover?.id && i.id !== closing?.id && i.section !== 'reference' && !seen.has(i.dataUrl) && !!seen.add(i.dataUrl));
  let pi = 0;
  const used = new Set<string>();
  const beside = pool.filter(i => !i.slide);   // pictures marked for a look slide of their own are not handed to the text slides
  const take = (): LookImage | undefined => { if (!split || !beside.length) return undefined; const img = beside[pi++ % beside.length]; used.add(img.id); return img; };
  // the prose slides take the pictures; a table or a column of findings needs the whole page, so the data slides go full width
  const takes = (k: Slide['kind']) => k === 'title' || k === 'text' || k === 'team';
  const push = (s: Slide) => { out.push(takes(s.kind) ? { ...s, image: s.image ?? take() } : s); };
  push({ kind: 'title', title: p.name, version: p.version, logline: pitch.logline, byline, image: cover, art: !!cover });
  if (pitch.why.trim()) push({ kind: 'text', heading: 'Why this film, why now', body: pitch.why });
  for (const sec of pitch.sections) if (sec.heading.trim() || sec.body.trim()) push({ kind: 'text', heading: sec.heading, body: sec.body });
  if (pitch.audience.primary || pitch.audience.secondary || pitch.audience.notes) push({ kind: 'audience', primary: unlabel(pitch.audience.primary, 'primary'), secondary: unlabel(pitch.audience.secondary, 'secondary'), notes: unlabel(pitch.audience.notes, 'how we reach them') });
  if (pitch.comps.length) push({ kind: 'comps', groups: compGroups(pitch.comps).map(g => ({ group: g.group, rows: g.comps.map(c => ({ title: c.title, year: c.year, distributor: c.distributor, budget: c.budget, worldwide: c.worldwide, multiple: c.budget && c.worldwide ? c.worldwide / c.budget : null })), medianMultiple: compStats(g.comps).medianMultiple })) });
  const sets = [...new Set(p.board.scenes.filter(s => !s.unit).map(s => s.set.trim()).filter(Boolean))];
  const crew = p.participants.filter(x => x.group === 'crew').length;
  if (p.board.scenes.length || p.lines.length) push({ kind: 'plan', scenes: p.board.scenes.length - parked.length, parked: parked.length, days: days.length, first: dated[0] ?? null, last: dated[dated.length - 1] ?? null, sets, cast: p.board.castList.length, crew, tier: sag.target.name, qualifies: sag.qualifying.name + (sag.dic ? ' with Diversity in Casting' : '') });
  if (p.lines.length) push({ kind: 'numbers', sections: ts.sections.map(s => ({ name: SECTION_NAME[s.section] ?? s.section, total: rollupTotal(s) })), contingency: ts.contingency, cashBudget: ts.cashBudget, investors: recoupableBudget(e), incentives: p.incentives ? incentiveReport(e).total : 0, grants: p.waterfall.nonRecoupable ?? 0, pointsValue: ts.pointsValue, deferred: ts.deferredTotal });
  const pr = projections(e);
  const hasCases = pitch.revenue.some(r => r.low || r.mid || r.high);
  push({ kind: 'deal', recoupPct: p.waterfall.recoupPct, poolPct: p.waterfall.poolPct, model: p.waterfall.model,
    tiers: p.tiers.map(t => ({ name: t.name, multiplier: t.multiplier, people: p.participants.filter(x => x.tierId === t.id).length })).filter(t => t.people),
    cases: hasCases ? CASES.map(c => ({ label: c, gross: pr[c].gross, net: pr[c].net, investors: pr[c].investors, multiple: pr[c].multiple })) : [], budget: recoupableBudget(e) });
  const team = (pitch.team ?? []).filter(t => t.name.trim());
  if (team.length) push({ kind: 'team', members: team });
  const research = (pitch.research ?? []).filter(r => r.title.trim() || r.body.trim());
  for (const group of researchSlides(research)) push({ kind: 'research', ...group });
  // the look: in the split layout, a few of the pictures no slide took, one to a slide and full bleed, taking the sections in
  // turn so six cards on a wall do not make six slides; in the plain layout, four to a slide by section
  const atAsk = out.length;
  if (split) {
    const left = pool.filter(i => !used.has(i.id));
    const chosen = pool.filter(i => i.slide);   // pictures marked "look slide" in the look book are the look slides, in look book order
    const want = chosen.length ? 0 : Math.max(0, Math.min(6, Math.round(rules.lookSlides ?? 3)));
    // spread the picks through each section (the first, the middle, the last of it) so a run of similar pictures gives one slide, not three
    const spread = (xs: LookImage[]) => xs.length <= want ? xs : Array.from({ length: want }, (_, k) => xs[Math.floor(k * xs.length / want)]);
    const bySection = LOOK_SECTIONS.map(ls => spread(left.filter(i => i.section === ls.id)));
    const picks: LookImage[] = [...chosen];
    for (let round = 0; picks.length < want && bySection.some(x => x.length > round); round++) for (const xs of bySection) if (xs[round] && picks.length < want) picks.push(xs[round]);
    for (const img of picks) out.push({ kind: 'images', heading: LOOK_SECTIONS.find(x => x.id === img.section)?.label ?? 'The look', images: [img] });
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
  if ((pitch.ask ?? '').trim() || p.lines.length) push({ kind: 'ask', body: pitch.ask ?? '', cashBudget: ts.cashBudget, ...fundingStack(p) });
  if (closing || rules?.signoff) out.push({ kind: 'closing', image: closing, signoff: rules?.signoff ?? '', title: p.name });
  return out;
}
