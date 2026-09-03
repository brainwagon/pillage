// IndexedDB primitives. Knows about keys and transactions; knows nothing
// about medications, regimens or doses.

const DB_NAME = 'pillage-v1';
const DB_VERSION = 1;

// *.github.io is a single origin shared by every Pages project on an account,
// so the database name is deliberately specific.
export const MEDICATIONS = 'medications';
export const DOSES = 'doses';
export const NOTES = 'notes';
export const ALL_STORES = [MEDICATIONS, DOSES, NOTES];

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        // Doses and notes carry their key inside the record, built so that
        // lexicographic order groups a day's records together. No secondary
        // indexes: a day, or a month, is one range scan.
        db.createObjectStore(MEDICATIONS, { keyPath: 'id' });
        db.createObjectStore(DOSES, { keyPath: 'key' });
        db.createObjectStore(NOTES, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked by another open tab'));
  });
  return dbPromise;
}

// Runs `fn` inside one transaction. `fn` must issue every request
// synchronously; to return data, return a thunk reading `request.result`,
// which is called once the transaction commits.
export async function withTx(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let out;
    try {
      out = fn(tx);
    } catch (err) {
      try { tx.abort(); } catch { /* already aborting */ }
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(typeof out === 'function' ? out() : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

// Every key beginning with `prefix`. U+FFFF sorts above any character we
// put in a key, so this bounds the prefix without needing an index.
export function prefixRange(prefix) {
  return IDBKeyRange.bound(prefix, prefix + '\uffff');
}

export function getAll(store, query) {
  return withTx(store, 'readonly', (tx) => {
    const req = tx.objectStore(store).getAll(query ?? undefined);
    return () => req.result;
  });
}

export function put(store, value) {
  return withTx(store, 'readwrite', (tx) => { tx.objectStore(store).put(value); });
}

export function del(store, key) {
  return withTx(store, 'readwrite', (tx) => { tx.objectStore(store).delete(key); });
}

export function delRange(store, range) {
  return withTx(store, 'readwrite', (tx) => { tx.objectStore(store).delete(range); });
}

// Wipe and reload every store in a single transaction, so a failed import
// cannot leave the database half-replaced.
export function replaceAll({ medications, doses, notes }) {
  return withTx(ALL_STORES, 'readwrite', (tx) => {
    const stores = {
      [MEDICATIONS]: medications,
      [DOSES]: doses,
      [NOTES]: notes,
    };
    for (const [name, records] of Object.entries(stores)) {
      const store = tx.objectStore(name);
      store.clear();
      for (const record of records) store.put(record);
    }
  });
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts, e.g. opening the files over file://.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
