const DB_NAME = "jtrim-file-system";
const DB_VERSION = 1;
const RECENTS_STORE = "recent-directories";
const PREFS_STORE = "preferences";

function indexedDbAvailable() {
  return typeof indexedDB !== "undefined";
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function openDatabase() {
  if (!indexedDbAvailable()) return null;
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(RECENTS_STORE)) {
      const store = db.createObjectStore(RECENTS_STORE, { keyPath: "id" });
      store.createIndex("lastUsedAt", "lastUsedAt");
    }
    if (!db.objectStoreNames.contains(PREFS_STORE)) {
      db.createObjectStore(PREFS_STORE, { keyPath: "key" });
    }
  };
  return await requestToPromise(request);
}

async function sameEntry(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (typeof a.isSameEntry !== "function") return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `recent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function recentHandleStoreAvailable() {
  return indexedDbAvailable();
}

export async function listRecentDirectories() {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const transaction = db.transaction(RECENTS_STORE, "readonly");
    const records = await requestToPromise(transaction.objectStore(RECENTS_STORE).getAll());
    await transactionDone(transaction);
    return records.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } finally {
    db.close();
  }
}

export async function saveRecentDirectory(handle, {
  preferredMode = "read",
  maxEntries = 10
} = {}) {
  if (!handle || handle.kind !== "directory") return null;
  const existing = await listRecentDirectories();
  let record = null;

  for (const candidate of existing) {
    if (candidate.name !== handle.name) continue;
    if (await sameEntry(candidate.handle, handle)) {
      record = candidate;
      break;
    }
  }

  const next = {
    id: record?.id || makeId(),
    name: handle.name,
    handle,
    lastUsedAt: Date.now(),
    preferredMode
  };

  const db = await openDatabase();
  if (!db) return null;
  try {
    let transaction = db.transaction(RECENTS_STORE, "readwrite");
    transaction.objectStore(RECENTS_STORE).put(next);
    await transactionDone(transaction);

    const all = await listRecentDirectories();
    const overflow = all.slice(Math.max(1, maxEntries));
    if (overflow.length) {
      transaction = db.transaction(RECENTS_STORE, "readwrite");
      const store = transaction.objectStore(RECENTS_STORE);
      for (const item of overflow) store.delete(item.id);
      await transactionDone(transaction);
    }
    return next;
  } finally {
    db.close();
  }
}

export async function removeRecentDirectory(id) {
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(RECENTS_STORE, "readwrite");
    transaction.objectStore(RECENTS_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function clearRecentDirectories() {
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(RECENTS_STORE, "readwrite");
    transaction.objectStore(RECENTS_STORE).clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}
