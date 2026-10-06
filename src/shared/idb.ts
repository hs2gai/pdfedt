/**
 * App-wide IndexedDB. To add a store, add it to STORES and bump DB_VERSION
 * (onupgradeneeded creates only the missing stores).
 */
const DB_NAME = 'pdfedt';
const DB_VERSION = 3;

export const STORES = {
  /** Recent file metadata (keyPath: id) */
  recentMeta: 'recent-meta',
  /** Recent file bytes (key: id) */
  recentBytes: 'recent-bytes',
  /** Bytes of the file as first opened, for "revert to the original" (key: id) */
  recentOriginal: 'recent-original',
  /** Custom stamps (keyPath: id) */
  stamps: 'stamp-templates',
} as const;

const KEY_PATHS: Record<string, string | undefined> = {
  [STORES.recentMeta]: 'id',
  [STORES.recentBytes]: undefined,
  [STORES.recentOriginal]: undefined,
  [STORES.stamps]: 'id',
};

let dbPromise: Promise<IDBDatabase> | undefined;
export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      for (const name of Object.values(STORES)) {
        if (!r.result.objectStoreNames.contains(name)) {
          r.result.createObjectStore(name, KEY_PATHS[name] ? { keyPath: KEY_PATHS[name] } : undefined);
        }
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

export const idbRequest = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export const idbDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
