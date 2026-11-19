import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Board } from './engine/types';
import { blankProject } from './data/seed';
import { withDeal, applyDeal } from './engine/deal';
import { adoptBoardDays, syncCastDaysFromBoard } from './engine/board';
import { topSheet } from './engine/budget';
import { idbAvailable, idbGet, idbSet, idbDel, STORES } from './idb';
import { checkBoard, checkProject, repairNote } from './engine/openProject';
import { COPIES_KEY, askToKeepStorage, forgetFileCopy, markOf, markOfText, noteFileCopy, noteSlotSaved, noteUntouched, quietReminder, readFileCopies, type FileCopies } from './fileCopies';

/** Every project that comes in: deal defaults, then the board takes ownership of cast and follower days. */
const normalize = (p: Project): Project => syncCastDaysFromBoard(adoptBoardDays(withDeal(p)));

const HISTORY = 30;

// ---- several projects in one browser ----
// Each project lives under its own key; an index lists them. The tab remembers which one it opened (sessionStorage), so two
// tabs on two projects never write over each other. `profitshare.project` is the pre-October single slot and is adopted on first load.
const LEGACY_KEY = 'profitshare.project';
const INDEX_KEY = 'profitshare.projects';
const ACTIVE_KEY = 'profitshare.activeProject';
const TAB_KEY = 'profitshare.tabProject';
const slotKey = (id: string) => `profitshare.project.${id}`;

export interface ProjectMeta { id: string; name: string; version: string; savedAt: string; shootDays: number; lines: number; scenes: number; cashBudget: number }

/** A minimal Storage so the index logic can be tested without a browser. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; readonly length?: number; key?(i: number): string | null }
const ls = (): KV | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
const ss = (): KV | null => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };

/** The browser's store has no room for another project. */
export class StoreFullError extends Error { constructor() { super('This browser has no room left to keep another project. Download your projects, remove some you no longer need, and try again.'); this.name = 'StoreFullError'; } }
export const newProjectId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** The list of projects as the browser holds it. A row that is not a row (the list was edited by hand, or cut off) is
 *  left out, and a row with a field missing is shown with a blank there, so the Projects table can always be drawn. */
export function readIndex(kv: KV | null = ls()): ProjectMeta[] {
  try {
    const raw = kv?.getItem(INDEX_KEY);
    let v: unknown;
    try { v = raw ? JSON.parse(raw) : []; } catch { return foundSlots(kv); }
    if (!Array.isArray(v)) return foundSlots(kv);
    const text = (x: unknown, or = '') => (typeof x === 'string' ? x : or), n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    const seen = new Set<string>(); const out: ProjectMeta[] = [];
    for (const m of v as Partial<ProjectMeta>[]) {
      if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, name: text(m.name, 'Untitled'), version: text(m.version), savedAt: text(m.savedAt), shootDays: n(m.shootDays), lines: n(m.lines), scenes: n(m.scenes), cashBudget: n(m.cashBudget) });
    }
    return out;
  } catch { return []; }
}
/** When the list itself cannot be read (cut off, or edited by hand), the projects are still in the browser under their
 *  own keys. List those, so none of them drops out of sight and the next save does not write a list without them. */
