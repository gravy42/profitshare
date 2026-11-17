// The authored pitch deck as data. `defaultSlides()` lays out a first deck from what the Pitch tab already holds;
// `deckData()` turns the slides (the author's own, or that default) into the plain-JSON contract in
// src/deck-runtime/data.ts, which the deck's runtime draws. Pass the effective project (after applyDeal), as
// everywhere in the engine. Nothing here reads the clock or rolls dice: the same project gives the same deck.
import type { LookImage, Project, Recipient, SlideCard, SlideSpec, Waterfall } from './types';
import type { DeckCard, DeckData, DeckImage, DeckMilestone, DeckRecipient, DeckSlide, DeckStat, DeckTheme } from '../deck-runtime/data';
import { DECK_DATA_VERSION } from '../deck-runtime/data';
import { withPitch, defaultDesign, defaultDeckRules, compGroups, compMultiple } from './pitch';
import { unlabel } from './deck';
import { topSheet } from './budget';
import { shootDays, parkedScenes } from './board';
import { shootDates, withCalendar } from './calendar';
import { letterFor } from './incentives';
import { sponsorNet } from './waterfall';
import { pathInputs } from './paths';
import { pathFor } from './pathMath';

export interface DeckDataOptions { today?: string }   // ISO date; only for the month and year in the default cover line

export const DECK_LEGAL = 'The figures in this deck are illustrative projections, not a promise of returns. Investing in a film is speculative and investors can lose all of the money they put in. This deck is not an offer to sell securities or a solicitation of an offer to buy them.';
export const DARK_INK = '#1b1608', LIGHT_INK = '#f4eddc';
export const DEFAULT_CARD = '#f1e9d6';   // an index card, when the design system names no card colour
export const MAX_CARDS = 4;
const TAGLINE_MAX = 120;                 // a logline's first sentence longer than this is not a tagline

/** "Ada Example" → "ada-example": lower-case letters, digits and single hyphens only. */
export const slugify = (name: string): string =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The first sentence of a paragraph: up to the first full stop, question or exclamation mark that ends a word. */
export function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^.*?[.!?]["'”’)]?(?=\s+["'“‘(]?[A-Z0-9]|$)/.exec(t);
  return (m ? m[0] : t).trim();
}

const pc = (n: number) => String(Math.round(n * 100) / 100);
const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

const investBody = (w: Waterfall): string => w.model === 'off-the-gross'
  ? `You take ${pc(100 - w.grossSharePct)} cents of every dollar the film earns until you have ${pc(w.recoupPct)}% of your investment back, then ${pc(100 - w.poolPct)}% of everything after.`
  : `You recoup ${pc(w.recoupPct)}% of your investment first, then share ${pc(100 - w.poolPct)}% of everything after.`;

function waysCards(p: Project): SlideCard[] {
  const w = p.waterfall;
  const cards: SlideCard[] = [{ id: 'invest', title: 'Invest', body: investBody(w) }];
  if (sponsorNet(w) > 0) {
    const fee = Math.max(0, Math.min(100, w.sponsorFeePct ?? 0));
    const give: SlideCard = { id: 'give', title: 'Give', body: 'A grant or a donation through the film’s fiscal sponsor. It is never repaid, and every dollar of it lowers what investors have to put in.' };
    if (fee > 0) give.footnote = `The fiscal sponsor keeps ${pc(fee)}% of each gift.`;
    cards.push(give);
  }
  return cards;
}

