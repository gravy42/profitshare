import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Board } from './engine/types';
import { blankProject } from './data/seed';
import { withDeal, applyDeal } from './engine/deal';
import { adoptBoardDays, syncCastDaysFromBoard } from './engine/board';
import { topSheet } from './engine/budget';
import { idbAvailable, idbGet, idbSet, idbDel, STORES } from './idb';

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
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const ls = (): KV | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
const ss = (): KV | null => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };

export const newProjectId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function readIndex(kv: KV | null = ls()): ProjectMeta[] {
  try { const raw = kv?.getItem(INDEX_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
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
  const rest = readIndex(kv).filter(m => m.id !== id);
  writeIndex([metaOf(p, id), ...rest], kv);
  return true;
}
/** The slot's project, pictures still blanked: follow with hydrateImages(). */
export function loadSlot(id: string, kv: KV | null = ls()): Project | null {
  try {
    const raw = kv?.getItem(slotKey(id));
    if (raw) { const p = JSON.parse(raw); if (p && p.schemaVersion === 1) return normalize(p); }
  } catch { /* corrupt or blocked */ }
  return null;
}
export function deleteSlot(id: string, kv: KV | null = ls()): void {
  const keys = slotKeys(id, kv);
  try { kv?.removeItem(slotKey(id)); } catch { /* ignore */ }
  writeIndex(readIndex(kv).filter(m => m.id !== id), kv);
  lastKeys.delete(id);
  dropAssets(keys, id, kv);   // after the slot has gone, and never an asset another project still uses
  if (kv?.getItem(ACTIVE_KEY) === id) { try { kv.removeItem(ACTIVE_KEY); } catch { /* ignore */ } }
}

/** The single pre-October slot becomes the first project in the index, once. */
export function adoptLegacy(kv: KV | null = ls()): string | null {
  try {
    const raw = kv?.getItem(LEGACY_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || p.schemaVersion !== 1) return null;
    const id = newProjectId();
    saveSlot(id, p, kv);
    kv!.setItem(ACTIVE_KEY, id);
    kv!.removeItem(LEGACY_KEY);
    return id;
  } catch { return null; }
}

/** Which project this tab should open: the one it had, else the browser's last active one. */
function startingId(): string | null {
  const kv = ls();
  if (readIndex(kv).length === 0) { const adopted = adoptLegacy(kv); if (adopted) return adopted; }
  const tab = ss()?.getItem(TAB_KEY);
  if (tab && kv?.getItem(slotKey(tab))) return tab;
  const active = kv?.getItem(ACTIVE_KEY);
  if (active && kv?.getItem(slotKey(active))) return active;
  return readIndex(kv)[0]?.id ?? null;
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
export function previousBoard(): BoardBackup | null {
  try { const raw = localStorage.getItem(BOARD_KEY); return raw ? JSON.parse(raw) as BoardBackup : null; } catch { return null; }
}
export function forgetPreviousBoard(): void { try { localStorage.removeItem(BOARD_KEY); } catch { /* ignore */ } }

/** The open project in memory, autosaved to its own slot in the browser, with undo; plus the list of every project the browser holds. */
export function useProject() {
  const [activeId, setActiveId] = useState<string | null>(startingId);
  const [project, setProjectState] = useState<Project>(() => (activeId && loadSlot(activeId)) || normalize(blankProject({ chartOfAccounts: 'empty' })));
  const [projects, setProjects] = useState<ProjectMeta[]>(readIndex);
  const past = useRef<Project[]>([]);
  const [dirty, setDirty] = useState(false);
  const [assetTick, setAssetTick] = useState(0);
  const [storageNote, setStorageNote] = useState('');
  const idRef = useRef(activeId); idRef.current = activeId;
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
  const adopt = useCallback((p: Project): string => { const id = newProjectId(); saveSlot(id, p); setProjects(readIndex()); setActiveId(id); return id; }, []);

  // autosave, 300ms after the last change, into this project's own slot; nothing is written while no project is open
  useEffect(() => {
    if (!activeId) { if (dirty) adopt(project); return; }   // the first edit on the start screen makes it a project of its own
    const t = setTimeout(() => {
      const ok = saveSlot(activeId, project); setProjects(readIndex());
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
    const on = (e: StorageEvent) => { if (e.key === INDEX_KEY) setProjects(readIndex()); };
    window.addEventListener('storage', on); return () => window.removeEventListener('storage', on);
  }, []);

  const setProject = useCallback((next: Project | ((p: Project) => Project)) => {
    setProjectState(prev => {
      let n = typeof next === 'function' ? next(prev) : next;
      if (n.board !== prev.board || n.participants !== prev.participants) n = syncCastDaysFromBoard(adoptBoardDays(n));   // the board owns cast and follower days: every edit flows to the budget
      if (n !== prev) { past.current.push(prev); if (past.current.length > HISTORY) past.current.shift(); setDirty(true); }
      return n;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev) { setProjectState(prev); hydrate(prev); }   // a step from before the pictures came back is filled in again
  }, [hydrate]);

  /** A project from a file or a Start button: it becomes a new project in the browser; the one that was open stays in the list. */
  const replace = useCallback((p: Project) => { past.current = []; const n = normalize(p); setProjectState(n); setDirty(false); adopt(n); }, [adopt]);

  /** Close the open project (it stays saved) and show the start screen. */
  const newProject = useCallback(() => { past.current = []; setActiveId(null); setProjectState(normalize(blankProject({ chartOfAccounts: 'empty' }))); setDirty(false); }, []);

  /** Switch to another project the browser holds. */
  const openProject = useCallback((id: string): boolean => {
    const p = loadSlot(id); if (!p) return false;
    past.current = []; setActiveId(id); setProjectState(p); setDirty(false); hydrate(p); return true;
  }, [hydrate]);

  const deleteProject = useCallback((id: string) => {
    deleteSlot(id); setProjects(readIndex());
    if (idRef.current === id) newProject();
  }, [newProject]);

  return { project, setProject, undo, replace, dirty, setDirty, canUndo: past.current.length > 0, undoDepth: past.current.length, storageNote, projects, activeId, newProject, openProject, deleteProject };
}

export function downloadJson(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/[^\w-]+/g, '_')}_${p.version.replace(/[^\w-]+/g, '_') || 'v1'}.profitshare.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
