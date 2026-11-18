// Editing the authored pitch deck: the slide list (add, move, copy, hide, delete), a slide's lists (cards, stats,
// milestones), and the people the deck is sent to. Pure functions over plain data, so the Pitch tab only has to call
// them and every rule is tested without a browser. Ids are made from the ids already there: no clock, no dice.
import type { FontFile, PitchDesign, Recipient, SlideCard, SlideLayout, SlideSpec } from './types';
import { cleanFamily } from '../deck-runtime/fonts';
import { cleanMotion } from '../deck-runtime/motion';
import { cleanSlidePaper, cleanSlidePaperShade, PAPER_LAYOUTS } from '../deck-runtime/paper';
import { MAX_CARDS, reservedSlug, slugify } from './deckData';

/** The thirteen layouts, in the order a deck usually runs, each with a name and a line on what it is for. */
export const LAYOUTS: { id: SlideLayout; name: string; about: string }[] = [
  { id: 'cover', name: 'Cover', about: 'The title, a line for who the deck is for, and who made the film.' },
  { id: 'photo', name: 'Picture and a line', about: 'One picture, a headline and a short paragraph.' },
  { id: 'text', name: 'Words', about: 'A headline and a few paragraphs, with small labelled columns under them if you want.' },
  { id: 'cards', name: 'Cards', about: 'Two to four cards in a row: findings, reasons, steps.' },
  { id: 'stats', name: 'Proof (numbers and a quote)', about: 'One big number, a few smaller ones and a quote. Every number needs its source.' },
  { id: 'comps', name: 'Comparable films', about: 'Bars and a table drawn from the Comparable films list.' },
  { id: 'team', name: 'Team', about: 'The people in the Team list, with a card beside them for who else is attached.' },
  { id: 'timeline', name: 'Plan', about: 'Shoot days, scenes, cast and budget from the project, and your milestones in order.' },
  { id: 'model', name: 'How the money flows', about: 'Who gets paid, and in what order: investors, then the cast and crew pool.' },
  { id: 'ways', name: 'Ways to take part', about: 'A card for each way in: invest, give. One can be highlighted for each person you send it to.' },
  { id: 'numbers', name: 'The money', about: 'What investors fund and what comes back, with a switch for each funding source.' },
  { id: 'ask', name: 'The ask', about: 'What you are raising, the next step and how to reach you.' },
  { id: 'closing', name: 'Closing', about: 'The title once more, over a picture, with your sign-off.' },
];
/** The papers a slide's cards can be drawn on, as the slide editor lists them: the deck's own first, a mix last. */
export const PAPER_CHOICES: { id: '' | NonNullable<SlideSpec['paper']>; name: string }[] = [
  { id: '', name: 'Deck default' }, { id: 'plain', name: 'Plain' }, { id: 'postcard', name: 'Postcard' }, { id: 'letter', name: 'Letter' },
  { id: 'notebook', name: 'Notebook' }, { id: 'torn', name: 'Torn page' }, { id: 'mixed', name: 'A mix' },
];
/** The papers a deck can use for every card, each with a line on what it looks like. */
export const PAPERS: { id: NonNullable<PitchDesign['paper']>; name: string; about: string }[] = [
  { id: 'plain', name: 'Plain', about: 'A flat card in the card colour.' },
  { id: 'postcard', name: 'Postcard', about: 'The back of a postcard: a stamp, a postmark and lines for an address.' },
  { id: 'letter', name: 'Letter', about: 'Old letter paper, folded in three.' },
  { id: 'notebook', name: 'Notebook', about: 'A ruled page from a small pad, with punched holes and a margin.' },
  { id: 'torn', name: 'Torn page', about: 'A ruled page torn off along the top.' },
];
/** The shades a deck's papers come in, each with a line on what it looks like. 'theme' is the design system's own card colour. */
export const SHADES: { id: NonNullable<PitchDesign['paperShade']>; name: string; about: string }[] = [
  { id: 'theme', name: 'From my design', about: 'The card colour of your design system.' },
  { id: 'white', name: 'White', about: 'Clean, bright stationery.' },
  { id: 'cream', name: 'Cream', about: 'Warm new paper, the colour of cream.' },
  { id: 'aged', name: 'Aged', about: 'Yellowed old paper: browner toward the edges, with spots, stains and worn creases.' },
  { id: 'kraft', name: 'Kraft', about: 'Brown parcel paper.' },
  { id: 'newsprint', name: 'Newsprint', about: 'Cool grey paper, a little yellow at the edges.' },
];
/** The shades a slide's papers can be drawn in, as the slide editor lists them: the deck's own first. */
export const SHADE_CHOICES: { id: '' | NonNullable<SlideSpec['paperShade']>; name: string }[] = [{ id: '', name: 'Deck default' }, ...SHADES.map(s => ({ id: s.id, name: s.name }))];
/** Whether a slide of this layout draws a card, so has a paper to choose. */
export const hasPaper = (layout: string): boolean => PAPER_LAYOUTS.includes(layout);

