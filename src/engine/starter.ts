// A first budget from nothing but a script. The board (scenes, cast, tags) is already broken down; this sizes a
// generic indie feature crew and the department allowances to the script's length and shoot days, prices the cast
// at a SAG tier, and writes every line with a note saying how it was sized, so the person can argue with each one.
// Nothing here knows about any real production: the template is a plain LA indie feature.
import type { Board, BoardElement, LineItem, Participant, Project, Scene, SagTierId } from './types';
import { blankProject } from '../data/seed';
import { PAID_HOURS, newId } from './budget';
import { SAG_TIERS, scaleHourly } from './sag';
import { fitDayBreaks, shootDays, dood, daysWithElements, adoptBoardDays, syncCastDaysFromBoard } from './board';
import { applyDeal, defaultDeal } from './deal';
import { topSheet } from './budget';

export interface StarterOptions {
  title: string;
  version?: string;
  tier: SagTierId;              // the SAG agreement the cast is priced at (and the deal's target)
  rates: 'scale' | 'ballpark';  // crew at the tier's scale ÷ 8 for everyone, or a ballpark LA non-union ladder for heads and keys
  pagesPerDay: number;          // sets the shoot-day count from the script's length
  crew?: 'lean' | 'full';       // lean drops the seconds (2nd AD, art director, camera operator, second grip…); default lean under $1M tiers
  dayHours?: 10 | 12;
}

export interface StarterReport {
  pages: number; scenes: number; shootDays: number; cast: number; crew: number; lines: number; cashBudget: number; sets: number;
  extras: string[];             // what the tags added: "stunt coordinator (4 days)", "animal wrangler (3 days)"
}

const PAYROLL = ['FICA1', 'FICA2', 'FUI', 'SUI (CA)', 'WC (CA)', 'PAYROLL FEE'];
const SAG = [...PAYROLL, 'SAG AFTRA'];
const SAG_BG = ['FICA1', 'FICA2', 'FUI', 'SUI (CA)', 'WC (CA)', 'PAYROLL FEE SAG BG', 'SAG AFTRA BG'];

