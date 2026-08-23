import type { ProjectSnapshot } from '@/types';

const DB_NAME = 'hyperframes-editor-v3';
const STORE_NAME = 'projects';
const AUTOSAVE_KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAutosave(snapshot: ProjectSnapshot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(snapshot, AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadAutosave(): Promise<ProjectSnapshot | null> {
  const db = await openDb();
  const result = await new Promise<ProjectSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(AUTOSAVE_KEY);
    request.onsuccess = () => resolve((request.result as ProjectSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