function foundSlots(kv: KV | null): ProjectMeta[] {
  const out: ProjectMeta[] = [];
  try {
    const n = kv?.length ?? 0, prefix = slotKey('');
    for (let i = 0; i < n; i++) {
      const k = kv?.key?.(i);
      if (!k || !k.startsWith(prefix) || k.length === prefix.length) continue;
      const id = k.slice(prefix.length);
      let name = 'Untitled';
      try { const p: unknown = JSON.parse(kv?.getItem(k) ?? ''); const t = (p as { name?: unknown } | null)?.name; if (typeof t === 'string' && t) name = t; } catch { /* listed all the same */ }
      out.push({ id, name, version: '', savedAt: '', shootDays: 0, lines: 0, scenes: 0, cashBudget: 0 });
    }
  } catch { /* nothing to list */ }
  return out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function writeIndex(list: ProjectMeta[], kv: KV | null = ls()) { try { kv?.setItem(INDEX_KEY, JSON.stringify(list)); } catch { /* ignore */ } }

export function metaOf(p: Project, id: string): ProjectMeta {
  let cashBudget = 0;
  try { cashBudget = topSheet(applyDeal(p)).cashBudget; } catch { /* a half-built project still gets listed */ }
  return { id, name: p.name, version: p.version, savedAt: new Date().toISOString(), shootDays: p.shootDays, lines: p.lines.length, scenes: p.board.scenes.length, cashBudget };
}

// ---- pictures and font files live in IndexedDB, not in the slot ----
// A look book is megabytes; localStorage holds about 5 MB a site in UTF-16, which is four or five pictures and then
// silence. So the slot keeps the project with every picture's and font file's data blanked, and the data sits in
// IndexedDB under its id. Loading a slot puts it back (asynchronously); Save (the .json) always has it inline.
//
// An asset is only blanked once its write to IndexedDB is known to have landed. Until then, and for good if the
// write fails, its data stays inline in the slot: a reference to something that was never stored would lose it.
const stored = new Set<string>();    // keys known to be in IndexedDB
const writing = new Set<string>();   // keys on their way there
const failed = new Set<string>();    // keys IndexedDB refused: kept inline
const lastKeys = new Map<string, Set<string>>();   // what each slot referenced when it was last written, to see what it let go of
let assetListener: (() => void) | null = null;
/** Told when an asset has landed in IndexedDB (the slot can be written again, smaller) or has been refused. */
export function onAssetsChanged(fn: (() => void) | null): void { assetListener = fn; }
/** True when IndexedDB has refused a picture or font file this session, so it is kept inside the project's slot. */
export const assetsKeptInline = (): boolean => failed.size > 0;
/** For tests: forget what this session knows about the store. */
export function resetAssetState(): void { stored.clear(); writing.clear(); failed.clear(); lastKeys.clear(); }

export const IMAGE_IN_DB = 'idb:';   // what a blanked asset's dataUrl says in the slot
const fontKey = (id: string) => `font:${id}`;   // font files share the pictures' store, under a key of their own
type Asset = { id?: unknown; dataUrl?: unknown };
const isAsset = (x: unknown): x is { id: string; dataUrl: string } => !!x && typeof x === 'object' && typeof (x as Asset).id === 'string' && typeof (x as Asset).dataUrl === 'string';
const blanked = (x: unknown): x is { id: string; dataUrl: string } => isAsset(x) && x.dataUrl.startsWith(IMAGE_IN_DB);
const listOf = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** True once the data is safely in IndexedDB. The first time a key is seen its write is started and the answer is no. */
function safelyStored(key: string, data: string): boolean {
  if (stored.has(key)) return true;
  if (failed.has(key) || writing.has(key)) return false;
  writing.add(key);
  void idbSet(STORES.images, key, data).then(
    () => { writing.delete(key); stored.add(key); assetListener?.(); },
    () => { writing.delete(key); failed.add(key); assetListener?.(); });
  return false;
}

/** The project with picture and font data moved out: each asset that is safely in IndexedDB is blanked in the copy
 *  that goes to the slot; one that is not there yet (or was refused) keeps its data. */
export function stripImages(p: Project): Project {
  const lb = p.pitch?.lookbook, ff = p.pitch?.design?.fontFiles;
  if ((!listOf(lb).length && !listOf(ff).length) || !idbAvailable()) return p;
  const out = <T,>(items: T[], keyOf: (id: string) => string): T[] => items.map(x => (isAsset(x) && x.dataUrl.startsWith('data:') && safelyStored(keyOf(x.id), x.dataUrl) ? { ...x, dataUrl: IMAGE_IN_DB + keyOf(x.id) } : x));
  let pitch = p.pitch!;
  if (Array.isArray(lb) && lb.length) pitch = { ...pitch, lookbook: out(lb, id => id) };
  if (Array.isArray(ff) && ff.length) pitch = { ...pitch, design: { ...pitch.design!, fontFiles: out(ff, fontKey) } };
  return { ...p, pitch };
}
/** The pictures and font files back from IndexedDB; one that is gone stays blank (and the page shows it as missing). */
export async function hydrateImages(p: Project): Promise<Project> {
  const lb = p.pitch?.lookbook, ff = p.pitch?.design?.fontFiles;
  if ((!listOf(lb).some(blanked) && !listOf(ff).some(blanked)) || !idbAvailable()) return p;
  const back = async (key: string) => { const data = await idbGet<string>(STORES.images, key).catch(() => undefined); if (data) stored.add(key); return data ?? ''; };
  let pitch = p.pitch!;
  if (listOf(lb).some(blanked)) pitch = { ...pitch, lookbook: await Promise.all(lb!.map(async img => (blanked(img) ? { ...img, dataUrl: await back(img.id) } : img))) };
  if (listOf(ff).some(blanked)) pitch = { ...pitch, design: { ...pitch.design!, fontFiles: await Promise.all(ff!.map(async f => (blanked(f) ? { ...f, dataUrl: await back(fontKey(f.id)) } : f))) } };
  return { ...p, pitch };
}
/** What came back from IndexedDB put into the project as it is now (it may have been edited while the store was read).
 *  Only an asset that is still a reference to the same stored thing is filled in: one the user has since replaced (a
 *  new file, with data of its own) or removed is left exactly as it is. */
export function mergeHydrated(cur: Project, h: Project): Project {
  const lb = cur.pitch?.lookbook, ff = cur.pitch?.design?.fontFiles;
  if (!listOf(lb).some(blanked) && !listOf(ff).some(blanked)) return cur;
  const read = (items: unknown) => new Map(listOf(items).filter(isAsset).filter(x => !x.dataUrl.startsWith(IMAGE_IN_DB)).map(x => [x.id, x.dataUrl] as const));
  const pics = read(h.pitch?.lookbook), fonts = read(h.pitch?.design?.fontFiles);
  const fill = <T,>(items: T[], from: Map<string, string>, keyOf: (id: string) => string): T[] =>
    items.map(x => (blanked(x) && x.dataUrl === IMAGE_IN_DB + keyOf(x.id) && from.has(x.id) ? { ...x, dataUrl: from.get(x.id)! } : x));
  let pitch = cur.pitch!;
  if (listOf(lb).some(blanked)) pitch = { ...pitch, lookbook: fill(lb!, pics, id => id) };
  if (listOf(ff).some(blanked)) pitch = { ...pitch, design: { ...pitch.design!, fontFiles: fill(ff!, fonts, fontKey) } };
  return { ...cur, pitch };
}

/** The IndexedDB keys a project refers to, whether its assets are blanked or still hold their data. */
export function assetKeys(p: Project | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const img of listOf(p?.pitch?.lookbook)) if (isAsset(img)) keys.add(img.id);
  for (const f of listOf(p?.pitch?.design?.fontFiles)) if (isAsset(f)) keys.add(fontKey(f.id));
  return keys;
}
/** True when a slot other than `exceptId` still refers to the stored asset `key`: two projects opened from one .json share their ids. */
function usedElsewhere(key: string, exceptId: string, kv: KV | null): boolean {
  const needle = JSON.stringify(IMAGE_IN_DB + key);
  return readIndex(kv).some(m => m.id !== exceptId && (kv?.getItem(slotKey(m.id)) ?? '').includes(needle));
}
/** Takes out of IndexedDB each of `keys` that no other slot refers to. */
function dropAssets(keys: Iterable<string>, exceptId: string, kv: KV | null): void {
  if (!idbAvailable()) return;
  for (const key of keys) {
    if (usedElsewhere(key, exceptId, kv)) continue;
    stored.delete(key); failed.delete(key);
    void idbDel(STORES.images, key).catch(() => undefined);
  }
}
const slotKeys = (id: string, kv: KV | null): Set<string> => {
  const known = lastKeys.get(id); if (known) return known;
  try { const raw = kv?.getItem(slotKey(id)); return assetKeys(raw ? JSON.parse(raw) : null); } catch { return new Set(); }
};