/** The deck the Pitch tab already implies, in a fixed order with fixed ids; a slide with nothing to say is left out. */
export function defaultSlides(p0: Project): SlideSpec[] {
  const p = withPitch(p0); const pitch = p.pitch!;
  const rules = pitch.design?.deck ?? defaultDeckRules();
  const out: SlideSpec[] = [];

  const cover: SlideSpec = { id: 'cover', layout: 'cover' };
  if (rules.coverImageId) cover.imageId = rules.coverImageId;
  out.push(cover);

  if (pitch.logline.trim()) out.push({ id: 'logline', layout: 'photo', eyebrow: 'Logline', body: pitch.logline.trim() });
  if (pitch.why.trim()) out.push({ id: 'why', layout: 'text', eyebrow: 'Why this film, why me', body: pitch.why.trim() });

  const market = (pitch.research ?? []).filter(r => r.kind === 'market' && (r.title.trim() || r.body.trim())).slice(0, MAX_CARDS);
  if (market.length) out.push({ id: 'gap', layout: 'cards', eyebrow: 'The gap', cards: market.map(r => ({ id: r.id, title: r.title.trim(), body: firstSentence(r.body), footnote: (r.url ?? '').trim() })) });

  if (pitch.comps.length) out.push({ id: 'opportunity', layout: 'comps', eyebrow: 'The opportunity' });

  const a = pitch.audience;
  if (a.primary.trim() || a.secondary.trim() || a.notes.trim()) {
    const s: SlideSpec = { id: 'audience', layout: 'stats', eyebrow: 'The audience', stats: [] };
    const body = [unlabel(a.primary, 'primary').trim(), unlabel(a.secondary, 'secondary').trim()].filter(Boolean).join('\n\n');
    if (body) s.body = body;
    const note = unlabel(a.notes, 'how we reach them').trim();
    if (note) s.closing = note;   // a stats slide draws its closing line as the note under the numbers
    out.push(s);
  }

  for (const sec of pitch.sections) if (sec.heading.trim() || sec.body.trim()) out.push({ id: `sec:${sec.id}`, layout: 'text', headline: sec.heading.trim(), body: sec.body.trim() });

  if ((pitch.team ?? []).some(t => t.name.trim())) out.push({ id: 'team', layout: 'team', eyebrow: 'The team' });
  if (p.board.scenes.length || p.lines.length) out.push({ id: 'plan', layout: 'timeline', eyebrow: 'The plan' });
  if (p.participants.length) out.push({ id: 'model', layout: 'model', eyebrow: 'The model' });
  out.push({ id: 'ways', layout: 'ways', eyebrow: 'Ways to take part', cards: waysCards(p) });
  if (p.lines.length) out.push({ id: 'numbers', layout: 'numbers', eyebrow: 'The numbers' });

  const ask: SlideSpec = { id: 'ask', layout: 'ask', eyebrow: 'The ask' };
  if ((pitch.ask ?? '').trim()) ask.body = pitch.ask!.trim();
  out.push(ask);

  if (rules.closingImageId) out.push({ id: 'closing', layout: 'closing', imageId: rules.closingImageId });
  return out;
}

/** The slides the deck is built from: the author's own when there are any, else the default. */
export function slidesOf(p: Project): SlideSpec[] {
  const own = p.pitch?.slides;
  return own && own.length ? own : defaultSlides(p);
}

// ---------- colour ----------

