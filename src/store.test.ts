import { describe, it, expect } from 'vitest';
import { readIndex, saveSlot, loadSlot, deleteSlot, adoptLegacy, type KV } from './store';
import { sampleProject, blankProject } from './data/seed';

const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } }; };

describe('projects in the browser', () => {
  it('one slot per project, an index newest first, delete removes both', () => {
    const kv = mem();
    saveSlot('a', sampleProject(), kv);
    saveSlot('b', blankProject({ name: 'Second' }), kv);
    const idx = readIndex(kv);
    expect(idx.map(m => m.id)).toEqual(['b', 'a']);
    expect(idx[1]).toMatchObject({ name: 'SALT FLAT', scenes: 26 });
    expect(idx[1].cashBudget).toBeGreaterThan(0);
    expect(loadSlot('a', kv)?.name).toBe('SALT FLAT');
    saveSlot('a', { ...sampleProject(), version: 'Draft 9' }, kv);   // a re-save moves it to the top and refreshes its row
    expect(readIndex(kv).map(m => m.id)).toEqual(['a', 'b']);
    expect(readIndex(kv)[0].version).toBe('Draft 9');
    deleteSlot('a', kv);
    expect(loadSlot('a', kv)).toBeNull();
    expect(readIndex(kv).map(m => m.id)).toEqual(['b']);
  });
  it('the old single slot is adopted once as the first project', () => {
    const kv = mem();
    kv.setItem('profitshare.project', JSON.stringify(sampleProject()));
    const id = adoptLegacy(kv);
    expect(id).toBeTruthy();
    expect(kv.getItem('profitshare.project')).toBeNull();
    expect(readIndex(kv)).toHaveLength(1);
    expect(loadSlot(id!, kv)?.name).toBe('SALT FLAT');
    expect(kv.getItem('profitshare.activeProject')).toBe(id);
    expect(adoptLegacy(kv)).toBeNull();   // nothing left to adopt
  });
});
