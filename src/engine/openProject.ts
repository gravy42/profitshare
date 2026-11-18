// The one door a project comes in through: a .json a filmmaker opens, or a project this browser saved earlier.
// checkProject() takes whatever JSON.parse gave back and answers with a project the app can draw, or with a reason a
// filmmaker can read. It never throws and never changes what it was given.
//
// Two kinds of trouble, two answers:
//   * the core a budget cannot exist without (lines, accounts, categories, fringes, people, tiers, waterfall, SAG
//     settings, the stripboard, shoot days, contingency) must be there and of the right basic type, down to each
//     line's numbers. Guessing at any of it would change the money, so the file is refused, with the reason.
//   * the parts that grew on later (deal terms, incentives, shoot locations, calendar, pitch, call sheets, notes) each
//     have defaults. One of those in a form that cannot be read is left out or set back to its default, the rest of
//     the file opens, and `repaired` names what was reset so the user can be told.
// Fields this version does not know are kept as they are: a newer ProfitShare may have written them.
import type { Board, Project } from './types';
import { defaultCalendar } from './calendar';
import { defaultCallSheets } from './callsheet';
import { defaultPitch } from './pitch';

export type ProjectCheck =
  | { ok: true; project: Project; repaired: string[] }
  | { ok: false; reason: string };

export const NOT_A_PROJECT = 'This file is not a ProfitShare project.';
export const NOT_JSON = 'This file cannot be read as a project. It may have been cut off.';
export const EMPTY_FILE = 'This file is empty.';
export const newerVersion = (v: number) => `This file was made by a newer version of ProfitShare (format ${v}). Reload this page to get the latest version, then open it again.`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
/** A copy with one key set, made so that a key named like something on Object.prototype is still plain data. */
const withKey = (o: Obj, k: string, v: unknown): Obj => { const c = { ...o }; Object.defineProperty(c, k, { value: v, enumerable: true, writable: true, configurable: true }); return c; };
const without = (o: Obj, k: string): Obj => { const c = { ...o }; delete c[k]; return c; };

// ---------- what a value may be ----------

type Test = (v: unknown) => boolean;
const str: Test = v => typeof v === 'string';
const num: Test = v => typeof v === 'number' && Number.isFinite(v);
const bool: Test = v => typeof v === 'boolean';
const numOrNull: Test = v => v === null || num(v);
const oneOf = (...xs: unknown[]): Test => v => xs.includes(v);
const listOf = (t: Test): Test => v => Array.isArray(v) && v.every(t);
const strs = listOf(str), nums = listOf(num);
const ymdStr: Test = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Keys that would read as something on every object (`constructor`, `toString`, `__proto__`): never a tag category or an id. */
const unsafeKey = (k: string) => k in Object.prototype;
const recordOf = (t: Test): Test => v => isObj(v) && Object.keys(v).every(k => t(v[k]));

/** How one field of a record is read.
 *  must: there, and of this type, or the record is no good.
 *  fill: of this type; left out (or null), it takes the default, which loses nothing.
 *  may:  optional; of the wrong type it is taken off and the record is kept. */
type Field = { test: Test; mode: 'must' } | { test: Test; mode: 'fill'; make: () => unknown } | { test: Test; mode: 'may' };
const must = (test: Test): Field => ({ test, mode: 'must' });
const fill = (test: Test, make: () => unknown): Field => ({ test, mode: 'fill', make });
const may = (test: Test): Field => ({ test, mode: 'may' });
const text = fill(str, () => '');
type Shape = Record<string, Field>;

type Read = { value: Obj; dropped: boolean } | { bad: string };
/** One record against its shape. The record itself comes back when nothing had to change. */
function readShape(raw: unknown, shape: Shape): Read {
  if (!isObj(raw)) return { bad: '' };
  let value = raw, dropped = false;
  for (const k of Object.keys(shape)) {
    const f = shape[k], v = own(raw, k);
    if (v !== undefined && f.test(v)) continue;
    if (f.mode === 'must') return { bad: k };
    if (f.mode === 'fill') { if (v != null) return { bad: k }; value = withKey(value, k, f.make()); continue; }
    if (v === undefined) continue;
    value = without(value, k);
    if (v !== null) dropped = true;   // a null where nothing was needed says the same as leaving it out
  }
  return { value, dropped };
}

