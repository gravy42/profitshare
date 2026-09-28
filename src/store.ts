import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from './engine/types';
import { sampleProject } from './data/seed';

const KEY = 'profitshare.project';
const HISTORY = 30;

function loadSaved(): Project | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const p = JSON.parse(raw); if (p && p.schemaVersion === 1) return p; }
  } catch { /* private mode, blocked storage, corrupt json – fall through */ }
  return null;
}
/** True when this browser already had a project autosaved (so the app opens on it rather than the start screen). */
export const hadSavedProject = () => loadSaved() !== null;
const load = (): Project => loadSaved() ?? sampleProject();

/** One project in memory, autosaved to localStorage, with undo. */
export function useProject() {
  const [project, setProjectState] = useState<Project>(load);
  const past = useRef<Project[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(project)); } catch { /* ignore */ } }, 300);
    return () => clearTimeout(t);
  }, [project]);

  const setProject = useCallback((next: Project | ((p: Project) => Project)) => {
    setProjectState(prev => {
      const n = typeof next === 'function' ? next(prev) : next;
      if (n !== prev) { past.current.push(prev); if (past.current.length > HISTORY) past.current.shift(); setDirty(true); }
      return n;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev) setProjectState(prev);
  }, []);

  const replace = useCallback((p: Project) => { past.current = []; setProjectState(p); setDirty(false); }, []);

  return { project, setProject, undo, replace, dirty, setDirty, canUndo: past.current.length > 0 };
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