/** Layouts whose main content is worked out from the budget, the schedule and the deal, not typed on the slide. */
export const FROM_BUDGET: ReadonlySet<SlideLayout> = new Set<SlideLayout>(['timeline', 'model', 'numbers']);
export const layoutName = (id: string): string => LAYOUTS.find(l => l.id === id)?.name ?? 'Unknown layout';

/** What a slide is called in the list: its headline, else its eyebrow, else nothing (the layout's name stands alone). */
export const slideLabel = (s: SlideSpec): string => str(s?.headline).trim() || str(s?.eyebrow).trim();

/** An id without the counter a copy was given: `ways-3` → `ways`. */
const stem = (id: string): string => id.replace(/-\d+$/, '');

/** `base` if nobody has it, else `base-2`, `base-3`, …: the first that is free. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken); const stem = base || 'id';
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) { const id = `${stem}-${n}`; if (!used.has(id)) return id; }
}

// ---------- reading what a project file holds ----------
// A hand-edited file, or one from a newer version, can hold anything in these lists. Every function below reads
// through these, so nothing has to check again and nothing throws.

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : '');
const objs = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isObj) : []);
const hasId = (x: unknown): x is SlideSpec => isObj(x) && typeof x.id === 'string' && x.id !== '';
/** The slides that can be worked on at all: anything with an id. The same list back when every entry is one (so a
 *  caller can tell that nothing changed); a list with nonsense in it comes back without the nonsense. */
const slidesOrEmpty = (slides: unknown): SlideSpec[] => (!Array.isArray(slides) ? [] : slides.every(hasId) ? (slides as SlideSpec[]) : slides.filter(hasId));
const cardIds = (slides: SlideSpec[]): string[] => slides.flatMap(s => objs(s.cards).map(c => str(c.id)).filter(Boolean));
const KNOWN: ReadonlySet<string> = new Set(LAYOUTS.map(l => l.id));

/** The slides as the editor shows them: only layouts this version knows, every field the right shape (text as text,
 *  lists as lists of things with ids), and nothing trimmed, so what is being typed stays as typed. Slides it leaves
 *  out are still in the project; `deckWarnings` says how many. */
