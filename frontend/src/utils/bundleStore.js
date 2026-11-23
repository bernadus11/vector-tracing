// Penyimpanan koleksi Bundle di IndexedDB browser (tidak hilang saat refresh,
// tanpa database server). Kapasitas jauh lebih besar dari localStorage.
const DB_NAME = 'vector-generate';
const STORE = 'bundleItems';
let dbPromise = null;
const memory = new Map(); // fallback kalau IndexedDB tidak tersedia

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function getAllItems() {
  const db = await openDb();
  if (!db) return [...memory.values()];
  const items = await tx(db, 'readonly', (s) => s.getAll());
  return (items || []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function putItem(item) {
  const db = await openDb();
  if (!db) { memory.set(item.id, item); return; }
  await tx(db, 'readwrite', (s) => s.put(item));
}

export async function deleteItem(id) {
  const db = await openDb();
  if (!db) { memory.delete(id); return; }
  await tx(db, 'readwrite', (s) => s.delete(id));
}

export function newItemId() {
  return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const LAYOUT_KEY = 'vtg-bundle-layout';
export function loadLayout() {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch { return null; }
}
export function saveLayout(layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
}