function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** WCAG relative luminance, 0 (black) to 1 (white); null when the colour is not a hex. */
export function luminance(hex: string): number | null {
  const rgb = rgbOf(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** The ink for a card: dark, unless the card is dark enough that the light ink reads better on it. */
export function cardInkFor(card: string): string {
  const l = luminance(card);
  if (l == null) return DARK_INK;
  return contrast(l, luminance(LIGHT_INK)!) > contrast(l, luminance(DARK_INK)!) ? LIGHT_INK : DARK_INK;
}

function themeOf(p: Project): DeckTheme {
  const d = p.pitch?.design; const base = defaultDesign();
  const col = (k: keyof typeof base.colors) => (d?.colors?.[k] ?? '').trim() || base.colors[k];
  const muted = col('muted');
  const card = (d?.card ?? '').trim() || DEFAULT_CARD;
  return {
    name: d?.name ?? '',
    colors: { bg: col('bg'), ink: col('ink'), accent: col('accent'), accent2: col('accent2'), muted, card, cardInk: cardInkFor(card), line: (d?.line ?? '').trim() || muted },
    fonts: { title: d?.fonts?.title ?? '', body: d?.fonts?.body ?? '' },
    signoff: (d?.deck ?? defaultDeckRules()).signoff ?? '',
  };
}

// ---------- the parts the project fills in ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m && +m[2] >= 1 && +m[2] <= 12 ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const monthDay = (iso: string) => { const x = parts(iso)!; return `${MONTHS[x.m - 1].slice(0, 3)} ${x.d}`; };
/** "Mar 8 to Apr 2, 2027"; both years when the shoot crosses New Year; one date when it is a single day. */
export function dateSpan(first: string, last: string): string {
  const a = parts(first), b = parts(last);
  if (!a || !b) return '';
  if (first === last) return `${monthDay(first)}, ${a.y}`;
  return a.y === b.y ? `${monthDay(first)} to ${monthDay(last)}, ${b.y}` : `${monthDay(first)}, ${a.y} to ${monthDay(last)}, ${b.y}`;
}

function currencySymbol(code: string): string {
  try {
    const sym = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(x => x.type === 'currency')?.value;
    return sym && sym !== code ? sym : `${code} `;
  } catch { return code ? `${code} ` : ''; }
}
/** "$1.2M", "$850K", "$900": a budget as a fact on a slide. */
export function compactMoney(n: number, currency = 'USD'): string {
  const sym = currencySymbol(currency); const abs = Math.abs(n);
  const one = (x: number) => String(Math.round(x * 10) / 10);
  let body: string;
  if (abs >= 999_950_000) body = `${one(abs / 1e9)}B`;
  else if (abs >= 999_500) body = `${one(abs / 1e6)}M`;
  else if (abs >= 1_000) body = `${Math.round(abs / 1e3)}K`;
  else body = String(Math.round(abs));
  return `${n < 0 ? '-' : ''}${sym}${body}`;
}

function timelineFacts(p: Project): { value: string; label: string }[] {
  const days = shootDays(p.board).length;
  const scenes = p.board.scenes.length - parkedScenes(p.board).length;
  const sets = new Set(p.board.scenes.filter(s => !s.unit).map(s => s.set.trim()).filter(Boolean)).size;
  const cast = p.board.castList.length;
  const cash = topSheet(p).cashBudget;
  const out: { value: string; label: string }[] = [];
  if (days > 0) out.push({ value: String(days), label: days === 1 ? 'shoot day' : 'shoot days' });
  if (scenes > 0) out.push({ value: String(scenes), label: scenes === 1 ? 'scene' : 'scenes' });
  if (sets > 0) out.push({ value: String(sets), label: sets === 1 ? 'set' : 'sets' });
  if (cast > 0) out.push({ value: String(cast), label: cast === 1 ? 'speaking part' : 'speaking parts' });
  if (cash > 0) out.push({ value: compactMoney(cash, p.currency), label: 'cash budget' });
  return out;
}

/** Milestones the project itself holds: the California application round (when the credit is on) and the shoot. */
function derivedMilestones(p: Project): DeckMilestone[] {
  const out: DeckMilestone[] = [];
  // letterFor, not incentiveReport().window: the window there depends on today's date, and a deck must not
  const round = p.incentives?.ca?.enabled ? letterFor(p.incentives.startDate) : null;
  if (round) out.push({ id: 'ca-window', when: round.apply, what: 'California tax credit application window' });
  const dated = [...shootDates(p.board, withCalendar(p).calendar!).values()].filter(Boolean).sort();
  if (dated.length) {
    const when = dateSpan(dated[0], dated[dated.length - 1]);
    if (when) out.push({ id: 'shoot', when, what: 'Principal photography' });
  }
  return out;
}

function modelSteps(p: Project): { label: string; title: string; body: string }[] {
  const w = p.waterfall; const n = p.participants.length;
  const inv = pc(100 - w.poolPct), pool = pc(w.poolPct), recoup = pc(w.recoupPct);
  const steps: { label: string; title: string; body: string }[] = [];
  if (w.model === 'off-the-gross') {
    steps.push({ label: 'From dollar one', title: `${pc(100 - w.grossSharePct)}¢ to investors, ${pc(w.grossSharePct)}¢ to the pool`, body: `Of every dollar the film earns, until investors have ${recoup}% of their investment back.` });
  } else {
    steps.push({ label: 'First', title: `Investors recoup ${recoup}%`, body: `Every dollar the film earns goes to investors until they have ${recoup}% of their investment back.` });
  }
  steps.push({ label: `After ${recoup}%`, title: `${inv}% to investors, ${pool}% to the pool`, body: 'Of everything the film earns from then on.' });
  if (n > 0) steps.push({ label: 'The pool', title: people(n), body: 'The cast and crew who make the film share the pool by their points.' });
  return steps;
}

function numbersNote(p: Project): string {
  const pitch = withPitch(p).pitch!; const deferred = topSheet(p).deferredTotal;
  const fee = `Sales and distribution fees and expenses of ${pc(pitch.feePct)}% come off the top of every case.`;
  return deferred > 0 ? `${fee} Deferred pay of ${compactMoney(deferred, p.currency)} is paid first, before the split.` : fee;
}

export const ASK_WITH_GRANTS = 'We are raising {investors} from investors. Grants and fiscal sponsorship cover another {grants} of the budget, and that money is never repaid.';
export const ASK_NO_GRANTS = 'We are raising {investors} from investors.';
export const ASK_WITHOUT_GRANTS = 'We are raising {investors} from investors. That is the whole raise if no grant comes in; the {grants} we are applying for would come off it.';

// ---------- specs → contract ----------

const text = (s: unknown): string => (typeof s === 'string' ? s : typeof s === 'number' && Number.isFinite(s) ? String(s) : '').trim();
const LAYOUTS: ReadonlySet<string> = new Set(['cover', 'photo', 'text', 'cards', 'stats', 'timeline', 'comps', 'team', 'model', 'ways', 'numbers', 'ask', 'closing']);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isObj) : []);
const lines = (x: unknown): string[] => (Array.isArray(x) ? x.map(text).filter(Boolean) : []);