export function readSlides(raw: unknown): SlideSpec[] {
  const out: SlideSpec[] = []; const seen = new Set<string>();
  for (const r of slidesOrEmpty(raw) as unknown as Record<string, unknown>[]) {
    const id = str(r.id), layout = str(r.layout);
    if (!KNOWN.has(layout) || seen.has(id)) continue;
    seen.add(id);
    const s: SlideSpec = { id, layout: layout as SlideLayout };
    for (const k of ['eyebrow', 'headline', 'punch', 'body', 'imageId', 'closing', 'footnote', 'byline', 'nextStep', 'contact'] as const) { const v = str(r[k]); if (v) s[k] = v; }
    if (typeof r.scrim === 'number' && Number.isFinite(r.scrim)) s.scrim = Math.max(0, Math.min(1, r.scrim));
    if (r.hidden === true) s.hidden = true;
    const motion = cleanMotion(r.motion, layout);
    if (motion) s.motion = motion;
    const paper = cleanSlidePaper(r.paper);
    if (paper) s.paper = paper;
    const shade = cleanSlidePaperShade(r.paperShade);
    if (shade) s.paperShade = shade;
    const ided = <T extends { id: string }>(items: T[], stem: string): T[] => { const used: string[] = []; return items.map(x => { const own = x.id && !used.includes(x.id) ? x.id : uniqueId(stem, used); used.push(own); return { ...x, id: own }; }); };
    const cards = ided(objs(r.cards).map(c => ({ id: str(c.id), kicker: str(c.kicker), title: str(c.title), body: str(c.body), footnote: str(c.footnote) })), 'card');
    if (cards.length) s.cards = cards;
    const stats = ided(objs(r.stats).map(x => ({ id: str(x.id), value: str(x.value), label: str(x.label), source: str(x.source) })), 'stat');
    if (stats.length) s.stats = stats;
    const ms = ided(objs(r.milestones).map(m => ({ id: str(m.id), when: str(m.when), what: str(m.what) })), 'ms');
    if (ms.length) s.milestones = ms;
    if (isObj(r.lead)) s.lead = { value: str(r.lead.value), text: str(r.lead.text), source: str(r.lead.source) };
    if (isObj(r.quote)) s.quote = { text: str(r.quote.text), by: str(r.quote.by) };
    const cols = objs(r.columns).map(c => ({ label: str(c.label), lines: Array.isArray(c.lines) ? c.lines.map(str) : [] }));
    if (cols.length) s.columns = cols;
    if (isObj(r.aside)) { const a = r.aside; s.aside = { title: str(a.title), lines: Array.isArray(a.lines) ? a.lines.map(str) : [], ...(str(a.footnote) ? { footnote: str(a.footnote) } : {}) }; }
    out.push(s);
  }
  return out;
}

/** The people the deck is sent to, as the editor shows them: every entry a person with an id of their own. */
export function readRecipients(raw: unknown): Recipient[] {
  const used: string[] = [];
  return objs(raw).map(r => {
    const id = str(r.id) && !used.includes(str(r.id)) ? str(r.id) : uniqueId('to', used);
    used.push(id);
    const out: Recipient = { id, slug: str(r.slug), name: str(r.name), coverLine: str(r.coverLine), lead: r.lead === 'without-grants' ? 'without-grants' : 'with-grants' };
    if (str(r.note)) out.note = str(r.note);
    if (str(r.highlightCardId)) out.highlightCardId = str(r.highlightCardId);
    return out;
  });
}

/** The font files a design holds that are files at all: an id, a role, a name and an address, each the right kind of thing. */
export function readFontFiles(raw: unknown): FontFile[] {
  const seen = new Set<string>();
  return objs(raw).filter(f => typeof f.id === 'string' && f.id && (f.role === 'title' || f.role === 'body') && !seen.has(f.role as string) && !!seen.add(f.role as string))
    .map(f => ({ id: f.id as string, role: f.role as FontFile['role'], family: str(f.family), dataUrl: str(f.dataUrl), embedOk: f.embedOk === true }));
}

/** A fresh slide of a layout, with an id nobody in `slides` has. */
export function newSlide(layout: SlideLayout, slides: SlideSpec[] = []): SlideSpec {
  const s: SlideSpec = { id: uniqueId(layout, slides.map(x => x.id)), layout };
  if (layout === 'cards' || layout === 'ways') s.cards = [{ id: uniqueId('card', cardIds(slides)), title: '', body: '' }];
  return s;
}

