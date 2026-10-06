import { useEffect, useState } from 'react';
import { openDb, idbRequest, idbDone, STORES } from '../../shared/idb';
import { BUILTIN_TEMPLATES, type StampTemplate } from './template';
import { uuid } from '../../shared/uuid';
import { t as tr } from '../../i18n';

/** Storage of custom stamps (IndexedDB) and JSON export / import */
const STORE = STORES.stamps;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function listUserTemplates(): Promise<StampTemplate[]> {
  const db = await openDb();
  const all = await idbRequest(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<StampTemplate[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putTemplate(template: StampTemplate): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ ...template, builtin: undefined, updatedAt: Date.now() });
  await idbDone(tx);
  notify();
}

export async function removeTemplate(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await idbDone(tx);
  notify();
}

/** Custom (newest first) + built-in. Show the user's own stamps first */
export function useStampTemplates(): StampTemplate[] {
  const [user, setUser] = useState<StampTemplate[]>([]);
  useEffect(() => {
    let alive = true;
    const reload = () => void listUserTemplates().then((l) => alive && setUser(l));
    reload();
    listeners.add(reload);
    // Pick up stamps saved in the editor in another tab
    window.addEventListener('focus', reload);
    return () => {
      alive = false;
      listeners.delete(reload);
      window.removeEventListener('focus', reload);
    };
  }, []);
  return [...user, ...BUILTIN_TEMPLATES];
}

// ---------------------------------------------------------------------------
// JSON export / import

interface StampFile {
  format: 'pdfugu-stamps';
  version: 1;
  stamps: StampTemplate[];
}

export function templatesToJson(templates: StampTemplate[]): string {
  const file: StampFile = {
    format: 'pdfugu-stamps',
    version: 1,
    stamps: templates.map((t) => ({ ...t, builtin: undefined })),
  };
  return JSON.stringify(file, null, 2);
}

/** Validates the JSON and returns it. IDs are reassigned (to avoid clashing with existing ones) */
export function templatesFromJson(json: string): StampTemplate[] {
  const file = JSON.parse(json) as Partial<StampFile>;
  if (file.format !== 'pdfugu-stamps' || !Array.isArray(file.stamps)) {
    throw new Error(tr('stamp.notStampFile'));
  }
  return file.stamps.map((t) => {
    if (typeof t.name !== 'string' || !Array.isArray(t.elements) || !(t.width > 0) || !(t.height > 0)) {
      throw new Error(tr('stamp.parseFailed'));
    }
    return { ...t, id: uuid(), builtin: undefined, updatedAt: Date.now() };
  });
}
