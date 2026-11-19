import { describe, it, expect } from 'vitest';
import { readIndex, saveSlot, loadSlot, deleteSlot, adoptLegacy, type KV } from './store';
import { sampleProject, blankProject } from './data/seed';

const mem = (): KV & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: k => {
      m.delete(k);
    },
  };
};

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
    saveSlot('a', { ...sampleProject(), version: 'Draft 9' }, kv); // a re-save moves it to the top and refreshes its row
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
    expect(adoptLegacy(kv)).toBeNull(); // nothing left to adopt
  });
});

describe('font files and pictures back from the browser store', () => {
  it('puts what was read into the project as it is now, and leaves the rest alone', async () => {
    const { mergeHydrated, stripImages, hydrateImages, IMAGE_IN_DB } = await import('./store');
    const base = sampleProject();
    const pitch = {
      logline: '',
      why: '',
      audience: { primary: '', secondary: '', notes: '' },
      sections: [],
      comps: [],
      revenue: [],
      feePct: 20,
      deck: '',
      sources: [],
    };
    const font = (dataUrl: string) => ({
      id: 'f1',
      role: 'body' as const,
      family: 'Invented Sans',
      dataUrl,
      embedOk: true,
    });
    const design = (dataUrl: string) => ({
      name: '',
      colors: { bg: '#000000', ink: '#ffffff', accent: '#ffffff', accent2: '#ffffff', muted: '#ffffff' },
      fonts: { title: '', body: '' },
      notes: '',
      fontFiles: [font(dataUrl)],
    });
    const pic = (dataUrl: string) => ({ id: 'i1', dataUrl, caption: 'edited since', section: 'tone' as const });
    const cur = {
      ...base,
      name: 'Renamed since',
      pitch: { ...pitch, lookbook: [pic(`${IMAGE_IN_DB}i1`)], design: design(`${IMAGE_IN_DB}font:f1`) },
    };
    const read = {
      ...base,
      pitch: {
        ...pitch,
        lookbook: [{ ...pic('data:image/png;base64,AAAA'), caption: '' }],
        design: design('data:font/woff2;base64,AAAA'),
      },
    };
    const merged = mergeHydrated(cur, read);
    expect(merged.name).toBe('Renamed since');
    expect(merged.pitch!.lookbook![0]).toEqual({ ...pic('data:image/png;base64,AAAA') });
    expect(merged.pitch!.design!.fontFiles![0].dataUrl).toBe('data:font/woff2;base64,AAAA');
    expect(mergeHydrated(read, read)).toBe(read); // nothing blanked: the same project back
    expect(stripImages(read)).toBe(read); // no IndexedDB here: the data stays inline
    expect(await hydrateImages(base)).toBe(base); // a project with neither is untouched
  });
});