/** A record keyed by names that came from the file, without the keys no object can safely carry and without the
 *  values that are not what they should be. The record itself comes back when it was clean. */
function cleanRecord(raw: Obj, t: Test): { value: Obj; dropped: boolean } {
  const keys = Object.keys(raw);
  const good = keys.filter(k => !unsafeKey(k) && t(raw[k]));
  if (good.length === keys.length) return { value: raw, dropped: false };
  const value: Obj = {};
  for (const k of good) value[k] = raw[k];
  return { value, dropped: true };
}

// ---------- the core: refused when it cannot be read ----------

const SECTIONS = oneOf('ATL', 'PRODUCTION', 'POST', 'OTHER');
const SAG_IDS = ['ULB', 'MLB', 'LBA', 'BASIC'];
const sceneCast: Test = v => isObj(v) && str(own(v, 'name')) && (own(v, 'id') == null || num(own(v, 'id')));
const boardElement: Test = v => isObj(v) && str(own(v, 'category')) && !unsafeKey(own(v, 'category') as string) && str(own(v, 'item'));   // a category is looked up by name on each scene

const CATEGORY: Shape = { number: must(str), name: text, section: must(SECTIONS) };
const ACCOUNT: Shape = { number: must(str), name: text, categoryNumber: must(str) };
const FRINGE: Shape = { id: must(str), name: text, rate: must(num), cap: may(numOrNull) };
const LINE: Shape = {
  id: must(str), accountId: must(str), description: text, amount: must(num), unit: text, rate: must(num), multiplier: must(num),
  fringes: fill(strs, () => []), tags: fill(strs, () => []), payType: must(oneOf('cash', 'deferred', 'points')),
  participantId: may(str), daysFrom: may(oneOf('board')), notes: may(str),
};
const PARTICIPANT: Shape = {
  id: must(str), name: text, role: text, group: must(str), tierId: must(str), days: must(num), bonusMultiplier: must(num),
  fixedPoints: may(num), castId: may(num), followsCastIds: may(nums), followsElements: may(listOf(boardElement)),
};
const TIER: Shape = { id: must(str), name: text, multiplier: must(num) };
const MAX_SCENARIOS = 50;     // revenue figures to price; each is a column on the Points tab, and thousands of them stall it
const WATERFALL: Shape = {
  model: must(oneOf('recoup-first', 'off-the-gross')), recoupPct: must(num), poolPct: must(num), grossSharePct: must(num), scenarios: must(v => nums(v) && (v as unknown[]).length <= MAX_SCENARIOS),
  nonRecoupable: may(num), sponsorFeePct: may(num),
};
const SAG: Shape = { targetTier: must(oneOf(...SAG_IDS)), dic: must(bool), includeContingency: must(bool) };
const CAST_MEMBER: Shape = { id: must(num), name: text };
const SCENE: Shape = {
  id: must(str), number: text, ie: text, set: text, tod: text, pages: text, eighths: must(num), synopsis: text, location: text, scriptDay: text,
  cast: fill(listOf(sceneCast), () => []), elements: fill(recordOf(strs), () => ({})),
  text: may(str), unit: may(oneOf('vfx', 'second', 'omit')),
};
const STRIPS: Record<string, Shape> = {
  scene: { sceneId: must(str), eighths: may(num) },
  daybreak: { id: must(str), label: may(str), date: may(str) },
  banner: { id: must(str), text },
};