/** Write one project to its slot and refresh its row in the index (newest first). A picture or font file the project
 *  no longer has is taken out of IndexedDB, unless another project in this browser still uses it. False when the
 *  browser would not take the write (its small store is full). */
export function saveSlot(id: string, p: Project, kv: KV | null = ls()): boolean {
  const before = slotKeys(id, kv);
  try { kv?.setItem(slotKey(id), JSON.stringify(stripImages(p))); } catch { return false; }
  const now = assetKeys(p);
  lastKeys.set(id, now);
  dropAssets([...before].filter(k => !now.has(k)), id, kv);
  const index = readIndex(kv);
  writeIndex([metaOf(p, id), ...index.filter(m => m.id !== id)], kv);
  // beside the list: whether this differs from the last copy that went into a file (see fileCopies.ts)
  try { noteSlotSaved(id, markOf(p), kv, Date.now(), index.find(m => m.id === id)?.savedAt); } catch { /* the save itself went through */ }
  return true;
}
export type SlotRead =
  | { ok: true; project: Project; repaired: string[] }
  | { ok: false; reason: string; missing: boolean };   // missing: there is nothing saved under this id at all
/** What is saved for one project, read through the same check a file goes through. A slot that cannot be read is
 *  reported with the reason and left exactly as it is in the browser: nothing here writes or deletes. */
