// ═══════════════════════════════════════
// IndexedDB — Almacenamiento offline v2
// ═══════════════════════════════════════
const DB_NAME = 'fotoperiodo_v2';
const DB_VER  = 1;
let db = null;

function openDB() {
  return new Promise((res, rej) => {
    if (db) return res(db);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      // Siembras registradas en campo
      if (!d.objectStoreNames.contains('siembras')) {
        const s = d.createObjectStore('siembras', { keyPath: 'id', autoIncrement: true });
        s.createIndex('bloque_nave_cama', ['bloque','nave','cama','lado']);
        s.createIndex('fecha', 'fecha');
      }
      // Guirnaldas y su estado
      if (!d.objectStoreNames.contains('guirnaldas')) {
        d.createObjectStore('guirnaldas', { keyPath: 'id' });
      }
      // Lecturas horómetros
      if (!d.objectStoreNames.contains('lecturas')) {
        const l = d.createObjectStore('lecturas', { keyPath: 'id', autoIncrement: true });
        l.createIndex('bloque_fecha', ['bloque','fecha']);
      }
      // Radiometría
      if (!d.objectStoreNames.contains('radiometria')) {
        d.createObjectStore('radiometria', { keyPath: 'id', autoIncrement: true });
      }
      // GPS
      if (!d.objectStoreNames.contains('gps')) {
        d.createObjectStore('gps', { keyPath: 'id', autoIncrement: true });
      }
      // Config / sync queue
      if (!d.objectStoreNames.contains('config'))
        d.createObjectStore('config', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('sync_queue'))
        d.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror   = e => rej(e);
  });
}

async function dbPut(store, data) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = () => res(true);
    tx.onerror = e => rej(e);
  });
}
async function dbAdd(store, data) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(data);
    req.onsuccess = () => res(req.result);
    tx.onerror = e => rej(e);
  });
}
async function dbGet(store, key) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e);
  });
}
async function dbGetAll(store) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e);
  });
}
async function dbDelete(store, key) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res(true);
    tx.onerror = e => rej(e);
  });
}
async function getConfig(key) {
  const r = await dbGet('config', key);
  return r ? r.value : null;
}
async function setConfig(key, value) {
  return dbPut('config', { key, value });
}
async function addToSyncQueue(type, data) {
  return dbAdd('sync_queue', { type, data, ts: Date.now(), synced: false });
}