/** Field names as a filmmaker would say them; any other becomes plain words (bonusMultiplier -> "bonus multiplier"). */
const SAID: Record<string, string> = {
  id: 'identifier', accountId: 'account number', categoryNumber: 'category number', tierId: 'points tier', sceneId: 'scene', payType: 'pay type',
  eighths: 'page count', tod: 'time of day', ie: 'interior or exterior', dic: 'Diversity in Casting setting', includeContingency: 'contingency setting',
  poolPct: 'pool percentage', recoupPct: 'recoup percentage', grossSharePct: 'gross share percentage', scenarios: 'revenue scenarios', fringes: 'list of fringes', tags: 'list of tags',
};
const words = (field: string) => (Object.prototype.hasOwnProperty.call(SAID, field) ? SAID[field] : field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
const unreadable = (what: string, at: number, field: string) =>
  `This project file has ${what} that cannot be read (number ${at + 1} in the file).${field ? ` The trouble is with its ${words(field)}.` : ''}`;

class Refused extends Error {}
const refuse = (reason: string): never => { throw new Refused(reason); };

interface Notes { repaired: Set<string> }

/** A list every item of which must be readable. The list itself comes back when no item had to change. */
function coreList(list: unknown[], shapeOf: (item: unknown) => Shape | null, what: string, detail: string, notes: Notes): unknown[] {
  let out = list;
  for (let i = 0; i < list.length; i++) {
    const shape = shapeOf(list[i]);
    const r: Read = shape ? readShape(list[i], shape) : { bad: '' };
    if ('bad' in r) return refuse(unreadable(what, i, r.bad));
    if (r.dropped) notes.repaired.add(detail);
    if (r.value !== list[i]) { if (out === list) out = list.slice(); out[i] = r.value; }
  }
  return out;
}

const CORE_LISTS: { key: string; missing: string; what: string; detail: string; shape: Shape }[] = [
  { key: 'lines', missing: 'budget lines', what: 'a budget line', detail: 'a detail on a budget line', shape: LINE },
  { key: 'accounts', missing: 'chart of accounts', what: 'an account', detail: 'a detail on an account', shape: ACCOUNT },
  { key: 'categories', missing: 'budget categories', what: 'a budget category', detail: 'a detail on a budget category', shape: CATEGORY },
  { key: 'fringes', missing: 'fringe rates', what: 'a fringe rate', detail: 'a detail on a fringe rate', shape: FRINGE },
  { key: 'participants', missing: 'points schedule', what: 'an entry on the points schedule', detail: 'a detail on a person in the points schedule', shape: PARTICIPANT },
  { key: 'tiers', missing: 'points tiers', what: 'a points tier', detail: 'a detail on a points tier', shape: TIER },
];
const CORE_PARTS: { key: string; missing: string; test: Test }[] = [
  ...CORE_LISTS.map(l => ({ key: l.key, missing: l.missing, test: Array.isArray as Test })),
  { key: 'waterfall', missing: 'waterfall terms', test: isObj },
  { key: 'sag', missing: 'SAG-AFTRA settings', test: isObj },
  { key: 'board', missing: 'stripboard', test: isObj },
  { key: 'shootDays', missing: 'number of shoot days', test: num },
  { key: 'contingencyPct', missing: 'contingency percentage', test: num },
];
const listed = (xs: string[]) => (xs.length <= 3 ? xs : [...xs.slice(0, 3), `${xs.length - 3} other part${xs.length - 3 === 1 ? '' : 's'}`])
  .reduce((s, x, i, all) => s + (i === 0 ? '' : i === all.length - 1 ? ' and ' : ', ') + x, '');

function readBoard(board: Obj, notes: Notes): Obj {
  const parts = [['scenes', 'scenes'], ['strips', 'strips'], ['castList', 'cast list']].filter(([k]) => !Array.isArray(own(board, k))).map(([, w]) => w);
  if (parts.length) return refuse(`This project file cannot be opened. Its stripboard is missing its ${listed(parts)}.`);
  if (!num(own(board, 'targetEighthsPerDay'))) return refuse('This project file cannot be opened. Its stripboard is missing its pages-per-day target.');
  let b = board;
  const setB = (k: string, v: unknown) => { if (v !== own(board, k)) b = withKey(b, k, v); };
  setB('castList', coreList(own(board, 'castList') as unknown[], () => CAST_MEMBER, 'a cast member on the stripboard', 'a detail on the cast list', notes));
  let scenes = coreList(own(board, 'scenes') as unknown[], () => SCENE, 'a scene on the stripboard', 'a detail on a scene', notes);
  for (let i = 0; i < scenes.length; i++) {
    // a tag category named like something every object has (`constructor`) would break the breakdowns: it goes
    const el = cleanRecord(own(scenes[i] as Obj, 'elements') as Obj, strs);
    if (!el.dropped) continue;
    notes.repaired.add('a tag on a scene');
    if (scenes === own(board, 'scenes')) scenes = scenes.slice();
    scenes[i] = withKey(scenes[i] as Obj, 'elements', el.value);
  }
  setB('scenes', scenes);
  const stripShape = (s: unknown): Shape | null => {
    const type = isObj(s) ? own(s, 'type') : undefined;
    return typeof type === 'string' && Object.prototype.hasOwnProperty.call(STRIPS, type) ? STRIPS[type] : null;
  };
  setB('strips', coreList(own(board, 'strips') as unknown[], stripShape, 'a strip on the stripboard', 'a detail on a strip', notes));
  return b;
}

function readCore(root: Obj, notes: Notes): Obj {
  const absent = CORE_PARTS.filter(c => own(root, c.key) == null).map(c => c.missing);
  if (absent.length) return refuse(`This project file is missing its ${listed(absent)}.`);
  const wrong = CORE_PARTS.filter(c => !c.test(own(root, c.key))).map(c => c.missing);
  if (wrong.length) return refuse(`This project file cannot be opened. ProfitShare could not read its ${listed(wrong)}.`);

  let p = root;
  const set = (k: string, v: unknown) => { if (v !== own(root, k)) p = withKey(p, k, v); };
  for (const k of ['name', 'version', 'currency']) {
    const v = own(root, k);
    if (v == null) set(k, k === 'currency' ? 'USD' : '');
    else if (!str(v)) return refuse(`This project file cannot be opened. ProfitShare could not read its ${k === 'name' ? 'project name' : k === 'version' ? 'version label' : k}.`);
  }
  for (const l of CORE_LISTS) set(l.key, coreList(own(root, l.key) as unknown[], () => l.shape, l.what, l.detail, notes));

  const single = (k: string, shape: Shape, what: string) => {
    const r = readShape(own(root, k), shape);
    if ('bad' in r) return refuse(`This project file cannot be opened. ProfitShare could not read its ${what}${r.bad ? ` (the trouble is with the ${words(r.bad)})` : ''}.`);
    if (r.dropped) notes.repaired.add(`a detail in the ${what}`);
    set(k, r.value);
  };
  single('waterfall', WATERFALL, 'waterfall terms');
  single('sag', SAG, 'SAG-AFTRA settings');

  set('board', readBoard(own(root, 'board') as Obj, notes));
  return p;
}

// ---------- the parts with defaults: reset when they cannot be read ----------

/** A list whose unreadable items are left out. The list itself comes back when every item was fine. */
function looseList(raw: unknown, shape: Shape): { value: unknown[]; dropped: boolean } {
  if (!Array.isArray(raw)) return { value: [], dropped: raw != null };
  let dropped = false, same = true; const out: unknown[] = [];
  for (const item of raw) {
    const r = readShape(item, shape);
    if ('bad' in r) { dropped = true; same = false; continue; }
    if (r.dropped) dropped = true;
    if (r.value !== item) same = false;
    out.push(r.value);
  }
  return { value: same ? raw : out, dropped };
}

/** A part made of named fields, each read on its own: a field in a form that cannot be read goes back to its default
 *  (when the part needs it) or is left out (when it does not). `nested` are the fields that hold lists or parts of
 *  their own. Comes back as it was when nothing had to change. */
function loosePart(raw: Obj, fields: Record<string, { test: Test; make?: () => unknown }>, nested: Record<string, (v: unknown) => { value: unknown; dropped: boolean } | 'leave-out'> = {}): { value: Obj; dropped: boolean } {
  let value = raw, dropped = false;
  for (const k of Object.keys(fields)) {
    const f = fields[k], v = own(raw, k);
    if (v !== undefined && f.test(v)) continue;
    if (v !== undefined && v !== null) dropped = true;
    if (f.make) value = withKey(value, k, f.make());
    else if (v !== undefined) value = without(value, k);
  }
  for (const k of Object.keys(nested)) {
    const v = own(value, k);   // after the pass above: a needed field that was unreadable is already its default
    if (v === undefined) continue;
    const r = nested[k](v);
    if (r === 'leave-out') { value = without(value, k); if (v !== null) dropped = true; continue; }
    if (r.dropped) dropped = true;
    if (r.value !== v) value = withKey(value, k, r.value);
  }
  return { value, dropped };
}
const req = (test: Test, make: () => unknown) => ({ test, make });
const opt = (test: Test) => ({ test });
const reqText = req(str, () => '');
const list = (shape: Shape) => (v: unknown) => looseList(v, shape);
const listOrNone = (shape: Shape) => (v: unknown) => (Array.isArray(v) ? looseList(v, shape) : 'leave-out' as const);
const partOrNone = (read: (o: Obj) => { value: Obj; dropped: boolean }) => (v: unknown) => (isObj(v) ? read(v) : 'leave-out' as const);

// the deal: withDeal() fills in any term that is left out, so a term that cannot be read is simply taken off
const PREMIUM = oneOf('cash', 'points', 'deferred', 'delete');
/** How many producers get a line: nobody types a figure past the hundreds, and the deal builds a line and a person for
 *  each one, so a figure in the tens of thousands would stop the page. Such a figure goes back to the default. */
const headcount: Test = v => v === null || (num(v) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 500);
const readDeal = (o: Obj) => loosePart(o, {}, {
  pay: partOrNone(pay => loosePart(pay, {
    model: opt(oneOf('as-budgeted', 'everyone-at-scale')), rerateCast: opt(bool), crewBasis: opt(oneOf(...SAG_IDS, 'custom')), crewCustomRate: opt(num), crewBumpPct: opt(num),
  }, { premiums: partOrNone(pr => cleanRecord(pr, PREMIUM)) })),
  producers: partOrNone(x => loosePart(x, { count: opt(headcount), days: opt(num) })),
  nonShoot: partOrNone(x => loosePart(x, { enabled: opt(bool), cashHourly: opt(num), rest: opt(oneOf('points', 'deferred')) })),
});

// incentives: withIncentives() fills in whatever is left out, the same way
const readIncentives = (o: Obj) => loosePart(o, { startDate: opt(ymdStr) }, {
  ca: partOrNone(x => loosePart(x, {
    enabled: opt(bool), excludedCategories: opt(strs), caSharePct: opt(num), outOfZonePct: opt(num), localHirePct: opt(num), vfx: opt(bool), trainees: opt(num),
    monetize: opt(oneOf('transfer', 'refund', 'own-tax')), transferCents: opt(num), bridge: opt(bool), bridgeCostPct: opt(num), auditCost: opt(num), countPreLetter: opt(bool),
  })),
  federal: partOrNone(x => loosePart(x, { enabled: opt(bool), includeAtl: opt(bool), independent: opt(bool), rural: opt(bool), transferCents: opt(num), bridge: opt(bool), bridgeCostPct: opt(num) })),
  perks: partOrNone(x => cleanRecord(x, num)),
});

const SHOOT_LOCATION: Shape = { id: must(str), name: text, days: must(num), outsideLaZone: must(bool), minWage: must(num) };

const CAL_EVENT: Shape = {
  id: must(str), date: must(ymdStr), label: text, kind: must(oneOf('prep', 'shoot', 'test', 'wrap', 'post', 'travel', 'hold', 'off', 'note')),
  end: may(ymdStr), dayIndex: may(num),
};
const monthStr: Test = v => v === '' || (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v));
const readCalendar = (o: Obj) => {
  const d = defaultCalendar({} as Project);
  return loosePart(o, { from: req(monthStr, () => d.from), to: req(monthStr, () => d.to), dayOne: opt(ymdStr), workDays: req(nums, () => d.workDays), skipHolidays: req(bool, () => d.skipHolidays), events: req(Array.isArray, () => []) },
    { events: list(CAL_EVENT) });
};

