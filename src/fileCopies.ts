// What this browser knows about the copies of each project that exist as files. A project lives in the browser's own
// store, which goes when site data is cleared or the laptop is replaced; a .profitshare.json is the copy that is safe.
// So, beside the list of projects (never inside a project file), one small record a project says when it was last
// put in a file, whether it has changed since, and since when. Nothing here touches a project or its slot.
import type { KV } from './store';

export const COPIES_KEY = 'profitshare.fileCopies';
const DAY = 24 * 60 * 60 * 1000;
/** Changed since the last file, and the first of those changes is this old: time to say so. */
export const REMIND_CHANGED_AFTER = 7 * DAY;
/** Never in a file at all, and this old. */
export const REMIND_NEVER_AFTER = 2 * DAY;
/** Dismissing the reminder holds this long. */
export const REMIND_QUIET_FOR = 3 * DAY;

export interface FileCopy {
  mark: string;        // what the project looks like now (a short fingerprint of its contents)
  since?: string;      // when the first change that is in no file was made; absent while a file holds everything
  fileAt?: string;     // when it was last put in a file, or opened from one
  fileMark?: string;   // what it looked like then
  from?: 'opened';     // the file is one it was opened from, not one that was downloaded
  untouched?: string;  // a sample or blank start nobody has changed yet looks like this: there is nothing of anyone's to lose
  quietUntil?: string; // the reminder was dismissed; not before this
}
export type FileCopies = Record<string, FileCopy>;

const text = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);
/** The records as the browser holds them. Anything that is not a record is left out, so a list that was cut off or
 *  edited by hand reads as "nothing known" and every project shows as never saved to a file, which is the safe way to be wrong. */
export function readFileCopies(kv: KV | null): FileCopies {
  const out: FileCopies = {};
  try {
    const v: unknown = JSON.parse(kv?.getItem(COPIES_KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const [id, r] of Object.entries(v as Record<string, Partial<FileCopy> | null>)) {
      if (!r || typeof r !== 'object' || typeof r.mark !== 'string') continue;
      out[id] = { mark: r.mark, since: text(r.since), fileAt: text(r.fileAt), fileMark: text(r.fileMark), from: r.from === 'opened' ? 'opened' : undefined, untouched: text(r.untouched), quietUntil: text(r.quietUntil) };
    }
  } catch { /* nothing known */ }
  return out;
}
function write(all: FileCopies, kv: KV | null) { try { kv?.setItem(COPIES_KEY, JSON.stringify(all)); } catch { /* the project itself is what matters; this is a note about it */ } }

// ---- the fingerprint ----
// Two saves of the same project must give the same mark whether its pictures are inline (in memory, in a file) or
// moved out to the browser's big store (in the slot), so the data of a picture or font file is left out and its id
// stands for it: a replaced picture is a new id.
const hasData = (x: unknown): x is { dataUrl: string } => !!x && typeof x === 'object' && typeof (x as { dataUrl?: unknown }).dataUrl === 'string';
const blank = (items: unknown): unknown => (Array.isArray(items) ? items.map(x => (hasData(x) ? { ...x, dataUrl: '' } : x)) : items);
/** A short mark that changes when the project's contents do. Takes a project, or anything a slot was found to hold. */
export function markOf(p: unknown): string {
  let v = p;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const pitch = (p as { pitch?: { lookbook?: unknown; design?: { fontFiles?: unknown } } }).pitch;
    if (pitch && typeof pitch === 'object') {
      const design = pitch.design && typeof pitch.design === 'object' ? { ...pitch.design, fontFiles: blank(pitch.design.fontFiles) } : pitch.design;
      v = { ...p, pitch: { ...pitch, lookbook: blank(pitch.lookbook), design } };
    }
  }
  let s: string;
  try { s = JSON.stringify(v) ?? ''; } catch { s = ''; }
  return hash(s);
}
/** The mark of a slot's text: of the project in it, or of the text itself when it cannot be taken apart. */
export function markOfText(raw: string): string {
  try { return markOf(JSON.parse(raw)); } catch { return hash(raw); }
}
/** Two 32-bit hashes side by side and the length: not secret, only unlikely to say "same" of two different projects. */
function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b); b = (b << 13) | (b >>> 19);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${s.length.toString(36)}`;
}

// ---- keeping the record ----

/** The browser has just written this project to its slot. `firstSeen` is when a project with no record yet was last
 *  written (projects from before these records were kept), so its clock does not start over today. */
export function noteSlotSaved(id: string, mark: string, kv: KV | null, now: number, firstSeen?: string): void {
  const all = readFileCopies(kv), r = all[id];
  if (r && r.mark === mark) return;   // nothing changed: nothing to write
  if (!r) {
    const seen = firstSeen && Number.isFinite(Date.parse(firstSeen)) ? Math.min(Date.parse(firstSeen), now) : now;
    all[id] = { mark, since: new Date(seen).toISOString() };
  } else if (r.fileMark === mark) all[id] = { ...r, mark, since: undefined };   // changed back to what the file holds (an undo)
  else all[id] = { ...r, mark, since: r.since ?? new Date(now).toISOString() };
  write(all, kv);
}
/** This project, looking like `mark`, has just gone into a file (Save, download all, the crash screen), or has just
 *  been opened from one. */
export function noteFileCopy(id: string, mark: string, kv: KV | null, now: number, from?: 'opened'): void {
  const all = readFileCopies(kv), r = all[id];
  all[id] = { ...r, mark, fileAt: new Date(now).toISOString(), fileMark: mark, from, since: undefined, quietUntil: undefined };
  write(all, kv);
}
/** A sample or a blank start, as it is now: until someone changes it there is nothing to remind anyone about. */
export function noteUntouched(id: string, mark: string, kv: KV | null, now: number): void {
  const all = readFileCopies(kv);
  all[id] = { ...all[id], mark, since: all[id]?.since ?? new Date(now).toISOString(), untouched: mark };
  write(all, kv);
}
export function quietReminder(id: string, kv: KV | null, now: number): void {
  const all = readFileCopies(kv); if (!all[id]) return;
  all[id] = { ...all[id], quietUntil: new Date(now + REMIND_QUIET_FOR).toISOString() };
  write(all, kv);
}
/** A project has been deleted from the browser: its record goes too. */
export function forgetFileCopy(id: string, kv: KV | null): void {
  const all = readFileCopies(kv); if (!(id in all)) return;
  delete all[id]; write(all, kv);
}

// ---- saying it ----

export type CopyState = 'never' | 'changed' | 'safe';
export const copyState = (r: FileCopy | undefined): CopyState => (!r?.fileAt ? 'never' : r.since ? 'changed' : 'safe');

/** "just now", "5 minutes ago", "3 days ago", "2 months ago": how long ago, in whole words. */
export function ago(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'} ago`;
  if (mins < 1) return 'just now';
  if (mins < 60) return n(mins, 'minute');
  if (mins < 60 * 24) return n(Math.round(mins / 60), 'hour');
  const days = Math.round(mins / (60 * 24));
  if (days < 60) return n(days, 'day');
  if (days < 730) return n(Math.round(days / 30.4), 'month');
  return n(Math.round(days / 365.25), 'year');
}
/** The Projects table's words for one project. */
export function copyWords(r: FileCopy | undefined, now: number): string {
  const state = copyState(r);
  if (state === 'never') return r && r.untouched === r.mark ? 'Never saved to a file (nothing changed yet)' : 'Never saved to a file';
  const when = ago(r!.fileAt, now);
  if (state === 'changed') return `Changed since you last ${r!.from === 'opened' ? 'opened it from' : 'saved it to'} a file${when ? ` (${when})` : ''}`;
  return `${r!.from === 'opened' ? 'Opened from' : 'Saved to'} a file${when ? ` ${when}` : ''}`;
}

