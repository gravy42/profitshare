// Call sheets: one per shoot day, drawn from the board (the day's scenes, sets, cast), the calendar (the date), the
// participants (cast and crew by department) and a locations table (addresses, parking, the nearest hospital, and
// coordinates for sunrise and sunset). What the day needs typed (calls, weather, notes) is kept per day as overrides
// on top of the defaults, so a sheet is never blank and nothing typed is lost when the board moves.
import type { Board, CallSheetDay, CallSheets, Location, Participant, Project } from './types';
import { shootDays, eighthsToText, type ShootDay } from './board';
import { shootDates, withCalendar, shortDate, parseYmd } from './calendar';

export const defaultCallSheets = (): CallSheets => ({ company: '', contacts: [], locations: [], crewCall: '07:00', shootingCall: '08:00', lunch: '13:00', wrap: '19:00', days: {} });

export const withCallSheets = (p: Project): Project => (p.callSheets ? p : { ...p, callSheets: defaultCallSheets() });

export const newLocation = (partial: Partial<Location> = {}): Location => ({ id: `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name: '', sets: '', address: '', parking: '', hospital: '', notes: '', ...partial });

/** "SAM'S HOUSE - KITCHEN" and "SAM'S HOUSE - BATHROOM" are one location: the set name before the first " - ". */
export const setGroup = (set: string) => set.split(/\s+[-–—]\s+/)[0].trim().toUpperCase();

/** One location per distinct set group on the board, for a first locations table; existing ones are kept. */
export function locationsFromBoard(board: Board, existing: Location[]): Location[] {
  const covered = new Set(existing.flatMap(l => l.sets.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)));
  const groups = new Map<string, Set<string>>();
  for (const s of board.scenes) { if (s.unit || !s.set.trim()) continue; const g = setGroup(s.set); if (!groups.has(g)) groups.set(g, new Set()); groups.get(g)!.add(s.set.trim().toUpperCase()); }
  const out = [...existing];
  for (const [g, sets] of groups) if (![...sets].some(x => covered.has(x)) && !covered.has(g)) out.push(newLocation({ name: g, sets: g }));
  return out;
}

/** Which location a set belongs to: the one whose sets list names the set, else the set's group, else none. */
export function locationFor(set: string, locations: Location[]): Location | undefined {
  const up = set.trim().toUpperCase(); const g = setGroup(set);
  const names = (l: Location) => l.sets.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  return locations.find(l => names(l).includes(up)) ?? locations.find(l => names(l).some(n => n === g || up.startsWith(n + ' '))) ?? locations.find(l => l.name.trim().toUpperCase() === g);
}

// ---- departments: a crew member's role puts them in a department for the crew-call block ----
const DEPTS: [string, RegExp][] = [
  ['Production', /\b(upm|unit production|line producer|production (manager|coordinator|secretary|assistant)|\bpa\b|office|accountant|script super|assistant director|\b[12](st|nd)? ?ad\b|first ad|second ad)/i],
  ['Camera', /\b(dp|dop|cinematograph|photograph|camera|1st ac|2nd ac|focus|dit|loader|steadicam|video assist)/i],
  ['Grip & Electric', /\b(gaffer|best boy|electric|grip|key grip|dolly|swing|lighting|generator|genny)/i],
  ['Catering & Craft', /\b(craft|cater|chef|cook)/i],
  ['Sound', /\b(sound|boom|mixer|utility)/i],
  ['Art', /\b(production design|art director|set dec|props?\b|propert|prop master|set dress|construction|scenic|art dept|art department|leadman|buyer)/i],
  ['Wardrobe', /\b(costume|wardrobe|seamstress|tailor)/i],
  ['Hair & Makeup', /\b(hair|make-?up|hmu|makeup)/i],
  ['Locations', /\b(location|site rep)/i],
  ['Transport', /\b(transport|driver|teamster|picture car)/i],
  ['Stunts & Safety', /\b(stunt|safety|medic|nurse|intimacy|wrangler|animal|special effects|sfx|pyro)/i],
  ['Post & VFX', /\b(editor|vfx|visual effects|post|colorist|dailies)/i],
];
export const departmentOf = (role: string): string => DEPTS.find(([, re]) => re.test(role))?.[0] ?? 'Other';

export const DEPT_ORDER = [...DEPTS.map(d => d[0]), 'Other'];

/** SAG work-status codes for a day: start, work, finish, or all three on a one-day part. */
export function castStatus(workDays: number[], dayIndex: number): 'SW' | 'W' | 'WF' | 'SWF' | '' {
  if (!workDays.includes(dayIndex)) return '';
  const first = workDays[0] === dayIndex, last = workDays[workDays.length - 1] === dayIndex;
  return first && last ? 'SWF' : first ? 'SW' : last ? 'WF' : 'W';
}

// ---- sunrise and sunset (NOAA's approximation), local time of the browser; to the minute at any city ----
const rad = (d: number) => d * Math.PI / 180, deg = (r: number) => r * 180 / Math.PI;
function sunEvent(date: string, lat: number, lng: number, rising: boolean): string | null {
  const d = parseYmd(date);
  const start = Date.UTC(d.getFullYear(), 0, 0); const n = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000);
  const lngHour = lng / 15;
  const t = n + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(rad(M)) + 0.020 * Math.sin(rad(2 * M)) + 282.634; L = ((L % 360) + 360) % 360;
  let RA = deg(Math.atan(0.91764 * Math.tan(rad(L)))); RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90; RA /= 15;
  const sinDec = 0.39782 * Math.sin(rad(L)), cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(90.833)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null;   // no rise or set that day (polar)
  const H = (rising ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH))) / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  const UT = (((T - lngHour) % 24) + 24) % 24;
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0) + UT * 3600000);
  return utc.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
export const sunrise = (date: string, lat: number, lng: number) => sunEvent(date, lat, lng, true);
export const sunset = (date: string, lat: number, lng: number) => sunEvent(date, lat, lng, false);

// ---- times: "07:00" in, "7:00 AM" out; an offset in minutes on a call ----
export const fmtTime = (hhmm: string): string => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim()); if (!m) return hhmm; const h = +m[1]; return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
export const addMinutes = (hhmm: string, mins: number): string => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim()); if (!m) return hhmm; const t = (((+m[1] * 60 + +m[2] + mins) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

// ---- the resolved sheet ----
export interface SheetScene { number: string; ie: string; set: string; tod: string; synopsis: string; pages: string; castIds: number[]; location?: Location; scriptDay: string }
export interface SheetCast { castId: number; name: string; actor: string; status: string; pickup: string; call: string; makeup: string; onSet: string; note: string }
export interface SheetDept { dept: string; call: string; people: { name: string; role: string }[] }
export interface SheetLocation extends Location { sets: string }
export interface Sheet {
  dayIndex: number; dayCount: number; date?: string; dateText: string;
  title: string; version: string; company: string;
  contacts: { role: string; name: string; phone: string }[];
  crewCall: string; shootingCall: string; lunch: string; wrap: string;
  sunrise?: string; sunset?: string; weather: string;
  locations: SheetLocation[];
  scenes: SheetScene[]; pages: string;
  cast: SheetCast[];
  depts: SheetDept[];
  advance: SheetScene[]; advanceDate?: string;
  notes: string; safety: string; meals: string;
}

const emptyDay = (): CallSheetDay => ({ cast: {}, depts: {} });

/** The sheet for one shoot day, defaults filled and the day's own entries laid over them. */
export function buildSheet(p0: Project, dayIndex: number): Sheet | null {
  const p = withCallSheets(p0); const cs = p.callSheets!;
  const days = shootDays(p.board); const day = days.find(d => d.index === dayIndex); if (!day) return null;
  const dates = shootDates(p.board, withCalendar(p).calendar!);
  const date = dates.get(dayIndex);
  const over = cs.days[dayIndex] ?? emptyDay();
  const crewCall = over.crewCall ?? cs.crewCall, shootingCall = over.shootingCall ?? cs.shootingCall;
  const sceneRows = (d: ShootDay): SheetScene[] => d.scenes.map(s => ({ number: s.number, ie: s.ie, set: s.set, tod: s.tod, synopsis: s.synopsis, pages: eighthsToText(s.eighths), castIds: s.cast.map(c => c.id).filter((x): x is number => x != null), location: locationFor(s.set, cs.locations), scriptDay: s.scriptDay }));
  const scenes = sceneRows(day);
  const locs: SheetLocation[] = [];
  for (const s of scenes) if (s.location && !locs.some(l => l.id === s.location!.id)) locs.push(s.location);
  const first = locs.find(l => l.lat != null && l.lng != null);
  const byActor = new Map<number, Participant>(); for (const x of p.participants) if (x.castId != null) byActor.set(x.castId, x);
  const workDays = new Map<number, number[]>(); for (const c of p.board.castList) workDays.set(c.id, days.filter(d => d.castIds.includes(c.id)).map(d => d.index));
  const cast: SheetCast[] = p.board.castList.filter(c => day.castIds.includes(c.id)).map(c => {
    const o = over.cast[c.id] ?? {};
    return { castId: c.id, name: c.name, actor: byActor.get(c.id)?.name ?? '', status: o.status ?? castStatus(workDays.get(c.id) ?? [], dayIndex), pickup: o.pickup ?? '', call: o.call ?? crewCall, makeup: o.makeup ?? crewCall, onSet: o.onSet ?? shootingCall, note: o.note ?? '' };
  });
  const crew = p.participants.filter(x => x.group === 'crew');   // producers and the director sit on the header, not in a department
  const groups = new Map<string, { name: string; role: string }[]>();
  for (const x of crew) { const d = departmentOf(x.role); if (!groups.has(d)) groups.set(d, []); groups.get(d)!.push({ name: x.name, role: x.role }); }
  const depts: SheetDept[] = DEPT_ORDER.filter(d => groups.has(d) || over.depts[d]).map(d => ({ dept: d, call: over.depts[d] ?? crewCall, people: groups.get(d) ?? [] }));
  const next = days.find(d => d.index === dayIndex + 1);
  return {
    dayIndex, dayCount: days.length, date, dateText: date ? parseYmd(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : `Day ${dayIndex} (no date yet; set Day 1 on the Calendar)`,
    title: p.name, version: p.version, company: cs.company, contacts: cs.contacts,
    crewCall, shootingCall, lunch: over.lunch ?? cs.lunch, wrap: over.wrap ?? cs.wrap,
    sunrise: date && first ? sunrise(date, first.lat!, first.lng!) ?? undefined : undefined, sunset: date && first ? sunset(date, first.lat!, first.lng!) ?? undefined : undefined,
    weather: over.weather ?? '', locations: locs, scenes, pages: eighthsToText(day.eighths), cast, depts,
    advance: next ? sceneRows(next) : [], advanceDate: next ? dates.get(next.index) : undefined,
    notes: over.notes ?? '', safety: over.safety ?? '', meals: over.meals ?? '',
  };
}

export const sheetDateLabel = (s: Sheet) => (s.date ? shortDate(s.date) : `Day ${s.dayIndex}`);