const COMP: Shape = { id: must(str), title: text, year: text, distributor: text, budget: fill(numOrNull, () => null), domestic: fill(numOrNull, () => null), worldwide: fill(numOrNull, () => null), note: text, source: text, group: may(str) };
const REVENUE: Shape = { id: must(str), source: text, low: must(num), mid: must(num), high: must(num) };
const PITCH_SECTION: Shape = { id: must(str), heading: text, body: text };
const LOOK_IMAGE: Shape = { id: must(str), dataUrl: must(str), caption: text, section: must(oneOf('tone', 'world', 'character', 'reference')), credit: may(str), slide: may(bool) };
const RESEARCH: Shape = { id: must(str), kind: must(oneOf('market', 'audience', 'comp', 'press', 'other')), title: text, body: text, url: may(str) };
const TEAM: Shape = { id: must(str), name: text, role: text, bio: text };
const fontWeight: Test = v => num(v) || (Array.isArray(v) && v.length === 2 && v.every(num));
const FONT_FILE: Shape = { id: must(str), role: must(oneOf('title', 'body')), family: must(str), dataUrl: must(str), embedOk: must(bool), weight: may(fontWeight), style: may(oneOf('normal', 'italic')), source: may(oneOf('google')), licence: may(str) };
const PAPERS = oneOf('plain', 'postcard', 'letter', 'notebook', 'torn');
const SHADES = oneOf('theme', 'white', 'cream', 'aged', 'kraft', 'newsprint');
const colors: Test = v => isObj(v) && ['bg', 'ink', 'accent', 'accent2', 'muted'].every(k => str(own(v, k)));
const fonts: Test = v => isObj(v) && str(own(v, 'title')) && str(own(v, 'body'));
/** The design system needs its colours and its two faces; without them there is no design to keep. */
const readDesign = (v: unknown) => {
  if (!isObj(v) || !colors(own(v, 'colors')) || !fonts(own(v, 'fonts'))) return 'leave-out' as const;
  return loosePart(v, { name: reqText, notes: reqText, logoDataUrl: opt(str), line: opt(str), card: opt(str), paper: opt(PAPERS), paperShade: opt(SHADES), hand: opt(bool), tilt: opt(bool) }, {
    deck: partOrNone(r => loosePart(r, { layout: req(oneOf('split', 'plain'), () => 'split'), eyebrow: req(bool, () => false), bleed: req(num, () => 0.55), signoff: reqText, coverImageId: opt(str), closingImageId: opt(str), lookSlides: opt(num) })),
    fontFiles: listOrNone(FONT_FILE),
  });
};
/** The slides, the people a deck is sent to and its movement each have a reader of their own that takes anything
 *  (readSlides, readRecipients, cleanDeckMotion); here they only have to be a list or a part at all. */