type Role = 'hod' | 'key' | 'crew' | 'general';
interface Slot { acct: string; title: string; role: Role; prep: number; wrap: number; day?: number; count?: number; long?: boolean; lean?: number }   // lean: how many of these a lean crew keeps (default: all)
// prep is a share of the shoot days (a designer preps most of a shoot's length again; a boom op preps nothing); wrap is days.
// day is the ballpark LA non-union day rate for a 10-hour day; roles without one take the role's default.
const BALLPARK_DEFAULT: Record<Role, number> = { hod: 750, key: 675, crew: 617, general: 617 };
const CREW: Slot[] = [
  { acct: '2101', title: 'Unit Production Manager', role: 'hod', prep: 1.0, wrap: 5, day: 900 },
  { acct: '2102', title: '1st Assistant Director', role: 'hod', prep: 0.75, wrap: 1, day: 900 },
  { acct: '2103', title: '2nd Assistant Director', role: 'key', prep: 0.5, wrap: 1, lean: 0 },
  { acct: '2105', title: 'Production Accountant', role: 'hod', prep: 0.5, wrap: 5, lean: 1 },
  { acct: '2107', title: 'Script Supervisor', role: 'hod', prep: 0.1, wrap: 1, day: 700 },
  { acct: '2109', title: 'Production Coordinator', role: 'key', prep: 1.0, wrap: 5, day: 650 },
  { acct: '2111', title: 'Production Assistant', role: 'general', prep: 0.25, wrap: 1, count: 3, lean: 2 },
  { acct: '2201', title: 'Production Designer', role: 'hod', prep: 0.9, wrap: 1, day: 900 },
  { acct: '2202', title: 'Art Director', role: 'key', prep: 0.75, wrap: 1, day: 700, lean: 0 },
  { acct: '2207', title: 'Art Department PA', role: 'general', prep: 0.5, wrap: 1, lean: 1 },
  { acct: '2301', title: 'Set Decorator', role: 'hod', prep: 0.5, wrap: 2, day: 700 },
  { acct: '2302', title: 'Leadperson', role: 'key', prep: 0.25, wrap: 1, lean: 0 },
  { acct: '2303', title: 'Set Dresser', role: 'crew', prep: 0.25, wrap: 1, lean: 1 },
  { acct: '2401', title: 'Property Master', role: 'hod', prep: 0.5, wrap: 1, day: 700 },
  { acct: '2402', title: 'Assistant Property Master', role: 'key', prep: 0.1, wrap: 1, lean: 0 },
  { acct: '2601', title: 'Director of Photography', role: 'hod', prep: 0.5, wrap: 0, day: 1200 },
  { acct: '2602', title: 'Camera Operator', role: 'key', prep: 0.1, wrap: 0, day: 750, lean: 0 },
  { acct: '2603', title: '1st Assistant Camera', role: 'key', prep: 0.15, wrap: 0 },
  { acct: '2604', title: '2nd Assistant Camera', role: 'key', prep: 0.1, wrap: 0, lean: 0 },
  { acct: '2605', title: 'Digital Utility / DIT', role: 'crew', prep: 0, wrap: 1, lean: 1 },
  { acct: '2701', title: 'Gaffer', role: 'hod', prep: 0.1, wrap: 1 },
  { acct: '2702', title: 'Best Boy Electric', role: 'key', prep: 0.05, wrap: 1 },
  { acct: '2703', title: 'Electrician', role: 'crew', prep: 0, wrap: 0, count: 2, lean: 1 },
  { acct: '2801', title: 'Key Grip', role: 'hod', prep: 0.1, wrap: 1 },
  { acct: '2802', title: 'Best Boy Grip', role: 'key', prep: 0.05, wrap: 1 },
  { acct: '2804', title: 'Company Grip', role: 'crew', prep: 0, wrap: 0, count: 2, lean: 1 },
  { acct: '2806', title: 'Set Medic', role: 'crew', prep: 0, wrap: 0 },
  { acct: '2807', title: 'Craft Service', role: 'crew', prep: 0.05, wrap: 0 },
  { acct: '2901', title: 'Production Sound Mixer', role: 'hod', prep: 0, wrap: 0, day: 800 },
  { acct: '2902', title: 'Boom Operator', role: 'key', prep: 0, wrap: 0 },
  { acct: '3001', title: 'Costume Designer', role: 'hod', prep: 0.5, wrap: 2 },
  { acct: '3004', title: 'Key Costumer', role: 'key', prep: 0.25, wrap: 1 },
  { acct: '3005', title: 'Set Costumer', role: 'crew', prep: 0, wrap: 1, lean: 0 },
  { acct: '3101', title: 'Key Makeup & Hair', role: 'hod', prep: 0.1, wrap: 0, day: 700 },
  { acct: '3102', title: 'Makeup & Hair Artist', role: 'crew', prep: 0, wrap: 0, lean: 0 },
  { acct: '3303', title: 'Driver', role: 'crew', prep: 0.1, wrap: 1, count: 2, long: true, lean: 1 },
  { acct: '3401', title: 'Location Manager', role: 'hod', prep: 1.0, wrap: 2 },
  { acct: '3402', title: 'Assistant Location Manager', role: 'key', prep: 0.5, wrap: 1, lean: 0 },
];
const POST_DAYS = 60;   // editor and assistant: the shoot, then twelve weeks