/** The list with a new slide of `layout` put after the slide `afterId` (at the end when there is none). */
export function addSlide(slides0: unknown, layout: SlideLayout, afterId?: string): { slides: SlideSpec[]; id: string } {
  const slides = slidesOrEmpty(slides0); const s = newSlide(layout, slides);
  const at = afterId ? slides.findIndex(x => x.id === afterId) : -1;
  const out = slides.slice(); out.splice(at < 0 ? out.length : at + 1, 0, s);
  return { slides: out, id: s.id };
}

/** The slide moved to position `to` (0 is first); out-of-range positions are clamped. The same list back when nothing moves. */
export function moveSlideTo(slides0: unknown, id: string, to: number): SlideSpec[] {
  const slides = slidesOrEmpty(slides0); const from = slides.findIndex(s => s.id === id);
  if (from < 0) return slides;
  const at = Math.max(0, Math.min(slides.length - 1, Math.round(to) || 0));
  if (at === from) return slides;
  const out = slides.slice(); const [s] = out.splice(from, 1); out.splice(at, 0, s);
  return out;
}
/** One place earlier (-1) or later (1). */
export function moveSlide(slides0: unknown, id: string, dir: -1 | 1): SlideSpec[] {
  const slides = slidesOrEmpty(slides0); const from = slides.findIndex(s => s.id === id);
  return from < 0 ? slides : moveSlideTo(slides, id, from + dir);
}

/** A copy of the slide right after it. The copy has an id of its own, and so does each of its cards (a recipient's
 *  highlighted card is found by id, so two cards may never share one). */
export function duplicateSlide(slides0: unknown, id: string): { slides: SlideSpec[]; id: string | null } {
  const slides = slidesOrEmpty(slides0); const at = slides.findIndex(s => s.id === id);
  if (at < 0) return { slides, id: null };
  const copy = JSON.parse(JSON.stringify(slides[at])) as SlideSpec;
  copy.id = uniqueId(stem(slides[at].id), slides.map(s => s.id));   // a copy of `ways-2` is `ways-3`, not `ways-2-2`
  if (Array.isArray(copy.cards)) { const used = cardIds(slides); copy.cards = objs(copy.cards).map(c => { const cid = uniqueId(stem(str(c.id)) || 'card', used); used.push(cid); return { ...(c as unknown as SlideCard), id: cid }; }); }
  const out = slides.slice(); out.splice(at + 1, 0, copy);
  return { slides: out, id: copy.id };
}

/** Hidden slides stay in the list and are left off the deck. */
export function setSlideHidden(slides0: unknown, id: string, hidden: boolean): SlideSpec[] {
  return slidesOrEmpty(slides0).map(s => {
    if (s.id !== id) return s;
    const { hidden: _h, ...rest } = s;
    return hidden ? { ...rest, hidden: true } : rest;
  });
}
/** The list without the slide. The last slide stays: a deck with no slides is the automatic draft again, which is
 *  not what Delete says it does. */
export function deleteSlide(slides0: unknown, id: string): SlideSpec[] {
  const slides = slidesOrEmpty(slides0);
  return slides.length <= 1 || !slides.some(s => s.id === id) ? slides : slides.filter(s => s.id !== id);
}

/** The slide to select once `id` has gone: the one after it, else the one before, else none. */
export function neighbourId(slides0: unknown, id: string): string | null {
  const slides = slidesOrEmpty(slides0); const at = slides.findIndex(s => s.id === id);
  if (at < 0) return slides[0]?.id ?? null;
  return (slides[at + 1] ?? slides[at - 1])?.id ?? null;
}

/** A slide with some fields changed. A text field set to nothing, an empty list, `undefined` or `hidden: false` is
 *  taken off the slide, so the saved file only carries what was typed. */