const anyList = (v: unknown) => (Array.isArray(v) ? { value: v, dropped: false } : 'leave-out' as const);
const readPitch = (o: Obj) => {
  const d = defaultPitch();
  return loosePart(o, {
    logline: reqText, why: reqText, deck: reqText, feePct: req(num, () => d.feePct), ask: opt(str),
    audience: req(isObj, () => d.audience), sections: req(Array.isArray, () => []), comps: req(Array.isArray, () => []), revenue: req(Array.isArray, () => d.revenue), sources: req(Array.isArray, () => []),
  }, {
    audience: partOrNone(a => loosePart(a, { primary: reqText, secondary: reqText, notes: reqText })),
    sections: list(PITCH_SECTION), comps: list(COMP), revenue: list(REVENUE),
    sources: v => { const xs = v as unknown[]; return xs.every(str) ? { value: xs, dropped: false } : { value: xs.filter(str), dropped: true }; },
    design: readDesign, lookbook: listOrNone(LOOK_IMAGE), research: listOrNone(RESEARCH), team: listOrNone(TEAM),
    slides: anyList, recipients: anyList, deckMotion: v => (isObj(v) ? { value: v, dropped: false } : 'leave-out' as const),
  });
};

const CONTACT: Shape = { role: text, name: text, phone: text };
const CS_LOCATION: Shape = { id: must(str), name: text, sets: text, address: text, parking: text, hospital: text, notes: text, lat: may(num), lng: may(num) };
const EXTRA: Shape = { id: must(str), kind: must(oneOf('stunt', 'standin', 'background')), name: text, role: text, call: text, onSet: text, note: text };
const DAY_TEXT = ['crewCall', 'shootingCall', 'rehearsal', 'lunch', 'wrap', 'weather', 'notes', 'safety', 'meals', 'parking', 'basecamp', 'bathrooms', 'lunchAt', 'trucks', 'hospital', 'bulletins', 'quote', 'instructions'];
const optTexts = (keys: string[]) => Object.fromEntries(keys.map(k => [k, opt(str)]));
const castCall: Test = v => isObj(v) && Object.keys(v).every(k => str(v[k]));
const readSheetDay = (o: Obj) => loosePart(o, { ...optTexts(DAY_TEXT), cast: req(isObj, () => ({})), depts: req(isObj, () => ({})) }, {
  cast: v => cleanRecord(v as Obj, castCall), depts: v => cleanRecord(v as Obj, str),
  crew: partOrNone(x => cleanRecord(x, str)), extras: listOrNone(EXTRA),
});
const readCallSheets = (o: Obj) => {
  const d = defaultCallSheets();
  return loosePart(o, {
    company: reqText, crewCall: req(str, () => d.crewCall), shootingCall: req(str, () => d.shootingCall), lunch: req(str, () => d.lunch), wrap: req(str, () => d.wrap),
    ...optTexts(['rehearsal', 'banner', 'basecamp', 'bathrooms', 'lunchAt', 'trucks']), brand: opt(bool),
    contacts: req(Array.isArray, () => []), locations: req(Array.isArray, () => []), days: req(isObj, () => ({})),
  }, {
    contacts: list(CONTACT), locations: list(CS_LOCATION),
    days: v => {
      // one sheet per shoot day, by day number: a day that is not a sheet is left out, the others are each read
      const days = cleanRecord(v as Obj, isObj); let value = days.value, dropped = days.dropped;
      for (const k of Object.keys(days.value)) {
        const r = readSheetDay(days.value[k] as Obj);
        if (r.dropped) dropped = true;
        if (r.value !== days.value[k]) value = withKey(value, k, r.value);
      }
      return { value, dropped };
    },
  });
};

