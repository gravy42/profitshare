// The store with a browser's big store behind it: an in-memory stand-in for src/idb.ts, which can be told to refuse writes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from './engine/types';

const db = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  refuse: new Set<string>(),
  writes: [] as string[],
  deletes: [] as string[],
}));
vi.mock('./idb', () => ({
  STORES: { images: 'images', docs: 'docs' },
  idbAvailable: () => true,
  idbGet: async (_s: string, key: string) => db.data.get(key),
  idbSet: async (_s: string, key: string, value: unknown) => {
    db.writes.push(key);
    if (db.refuse.has(key)) throw new Error('refused');
    db.data.set(key, value);
    return key;
  },
  idbDel: async (_s: string, key: string) => {
    db.deletes.push(key);
    db.data.delete(key);
  },
  idbKeys: async () => [...db.data.keys()],
}));

import {
  IMAGE_IN_DB,
  assetKeys,
  assetsKeptInline,
  deleteSlot,
  hydrateImages,
  loadSlot,
  mergeHydrated,
  onAssetsChanged,
  readIndex,
  resetAssetState,
  saveSlot,
  stripImages,
  type KV,
} from './store';
import { sampleProject } from './data/seed';

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
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const PIC = 'data:image/png;base64,AAAA',
  PIC2 = 'data:image/png;base64,BBBB',
  FONT = 'data:font/woff2;base64,CCCC',
  FONT2 = 'data:font/woff2;base64,DDDD';
// Invented content only.
const project = (
  over: { pics?: [string, string][]; fonts?: [string, string, ('title' | 'body')?][] } = {},
): Project => ({
  ...sampleProject(),
  pitch: {
    logline: '',
    why: '',
    audience: { primary: '', secondary: '', notes: '' },
    sections: [],
    comps: [],
    revenue: [],
    feePct: 20,
    deck: '',
    sources: [],
    lookbook: (over.pics ?? [['i1', PIC]]).map(([id, dataUrl]) => ({
      id,
      dataUrl,
      caption: '',
      section: 'tone' as const,
    })),
    design: {
      name: '',
      colors: { bg: '#000000', ink: '#ffffff', accent: '#ffffff', accent2: '#ffffff', muted: '#ffffff' },
      fonts: { title: '', body: '' },
      notes: '',
      fontFiles: (over.fonts ?? [['f1', FONT]]).map(([id, dataUrl, role]) => ({
        id,
        role: role ?? 'body',
        family: 'Invented Sans',
        dataUrl,
        embedOk: true,
      })),
    },
  },
});
const pic = (p: Project, i = 0) => p.pitch!.lookbook![i].dataUrl;
const font = (p: Project, i = 0) => p.pitch!.design!.fontFiles![i].dataUrl;

beforeEach(() => {
  db.data.clear();
  db.refuse.clear();
  db.writes.length = 0;
  db.deletes.length = 0;
  resetAssetState();
  onAssetsChanged(null);
});

