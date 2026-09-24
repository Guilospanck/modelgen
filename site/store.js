// Saved models, in this browser's IndexedDB: { id, name, text, updated }. Every call rejects with a
// plain message when the browser won't store anything (private windows, blocked site data).
const DB = "modelgen-playground", STORE = "models";

let opening;
function db() {
  opening ??= new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch { reject(new Error("this browser won't let the page store models")); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("this browser won't let the page store models"));
  });
  opening.catch(() => { opening = undefined; }); // a later call may try again
  return opening;
}

async function run(mode, fn) {
  const tx = (await db()).transaction(STORE, mode);
  const req = fn(tx.objectStore(STORE));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("saving failed"));
  });
}

// Newest first.
export const listModels = async () => ((await run("readonly", s => s.getAll())) ?? []).sort((a, b) => b.updated - a.updated);
export const loadModel = id => run("readonly", s => s.get(id));
export const deleteModel = id => run("readwrite", s => s.delete(id));
export async function saveModel({ id, name, text }) {
  const model = { id: id ?? crypto.randomUUID(), name, text, updated: Date.now() };
  await run("readwrite", s => s.put(model));
  return model;
}