/** Link endings the deck reads as "which ask first", so nobody's own link can use them. */
export function reservedSlug(slug: string): boolean {
  return /^(with|without)(-grants)?$/.test(slug) || /-(with|without)$/.test(slug);
}

/**
 * A slide as typed, made safe to read: a hand-edited or newer project file can carry a layout this build does not know,
 * a missing list or a number where text belongs. Unknown layouts and slides without an id are dropped; everything else is
 * coerced to the shapes below, so nothing after this has to check again.
 */
function cleanSpec(raw: unknown): SlideSpec | null {
  if (!isObj(raw)) return null;
  const id = text(raw.id), layout = text(raw.layout);
  if (!id || !LAYOUTS.has(layout)) return null;
  const s: SlideSpec = { id, layout: layout as SlideSpec['layout'] };
  for (const k of ['eyebrow', 'headline', 'punch', 'body', 'imageId', 'closing', 'footnote', 'byline', 'nextStep', 'contact'] as const) { const v = text(raw[k]); if (v) s[k] = v; }
  if (typeof raw.scrim === 'number') s.scrim = raw.scrim;
  if (raw.hidden === true) s.hidden = true;
  const cards = list(raw.cards).map((c, i) => ({ id: text(c.id) || `card${i + 1}`, kicker: text(c.kicker), title: text(c.title), body: text(c.body), footnote: text(c.footnote) }));
  if (cards.length) s.cards = cards;
  const stats = list(raw.stats).map((x, i) => ({ id: text(x.id) || `stat${i + 1}`, value: text(x.value), label: text(x.label), source: text(x.source) }));
  if (stats.length) s.stats = stats;
  const ms = list(raw.milestones).map((m, i) => ({ id: text(m.id) || `m${i + 1}`, when: text(m.when), what: text(m.what) }));
  if (ms.length) s.milestones = ms;
  if (isObj(raw.lead)) s.lead = { value: text(raw.lead.value), text: text(raw.lead.text), source: text(raw.lead.source) };
  if (isObj(raw.quote)) s.quote = { text: text(raw.quote.text), by: text(raw.quote.by) };
  const cols = list(raw.columns).map(c => ({ label: text(c.label), lines: lines(c.lines) })).filter(c => c.label || c.lines.length);
  if (cols.length) s.columns = cols;
  if (isObj(raw.aside)) { const a = { title: text(raw.aside.title), lines: lines(raw.aside.lines), footnote: text(raw.aside.footnote) }; if (a.title || a.lines.length) s.aside = a.footnote ? a : { title: a.title, lines: a.lines }; }
  return s;
}
const cleanSlides = (p: Project): SlideSpec[] => slidesOf(p).map(cleanSpec).filter((s): s is SlideSpec => !!s);
const cardsOf = (cards: SlideCard[] | undefined): DeckCard[] => (cards ?? []).map(c => {
  const out: DeckCard = { id: c.id, title: c.title ?? '', body: c.body ?? '' };
  if (text(c.kicker)) out.kicker = c.kicker!.trim();
  if (text(c.footnote)) out.footnote = c.footnote!.trim();
  return out;
});
const sourced = (x: { source?: unknown } | undefined): boolean => !!x && !!text(x.source);