/** Whether to show the quiet line for the open project, and which. Null when there is nothing to say: a file holds
 *  everything, the changes are young, the line was dismissed not long ago, or nobody has changed the sample. */
export function reminderFor(r: FileCopy | undefined, now: number): { kind: 'never' | 'changed'; text: string } | null {
  if (!r || !r.since || r.untouched === r.mark) return null;
  const quiet = r.quietUntil ? Date.parse(r.quietUntil) : NaN;
  if (Number.isFinite(quiet) && now < quiet) return null;
  const since = Date.parse(r.since);
  if (!Number.isFinite(since)) return null;
  const age = now - since;
  if (!r.fileAt) return age >= REMIND_NEVER_AFTER ? { kind: 'never', text: 'This project lives only in this browser. Save a copy to a file.' } : null;
  return age >= REMIND_CHANGED_AFTER ? { kind: 'changed', text: `This project has changed since you last ${r.from === 'opened' ? 'opened it from' : 'saved it to'} a file, ${ago(r.fileAt, now)}. The changes live only in this browser. Save a copy to a file.` } : null;
}

// ---- asking the browser to keep what it holds ----

const ASKED_KEY = 'profitshare.askedToKeep';
let asked = false;
/** For tests. */
export function resetKeepAsk(): void { asked = false; }
type StorageLike = { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> };
/** Asks the browser, once, not to clear this site's store when the disk runs low. Most browsers decide by themselves
 *  without a word; one or two ask the person in their own way. Asked once a browser and never again, so a "no" is
 *  final. Called when the person has a project of their own, not when the page first opens. */
export async function askToKeepStorage(kv: KV | null, storage: StorageLike | undefined = typeof navigator !== 'undefined' ? navigator.storage : undefined): Promise<boolean | null> {
  if (asked) return null;
  asked = true;
  try {
    if (!storage || typeof storage.persist !== 'function') return null;
    if (kv?.getItem(ASKED_KEY)) return null;
    if (typeof storage.persisted === 'function' && await storage.persisted()) return true;
    try { kv?.setItem(ASKED_KEY, '1'); } catch { /* asked this visit only */ }
    return await storage.persist();
  } catch { return null; }
}