export function patchSlide(slides0: unknown, id: string, patch: Partial<SlideSpec>): SlideSpec[] {
  return slidesOrEmpty(slides0).map(s => {
    if (s.id !== id) return s;
    const out: Record<string, unknown> = { ...s, ...patch, id: s.id, layout: s.layout };
    for (const k of Object.keys(patch)) { const v = out[k]; if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete out[k]; }
    if (out.hidden !== true) delete out.hidden;   // a slide is hidden or it is not: `hidden: false` is never stored
    return out as unknown as SlideSpec;
  });
}

// ---------- a slide's own lists ----------

/** The item at `index` moved one place earlier (-1) or later (1); the same list back when it cannot move. */
export function moveItem<T>(items: T[], index: number, dir: -1 | 1): T[] {
  if (!Array.isArray(items)) return [];
  const to = index + dir;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
  const out = items.slice(); [out[index], out[to]] = [out[to], out[index]];
  return out;
}
/** A slide's cards with one more, if there is room (a slide holds four). The new card's id is free across the whole deck. */
export function addCard(slides0: unknown, slideId: string): SlideSpec[] {
  const slides = slidesOrEmpty(slides0);
  return slides.map(s => {
    const have = objs(s.cards) as unknown as SlideCard[];
    if (s.id !== slideId || have.length >= MAX_CARDS) return s;
    const card: SlideCard = { id: uniqueId('card', cardIds(slides)), title: '', body: '' };
    return { ...s, cards: [...have, card] };
  });
}
/** An id for a new item in a list of things with ids (stats, milestones): `stem`, `stem-2`, … */
export const nextItemId = (stem: string, items: { id: string }[] | undefined): string => uniqueId(stem, objs(items).map(i => str(i.id)));

// ---------- recipients ----------

export type LinkProblem = '' | 'empty' | 'taken' | 'reserved';
/** What is wrong with a link ending as typed, if anything. `others` are everyone else's endings as typed. The ending
 *  is read the way the deck reads it: lower case, letters, digits and hyphens. */
export function linkEndingProblem(typed: string, others: string[]): LinkProblem {
  const slug = slugify(str(typed));
  if (!slug) return 'empty';
  if (reservedSlug(slug)) return 'reserved';
  if ((Array.isArray(others) ? others : []).some(o => slugify(str(o)) === slug)) return 'taken';
  return '';
}
/** The problem in words, for the page. */
export function linkProblemText(problem: LinkProblem, typed: string): string {
  const slug = slugify(str(typed));
  if (problem === 'empty') return 'Type a link ending: letters, digits and hyphens. Without one there is no link for this person.';
  if (problem === 'reserved') return `This ending is reserved. Try another, such as ${slug}-film.`;
  if (problem === 'taken') return `Someone else already has "${slug}". Each person needs an ending of their own.`;
  return '';
}

/** A link ending to start from: the first two words of the name ("Placeholder Capital Partners Fund" →
 *  "placeholder-capital"), with "-film" added when that would be an ending the deck reserves. */
export function suggestEnding(name: string): string {
  const slug = slugify(str(name).trim().split(/\s+/).slice(0, 2).join(' '));
  return slug && reservedSlug(slug) ? `${slug}-film` : slug;
}

/** A new recipient with an id nobody has; they read the with-grants ask first, like the general deck. */
export function newRecipient(all: Recipient[] | undefined): Recipient {
  return { id: uniqueId('to', objs(all).map(r => str(r.id))), slug: '', name: '', coverLine: '', lead: 'with-grants' };
}
/** The recipient with a new name. Their link ending follows the name for as long as nobody has typed one of their own
 *  (it is empty, or still what the old name suggested). */
export function renameRecipient(r: Recipient, name: string): Recipient {
  const slug = str(r.slug), old = str(r.name);
  const follows = !slug.trim() || slug === suggestEnding(old) || slug === slugify(old);
  return { ...r, name, slug: follows ? suggestEnding(name) : slug };
}