export function readSlot(id: string, kv: KV | null = ls()): SlotRead {
  let raw: string | null | undefined;
  try { raw = kv?.getItem(slotKey(id)); } catch { raw = null; }
  if (!raw) return { ok: false, reason: 'Nothing is saved for this project in this browser.', missing: true };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: 'What this browser saved for it is incomplete.', missing: false }; }
  const r = checkProject(parsed);
  if (!r.ok) return { ok: false, reason: r.reason.replace(/^This (project )?file/, 'The saved copy'), missing: false };
  try { return { ok: true, project: normalize(r.project), repaired: r.repaired }; }
  catch (e) { console.error('A saved project could not be prepared', e); return { ok: false, reason: 'The saved copy could not be read.', missing: false }; }
}
/** The slot's project, pictures still blanked: follow with hydrateImages(). Null when there is none or it cannot be read. */
export function loadSlot(id: string, kv: KV | null = ls()): Project | null {
  const r = readSlot(id, kv);
  return r.ok ? r.project : null;
}
export function deleteSlot(id: string, kv: KV | null = ls()): void {
  const keys = slotKeys(id, kv);
  try { kv?.removeItem(slotKey(id)); } catch { /* ignore */ }
  writeIndex(readIndex(kv).filter(m => m.id !== id), kv);
  lastKeys.delete(id);
  forgetFileCopy(id, kv);
  dropAssets(keys, id, kv);   // after the slot has gone, and never an asset another project still uses
  if (kv?.getItem(ACTIVE_KEY) === id) { try { kv.removeItem(ACTIVE_KEY); } catch { /* ignore */ } }
}

/** The single pre-October slot becomes the first project in the index, once. */
export function adoptLegacy(kv: KV | null = ls()): string | null {
  try {
    const raw = kv?.getItem(LEGACY_KEY);
    if (!raw) return null;
    const r = checkProject(JSON.parse(raw));
    if (!r.ok) return null;   // not a project this version can read: it stays where it is, untouched
    const p = r.project;
    const id = newProjectId();
    saveSlot(id, p, kv);
    kv!.setItem(ACTIVE_KEY, id);
    kv!.removeItem(LEGACY_KEY);
    return id;
  } catch { return null; }
}

