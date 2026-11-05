'use strict';
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/';
const HEADER = new TextEncoder().encode('WTHDB01\0');
const ITERATIONS = 200000;
let sqlModule = null;
let localDB = null;
let version = null;
let idb = undefined;
const inMemoryCache = new Map();
function progress(message) { postMessage({event: 'progress', message}); }
async function openStore() {
  if (idb !== undefined) return idb;
  try {
    idb = await new Promise((resolve, reject) => {
      const request = indexedDB.open('IDsChangesetsByUser-cifrado-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('items');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    idb = null;
    progress('Advertencia: este navegador no permite la caché persistente.');
  }
  return idb;
}
async function readItem(name) {
  const store = await openStore();
  if (!store) return inMemoryCache.get(name);
  return new Promise((resolve, reject) => {
    const tx = store.transaction('items', 'readonly');
    const request = tx.objectStore('items').get(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function putItem(name, value) {
  const store = await openStore();
  if (!store) { inMemoryCache.set(name, value); return; }
  return new Promise((resolve, reject) => {
    const tx = store.transaction('items', 'readwrite');
    tx.objectStore('items').put(value, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function deleteItem(name) {
  inMemoryCache.delete(name);
  const store = await openStore();
  if (!store) return;
  return new Promise((resolve, reject) => {
    const tx = store.transaction('items', 'readwrite');
    tx.objectStore('items').delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function fetchManifest() {
  const url = new URL('../data/version.json', self.location.href);
  let data;
  try {
    const response = await fetch(url, {cache: 'no-store'});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    data = await response.json();
    if (data.format !== 'WTHDB01' || !/^[a-f0-9]{64}$/.test(data.sha256)) throw Error('Manifest de base no válido');
    try { await putItem('manifest', data); } catch (error) { progress('Aviso: no se pudo guardar el manifiesto.'); }
  } catch (error) {
    data = await readItem('manifest');
    if (!data) throw Error(`No se pudo leer data/version.json: ${error.message}`);
    progress('Sin conexión: usando la última versión guardada en este navegador.');
  }
  version = data;
  return data;
}
async function downloadPayload() {
  const key = 'payload:' + version.sha256;
  let file = await readItem(key);
  if (file instanceof Blob && file.size === version.encryptedBytes) {
    progress('Base cifrada encontrada en la caché local.');
    return file;
  }
  const url = new URL('../data/' + encodeURIComponent(version.filename), self.location.href);
  progress('Descargando base cifrada…');
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw Error(`No se pudo descargar la base: HTTP ${response.status}`);
  if (!response.body) file = await response.blob();
  else {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let reported = -1;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      const rounded = Math.floor(total / (1024 * 1024) / 5);
      if (rounded !== reported) {
        reported = rounded;
        progress(`Descargando base: ${(total / 1048576).toFixed(1)} / ${(version.encryptedBytes / 1048576).toFixed(1)} MiB`);
      }
    }
    file = new Blob(chunks, {type: 'application/octet-stream'});
  }
  if (file.size !== version.encryptedBytes) throw Error(`Descarga incompleta: ${file.size} bytes frente a ${version.encryptedBytes}`);
  try { await putItem(key, file); } catch (error) { progress('Aviso: el navegador no tiene espacio para guardar la descarga.'); }
  return file;
}
async function makeKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt}, material, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
}
async function importSQL() {
  if (sqlModule) return sqlModule;
  progress('Cargando motor SQLite WebAssembly…');
  try {
    importScripts(CDN + 'sql-wasm.js');
    sqlModule = await self.initSqlJs({locateFile: file => CDN + file});
    return sqlModule;
  } catch (error) {
    throw Error('No se ha podido cargar sql.js desde cdnjs. Necesitas conexión a Internet para la biblioteca: ' + error.message);
  }
}
async function unlock(password, remember, savedKey = null) {
  if (!version) await fetchManifest();
  const blob = await downloadPayload();
  progress('Verificando el archivo cifrado…');
  let encrypted = await blob.arrayBuffer();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encrypted));
  const digest = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== version.sha256) throw Error('El archivo cifrado no coincide con version.json (SHA-256).');
  const header = new Uint8Array(encrypted.slice(0, 8));
  if (!header.every((value, index) => value === HEADER[index])) throw Error('Formato de base no reconocido (WTHDB01).');
  const salt = new Uint8Array(encrypted.slice(8, 24));
  const iv = new Uint8Array(encrypted.slice(24, 36));
  if (!savedKey && !password) throw Error('Introduce la contraseña de la base de datos.');
  const key = savedKey || await makeKey(password, salt);
  progress('Descifrando base de datos…');
  let compressed;
  try {
    compressed = await crypto.subtle.decrypt({name: 'AES-GCM', iv, tagLength: 128}, key, new Uint8Array(encrypted, 36));
  } catch (error) {
    throw Error('Contraseña incorrecta o base cifrada dañada.');
  }
  encrypted = null;
  progress('Descomprimiendo SQLite (~310 MB). Puede tardar…');
  if (typeof DecompressionStream !== 'function') throw Error('Tu navegador no admite DecompressionStream (gzip). Utiliza Chrome, Firefox o Edge actualizados.');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  compressed = null;
  let sqliteArray = await new Response(stream).arrayBuffer();
  progress('Abriendo e indexando SQLite en el navegador…');
  const SQL = await importSQL();
  const freshDB = new SQL.Database(new Uint8Array(sqliteArray));
  sqliteArray = null;
  const test = freshDB.exec("SELECT value FROM metadata WHERE key='sequenceNumber' LIMIT 1");
  if (!test.length || Number(test[0].values[0][0]) !== Number(version.sequenceNumber)) {
    freshDB.close();
    throw Error('La secuencia de SQLite no coincide con el manifiesto.');
  }
  localDB?.close();
  localDB = freshDB;
  if (remember) {
    try { await putItem('savedKey', key); } catch (error) { progress('Aviso: no se pudo recordar el acceso en este navegador.'); }
  } else await deleteItem('savedKey').catch(() => {});
  progress('¡Historial listo para consultas!');
  return {ready: true, version, persistent: !!remember};
}
async function handle(message) {
  switch (message.action) {
    case 'init': {
      await fetchManifest();
      const key = await readItem('savedKey');
      if (key) {
        try { return await unlock(null, true, key); }
        catch (error) {
          await deleteItem('savedKey').catch(() => {});
          progress(`No se pudo abrir automáticamente: ${error.message}`);
        }
      }
      return {ready: false, version};
    }
    case 'unlock':
      return unlock(String(message.password || ''), !!message.remember);
    case 'lookup': {
      const uid = Number(message.uid);
      if (!Number.isSafeInteger(uid) || uid <= 0) throw Error('UID incorrecto');
      if (!localDB) throw Error('Primero debes desbloquear la base local');
      const results = localDB.exec('SELECT user_name, date_first, date_last FROM whosthat WHERE user_id = ? AND user_name <> ? ORDER BY date_first ASC, user_name COLLATE NOCASE', [uid, '']);
      return results.length ? results[0].values.map(([name, first, last]) => ({name, first, last})) : [];
    }
    case 'version':
      return version;
    default:
      throw Error('Acción desconocida');
  }
}
self.onmessage = async ({data}) => {
  try {
    const result = await handle(data);
    postMessage({id: data.id, ok: true, result});
  } catch (error) {
    postMessage({id: data.id, ok: false, error: error?.message || String(error)});
  }
};
