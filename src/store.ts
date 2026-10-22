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

// ---- pictures live in IndexedDB, not in the slot ----
// A look book is megabytes; localStorage holds about 5 MB a site in UTF-16, which is four or five pictures and then
// silence. So the slot keeps the project with every picture's data blanked, and the pictures sit in IndexedDB under
// their ids. Loading a slot puts them back (asynchronously); Save (the .json) always has them inline.
const stored = new Set<string>();   // image ids known to be in IndexedDB this session, so autosave does not rewrite megabytes every 300ms
export const IMAGE_IN_DB = 'idb:';   // what a blanked picture's dataUrl says in the slot
/** The project with picture data moved out: write the pictures to IndexedDB and blank them in the copy that goes to the slot. */
export function stripImages(p: Project): Project {
  const lb = p.pitch?.lookbook;
  if (!lb?.length || !idbAvailable()) return p;
  const lookbook = lb.map(img => {
    if (!img.dataUrl.startsWith('data:')) return img;
    if (!stored.has(img.id)) { stored.add(img.id); void idbSet(STORES.images, img.id, img.dataUrl).catch(() => stored.delete(img.id)); }
    return { ...img, dataUrl: IMAGE_IN_DB + img.id };
  });
  return { ...p, pitch: { ...p.pitch!, lookbook } };
}
/** The pictures back from IndexedDB; a picture that is gone stays blank (and the look book shows it as missing). */
export async function hydrateImages(p: Project): Promise<Project> {
  const lb = p.pitch?.lookbook;
  if (!lb?.some(i => i.dataUrl.startsWith(IMAGE_IN_DB)) || !idbAvailable()) return p;
  const lookbook = await Promise.all(lb.map(async img => {
    if (!img.dataUrl.startsWith(IMAGE_IN_DB)) return img;
    const data = await idbGet<string>(STORES.images, img.id).catch(() => undefined);
    if (data) { stored.add(img.id); return { ...img, dataUrl: data }; }
    return { ...img, dataUrl: '' };
  }));
  return { ...p, pitch: { ...p.pitch!, lookbook } };
}

/** Write one project to its slot and refresh its row in the index (newest first). */
export function saveSlot(id: string, p: Project, kv: KV | null = ls()): void {
  try { kv?.setItem(slotKey(id), JSON.stringify(stripImages(p))); } catch { return; }
  const rest = readIndex(kv).filter(m => m.id !== id);
  writeIndex([metaOf(p, id), ...rest], kv);
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
  const p = loadSlot(id, kv);
  for (const img of p?.pitch?.lookbook ?? []) if (img.dataUrl.startsWith(IMAGE_IN_DB)) { stored.delete(img.id); void idbDel(STORES.images, img.id).catch(() => undefined); }
  try { kv?.removeItem(slotKey(id)); } catch { /* ignore */ }
  writeIndex(readIndex(kv).filter(m => m.id !== id), kv);
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
  const idRef = useRef(activeId); idRef.current = activeId;
  // pictures come back from IndexedDB after the slot loads; swapping them in is not an edit
  const hydrate = useCallback((p: Project) => {
    void hydrateImages(p).then(h => {
      if (h === p) return;
      const data = new Map((h.pitch?.lookbook ?? []).map(i => [i.id, i.dataUrl]));
      setProjectState(cur => cur === p ? h : (cur.pitch?.lookbook?.some(i => i.dataUrl.startsWith(IMAGE_IN_DB))
        ? { ...cur, pitch: { ...cur.pitch!, lookbook: cur.pitch!.lookbook!.map(i => i.dataUrl.startsWith(IMAGE_IN_DB) && data.has(i.id) ? { ...i, dataUrl: data.get(i.id)! } : i) } }
        : cur));
    });
  }, []);
  useEffect(() => { hydrate(project); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Give the in-memory project a slot of its own (the first edit on the start screen, or an Open / Start action). */
  const adopt = useCallback((p: Project): string => { const id = newProjectId(); saveSlot(id, p); setProjects(readIndex()); setActiveId(id); return id; }, []);

  // autosave, 300ms after the last change, into this project's own slot; nothing is written while no project is open
  useEffect(() => {
    if (!activeId) { if (dirty) adopt(project); return; }   // the first edit on the start screen makes it a project of its own
    const t = setTimeout(() => { saveSlot(activeId, project); setProjects(readIndex()); }, 300);
    return () => clearTimeout(t);
  }, [project, activeId, dirty]);   // eslint-disable-line react-hooks/exhaustive-deps
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
    if (prev) setProjectState(prev);
  }, []);

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

  return { project, setProject, undo, replace, dirty, setDirty, canUndo: past.current.length > 0, projects, activeId, newProject, openProject, deleteProject };
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
