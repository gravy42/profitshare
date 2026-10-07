import type { Board, Calendar, CalEvent, Project } from './types';
import { shootDays } from './board';

/** Dates are plain 'YYYY-MM-DD' strings everywhere; no time zones. */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const monthOf = (s: string) => s.slice(0, 7);
export const dow = (s: string) => parseYmd(s).getDay();          // 0 = Sunday
export const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const addMonths = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const monthName = (ym: string) => parseYmd(ym + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export const shortDate = (s: string) => parseYmd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** Months from `from` to `to` inclusive, as 'YYYY-MM'. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return out;
  for (let m = from; m <= to && out.length < 36; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Empty until the user picks a range: no months, no Day 1, nothing placed. */
export const defaultCalendar = (_p: Project): Calendar => ({
  from: '', to: '',
  workDays: [1, 2, 3, 4, 5],
  skipHolidays: true,
  events: [],
});

export const withCalendar = (p: Project): Project => (p.calendar ? p : { ...p, calendar: defaultCalendar(p) });

// ---------- US holidays (the ones a film crew actually takes) ----------

const nthWeekday = (y: number, m: number, weekday: number, n: number) => {
  const first = new Date(y, m, 1); const off = (weekday - first.getDay() + 7) % 7;
  return ymd(new Date(y, m, 1 + off + 7 * (n - 1)));
};
const lastWeekday = (y: number, m: number, weekday: number) => {
  const last = new Date(y, m + 1, 0); const off = (last.getDay() - weekday + 7) % 7;
  return ymd(new Date(y, m + 1, 0 - off));
};
/** A fixed-date holiday observed on the nearest weekday when it lands on a weekend. */
const observed = (y: number, m: number, d: number) => {
  const dt = new Date(y, m, d);
  if (dt.getDay() === 6) dt.setDate(d - 1);
  else if (dt.getDay() === 0) dt.setDate(d + 1);
  return ymd(dt);
};

export function usHolidays(year: number): { date: string; label: string }[] {
  const thanks = nthWeekday(year, 10, 4, 4);
  return [
    { date: observed(year, 0, 1), label: "New Year's Day" },
    { date: nthWeekday(year, 0, 1, 3), label: 'MLK Day' },
    { date: nthWeekday(year, 1, 1, 3), label: "Presidents' Day" },
    { date: lastWeekday(year, 4, 1), label: 'Memorial Day' },
    { date: observed(year, 5, 19), label: 'Juneteenth' },
    { date: observed(year, 6, 4), label: 'Independence Day' },
    { date: nthWeekday(year, 8, 1, 1), label: 'Labor Day' },
    { date: thanks, label: 'Thanksgiving' },
    { date: addDays(thanks, 1), label: 'Day after Thanksgiving' },
    { date: `${year}-12-24`, label: 'Christmas Eve' },
    { date: observed(year, 11, 25), label: 'Christmas Day' },
    { date: `${year}-12-31`, label: "New Year's Eve" },
  ];
}

export function holidaysBetween(from: string, to: string): Map<string, string> {
  const out = new Map<string, string>();
  const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
  for (let y = y0; y <= y1; y++) for (const h of usHolidays(y)) if (monthOf(h.date) >= from && monthOf(h.date) <= to) out.set(h.date, h.label);
  return out;
}

// ---------- events ----------

export const EVENT_KINDS: { id: CalEvent['kind']; label: string }[] = [
  { id: 'prep', label: 'Prep' }, { id: 'shoot', label: 'Shoot day' }, { id: 'test', label: 'Test shoot' }, { id: 'wrap', label: 'Wrap' }, { id: 'post', label: 'Post' },
  { id: 'travel', label: 'Travel / move' }, { id: 'hold', label: 'Hold / hiatus' }, { id: 'off', label: 'Company day off' }, { id: 'note', label: 'Note' },
];

/** Every date an event covers (inclusive of `end`). */
export function eventDates(e: CalEvent): string[] {
  const end = e.end && e.end > e.date ? e.end : e.date;
  const out: string[] = [];
  for (let d = e.date; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function eventsOn(cal: Calendar, date: string): CalEvent[] {
  return cal.events.filter(e => date >= e.date && date <= (e.end && e.end > e.date ? e.end : e.date));
}

// ---------- shoot days onto dates ----------

/** Is `date` a day the company can shoot: a work weekday, not a skipped holiday, not a company day off. */
export function isWorkDate(cal: Calendar, date: string, holidays: Map<string, string>): boolean {
  if (!cal.workDays.includes(dow(date))) return false;
  if (cal.skipHolidays && holidays.has(date)) return false;
  if (cal.events.some(e => e.kind === 'off' && date >= e.date && date <= (e.end && e.end > e.date ? e.end : e.date))) return false;
  return true;
}

/** Shoot day index → date. A day placed by hand on the calendar wins, then a dated day break on the board;
 *  with a Day 1 set, the rest walk forward from it over work dates. Without one, unplaced days stay off the calendar. */
export function shootDates(board: Board, cal: Calendar): Map<number, string> {
  const out = new Map<number, string>();
  const days = shootDays(board);
  const pinned = new Map<number, string>();
  for (const e of cal.events) if (e.kind === 'shoot' && e.dayIndex) pinned.set(e.dayIndex, e.date);
  const taken = new Set(pinned.values());
  const holidays = cal.dayOne ? holidaysBetween(monthOf(cal.dayOne), addMonths(monthOf(cal.dayOne), 12)) : new Map<string, string>();
  let d = cal.dayOne;
  for (const day of days) {
    const pin = pinned.get(day.index) ?? (day.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : undefined);
    if (pin) { out.set(day.index, pin); if (d && pin >= d) d = addDays(pin, 1); continue; }
    if (!d) continue;
    let guard = 0;
    while ((!isWorkDate(cal, d, holidays) || taken.has(d)) && guard++ < 400) d = addDays(d, 1);
    out.set(day.index, d);
    d = addDays(d, 1);
  }
  return out;
}

/** Write the computed dates onto the day-break strips so the stripboard shows them too. */
export function stampBoardDates(p: Project): Project {
  const cal = withCalendar(p).calendar!;
  const dates = shootDates(p.board, cal);
  let n = 0;
  const strips = p.board.strips.map(s => {
    if (s.type !== 'daybreak') return s;
    n += 1;
    const date = dates.get(n);
    return date ? { ...s, date } : s;
  });
  return { ...p, board: { ...p.board, strips } };
}

export const newEvent = (date: string, label: string, kind: CalEvent['kind'], end?: string, dayIndex?: number): CalEvent =>
  ({ id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, date, end: end && end > date ? end : undefined, label, kind, ...(dayIndex ? { dayIndex } : {}) });

// ---------- export ----------

const icsDate = (s: string) => s.replace(/-/g, '');
export function toIcs(p: Project): string {
  const cal = withCalendar(p).calendar!;
  const dates = shootDates(p.board, cal);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ProfitShare//Calendar//EN'];
  const esc = (s: string) => s.replace(/[\\,;]/g, m => '\\' + m);
  for (const day of shootDays(p.board)) {
    const d = dates.get(day.index); if (!d) continue;
    const loc = [...new Set(day.scenes.map(s => s.location).filter(Boolean))].join(' / ');
    lines.push('BEGIN:VEVENT', `UID:shoot-${day.index}@profitshare`, `DTSTART;VALUE=DATE:${icsDate(d)}`, `DTEND;VALUE=DATE:${icsDate(addDays(d, 1))}`,
      `SUMMARY:${esc(`${p.name}: Shoot Day ${day.index}`)}`, `DESCRIPTION:${esc(`${day.scenes.map(s => s.number).join(', ')}${loc ? ' · ' + loc : ''}`)}`, 'END:VEVENT');
  }
  for (const e of cal.events) {
    if (e.kind === 'shoot' && e.dayIndex) continue;
    const end = e.end && e.end > e.date ? e.end : e.date;
    lines.push('BEGIN:VEVENT', `UID:${e.id}@profitshare`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(end, 1))}`, `SUMMARY:${esc(`${p.name}: ${e.label}`)}`, `CATEGORIES:${e.kind}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