function slideOf(p: Project, s: SlideSpec, pictures: Map<string, LookImage>): DeckSlide {
  const pitch = p.pitch!;
  const base: { id: string; eyebrow?: string; headline?: string; punch?: string; imageId?: string; scrim?: number; footnote?: string } = { id: s.id };
  if (text(s.eyebrow)) base.eyebrow = s.eyebrow!.trim();
  if (text(s.headline)) base.headline = s.headline!.trim();
  if (text(s.punch)) base.punch = s.punch!.trim();
  if (s.imageId && pictures.has(s.imageId)) base.imageId = s.imageId;   // an id that matches no picture is dropped, and warned about
  if (typeof s.scrim === 'number' && Number.isFinite(s.scrim)) base.scrim = Math.max(0, Math.min(1, s.scrim));
  if (text(s.footnote)) base.footnote = s.footnote!.trim();
  const body = text(s.body), closing = text(s.closing);

  switch (s.layout) {
    case 'cover': {
      const first = firstSentence(pitch.logline);
      return { ...base, layout: 'cover', title: p.name, tagline: first.length <= TAGLINE_MAX ? first : '', byline: (s.byline ?? '').trim() };
    }
    case 'photo': return { ...base, layout: 'photo', body };
    case 'text': return { ...base, layout: 'text', body, ...(s.columns?.length ? { aside: s.columns.map(c => ({ label: c.label, lines: [...c.lines] })) } : {}), ...(closing ? { closing } : {}) };
    case 'cards': return { ...base, layout: 'cards', cards: cardsOf(s.cards) };
    case 'ways': return { ...base, layout: 'ways', cards: cardsOf(s.cards) };
    case 'stats': {
      const stats: DeckStat[] = (s.stats ?? []).filter(sourced).map(x => ({ id: x.id, value: x.value ?? '', label: x.label ?? '', source: x.source.trim() }));
      return { ...base, layout: 'stats',
        ...(sourced(s.lead) ? { lead: { value: s.lead!.value ?? '', text: s.lead!.text ?? '', source: s.lead!.source.trim() } } : {}),
        ...(body ? { body } : {}), stats,
        ...(s.quote && text(s.quote.text) ? { quote: { text: s.quote.text.trim(), by: text(s.quote.by) } } : {}),
        ...(closing ? { note: closing } : {}) };
    }
    case 'timeline': {
      const own = (s.milestones ?? []).filter(m => text(m.when) || text(m.what)).map(m => ({ id: m.id, when: text(m.when), what: text(m.what) }));
      return { ...base, layout: 'timeline', facts: timelineFacts(p), milestones: own.length ? own : derivedMilestones(p), ...(closing ? { note: closing } : {}) };
    }
    case 'comps': {
      const bars = pitch.comps.map(c => ({ c, m: compMultiple(c) })).filter((x): x is { c: typeof x.c; m: number } => x.m != null)
        .sort((x, y) => y.m - x.m).slice(0, 6)
        .map(({ c, m }) => ({ label: c.title, value: m, ...(text(c.year) ? { note: c.year.trim() } : {}) }));
      const groups = compGroups(pitch.comps).map(g => ({ group: g.group, rows: g.comps.map(c => ({ title: c.title, year: c.year, multiple: compMultiple(c) })) }));
      const callout = closing || body;
      return { ...base, layout: 'comps', bars, barsLabel: 'Worldwide gross over budget', groups, ...(callout ? { callout } : {}) };
    }
    case 'team': return { ...base, layout: 'team', members: (pitch.team ?? []).filter(t => t.name.trim()).map(t => ({ name: t.name.trim(), role: t.role ?? '', bio: t.bio ?? '' })), ...(s.aside ? { aside: { title: s.aside.title, lines: [...s.aside.lines], ...(s.aside.footnote ? { footnote: s.aside.footnote } : {}) } } : {}) };
    case 'model': return { ...base, layout: 'model', body, steps: modelSteps(p), ...(closing ? { closing } : {}) };
    case 'numbers': return { ...base, layout: 'numbers', body, caseNote: closing || numbersNote(p) };
    case 'ask': {
      const grants = sponsorNet(p.waterfall) > 0;   // with no grants in the project there is nothing for {grants} to say
      return { ...base, layout: 'ask', withGrants: body || (grants ? ASK_WITH_GRANTS : ASK_NO_GRANTS), withoutGrants: body || (grants ? ASK_WITHOUT_GRANTS : ASK_NO_GRANTS), nextStep: (s.nextStep ?? '').trim(), contact: (s.contact ?? '').trim() };
    }
    case 'closing': return { ...base, layout: 'closing', title: p.name };
  }
}

