import { useEffect, useState } from 'react';
import { openDb, idbRequest, idbDone, STORES } from '../shared/idb';

/**
 * Recently opened documents (IndexedDB).
 *
 * Running entirely in the browser we cannot keep file paths, so the working bytes themselves are stored.
 * Registered when opened and updated to the latest state on every annotation / content edit,
 * so it serves both restoring after reload and the "recent files" list.
 * Metadata and bytes are kept in separate stores so listing does not read the huge byte arrays.
 * The file as first opened is kept as well, for "revert to the original".
 */
const META = STORES.recentMeta;
const BYTES = STORES.recentBytes;
const ORIGINAL = STORES.recentOriginal;
const RECENT_LIMIT = 20;

export interface RecentMeta {
  id: string;
  name: string;
  /** Identifies the original file (avoid duplicates when the same file is reopened) */
  sourceKey: string;
  /** Length of the stored bytes */
  size: number;
  /** Last used time (opened / auto-saved). Sort key of the list and basis of "resume last session" */
  savedAt: number;
  /** Whether the state is after content editing (disables incremental save when restored) */
  contentEdited: boolean;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const sourceKeyOf = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

/** Newest first */
async function listRecent(): Promise<RecentMeta[]> {
  const db = await openDb();
  const all = await idbRequest(db.transaction(META).objectStore(META).getAll() as IDBRequest<RecentMeta[]>);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

const getBytes = async (store: string, id: string) => {
  const db = await openDb();
  return idbRequest(db.transaction(store).objectStore(store).get(id) as IDBRequest<Uint8Array | undefined>);
};
export const getRecentBytes = (id: string) => getBytes(BYTES, id);
/** The file as first opened; undefined for entries saved before this was kept */
export const getRecentOriginal = (id: string) => getBytes(ORIGINAL, id);

/** A partial view would clone the whole underlying buffer, so slice it out first when needed */
const owned = (bytes: Uint8Array) =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();

/**
 * Add / update. Old entries beyond the limit are removed.
 * `original`: the file as opened from disk (only when opening it; snapshots keep the stored one)
 */
export async function putRecent(meta: RecentMeta, bytes: Uint8Array, original?: Uint8Array): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, BYTES, ORIGINAL], 'readwrite');
  tx.objectStore(META).put(meta);
  tx.objectStore(BYTES).put(owned(bytes), meta.id);
  if (original) tx.objectStore(ORIGINAL).put(owned(original), meta.id);
  const all = await idbRequest(tx.objectStore(META).getAll() as IDBRequest<RecentMeta[]>);
  for (const old of all.sort((a, b) => b.savedAt - a.savedAt).slice(RECENT_LIMIT)) deleteEntry(tx, old.id);
  await idbDone(tx);
  notify();
}

/** Mark as "last used" when reopened (bytes unchanged) */
export async function touchRecent(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, 'readwrite');
  const meta = await idbRequest(tx.objectStore(META).get(id) as IDBRequest<RecentMeta | undefined>);
  if (meta) tx.objectStore(META).put({ ...meta, savedAt: Date.now() });
  await idbDone(tx);
  notify();
}

export async function removeRecent(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, BYTES, ORIGINAL], 'readwrite');
  deleteEntry(tx, id);
  await idbDone(tx);
  notify();
}

function deleteEntry(tx: IDBTransaction, id: string) {
  for (const store of [META, BYTES, ORIGINAL]) tx.objectStore(store).delete(id);
}

/** Subscribe to the list. Re-read on every add / remove */
export function useRecentList(): RecentMeta[] {
  const [list, setList] = useState<RecentMeta[]>([]);
  useEffect(() => {
    let alive = true;
    const reload = () => void listRecent().then((l) => alive && setList(l));
    reload();
    listeners.add(reload);
    return () => {
      alive = false;
      listeners.delete(reload);
    };
  }, []);
  return list;
}