// ---- a project that took the page down is not opened again by itself ----
// When drawing fails with a project open, the crash screen (ui/CrashScreen.tsx) calls noteCrash(). Two things are
// remembered: in the browser, that this project crashed, so no tab opens it on its own again (the user still can, from
// Projects; once it draws, the mark comes off); and in this tab, that the next start is the start screen with a line
// saying why. So a reload after a crash always lands on a page that works, and the project is still there.
const CRASHED_KEY = 'profitshare.crashed';      // ids that crashed while open (localStorage)
const AFTER_CRASH_KEY = 'profitshare.afterCrash';   // this tab's next start is the start screen (sessionStorage)
let openNow: string | null = null;      // the project being drawn, as of the latest render
let afterCrash: { id: string | null; name: string } | null = null;   // the same note, for a restart without a reload
const get = (kv: KV | null, k: string): string | null => { try { return kv?.getItem(k) ?? null; } catch { return null; } };
export function crashedIds(kv: KV | null = ls()): string[] {
  try { const v: unknown = JSON.parse(get(kv, CRASHED_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
function setCrashed(ids: string[], kv: KV | null) { try { if (ids.length) kv?.setItem(CRASHED_KEY, JSON.stringify(ids.slice(-50))); else kv?.removeItem(CRASHED_KEY); } catch { /* ignore */ } }
/** The page could not be drawn. Remembers which project was open so it is not opened again without being asked, and
 *  that this tab starts on the start screen next. Nothing saved is changed. Returns what was open, for the screen to say. */
export function noteCrash(kv: KV | null = ls(), tabKv: KV | null = ss()): { id: string | null; name: string } {
  const id = openNow;
  const name = id ? readIndex(kv).find(m => m.id === id)?.name ?? '' : '';
  afterCrash = { id, name };
  if (id) setCrashed([...crashedIds(kv).filter(x => x !== id), id], kv);
  try { tabKv?.setItem(AFTER_CRASH_KEY, JSON.stringify(afterCrash)); tabKv?.removeItem(TAB_KEY); } catch { /* ignore */ }
  return afterCrash;
}
/** Set when this start follows a crash: the project that was open then (its name may be empty), or null. */
export function crashBefore(tabKv: KV | null = ss()): { id: string | null; name: string } | null {
  if (afterCrash) return afterCrash;
  try {
    const v = JSON.parse(get(tabKv, AFTER_CRASH_KEY) ?? 'null') as { id?: unknown; name?: unknown } | null;
    return v && typeof v === 'object' ? { id: typeof v.id === 'string' ? v.id : null, name: typeof v.name === 'string' ? v.name : '' } : null;
  } catch { return null; }
}
/** The page has drawn: the start-screen-next note is used up, and a project that is open and drawing is no longer marked. */
export function noteDrawn(id: string | null, kv: KV | null = ls(), tabKv: KV | null = ss()): void {
  afterCrash = null;
  try { if (get(tabKv, AFTER_CRASH_KEY) !== null) tabKv?.removeItem(AFTER_CRASH_KEY); } catch { /* ignore */ }
  if (id) { const ids = crashedIds(kv); if (ids.includes(id)) setCrashed(ids.filter(x => x !== id), kv); }
}

/** For tests: forget what this page knows about a crash (a real reload does the same). */
export function resetCrashState(): void { openNow = null; afterCrash = null; }

/** Which project this tab should open: the one it had, else the browser's last active one, else the newest. Never one
 *  that took the page down the last time it was open, and none at all on the start that follows a crash. */
export function startingId(kv: KV | null = ls(), tabKv: KV | null = ss()): string | null {
  if (crashBefore(tabKv)) return null;
  if (readIndex(kv).length === 0) { const adopted = adoptLegacy(kv); if (adopted) return adopted; }
  const crashed = new Set(crashedIds(kv));
  const usable = (id: string | null | undefined): id is string => !!id && !crashed.has(id) && !!get(kv, slotKey(id));
  const tab = get(tabKv, TAB_KEY);
  if (usable(tab)) return tab;
  const active = get(kv, ACTIVE_KEY);
  if (usable(active)) return active;
  return readIndex(kv).find(m => usable(m.id))?.id ?? null;
}
function rememberActive(id: string | null) {
  try { if (id) { ls()?.setItem(ACTIVE_KEY, id); ss()?.setItem(TAB_KEY, id); } else { ss()?.removeItem(TAB_KEY); } } catch { /* ignore */ }
}

/** True when this browser already holds a project (so the app opens on it rather than the start screen). */
export const hadSavedProject = () => startingId() !== null;

const BOARD_KEY = 'profitshare.previous-board';
export interface BoardBackup { when: string; reason: string; board: Board }
/** The board as it was before something replaced it, kept in the browser so a reload doesn't lose it. */
export function keepBoard(board: Board, reason: string): void {
  if (!board.scenes.length) return;
  try { localStorage.setItem(BOARD_KEY, JSON.stringify({ when: new Date().toISOString(), reason, board } satisfies BoardBackup)); } catch { /* ignore */ }
}
/** The kept board, when what the browser holds can be read as one; anything else is passed over and left where it is. */
export function previousBoard(kv: KV | null = ls()): BoardBackup | null {
  try {
    const raw = kv?.getItem(BOARD_KEY); if (!raw) return null;
    const v = JSON.parse(raw) as Partial<BoardBackup> | null;
    if (!v || typeof v !== 'object') return null;
    const board = checkBoard(v.board);
    return board ? { when: typeof v.when === 'string' ? v.when : '', reason: typeof v.reason === 'string' ? v.reason : '', board } : null;
  } catch { return null; }
}
export function forgetPreviousBoard(): void { try { localStorage.removeItem(BOARD_KEY); } catch { /* ignore */ } }

/** The open project in memory, autosaved to its own slot in the browser, with undo; plus the list of every project the browser holds. */
export function useProject() {
  // what this tab opens on, worked out once: the project it had, or the start screen with a line saying why not
  const [start] = useState(startUp);
  const [activeId, setActiveId] = useState<string | null>(start.id);
  const [project, setProjectState] = useState<Project>(start.project);
  const [startNote, setStartNote] = useState(start.note);
  openNow = activeId;   // for the crash screen: which project was being drawn when drawing failed
  useEffect(() => { noteDrawn(activeId); }, [activeId]);   // this render reached the page
  const [projects, setProjectList] = useState<ProjectMeta[]>(readIndex);
  // what is known about each project's copies in files, read whenever the list is
  const [copies, setCopies] = useState<FileCopies>(() => readFileCopies(ls()));
  const refreshCopies = useCallback(() => setCopies(readFileCopies(ls())), []);
  const setProjects = useCallback((list: ProjectMeta[]) => { setProjectList(list); refreshCopies(); }, [refreshCopies]);
  const past = useRef<Project[]>([]);
  const [dirty, setDirty] = useState(false);
  const [assetTick, setAssetTick] = useState(0);
  const [storageNote, setStorageNote] = useState('');
  const idRef = useRef(activeId); idRef.current = activeId;
  const projectRef = useRef(project); projectRef.current = project;
  // An edit autosave has not written yet. Autosave waits 300ms, so anything that switches project writes it first.
  const pending = useRef(false);
  const writeOpen = () => { if (idRef.current && pending.current) { saveSlot(idRef.current, projectRef.current); pending.current = false; } };
  // pictures come back from IndexedDB after the slot loads; swapping them in is not an edit
  const hydrate = useCallback((p: Project) => {
    void hydrateImages(p).then(h => {
      if (h === p) return;
      // the steps Undo can go back to were taken before the data came back: they get it too, so undoing never brings
      // back a reference where a picture or a font should be
      past.current = past.current.map(old => mergeHydrated(old, h));
      setProjectState(cur => (cur === p ? h : mergeHydrated(cur, h)));
    });
  }, []);
  useEffect(() => { hydrate(project); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Give the in-memory project a slot of its own (the first edit on the start screen, or an Open / Start action). */
  const adopt = useCallback((p: Project, origin?: ProjectOrigin): string => {
    const id = newProjectId();
    // No room left in the browser's store: say so, and write no record claiming a project that was never kept.
    if (!saveSlot(id, p)) throw new StoreFullError();
    if (origin === 'file') noteFileCopy(id, markOf(p), ls(), Date.now(), 'opened');
    else if (origin === 'untouched') noteUntouched(id, markOf(p), ls(), Date.now());
    if (origin !== 'untouched') void askToKeepStorage(ls());   // the person has a project of their own here now
    setProjects(readIndex()); setActiveId(id); return id;
  }, [setProjects]);

  // autosave, 300ms after the last change, into this project's own slot; nothing is written while no project is open
  useEffect(() => {
    if (!activeId) { if (dirty) { try { adopt(project); } catch { /* the store is full: the storage note below says so */ } } return; }   // the first edit on the start screen makes it a project of its own
    const t = setTimeout(() => {
      const ok = saveSlot(activeId, project); pending.current = false; setProjects(readIndex());
      setStorageNote(!ok ? 'This browser\'s store is full, so the last changes are not saved here. Press Save to download the project as a .json file.'
        : assetsKeptInline() ? 'This browser would not store a picture or font file on its own, so it is kept inside the project here. Press Save to keep a .json copy as well.' : '');
    }, 300);
    return () => clearTimeout(t);
  }, [project, activeId, dirty, assetTick]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a picture or font file has landed in the big store (the slot can be written again, without it) or was refused
  useEffect(() => { onAssetsChanged(() => setAssetTick(n => n + 1)); return () => onAssetsChanged(null); }, []);
  useEffect(() => { rememberActive(activeId); }, [activeId]);
  // another tab saved or deleted something: refresh the list
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === INDEX_KEY) setProjects(readIndex()); else if (e.key === COPIES_KEY) refreshCopies(); };
    window.addEventListener('storage', on); return () => window.removeEventListener('storage', on);
  }, []);

  const setProject = useCallback((next: Project | ((p: Project) => Project)) => {
    setProjectState(prev => {
      let n = typeof next === 'function' ? next(prev) : next;
      if (n.board !== prev.board || n.participants !== prev.participants) n = syncCastDaysFromBoard(adoptBoardDays(n));   // the board owns cast and follower days: every edit flows to the budget
      if (n !== prev) { past.current.push(prev); if (past.current.length > HISTORY) past.current.shift(); setDirty(true); pending.current = true; if (idRef.current) void askToKeepStorage(ls()); }   // an edit makes it theirs
      return n;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev) { setProjectState(prev); hydrate(prev); }   // a step from before the pictures came back is filled in again
  }, [hydrate]);

  /** A project from a file or a Start button: it becomes a new project in the browser; the one that was open stays in the list. */
  const replace = useCallback((p: Project, origin?: ProjectOrigin) => {
    const n = normalize(p);
    // The project that is open is written to its slot first: autosave waits 300ms, and an edit made just before a
    // switch would otherwise be left behind.
    writeOpen();
    adopt(n, origin);   // throws when the store is full, before anything on screen changes
    past.current = []; setProjectState(n); setDirty(false);
  }, [adopt]);

  /** Save: download the open project as a file, and note that a file now holds it as it is. */
  const saveToFile = useCallback(() => {
    downloadJson(project);
    if (idRef.current) { noteFileCopy(idRef.current, markOf(project), ls(), Date.now()); refreshCopies(); }
  }, [project, refreshCopies]);
  const quietBackupReminder = useCallback(() => { if (idRef.current) { quietReminder(idRef.current, ls(), Date.now()); refreshCopies(); } }, [refreshCopies]);

  /** Close the open project (it stays saved) and show the start screen. */
  const newProject = useCallback(() => { writeOpen(); past.current = []; setActiveId(null); setProjectState(normalize(blankProject({ chartOfAccounts: 'empty' }))); setDirty(false); }, []);

  /** Switch to another project the browser holds. When what is saved for it cannot be read, nothing changes (the
   *  project that is open stays open, the saved copy stays as it is) and `note` says why. */
  const openProject = useCallback((id: string): { ok: boolean; note: string } => {
    const r = readSlot(id);
    if (!r.ok) return { ok: false, note: r.reason };
    writeOpen();
    const p = r.project;
    past.current = []; setActiveId(id); setProjectState(p); setDirty(false); setStartNote(''); hydrate(p);
    return { ok: true, note: repairNote(r.repaired) };
  }, [hydrate]);

  const deleteProject = useCallback((id: string) => {
    deleteSlot(id); setProjects(readIndex());
    if (idRef.current === id) newProject();
  }, [newProject, setProjects]);

  return { project, setProject, undo, replace, dirty, setDirty, canUndo: past.current.length > 0, undoDepth: past.current.length, storageNote, startNote, dismissStartNote: () => setStartNote(''), projects, activeId, newProject, openProject, deleteProject, copies, refreshCopies, saveToFile, quietBackupReminder };
}
/** Where a new project came from: a file it was opened from (so a file already holds it), or a sample or blank start
 *  that nobody has changed yet (so there is nothing to remind anyone to save). */
export type ProjectOrigin = 'file' | 'untouched';

/** What a tab starts on. The project it would open is read through the check; if it cannot be read, or the last start
 *  ended in a crash, the tab starts on the start screen with no project open (so autosave has nothing to write over)
 *  and a note for the user. The saved copy is left as it is either way. */
export function startUp(kv: KV | null = ls(), tabKv: KV | null = ss()): { id: string | null; project: Project; note: string } {
  const blank = () => normalize(blankProject({ chartOfAccounts: 'empty' }));
  const crash = crashBefore(tabKv);
  if (crash) {
    const listed = !!crash.id && readIndex(kv).some(m => m.id === crash.id);
    return { id: null, project: blank(), note: listed
      ? `ProfitShare ran into a problem while ${crash.name ? `“${crash.name}”` : 'a project'} was open, so it has not been opened again. It is still saved here, under Projects, unchanged.`
      : 'ProfitShare ran into a problem and has started again. The projects saved in this browser are unchanged.' };
  }
  const id = startingId(kv, tabKv);
  if (!id) return { id: null, project: blank(), note: '' };
  const r = readSlot(id, kv);
  if (r.ok) return { id, project: r.project, note: repairNote(r.repaired) && `Some of this project could not be read and was left out or set back to its default: ${r.repaired.join(', ')}. Everything else is as it was saved.` };
  const name = readIndex(kv).find(m => m.id === id)?.name;
  return { id: null, project: blank(), note: `${name ? `“${name}”` : 'The project that was open last'} could not be opened. ${r.reason} It has been left as it is in this browser, under Projects.` };
}

/** Every project this browser holds, as the text of a file each, for the crash screen's download buttons. Nothing here
 *  needs a project to be readable: one that is not is handed over exactly as it is saved. Pictures and font files are
 *  put back from the browser's big store where that works. */
export function savedProjectList(kv: KV | null = ls()): { id: string; name: string; fileName: string }[] {
  const used = new Set<string>();   // compared without regard to capitals: on most laptops "Salt_Flat" and "salt_flat" are one file
  return readIndex(kv).filter(m => get(kv, slotKey(m.id)) !== null).map(m => {
    const stem = `${m.name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'project'}${m.version ? `_${m.version.replace(/[^\w-]+/g, '_').slice(0, 30)}` : ''}`;
    let fileName = `${stem}.profitshare.json`;
    for (let n = 2; used.has(fileName.toLowerCase()); n++) fileName = `${stem}_${n}.profitshare.json`;
    used.add(fileName.toLowerCase());
    return { id: m.id, name: m.name, fileName };
  });
}
export async function savedProjectText(id: string, kv: KV | null = ls()): Promise<string | null> {
  const raw = get(kv, slotKey(id));
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw) as Project;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return raw;
    return JSON.stringify(await hydrateImages(p), null, 1);
  } catch { return raw; }   // not something this version can take apart: the file is what the browser holds, as it is
}
/** A saved project has just been downloaded as it is in its slot: note that a file holds it (see fileCopies.ts). */
export function noteDownloaded(id: string, kv: KV | null = ls(), now = Date.now()): void {
  const raw = get(kv, slotKey(id));
  if (raw !== null) noteFileCopy(id, markOfText(raw), kv, now);
}
export function downloadText(text: string | Uint8Array, fileName: string, type = 'application/json') {
  const blob = new Blob([text as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadJson(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/[^\w-]+/g, '_')}_${p.version.replace(/[^\w-]+/g, '_') || 'v1'}.profitshare.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Several files at once (every saved project from another laptop, say). */
export function pickFiles(accept: string): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