/** Each part that has defaults, the plain name the user is told when it had to be reset, and how it is read. */
const LOOSE: { key: string; label: string; read: (v: unknown) => { value: unknown; dropped: boolean } | 'leave-out' }[] = [
  { key: 'dayHours', label: 'the length of the shooting day', read: v => (v === 10 || v === 12 ? { value: v, dropped: false } : 'leave-out') },
  { key: 'notes', label: 'the project notes', read: v => (str(v) ? { value: v, dropped: false } : 'leave-out') },
  { key: 'deal', label: 'the deal terms', read: partOrNone(readDeal) },
  { key: 'incentives', label: 'the incentives', read: partOrNone(readIncentives) },
  { key: 'locations', label: 'the shoot locations', read: listOrNone(SHOOT_LOCATION) },
  { key: 'calendar', label: 'the calendar', read: partOrNone(readCalendar) },
  { key: 'pitch', label: 'the pitch', read: partOrNone(readPitch) },
  { key: 'callSheets', label: 'the call sheets', read: partOrNone(readCallSheets) },
];

function readLoose(p0: Obj, notes: Notes): Obj {
  let p = p0;
  for (const part of LOOSE) {
    const v = own(p0, part.key);
    if (v === undefined) continue;
    const r = part.read(v);
    if (r === 'leave-out') { p = without(p, part.key); if (v !== null) notes.repaired.add(part.label); continue; }
    if (r.dropped) notes.repaired.add(part.label);
    if (r.value !== v) p = withKey(p, part.key, r.value);
  }
  return p;
}