describe('pictures and font files in the big store', () => {
  it('strip, then hydrate: an asset is only blanked once its write has landed, and comes back whole', async () => {
    const p = project();
    const first = stripImages(p);
    expect(pic(first)).toBe(PIC);
    expect(font(first)).toBe(FONT); // the writes are on their way: nothing is a bare reference yet
    await settle();
    expect(db.data.get('i1')).toBe(PIC);
    expect(db.data.get('font:f1')).toBe(FONT);
    const second = stripImages(p);
    expect(pic(second)).toBe(`${IMAGE_IN_DB}i1`);
    expect(font(second)).toBe(`${IMAGE_IN_DB}font:f1`);
    expect(pic(p)).toBe(PIC); // the project in memory is never touched
    expect(db.writes).toEqual(['i1', 'font:f1']); // and nothing is written twice
    const back = await hydrateImages(JSON.parse(JSON.stringify(second)));
    expect(pic(back)).toBe(PIC);
    expect(font(back)).toBe(FONT);
    expect(await hydrateImages(p)).toBe(p); // nothing blanked: the same project back
  });
  it('tells whoever is listening when a write lands, so the slot can be written again without the data', async () => {
    let told = 0;
    onAssetsChanged(() => {
      told++;
    });
    const kv = mem();
    const p = project();
    expect(saveSlot('a', p, kv)).toBe(true);
    expect(kv.m.get('profitshare.project.a')).toContain(PIC);
    await settle();
    expect(told).toBe(2);
    saveSlot('a', p, kv);
    const raw = kv.m.get('profitshare.project.a')!;
    expect(raw).not.toContain(PIC);
    expect(raw).not.toContain(FONT);
    expect(raw).toContain('"idb:i1"');
    expect(raw).toContain('"idb:font:f1"');
    expect(assetsKeptInline()).toBe(false);
  });
  it('a missing entry comes back blank, not as a reference', async () => {
    const kv = mem();
    const p = project();
    saveSlot('a', p, kv);
    await settle();
    saveSlot('a', p, kv);
    db.data.delete('font:f1');
    const back = await hydrateImages(loadSlot('a', kv)!);
    expect(pic(back)).toBe(PIC);
    expect(font(back)).toBe('');
  });
  it('a write the browser refuses leaves the data inline for good, and says so', async () => {
    db.refuse.add('font:f1');
    let told = 0;
    onAssetsChanged(() => {
      told++;
    });
    const kv = mem();
    const p = project();
    saveSlot('a', p, kv);
    await settle();
    expect(told).toBe(2);
    expect(assetsKeptInline()).toBe(true);
    saveSlot('a', p, kv);
    await settle();
    saveSlot('a', p, kv);
    const saved = loadSlot('a', kv)!;
    expect(font(saved)).toBe(FONT); // never a reference to something that is not there
    expect(pic(saved)).toBe(`${IMAGE_IN_DB}i1`); // the picture's write landed: it is a reference
    expect(db.writes.filter(k => k === 'font:f1')).toHaveLength(1); // and the refused write is not retried on every keystroke
    const back = await hydrateImages(saved);
    expect(font(back)).toBe(FONT);
    expect(pic(back)).toBe(PIC);
  });
  it('removing or replacing a font or a picture takes its entry out of the store', async () => {
    const kv = mem();
    const p = project({
      pics: [
        ['i1', PIC],
        ['i2', PIC2],
      ],
    });
    saveSlot('a', p, kv);
    await settle();
    saveSlot('a', p, kv);
    expect([...db.data.keys()].sort()).toEqual(['font:f1', 'i1', 'i2']);
    const edited = project({ pics: [['i2', PIC2]], fonts: [['f2', FONT2]] }); // a picture removed, the font file replaced
    saveSlot('a', edited, kv);
    await settle();
    saveSlot('a', edited, kv);
    expect([...db.data.keys()].sort()).toEqual(['font:f2', 'i2']);
    expect(db.deletes.sort()).toEqual(['font:f1', 'i1']);
    // undo puts the old ones back in memory: the next save stores them again
    saveSlot('a', p, kv);
    await settle();
    saveSlot('a', p, kv);
    expect([...db.data.keys()].sort()).toEqual(['font:f1', 'i1', 'i2']);
    expect(font(await hydrateImages(loadSlot('a', kv)!))).toBe(FONT);
  });
  it('removal is noticed after a reload too (nothing remembered from this session)', async () => {
    const kv = mem();
    const p = project();
    saveSlot('a', p, kv);
    await settle();
    saveSlot('a', p, kv);
    resetAssetState(); // a new session
    const loaded = await hydrateImages(loadSlot('a', kv)!);
    const without = { ...loaded, pitch: { ...loaded.pitch!, design: { ...loaded.pitch!.design!, fontFiles: [] } } };
    saveSlot('a', without, kv);
    await settle();
    expect(db.data.has('font:f1')).toBe(false);
    expect(db.data.has('i1')).toBe(true);
  });
  it('two projects that share ids (one .json opened twice): deleting one leaves what the other still uses', async () => {
    const kv = mem();
    const p = project();
    saveSlot('a', p, kv);
    saveSlot('b', p, kv);
    await settle();
    saveSlot('a', p, kv);
    saveSlot('b', p, kv);
    expect([...db.data.keys()].sort()).toEqual(['font:f1', 'i1']);
    deleteSlot('a', kv);
    await settle();
    expect(readIndex(kv).map(m => m.id)).toEqual(['b']);
    expect([...db.data.keys()].sort()).toEqual(['font:f1', 'i1']); // still b's
    const b = await hydrateImages(loadSlot('b', kv)!);
    expect(pic(b)).toBe(PIC);
    expect(font(b)).toBe(FONT);
    // b lets go of its font: now nobody uses it
    saveSlot('b', { ...b, pitch: { ...b.pitch!, design: { ...b.pitch!.design!, fontFiles: [] } } }, kv);
    await settle();
    expect([...db.data.keys()]).toEqual(['i1']);
    deleteSlot('b', kv);
    await settle();
    expect(db.data.size).toBe(0);
    expect(readIndex(kv)).toEqual([]);
  });
  it('deleting a project removes its own fonts and pictures', async () => {
    const kv = mem();
    saveSlot('a', project(), kv);
    saveSlot('b', project({ pics: [['other', PIC2]], fonts: [['fb', FONT2]] }), kv);
    await settle();
    saveSlot('a', project(), kv);
    saveSlot('b', project({ pics: [['other', PIC2]], fonts: [['fb', FONT2]] }), kv);
    deleteSlot('a', kv);
    await settle();
    expect([...db.data.keys()].sort()).toEqual(['font:fb', 'other']);
  });
  it('what comes back never overwrites a font the user replaced meanwhile, or brings back one they removed', () => {
    const blank = project({ pics: [['i1', `${IMAGE_IN_DB}i1`]], fonts: [['f1', `${IMAGE_IN_DB}font:f1`]] });
    const read = project(); // what the store gave back for that project
    expect(font(mergeHydrated(blank, read))).toBe(FONT);
    const replaced = project({ pics: [['i1', `${IMAGE_IN_DB}i1`]], fonts: [['f2', FONT2]] }); // a new file attached while the store was being read
    const merged = mergeHydrated(replaced, read);
    expect(merged.pitch!.design!.fontFiles).toEqual(replaced.pitch!.design!.fontFiles);
    expect(pic(merged)).toBe(PIC); // the picture is still filled in
    const sameId = project({ pics: [['i1', PIC2]], fonts: [['f1', FONT2]] }); // even under the same id: data of its own is never replaced
    expect(mergeHydrated(sameId, read)).toBe(sameId);
    const removed = project({ pics: [['i1', `${IMAGE_IN_DB}i1`]], fonts: [] });
    expect(mergeHydrated(removed, read).pitch!.design!.fontFiles).toEqual([]);
    const missing = project({ pics: [['i1', `${IMAGE_IN_DB}i1`]], fonts: [['f1', `${IMAGE_IN_DB}font:f1`]] });
    const gone = project({ pics: [['i1', '']], fonts: [['f1', '']] }); // the store had neither
    expect(font(mergeHydrated(missing, gone))).toBe('');
  });
  it('a step Undo can go back to, taken before the data came back, is filled in the same way', () => {
    const before = project({ pics: [['i1', `${IMAGE_IN_DB}i1`]], fonts: [['f1', `${IMAGE_IN_DB}font:f1`]] });
    const filled = mergeHydrated({ ...before, name: 'An older step' }, project());
    expect(filled.name).toBe('An older step');
    expect(pic(filled)).toBe(PIC);
    expect(font(filled)).toBe(FONT);
  });
  it('reads anything in those lists without throwing', async () => {
    const p = project();
    const junk = {
      ...p,
      pitch: {
        ...p.pitch!,
        lookbook: [null, 'x', 4, { id: 7 }, { id: 'ok', dataUrl: PIC }] as never,
        design: { ...p.pitch!.design!, fontFiles: [null, 'x', { id: 'f' }, { id: 'g', dataUrl: 9 }] as never },
      },
    };
    expect(() => stripImages(junk)).not.toThrow();
    await settle();
    expect(() => mergeHydrated(junk, junk)).not.toThrow();
    expect([...assetKeys(junk)]).toEqual(['ok']);
    await expect(hydrateImages(junk)).resolves.toBe(junk);
    expect(() => saveSlot('a', junk, mem())).not.toThrow();
    expect([...assetKeys(null)]).toEqual([]);
  });
});