/** The people who get a deck, as the deck itself decides it: a link ending of their own that is not reserved (of two
 *  with the same ending the first has it). `at` is their place in the list as typed. */
export function validRecipients(all: unknown): { id: string; at: number; slug: string; name: string; lead: Recipient['lead'] }[] {
  const out: { id: string; at: number; slug: string; name: string; lead: Recipient['lead'] }[] = []; const seen = new Set<string>();
  readRecipients(all).forEach((r, at) => {
    const slug = slugify(r.slug);
    if (!slug || seen.has(slug) || reservedSlug(slug)) return;
    seen.add(slug);
    out.push({ id: r.id, at, slug, name: r.name.trim(), lead: r.lead });
  });
  return out;
}

/** The cards a recipient can have picked out: every card on a cards or ways slide that is on the deck, with the slide it is on. */
export function highlightChoices(slides: SlideSpec[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []; const seen = new Set<string>();
  for (const s of readSlides(slides)) {
    if (s.hidden || (s.layout !== 'ways' && s.layout !== 'cards')) continue;
    for (const c of (s.cards ?? []).slice(0, MAX_CARDS)) {
      const title = c.title.trim();
      if (!c.id || seen.has(c.id) || !(title || c.body.trim())) continue;
      seen.add(c.id);
      out.push({ id: c.id, label: `${title || 'Untitled card'} (${slideLabel(s) || layoutName(s.layout)})` });
    }
  }
  return out;
}

// ---------- font files ----------

export const FONT_WARN_BYTES = 1_500_000;    // above this a deck that carries the file is slow to send and open
export const FONT_MAX_BYTES = 10_000_000;    // above this the file is refused
/** What kind of font file these bytes are, by how the file starts: its MIME type, or null when it is not a font. */
export function fontMime(head: ArrayLike<number>): 'font/woff2' | 'font/woff' | 'font/otf' | 'font/ttf' | null {
  if (!head || head.length < 4) return null;
  const tag = String.fromCharCode(head[0], head[1], head[2], head[3]);
  if (tag === 'wOF2') return 'font/woff2';
  if (tag === 'wOFF') return 'font/woff';
  if (tag === 'OTTO') return 'font/otf';
  if (tag === 'true' || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0)) return 'font/ttf';
  return null;
}
const FILE_WORDS = /^(latin|ext|cyrillic|greek|vietnamese|normal|italic|oblique|regular|roman|thin|hairline|extralight|ultralight|light|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|variable|vf|wght|webfont|\d{3})$/i;
/** A family name to start from: the file's name without its ending, its weight, style and subset words, each word
 *  capitalised. "special-elite-latin-400-normal.woff2" → "Special Elite"; "Invented_Slab-Bold.woff2" → "Invented Slab". */
export function familyFromFileName(name: string): string {
  const words = cleanFamily(str(name).replace(/\.[A-Za-z0-9]+$/, '').replace(/[_.+-]+/g, ' ')).split(' ').filter(Boolean);
  const kept = words.filter(w => !FILE_WORDS.test(w));
  const use = kept.length ? kept : words;
  return use.map(w => (/[A-Z]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ') || 'My font';
}
/** "412 KB", "2.1 MB". */
export const fileSize = (bytes: number): string => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
/** How many bytes a base64 data URL holds. */
export function dataUrlBytes(dataUrl: string): number {
  if (typeof dataUrl !== 'string') return 0;
  const at = dataUrl.indexOf(','); if (at < 0) return 0;
  const b64 = dataUrl.length - at - 1; const pad = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(b64 * 3 / 4) - pad);
}
/** The font files with one put in for its role: a role holds one file, so the new one takes the old one's place. */
export function setFontFile(files: FontFile[] | undefined, file: FontFile): FontFile[] {
  return [...readFontFiles(files).filter(f => f.role !== file.role), file].sort((a, b) => (a.role === b.role ? 0 : a.role === 'title' ? -1 : 1));
}