// ---------- the whole file ----------

const MAX_DEPTH = 200;   // a project is a dozen levels deep; far past that, the file is something else
/** The same value without any key named `__proto__` (never data: it would become an object's prototype the first
 *  time it was assigned). A value with none comes back as it was. */
function plain(v: unknown, depth: number): unknown {
  if (typeof v !== 'object' || v === null) return v;
  if (depth > MAX_DEPTH) return refuse(NOT_A_PROJECT);
  if (Array.isArray(v)) {
    let out: unknown[] = v;
    for (let i = 0; i < v.length; i++) { const c = plain(v[i], depth + 1); if (c !== v[i]) { if (out === v) out = v.slice(); out[i] = c; } }
    return out;
  }
  const o = v as Obj; let out: Obj | null = null;
  const tainted = Object.prototype.hasOwnProperty.call(o, '__proto__');
  if (tainted) { out = {}; for (const k of Object.keys(o)) if (k !== '__proto__') out[k] = o[k]; }
  for (const k of Object.keys(out ?? o)) {
    const c = plain(o[k], depth + 1);
    if (c !== o[k]) { if (!out) out = { ...o }; out[k] = c; }
  }
  return out ?? o;
}

/** The project in what JSON.parse gave back, or the reason there is none. Never throws; never changes `raw`. A good
 *  project comes back as the very object it was given. */