interface Allow { acct: string; desc: string; perDay?: number; flat?: number; perSet?: number; perHead?: number; note?: string }
// per-shoot-day allowances are what a department spends on an ordinary day; flats are the things a feature buys once
const ALLOWANCES: Allow[] = [
  { acct: '1404', desc: 'Casting director', flat: 15000 },
  { acct: '1406', desc: 'Casting expenses (sessions, self-tape platform)', flat: 1500 },
  { acct: '2120', desc: 'Production supplies', perDay: 150 },
  { acct: '2210', desc: 'Art department purchases', perDay: 400 },
  { acct: '2211', desc: 'Art department rentals', perDay: 200 },
  { acct: '2310', desc: 'Set dressing purchases', perDay: 400 },
  { acct: '2311', desc: 'Set dressing rentals', perDay: 400 },
  { acct: '2410', desc: 'Prop purchases', perDay: 250 },
  { acct: '2411', desc: 'Prop rentals', perDay: 150 },
  { acct: '2610', desc: 'Camera expendables and media', perDay: 100 },
  { acct: '2611', desc: 'Camera package rental (body, lenses, support, monitors)', perDay: 1500 },
  { acct: '2706', desc: 'Generator rental', perDay: 250 },
  { acct: '2707', desc: 'Generator fuel', perDay: 100 },
  { acct: '2710', desc: 'Lighting expendables', perDay: 100 },
  { acct: '2711', desc: 'Lighting package rental', perDay: 900 },
  { acct: '2808', desc: 'Craft service purchases', perHead: 6 },
  { acct: '2810', desc: 'Grip expendables', perDay: 75 },
  { acct: '2811', desc: 'Grip package rental', perDay: 600 },
  { acct: '2812', desc: 'Dolly rental', perDay: 150 },
  { acct: '2910', desc: 'Sound expendables (batteries, media)', perDay: 50 },
  { acct: '2911', desc: "Sound package rental (mixer's kit, lavs, boom)", perDay: 400 },
  { acct: '3010', desc: 'Wardrobe purchases', perDay: 300 },
  { acct: '3011', desc: 'Wardrobe rentals', perDay: 150 },
  { acct: '3012', desc: 'Alterations and cleaning', perDay: 50 },
  { acct: '3110', desc: 'Makeup & hair purchases', perDay: 100 },
  { acct: '3306', desc: 'Truck rentals (two cube trucks)', perDay: 350 },
  { acct: '3307', desc: 'Gas & fuel', perDay: 100 },
  { acct: '3312', desc: 'Mileage, parking, tolls', perDay: 100 },
  { acct: '3406', desc: 'Site rentals', perSet: 1500, note: 'One fee per distinct location in the script; a house for a week and a diner for an afternoon do not cost the same, so this is a placeholder to replace as locations are found.' },
  { acct: '3407', desc: 'Permits', perDay: 400 },
  { acct: '3409', desc: 'Location parking', perDay: 200 },
  { acct: '3413', desc: 'Bathrooms', perDay: 150 },
  { acct: '3415', desc: 'Working meals (second meal, walking meals)', perDay: 150 },
  { acct: '3416', desc: 'Catered meals', perHead: 22 },
  { acct: '4010', desc: 'Editorial purchases (drives, software)', flat: 2500 },
  { acct: '4101', desc: 'Composer', flat: 15000 },
  { acct: '4105', desc: 'Music licensing', flat: 10000 },
  { acct: '4301', desc: 'Sound post: edit, design, mix', flat: 25000 },
  { acct: '4402', desc: 'Color correction', flat: 12000 },
  { acct: '4405', desc: 'Main & end titles', flat: 3000 },
  { acct: '4406', desc: 'Deliverables (DCP, captions, QC, textless)', flat: 7500 },
  { acct: '5001', desc: 'Publicist (festival premiere)', flat: 10000 },
  { acct: '5002', desc: 'EPK & stills', flat: 3000 },
  { acct: '5003', desc: 'Festival submissions', flat: 3000 },
  { acct: '5101', desc: 'Production package insurance', perDay: 900, note: 'Insurance is priced as a share of the budget, roughly 2 to 3 percent; per shoot day is a stand-in until a quote comes in.' },
  { acct: '5102', desc: 'Errors & omissions (3-year term)', flat: 10000 },
  { acct: '5201', desc: 'Legal: entity, agreements, clearances', flat: 20000 },
  { acct: '5203', desc: 'Accounting and payroll service', flat: 6000 },
  { acct: '5211', desc: 'Wrap party', flat: 2000 },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const uniqueSets = (scenes: Scene[]) => new Set(scenes.map(s => s.set.trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean)).size;
const itemsOf = (scenes: Scene[], category: string): BoardElement[] => {
  const seen = new Set<string>(); const out: BoardElement[] = [];
  for (const s of scenes) for (const item of s.elements[category] ?? []) { const k = item.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ category, item }); } }
  return out;
};

/** A new project from a parsed, tagged board: day breaks are placed here. */
export function starterProject(board: Board, opts: StarterOptions): { project: Project; report: StarterReport } {
  const base = blankProject({ name: opts.title, version: opts.version ?? 'Draft 1', chartOfAccounts: 'standard' });
  return applyStarter({ ...base, board, dayHours: opts.dayHours ?? 12 }, opts);
}