function recipientsOf(all: Recipient[] | undefined): DeckRecipient[] {
  const seen = new Set<string>(); const out: DeckRecipient[] = [];
  for (const r of (Array.isArray(all) ? all : []).filter(x => !!x && typeof x === 'object')) {
    const slug = slugify(text(r.slug));
    if (!slug || seen.has(slug) || reservedSlug(slug)) continue;   // no link ending, one already taken (the first wins), or one the deck reads as a switch
    seen.add(slug);
    const rec: DeckRecipient = { slug, name: text(r.name), coverLine: text(r.coverLine), lead: r.lead === 'without-grants' ? 'without-grants' : 'with-grants' };
    if (text(r.note)) rec.note = text(r.note);
    if (text(r.highlightCardId)) rec.highlightCardId = text(r.highlightCardId);
    out.push(rec);
  }
  return out;
}

function coverLineOf(today?: string): string {
  const x = today ? parts(today) : null;
  return x ? `Investor deck. ${MONTHS[x.m - 1]} ${x.y}.` : 'Investor deck.';
}

/** The money behind the numbers slide. A case nobody typed receipts for is left out, so the deck never shows a row of zeros. */
function pathsOf(p: Project): DeckData['paths'] {
  const x = pathInputs(p);
  return { ...x, cases: x.cases.filter(c => c.gross > 0) };
}