export function checkProject(raw: unknown): ProjectCheck {
  try {
    if (!isObj(raw)) return { ok: false, reason: NOT_A_PROJECT };
    const v = own(raw, 'schemaVersion');
    if (typeof v === 'number' && v > 1) return { ok: false, reason: newerVersion(v) };
    if (v !== 1) return { ok: false, reason: NOT_A_PROJECT };
    const notes: Notes = { repaired: new Set() };
    const project = readLoose(readCore(plain(raw, 0) as Obj, notes), notes) as unknown as Project;
    return { ok: true, project, repaired: [...notes.repaired] };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, reason: e.message };
    return { ok: false, reason: 'This project file could not be read. It may be damaged.' };   // nothing above should get here; if it does, the user still gets a sentence
  }
}

/** A stripboard on its own (the copy kept before a board is replaced), or null when it cannot be read as one. */
export function checkBoard(raw: unknown): Board | null {
  try { return isObj(raw) ? readBoard(plain(raw, 0) as Obj, { repaired: new Set() }) as unknown as Board : null; } catch { return null; }
}

/** The same, from the text of a file. */
export function readProjectText(fileText: string): ProjectCheck {
  if (typeof fileText !== 'string' || !fileText.trim()) return { ok: false, reason: EMPTY_FILE };
  let raw: unknown;
  try { raw = JSON.parse(fileText); } catch { return { ok: false, reason: NOT_JSON }; }
  return checkProject(raw);
}

/** What the user is told when parts of a file were reset: one calm sentence, or nothing. */
export const repairNote = (repaired: string[]): string =>
  repaired.length ? `Some of it could not be read and was left out or set back to its default: ${repaired.join(', ')}. Everything else is as it was saved.` : '';