/** Draw the starter budget into a project that already has a board (and maybe a name, a chart of accounts, a day
 *  length). Lines and participants are replaced; the board keeps its day breaks when it has any, otherwise they are
 *  placed at opts.pagesPerDay. Accounts the template needs that the chart lacks are added from the standard chart. */
export function applyStarter(base0: Project, opts: StarterOptions): { project: Project; report: StarterReport } {
  const tier = SAG_TIERS.find(t => t.id === opts.tier) ?? SAG_TIERS[1];
  const hours = PAID_HOURS[base0.dayHours ?? opts.dayHours ?? 12];
  const board0 = base0.board;
  const PREP_HOURS = PAID_HOURS[10].day;   // prep and wrap days are ten-hour days whatever the shoot day is
  const POST_HOURS = 8;                     // an editor's day has no overtime in it
  const lean = (opts.crew ?? ((opts.tier === 'ULB' || opts.tier === 'MLB') ? 'lean' : 'full')) === 'lean';
  const eighths = board0.scenes.reduce((n, s) => n + s.eighths, 0);
  const pages = eighths / 8;
  const days = Math.max(1, Math.ceil(pages / Math.max(0.5, opts.pagesPerDay)));
  const hasBreaks = board0.strips.some(s => s.type === 'daybreak');
  const board = hasBreaks ? board0 : fitDayBreaks({ ...board0, targetEighthsPerDay: Math.round(opts.pagesPerDay * 8) }, days);
  const D = shootDays(board).length;
  // the chart: the project's own if it has one, with any account the template needs added from the standard chart
  const std = blankProject({ chartOfAccounts: 'standard' });
  let base: Project = base0.accounts.length ? base0 : { ...base0, categories: std.categories, accounts: std.accounts };
  if (!base.fringes.length) base = { ...base, fringes: std.fringes };
  const ensureAccount = (number: string) => {
    if (base.accounts.some(a => a.number === number)) return;
    const a = std.accounts.find(x => x.number === number); if (!a) return;
    if (!base.categories.some(c => c.number === a.categoryNumber)) { const c = std.categories.find(x => x.number === a.categoryNumber)!; base = { ...base, categories: [...base.categories, c].sort((x, y) => x.number.localeCompare(y.number, undefined, { numeric: true })) }; }
    base = { ...base, accounts: [...base.accounts, a].sort((x, y) => x.number.localeCompare(y.number, undefined, { numeric: true })) };
  };
  const sag = { ...base.sag, targetTier: tier.id };
  const deal0 = defaultDeal({ shootDays: D, sag });
  const p: Project = { ...base, board, shootDays: D, dayHours: base0.dayHours ?? opts.dayHours ?? 12, sag, deal: { ...deal0, pay: { ...deal0.pay, model: 'as-budgeted', crewBasis: tier.id, rerateCast: true } } };
  const lines: LineItem[] = [];
  const participants: Participant[] = [];
  const extras: string[] = [];
  const scaleH = scaleHourly(tier.dayRate);
  const crewHourly = (slot: Slot): number => {
    if (opts.rates === 'scale') return scaleH;
    const day = slot.day ?? BALLPARK_DEFAULT[slot.role];
    return slot.role === 'crew' || slot.role === 'general' ? Math.max(scaleH, 56.13) : r2(day / 11);   // ballpark days are quoted for a 10-hour day
  };
  const sized = (what: string) => `Starting place from the script: ${what}. Change it; every number here is a guess sized to ${D} shoot days and ${Math.round(pages)} pages.`;   // eslint-disable-line
  const wage = (acct: string, desc: string, amount: number, hourly: number, pid: string, mult = hours.day, fr = PAYROLL, note?: string, extra: Partial<LineItem> = {}) => {
    if (amount <= 0 && !extra.daysFrom && !fr.includes('SAG AFTRA')) return;   // a cast line stays even at 0 days: the board fills it
    lines.push({ id: newId('L'), accountId: acct, description: desc, amount, unit: 'DAY', rate: hourly, multiplier: mult, fringes: fr, tags: ['starter'], payType: 'cash', participantId: pid, ...(note ? { notes: note } : {}), ...extra });
  };
  const allow = (acct: string, desc: string, total: number, note: string, payType: LineItem['payType'] = 'cash') => {
    if (total <= 0) return;
    lines.push({ id: newId('L'), accountId: acct, description: desc, amount: 1, unit: 'ALLOW', rate: Math.round(total), multiplier: 1, fringes: [], tags: ['starter'], payType, notes: note });
  };

  // ---- above the line: placeholders a reader expects to see, small and on the back end where the deal allows ----
  const wd = `p_1301_1`;
  participants.push({ id: wd, name: 'Writer / Director', role: 'Writer / Director', group: 'producer', tierId: 'director', days: D, bonusMultiplier: 1 });
  allow('1102', 'Script purchase', 20000, sized('an original screenplay at a first-feature price; 1 to 3 percent of the budget is the usual range'), 'points');
  lines[lines.length - 1].participantId = wd;
  allow('1201', 'Producer fee', 25000, sized('one producer at a modest fee; add a line per producer'), 'points');
  participants.push({ id: 'p_producer_1', name: 'Producer #1', role: 'Producer', group: 'producer', tierId: 'producer', days: D + 40, bonusMultiplier: 1 });
  lines[lines.length - 1].participantId = 'p_producer_1';
  wage('1301', 'Directing fee', D, r2(25000 / D / hours.day), wd, hours.day, PAYROLL, sized('$25,000 across the shoot; a first-feature director at this size usually lands at 2 to 3 percent of the budget, part of it deferred'));

  // ---- cast from the board: shoot days follow the stripboard, one fitting day each off it ----
  const rows = dood(board);
  const scenesOf = new Map<number, number>();
  for (const s of board.scenes) for (const c of s.cast) if (c.id != null) scenesOf.set(c.id, (scenesOf.get(c.id) ?? 0) + 1);
  const ranked = [...board.castList].sort((a, b) => (scenesOf.get(b.id) ?? 0) - (scenesOf.get(a.id) ?? 0));
  const principals = new Set(ranked.slice(0, 2).map(c => c.id));
  let principalWages = 0;
  for (const c of board.castList) {
    const shoot = rows.find(r => r.castId === c.id)?.total ?? 0;
    const sc = scenesOf.get(c.id) ?? 0;
    const acct = principals.has(c.id) ? '1401' : sc >= 3 ? '1402' : '1403';
    const tierId = acct === '1401' ? (c.id === ranked[0]?.id ? 'lead' : 'cast') : acct === '1402' ? 'cast' : 'general';
    const pid = `p_cast_${c.id}`;
    participants.push({ id: pid, name: c.name, role: acct === '1401' ? 'Principal cast' : acct === '1402' ? 'Supporting cast' : 'Day player', group: 'cast', tierId, days: shoot + 1, bonusMultiplier: 1, castId: c.id });
    const fit = acct === '1403' ? 0 : 1;
    wage(acct, fit ? 'Shoot | Rehearsal | Fitting' : 'Shoot', shoot + fit, scaleH, pid, hours.sag, SAG, `${tier.name} day performer, ${tier.dayRate} for 8 hours, overtime on top${fit ? '; one fitting day off the board' : ''}. Shoot days follow the stripboard.`);
    if (acct === '1401') principalWages += (shoot + fit) * scaleH * hours.sag;
  }
  if (principalWages) allow('1401', "Agents' fees (10% of principal cast)", principalWages * 0.1, 'Ten percent on top of scale for represented principals.');

  // ---- what the tags add ----
  const stunts = itemsOf(board.scenes, 'Stunts');
  if (stunts.length) {
    const d = daysWithElements(board, stunts);
    const pid = 'p_1501_1';
    participants.push({ id: pid, name: 'Stunt Coordinator', role: 'Stunt Coordinator', group: 'crew', tierId: 'hod', days: d + 2, bonusMultiplier: 1, followsElements: stunts });
    wage('1501', `Stunt Coordinator (days with ${stunts.slice(0, 3).map(e => e.item).join(', ')}${stunts.length > 3 ? '…' : ''})`, d, scaleH, pid, hours.sag, SAG, 'Days come from the stripboard: every day a scene carries a Stunts tag.', { daysFrom: 'board' });
    wage('1501', 'Stunt Coordinator prep', 2, scaleH, pid, PREP_HOURS, SAG);
    extras.push(`stunt coordinator (${d} day${d === 1 ? '' : 's'} + 2 prep)`);
  }
  const animals = itemsOf(board.scenes, 'Animals');
  if (animals.length) {
    const d = daysWithElements(board, animals);
    const pid = 'p_2405_1';
    participants.push({ id: pid, name: 'Animal Wrangler', role: 'Animal Wrangler', group: 'crew', tierId: 'crew', days: d, bonusMultiplier: 1, followsElements: animals });
    wage('2405', `Animal Wrangler (days with ${animals.map(e => e.item).join(', ')})`, d, Math.max(scaleH, 56.13), pid, hours.day, PAYROLL, 'Days come from the stripboard: every day a scene carries an Animals tag.', { daysFrom: 'board' });
    allow('2406', `Animals: ${animals.map(e => e.item).join(', ')}`, d * 350, sized('a trained animal and its handler run $300 to $500 a day; priced per day the animal works'));
    extras.push(`animal wrangler (${d} day${d === 1 ? '' : 's'})`);
  }
  const vehicles = itemsOf(board.scenes, 'Vehicles');
  if (vehicles.length) {
    const d = daysWithElements(board, vehicles);
    allow('2408', `Picture vehicles: ${vehicles.slice(0, 4).map(e => e.item).join(', ')}${vehicles.length > 4 ? ` and ${vehicles.length - 4} more` : ''}`, d * 300, sized(`${vehicles.length} tagged vehicle${vehicles.length === 1 ? '' : 's'} over ${d} day${d === 1 ? '' : 's'} at $300 a vehicle-day; a hero car or a period car costs more`));
    extras.push(`picture vehicles (${vehicles.length})`);
  }
  const sfx = itemsOf(board.scenes, 'Special Effects');
  if (sfx.length) {
    const d = daysWithElements(board, sfx);
    const pid = 'p_3201_1';
    participants.push({ id: pid, name: 'Special Effects Coordinator', role: 'Special Effects Coordinator', group: 'crew', tierId: 'hod', days: d + 1, bonusMultiplier: 1, followsElements: sfx });
    wage('3201', `Special Effects Coordinator (days with ${sfx.slice(0, 3).map(e => e.item).join(', ')})`, d, crewHourly({ acct: '3201', title: '', role: 'hod', prep: 0, wrap: 0 }), pid, hours.day, PAYROLL, 'Days come from the stripboard: every day a scene carries a Special Effects tag.', { daysFrom: 'board' });
    wage('3201', 'Special Effects Coordinator prep / scout', 1, crewHourly({ acct: '3201', title: '', role: 'hod', prep: 0, wrap: 0 }), pid, PREP_HOURS);
    allow('3210', 'Special effects purchases and rentals', d * 750, sized(`${sfx.length} tagged effect${sfx.length === 1 ? '' : 's'} over ${d} day${d === 1 ? '' : 's'}`));
    extras.push(`special effects (${d} day${d === 1 ? '' : 's'})`);
  }
  const bgScenes = board.scenes.filter(s => (s.elements['Background Actors'] ?? []).length);
  if (bgScenes.length) {
    const bgDays = daysWithElements(board, itemsOf(board.scenes, 'Background Actors'));
    const heads = 8;
    lines.push({ id: newId('L'), accountId: '2002', description: `Non-union background: ${heads} a day on ${bgDays} day${bgDays === 1 ? '' : 's'} with background in the script`, amount: bgDays * heads, unit: 'DAY', rate: 16.9, multiplier: hours.day, fringes: PAYROLL, tags: ['starter'], payType: 'cash',
      notes: sized(`${bgScenes.length} scene${bgScenes.length === 1 ? '' : 's'} tagged with background; eight people a day at the California minimum. A crowd scene needs its own line`) });
    extras.push(`background (${bgDays} day${bgDays === 1 ? '' : 's'})`);
  }

  // ---- the crew ----
  let crewCount = 0;
  for (const slot of CREW) {
    const n = lean && slot.lean != null ? slot.lean : (slot.count ?? 1);
    if (n === 0) continue;
    const hourly = crewHourly(slot);
    const prep = Math.round(slot.prep * D);
    for (let i = 1; i <= n; i++) {
      const pid = `p_${slot.acct}_${i}`;
      const name = n > 1 ? `${slot.title} #${i}` : slot.title;
      participants.push({ id: pid, name, role: slot.title, group: 'crew', tierId: slot.role, days: prep + D + slot.wrap, bonusMultiplier: 1 });
      const mult = slot.long ? hours.long : hours.day;
      const how = opts.rates === 'scale' ? `${tier.name} scale ÷ 8 for everyone (the Sing Sing baseline)` : slot.role === 'crew' || slot.role === 'general' ? 'general crew at Moderate Low Budget scale ÷ 8' : `ballpark LA non-union, $${(slot.day ?? BALLPARK_DEFAULT[slot.role]).toLocaleString()} for a 10-hour day`;
      wage(slot.acct, 'Prep', prep, hourly, pid, PREP_HOURS, PAYROLL, i === 1 ? sized(`${slot.title}: ${how}; prep at ${Math.round(slot.prep * 100)}% of the shoot, ten-hour days`) : undefined);
      wage(slot.acct, 'Shoot', D, hourly, pid, mult, PAYROLL, prep ? undefined : (i === 1 ? sized(`${slot.title}: ${how}`) : undefined));
      wage(slot.acct, 'Wrap', slot.wrap, hourly, pid, PREP_HOURS, PAYROLL);
      crewCount++;
    }
  }
  // post: editor through the shoot and twelve weeks after
  for (const [acct, title, role] of [['4001', 'Editor', 'hod'], ['4002', 'Assistant Editor', 'key']] as const) {
    const pid = `p_${acct}_1`;
    const hourly = crewHourly({ acct, title, role, prep: 0, wrap: 0, day: role === 'hod' ? 750 : 675 });
    participants.push({ id: pid, name: title, role: title, group: 'crew', tierId: role, days: D + POST_DAYS, bonusMultiplier: 1 });
    wage(acct, 'Production (assembly during the shoot)', D, hourly, pid, POST_HOURS, PAYROLL, sized(`${title} through the shoot and ${POST_DAYS / 5} weeks of post, eight-hour days`));
    wage(acct, 'Post', POST_DAYS, hourly, pid, POST_HOURS);
    crewCount++;
  }

  // ---- allowances ----
  const sets = uniqueSets(board.scenes);
  const heads = crewCount + Math.min(6, board.castList.length) + 4;   // crew on an ordinary day, plus cast, plus a few
  for (const a of ALLOWANCES) {
    const total = a.flat ?? (a.perDay ? a.perDay * D : a.perSet ? a.perSet * sets : a.perHead ? a.perHead * heads * D : 0);
    const how = a.flat ? `a flat placeholder for a feature this size` : a.perDay ? `$${a.perDay.toLocaleString()} a shoot day × ${D}` : a.perSet ? `${sets} distinct sets in the script × $${a.perSet.toLocaleString()}` : `${heads} heads × $${a.perHead} × ${D} days`;
    allow(a.acct, a.desc, total, a.note ? `${a.note} ${sized(how)}` : sized(how));
  }

  // lines grouped by account in chart order; any account the chart lacks comes in from the standard chart
  for (const l of lines) ensureAccount(l.accountId);
  const order = new Map(base.accounts.map((a, i) => [a.number, i]));
  lines.sort((x, y) => (order.get(x.accountId) ?? 9999) - (order.get(y.accountId) ?? 9999));
  const project0: Project = { ...p, categories: base.categories, accounts: base.accounts, lines, participants, notes: `Built from the script by ProfitShare's starter: a generic LA indie feature crew and allowances sized to ${Math.round(pages)} pages over ${D} shoot days, cast at ${tier.name} scale, crew ${opts.rates === 'scale' ? 'at scale' : 'at ballpark non-union rates'}, ${lean ? 'a lean crew' : 'a full crew'}. Every line carries a note on how it was sized; the lines are tagged "starter" so you can tell them from your own.` };
  const project = syncCastDaysFromBoard(adoptBoardDays(project0));   // the board owns the cast days from here on
  const ts = topSheet(applyDeal(project));
  return { project, report: { pages: Math.round(pages * 10) / 10, scenes: board.scenes.length, shootDays: D, cast: board.castList.length, crew: crewCount, lines: lines.length, cashBudget: ts.cashBudget, sets, extras } };
}