/** The deck as the runtime reads it. */
export function deckData(p0: Project, opts: DeckDataOptions = {}): DeckData {
  const p = withPitch(p0); const pitch = p.pitch!;
  const pictures = new Map((pitch.lookbook ?? []).filter(i => i.dataUrl).map(i => [i.id, i] as const));
  const slides = cleanSlides(p).filter(s => !s.hidden).map(s => slideOf(p, s, pictures));
  const usedIds = new Set(slides.map(s => s.imageId).filter((id): id is string => !!id));
  const images: DeckImage[] = [...pictures.values()].filter(i => usedIds.has(i.id)).map(i => ({ id: i.id, src: i.dataUrl, alt: i.caption.trim() || 'Look book picture' }));
  const data: DeckData = {
    version: DECK_DATA_VERSION,
    film: p.name,
    coverLine: coverLineOf(opts.today),
    theme: themeOf(p),
    images,
    slides,
    recipients: recipientsOf(pitch.recipients),
    paths: pathsOf(p),
    currency: p.currency,
    legal: DECK_LEGAL,
  };
  return JSON.parse(JSON.stringify(data)) as DeckData;   // plain JSON, whatever a hand-edited project file carried in
}

/** What the author should fix, one entry per problem. A recipient's problems carry `recipient:<id>` as the slide id. */
export function deckWarnings(p0: Project): { slideId: string; message: string }[] {
  const p = withPitch(p0); const pitch = p.pitch!;
  const ids = new Set((pitch.lookbook ?? []).map(i => i.id));
  const out: { slideId: string; message: string }[] = [];
  const typed = slidesOf(p);
  const clean = typed.map(cleanSpec);
  const dropped = clean.filter(s => !s).length;
  if (dropped) out.push({ slideId: 'deck', message: `${dropped} slide${dropped === 1 ? ' is' : 's are'} of a kind this version does not know, and ${dropped === 1 ? 'is' : 'are'} left off the deck.` });
  const paths = pathInputs(p);
  for (const s of clean) {
    if (!s || s.hidden) continue;
    if (s.layout === 'numbers' && !paths.cases.some(c => c.gross > 0)) out.push({ slideId: s.id, message: 'No revenue cases are typed yet, so this slide shows what investors fund but not what comes back. Add low, mid and high receipts under Revenue.' });
    if ((s.layout === 'numbers' || s.layout === 'ask') && paths.cashBudget > 0 && pathFor(paths).investors <= 0) out.push({ slideId: s.id, message: 'Grants, credits and perks already cover the whole budget, so this slide asks investors for nothing. Check the amounts under Deal.' });
    if (s.layout === 'stats') {
      if (s.lead && !sourced(s.lead)) out.push({ slideId: s.id, message: `The lead number${text(s.lead.value) ? ` "${s.lead.value.trim()}"` : ''} has no source, so it is left off the deck.` });
      for (const x of s.stats ?? []) if (!sourced(x)) out.push({ slideId: s.id, message: `The stat${text(x.value) ? ` "${x.value.trim()}"` : ''} has no source, so it is left off the deck.` });
    }
    if ((s.layout === 'cards' || s.layout === 'ways') && (s.cards?.length ?? 0) > MAX_CARDS) out.push({ slideId: s.id, message: `This slide has ${s.cards!.length} cards; a slide holds ${MAX_CARDS} at most.` });
    if (s.imageId && !ids.has(s.imageId)) out.push({ slideId: s.id, message: 'The picture chosen for this slide is no longer in the look book.' });
  }
  const seen = new Set<string>();
  for (const r of (Array.isArray(pitch.recipients) ? pitch.recipients : []).filter(x => !!x && typeof x === 'object')) {
    const slug = slugify(text(r.slug)); const who = text(r.name) || 'A recipient';
    if (slug && reservedSlug(slug)) out.push({ slideId: `recipient:${r.id}`, message: `${who}'s link ending "${slug}" is one the deck reads as a switch (with, without). Pick another, or they get no link.` });
    else if (!slug) out.push({ slideId: `recipient:${r.id}`, message: `${who} has no link ending, so there is no deck link for them.` });
    else if (seen.has(slug)) out.push({ slideId: `recipient:${r.id}`, message: `${who} has the same link ending as someone else ("${slug}"); only the first one gets it.` });
    else seen.add(slug);
  }
  return out;
}
