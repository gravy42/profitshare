// A thin IndexedDB wrapper for the big things the browser keeps for us: look book pictures and the documents the AI
// reads. localStorage is small (about 5 MB a site and counted in UTF-16); IndexedDB is not. Absent (tests, an
// ancient browser), every call resolves to nothing and the callers keep the data inline.
const DB = 'profitshare';
const VERSION = 1;
export const STORES = { images: 'images', docs: 'docs' } as const;
type Store = typeof STORES[keyof typeof STORES];

export const idbAvailable = () => typeof indexedDB !== 'undefined';

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { const d = r.result; for (const s of Object.values(STORES)) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
function tx<T>(store: Store, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (!idbAvailable()) return Promise.resolve(undefined as T);
  return open().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode); const req = f(t.objectStore(store));
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  }));
}
export const idbGet = <T,>(store: Store, key: string) => tx<T | undefined>(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>);
export const idbSet = (store: Store, key: string, value: unknown) => tx<IDBValidKey>(store, 'readwrite', s => s.put(value, key));
export const idbDel = (store: Store, key: string) => tx<undefined>(store, 'readwrite', s => s.delete(key));
export const idbKeys = (store: Store) => tx<IDBValidKey[]>(store, 'readonly', s => s.getAllKeys()).then(k => (k ?? []).map(String));
