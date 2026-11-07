'use strict';
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.15.2/';
const HEADER = new TextEncoder().encode('WTHDB01\0');
const ITERATIONS = 200000;
const EPOCH_MS = Date.UTC(2005, 3, 17);
const DAY_MS = 86400000;
let sqlModule = null;
let localDB = null;
let sharedNamesCache = null;
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
async function pruneOldPayloads(activeKey) {
  const store = await openStore();
  if (!store) { for (const key of inMemoryCache.keys()) if (key.startsWith('payload:') && key !== activeKey) inMemoryCache.delete(key); return; }
  await new Promise((resolve, reject) => {
    const tx = store.transaction('items', 'readwrite');
    const request = tx.objectStore('items').openCursor();
    request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (typeof cursor.key === 'string' && cursor.key.startsWith('payload:') && cursor.key !== activeKey) cursor.delete(); cursor.continue(); };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function checkManifest(data) {
  if (!data || data.format !== 'WTHDB01' || data.dateEpoch !== '2005-04-17' || !/^[a-f0-9]{64}$/.test(data.sha256) || !Number.isSafeInteger(data.sequenceNumber) || !Number.isSafeInteger(data.records) || !Number.isSafeInteger(data.sqliteBytes) || !Number.isSafeInteger(data.encryptedBytes)) throw Error('La base publicada no utiliza el formato exclusivo de fechas relativas requerido.');
  return data;
}
async function fetchManifest() {
  const url = new URL('../data/version.json', self.location.href);
  let data;
  try {
    const response = await fetch(url, {cache: 'no-store'});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    data = checkManifest(await response.json());
    try { await putItem('manifest', data); } catch (error) { progress('Aviso: no se pudo guardar el manifiesto.'); }
  } catch (error) {
    data = await readItem('manifest');
    if (!data) throw Error(`No se pudo leer un manifiesto válido: ${error.message}`);
    checkManifest(data);
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
  let blob = await downloadPayload();
  progress('Verificando el archivo cifrado…');
  let encrypted = await blob.arrayBuffer();
  blob = null;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encrypted));
  const digest = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== version.sha256) { await deleteItem('payload:' + version.sha256).catch(() => {}); throw Error('El archivo cifrado no coincide con version.json (SHA-256).'); }
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
  progress(`Descomprimiendo SQLite (${(version.sqliteBytes / 1048576).toFixed(0)} MiB). Puede tardar…`);
  if (typeof DecompressionStream !== 'function') throw Error('Tu navegador no admite DecompressionStream (gzip). Utiliza Chrome, Firefox o Edge actualizados.');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  compressed = null;
  let sqliteArray = await new Response(stream).arrayBuffer();
  progress('Abriendo SQLite y verificando el formato…');
  const SQL = await importSQL();
  const freshDB = new SQL.Database(new Uint8Array(sqliteArray));
  sqliteArray = null;
  try {
    const values = freshDB.exec('SELECT key,value FROM metadata');
    const meta = new Map(values[0]?.values || []);
    const columns = freshDB.exec('PRAGMA table_info(whosthat)')[0]?.values || [];
    const expected = ['user_id', 'user_name', 'date_first', 'date_span'];
    const types = ['INTEGER', 'TEXT', 'INTEGER', 'INTEGER'];
    if (meta.get('dateEpoch') !== '2005-04-17' || Number(meta.get('sequenceNumber')) !== version.sequenceNumber || columns.length !== 4 || columns.some((col, i) => col[1] !== expected[i] || String(col[2]).toUpperCase() !== types[i] || (i < 2 && col[5] !== i + 1)) || Number(freshDB.exec('SELECT COUNT(*) FROM whosthat')[0]?.values[0][0]) !== version.records) throw Error('Base SQLite incompatible: se exige el formato de fechas relativas.');
  } catch (error) {
    freshDB.close();
    throw error;
  }
  localDB?.close();
  localDB = freshDB;
  sharedNamesCache = null;
  try { await pruneOldPayloads('payload:' + version.sha256); } catch (error) { progress('Aviso: no se pudieron eliminar versiones antiguas de la caché.'); }
  if (remember) {
    try { await putItem('savedKey', key); } catch (error) { progress('Aviso: no se pudo recordar el acceso en este navegador.'); }
  } else await deleteItem('savedKey').catch(() => {});
  progress('¡Historial listo para consultas!');
  return {ready: true, version, persistent: !!remember};
}
function dateText(offset) {
  if (!Number.isSafeInteger(offset)) throw Error('Desplazamiento de fecha incorrecto');
  const date = new Date(EPOCH_MS + offset * DAY_MS);
  if (Number.isNaN(date.getTime())) throw Error('Fecha fuera del rango admitido');
  return date.toISOString().slice(0, 10);
}
function dayOffset(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Fecha incorrecta');
  const timestamp = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw Error('Fecha incorrecta');
  return Math.round((timestamp - EPOCH_MS) / DAY_MS);
}
function historyRecord([uid, name, first, span]) {
  return {uid, name, first: dateText(first), last: dateText(first + span)};
}
const EXPLORER_PAGE_SIZE = 100;
function historyUid(value) {
  const uid = Number(value);
  if (!Number.isSafeInteger(uid) || uid <= 0) throw Error('UID incorrecto');
  return uid;
}
function historyRows(sql, params = []) {
  const statement = localDB.prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.get());
  } finally { statement.free(); }
  return rows;
}
function historyPage(rows, map) {
  return {rows: rows.slice(0, EXPLORER_PAGE_SIZE).map(map), more: rows.length > EXPLORER_PAGE_SIZE};
}
function historyOrder(message, fields, sortDefault, directionDefault, tie = 'user_id ASC,user_name ASC') {
  const sort = message.sort === undefined ? sortDefault : String(message.sort);
  const direction = message.direction === undefined ? directionDefault : String(message.direction);
  if (!Object.hasOwn(fields, sort) || !['asc', 'desc'].includes(direction)) throw Error('Orden de columnas incorrecto.');
  return fields[sort] + ' ' + direction.toUpperCase() + ',' + tie;
}
function historyRegexSorted(pattern, page, order) {
  let expression;
  try { expression = new RegExp(pattern, 'i'); } catch (error) { throw Error('Regex no válida: ' + error.message); }
  const statement = localDB.prepare('SELECT user_id,user_name,date_first,date_span FROM whosthat WHERE user_name <> ? ORDER BY ' + order);
  const rows = [];
  let matches = 0;
  try {
    statement.bind(['']);
    while (statement.step()) {
      const row = statement.get();
      if (!expression.test(row[1])) continue;
      if (matches >= page * EXPLORER_PAGE_SIZE) rows.push(row);
      matches++;
      if (rows.length > EXPLORER_PAGE_SIZE) break;
    }
  } finally { statement.free(); }
  return historyPage(rows, historyRecord);
}
function sharedNames() {
  if (sharedNamesCache) return sharedNamesCache;
  const rows = historyRows('SELECT user_name,COUNT(*),MIN(date_first),MAX(date_first+date_span) FROM whosthat WHERE user_name <> ? GROUP BY user_name HAVING COUNT(*) > 1', ['']);
  sharedNamesCache = rows.map(([name, total, first, last]) => ({name, total, first: dateText(first), last: dateText(last)}));
  return sharedNamesCache;
}
function historyRegex(pattern, cursor) {
  if (pattern.length > 120) throw Error('El patrón regex no puede superar 120 caracteres.');
  let expression;
  try { expression = new RegExp(pattern, 'i'); } catch (error) { throw Error('Regex no válida: ' + error.message); }
  let after = null;
  if (cursor !== undefined && cursor !== null && cursor !== 0) {
    if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isSafeInteger(cursor[0]) || cursor[0] <= 0 || typeof cursor[1] !== 'string' || !cursor[1]) throw Error('Cursor de búsqueda inválido.');
    after = cursor;
  }
  const rows = [];
  let lastMatch = after;
  while (rows.length <= EXPLORER_PAGE_SIZE) {
    const sql = after ? 'SELECT user_id,user_name,date_first,date_span FROM whosthat WHERE (user_id,user_name) > (?,?) AND user_name <> ? ORDER BY user_id,user_name LIMIT 2000' : 'SELECT user_id,user_name,date_first,date_span FROM whosthat WHERE user_name <> ? ORDER BY user_id,user_name LIMIT 2000';
    const batch = historyRows(sql, after ? [after[0], after[1], ''] : ['']);
    if (!batch.length) break;
    for (const [uid, name, first, span] of batch) {
      after = [uid, name];
      if (!expression.test(name)) continue;
      rows.push(historyRecord([uid, name, first, span]));
      if (rows.length === EXPLORER_PAGE_SIZE) lastMatch = after;
      if (rows.length > EXPLORER_PAGE_SIZE) break;
    }
    if (rows.length > EXPLORER_PAGE_SIZE || batch.length < 2000) break;
  }
  return {rows: rows.slice(0, EXPLORER_PAGE_SIZE), more: rows.length > EXPLORER_PAGE_SIZE, nextCursor: lastMatch};
}
function historyExplore(message) {
  if (!localDB) throw Error('Primero debes desbloquear la base local.');
  const mode = String(message.mode || '');
  if (mode === 'user') {
    const uid = historyUid(message.uid);
    const rows = historyRows('SELECT user_name,date_first,date_span FROM whosthat WHERE user_id = ? AND user_name <> ? ORDER BY date_first ASC,user_name COLLATE NOCASE LIMIT 1001', [uid, '']);
    return {uid, rows: rows.slice(0, 1000).map(([name, first, span]) => ({name, first: dateText(first), last: dateText(first + span)})), more: rows.length > 1000};
  }
  if (mode === 'shared_users') {
    const name = String(message.name || '');
    const page = Number(message.page || 0);
    if (!name || name.length > 255) throw Error('Nombre compartido incorrecto.');
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw Error('Página incorrecta.');
    const rows = historyRows('SELECT user_id,user_name,date_first,date_span FROM whosthat WHERE user_name = ? ORDER BY user_id LIMIT ? OFFSET ?', [name, EXPLORER_PAGE_SIZE + 1, page * EXPLORER_PAGE_SIZE]);
    return {name, ...historyPage(rows, historyRecord)};
  }
  if (mode === 'position') {
    const uid = historyUid(message.uid);
    const min = Number(message.min || 1);
    if (!Number.isSafeInteger(min) || min < 1 || min > 100000) throw Error('Mínimo de nombres inválido.');
    const found = historyRows('SELECT COUNT(*) FROM whosthat WHERE user_id = ? AND user_name <> ?', [uid, '']);
    const total = found[0][0];
    if (!total || total < min) return {uid, total, position: null};
    const rows = historyRows('SELECT COUNT(*) FROM (SELECT user_id FROM whosthat WHERE user_name <> ? GROUP BY user_id HAVING COUNT(*) > ? OR (COUNT(*) = ? AND user_id < ?))', ['', total, total, uid]);
    return {uid, total, position: rows[0][0] + 1};
  }
  const page = Number(message.page || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw Error('Página incorrecta.');
  const offset = page * EXPLORER_PAGE_SIZE;
  if (mode === 'shared') {
    const filter = String(message.filter || '').trim();
    if (filter.length > 120) throw Error('Filtro demasiado largo.');
    const sort = message.sort === undefined ? 'total' : String(message.sort);
    const direction = message.direction === undefined ? 'desc' : String(message.direction);
    if (!['name', 'total', 'first', 'last'].includes(sort) || !['asc', 'desc'].includes(direction)) throw Error('Orden de columnas incorrecto.');
    const filtered = filter ? sharedNames().filter(row => row.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) : sharedNames();
    const collator = new Intl.Collator('es', {sensitivity: 'base'});
    const sorted = [...filtered].sort((a, b) => {
      const value = sort === 'name' ? collator.compare(a.name, b.name) : sort === 'total' ? a.total - b.total : a[sort].localeCompare(b[sort]);
      return (direction === 'asc' ? value : -value) || a.name.localeCompare(b.name);
    });
    return historyPage(sorted.slice(offset, offset + EXPLORER_PAGE_SIZE + 1), row => row);
  }
  if (mode === 'ranking') {
    const min = Number(message.min || 1);
    if (!Number.isSafeInteger(min) || min < 1 || min > 100000) throw Error('Mínimo de nombres inválido.');
    const order = historyOrder(message, {uid: 'user_id', total: 'total', last: 'last'}, 'total', 'desc', 'user_id ASC');
    const rows = historyRows('SELECT user_id,COUNT(*) AS total,MAX(date_first+date_span) AS last FROM whosthat WHERE user_name <> ? GROUP BY user_id HAVING COUNT(*) >= ? ORDER BY ' + order + ' LIMIT ? OFFSET ?', ['', min, EXPLORER_PAGE_SIZE + 1, offset]);
    return historyPage(rows, ([uid, total, last]) => ({uid, total, last: dateText(last)}));
  }
  if (mode !== 'names' && mode !== 'dates') throw Error('Modo de búsqueda incorrecto.');
  const filters = ['user_name <> ?'];
  const params = [''];
  if (mode === 'names') {
    const name = String(message.name || '').trim();
    const match = String(message.match || 'contains');
    if (!['exact', 'starts', 'contains', 'regex'].includes(match)) throw Error('Tipo de búsqueda incorrecto.');
    if (!name && !message.uid) throw Error('Introduce un nombre, patrón o UID.');
    if (name.length > 120) throw Error('La búsqueda no puede superar 120 caracteres.');
    if (match === 'regex' && name) {
      const order = historyOrder(message, {uid: 'user_id', name: 'user_name COLLATE NOCASE', first: 'date_first', last: '(date_first+date_span)'}, 'uid', 'asc');
      if (message.uid) {
        const uid = historyUid(message.uid);
        const expression = (() => { try { return new RegExp(name, 'i'); } catch (error) { throw Error('Regex no válida: ' + error.message); } })();
        const rows = historyRows('SELECT user_id,user_name,date_first,date_span FROM whosthat WHERE user_id = ? AND user_name <> ? ORDER BY ' + order, [uid, '']).filter(row => expression.test(row[1])).slice(offset, offset + EXPLORER_PAGE_SIZE + 1);
        return historyPage(rows, historyRecord);
      }
      if ((message.sort === undefined || message.sort === 'uid') && (message.direction === undefined || message.direction === 'asc')) return historyRegex(name, message.cursor);
      return historyRegexSorted(name, page, order);
    }
    if (message.uid) { filters.push('user_id = ?'); params.push(historyUid(message.uid)); }
    if (name && match === 'exact') { filters.push('user_name = ? COLLATE NOCASE'); params.push(name); }
    if (name && (match === 'starts' || match === 'contains')) {
      const escaped = name.replace(/[\\%_]/g, char => '\\' + char);
      filters.push("user_name LIKE ? ESCAPE '\\'");
      params.push((match === 'contains' ? '%' : '') + escaped + '%');
    }
  } else {
    const from = String(message.from || ''), to = String(message.to || '');
    if (!from && !to) throw Error('Introduce al menos una fecha.');
    const start = from ? dayOffset(from) : null;
    const end = to ? dayOffset(to) : null;
    if (from && to && start > end) throw Error('La fecha inicial es posterior a la final.');
    const dateMode = String(message.dateMode || 'first');
    if (!['first', 'last', 'overlap'].includes(dateMode)) throw Error('Tipo de fecha incorrecto.');
    if (dateMode === 'overlap') {
      if (start !== null) { filters.push('(date_first+date_span) >= ?'); params.push(start); }
      if (end !== null) { filters.push('date_first <= ?'); params.push(end); }
    } else {
      const col = dateMode === 'first' ? 'date_first' : '(date_first+date_span)';
      if (start !== null) { filters.push(col + ' >= ?'); params.push(start); }
      if (end !== null) { filters.push(col + ' <= ?'); params.push(end); }
    }
  }
  const sortDefault = mode === 'dates' ? (message.dateMode === 'last' ? 'last' : 'first') : 'name';
  const order = historyOrder(message, {uid: 'user_id', name: 'user_name COLLATE NOCASE', first: 'date_first', last: '(date_first+date_span)'}, sortDefault, mode === 'dates' ? 'desc' : 'asc');
  const rows = historyRows('SELECT user_id,user_name,date_first,date_span FROM whosthat WHERE ' + filters.join(' AND ') + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?', [...params, EXPLORER_PAGE_SIZE + 1, offset]);
  return historyPage(rows, historyRecord);
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
      const results = localDB.exec('SELECT user_name,date_first,date_span FROM whosthat WHERE user_id = ? AND user_name <> ? ORDER BY date_first ASC,user_name COLLATE NOCASE', [uid, '']);
      return results.length ? results[0].values.map(([name, first, span]) => ({name, first: dateText(first), last: dateText(first + span)})) : [];
    }
    case 'explore':
      return historyExplore(message);
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
