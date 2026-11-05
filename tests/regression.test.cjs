'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'js/db-worker.js'), 'utf8');
const extract = name => { const line = source.split('\n').find(value => value.startsWith('const ' + name + ' = ')); assert.ok(line, 'Falta ' + name); return line; };
const attributes = text => { const result = {}; for (const match of text.matchAll(/([a-z_]+)="([^"]*)"/g)) result[match[1]] = match[2]; return result; };
class FakeElement {
  constructor(attrs, children = {}) { this.attrs = attrs; this.children = children; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  getElementsByTagName(name) { return this.children[name] || []; }
}
class FakeParser {
  parseFromString(text) {
    if (!/^<osm(?:\s[^>]*)?>[\s\S]*<\/osm>$/.test(text)) return {documentElement: {tagName: 'parsererror'}, getElementsByTagName: name => name === 'parsererror' ? [{}] : []};
    const changesets = [...text.matchAll(/<changeset\s([^>]*?)\s*\/>/g)].map(match => new FakeElement(attributes(match[1])));
    const found = /<user\s([^>]+)>/.exec(text);
    const user = found ? [new FakeElement(attributes(found[1]), {changesets: [new FakeElement({count: '500'})], traces: [new FakeElement({count: '0'})], blocks: [new FakeElement({}, {received: [new FakeElement({count: '0', active: '0'})]})]})] : [];
    return {documentElement: {tagName: 'osm'}, getElementsByTagName: name => name === 'changeset' ? changesets : name === 'user' ? user : []};
  }
}
const changeset = (id, options = {}) => { const uid = options.uid === undefined ? '8278438' : options.uid; const count = options.count === undefined ? '1' : options.count; const date = options.date === undefined ? '2026-11-05T12:00:00Z' : options.date; const attributes = [`id="${id}"`, uid === null ? '' : `uid="${uid}"`, count === null ? '' : `changes_count="${count}"`, date === null ? '' : `created_at="${date}"`, 'user="Jordi MF"']; if (options.bbox !== false) attributes.push('min_lat="41" min_lon="2" max_lat="42" max_lon="3"'); return '<changeset ' + attributes.filter(Boolean).join(' ') + '/>'; };
const osm = elements => '<osm version="0.6">' + elements.join('') + '</osm>';
const userXml = uid => '<osm><user id="' + uid + '" display_name="Jordi MF"><changesets count="500"/></user></osm>';
const response = (text, status = 200) => ({ok: status === 200, status, text: async () => text});
function harness(pages, options = {}) {
  const dom = new Map();
  const $ = id => { if (!dom.has(id)) dom.set(id, {value: '', textContent: '', hidden: false, style: {color: ''}, classList: {add() {}, remove() {}, toggle() {}}, onclick: null}); return dom.get(id); };
  const ctx = { $, AbortController, DOMParser: FakeParser, encodeURIComponent, Date, Number, Map, Set, Error, RegExp, console, setTimeout: cb => setTimeout(cb, 0), clearTimeout, window: {WhoDB: {ready: false}}, activeRun: 0, loadController: null, resultsReady: false, order: [], records: new Map(), pending: [], errs: [], unlocatedIds: [], worldExtent: [Infinity, Infinity, -Infinity, -Infinity], sel: new Set(), closed: false, lassoBounds: null, exported: 0, currentUserUid: null, lastError: '', doneText: '', ov: {hidden: true}, frozen: false};
  ctx.ol = {Feature: class {constructor(value) {this.geometry = value.geometry;} set() {}}, geom: {Point: class {}, Polygon: class {}}, proj: {fromLonLat: point => point, transformExtent: box => box}, extent: {extend: (extent, box) => {extent[0] = Math.min(extent[0], box[0]);extent[1] = Math.min(extent[1], box[1]);extent[2] = Math.max(extent[2], box[2]);extent[3] = Math.max(extent[3], box[3]);}}};
  ctx.clear = () => {ctx.activeRun++;ctx.loadController?.abort();ctx.loadController = null;ctx.order = [];ctx.records.clear();ctx.pending = [];ctx.unlocatedIds = [];ctx.errs = [];ctx.$('ids').value = '';ctx.$('selectedIds').value = '';ctx.$('errorLog').value = '';ctx.$('finishMessage').textContent = '';ctx.$('finishMessage').hidden = true;ctx.ov.hidden = true;};
  ctx.openOv = () => {ctx.ov.hidden = false;};
  ctx.msg = () => {};
  ctx.err = text => {ctx.lastError = text;ctx.ov.hidden = false;ctx.frozen = true;};
  ctx.flushMap = () => {ctx.pending = [];};
  ctx.renderList = () => {};
  ctx.summary = () => {};
  ctx.syncMapSelection = () => {};
  ctx.publishIds = () => {ctx.$('ids').value = ctx.order.join(',');ctx.exported = ctx.order.length;};
  ctx.done = text => {ctx.doneText = text;ctx.publishIds();ctx.$('finishMessage').textContent = text;ctx.$('finishMessage').hidden = false;};
  ctx.alert = text => {throw Error(text);};
  let index = 0;
  ctx.fetch = async (url, settings) => {
    if (url.includes('/api/0.6/user/')) return response(userXml(options.userUid || '8278438'));
    if (url.includes('display_name=')) return response(osm([changeset('400')]));
    const item = pages[index++];
    if (item === 'pending') return new Promise((resolve, reject) => {settings.signal.addEventListener('abort', () => reject(Error('Cancelada')), {once: true});});
    if (item === 'http503') return response('Servidor no disponible', 503);
    return response(item === undefined ? osm([]) : item);
  };
  vm.createContext(ctx);
  for (const name of ['xml', 'validOSMId', 'verifyUID', 'verifyChangesetBatch', 'req', 'addCS', 'user', 'loadCS', 'failLoad', 'startLoad']) vm.runInContext(extract(name), ctx);
  vm.runInContext(source.split('\n').find(line => line.startsWith("$('ovX').onclick =")), ctx);
  $('userUID').value = options.uid || '8278438';
  $('maxChangesets').value = String(options.limit || 200);
  return {ctx, $, load: () => vm.runInContext('startLoad()', ctx), calls: () => index};
}
test('Los IDs no son exportables antes de completar la carga', () => {const dom = {ids: {value: ''}, selectedIds: {value: ''}}, ctx = {$: id => dom[id], order: ['101','102'], exported: 0, resultsReady: false, sel: new Set(['101']), selectionTextTimer: null, clearTimeout, String};vm.createContext(ctx);for (const name of ['publishIds', 'writeSelected']) vm.runInContext(extract(name), ctx);vm.runInContext('publishIds();writeSelected()', ctx);assert.equal(dom.ids.value, '');assert.equal(dom.selectedIds.value, '');ctx.resultsReady = true;vm.runInContext('publishIds();writeSelected()', ctx);assert.equal(dom.ids.value, '101,102');assert.equal(dom.selectedIds.value, '101');});
test('Un lote válido incorpora cambios con geometría y sin bbox', async () => {const h = harness([osm([changeset('101'), changeset('102', {bbox: false}), changeset('103', {count: 0, bbox: false})])]);await h.load();assert.deepEqual(Array.from(h.ctx.order), ['101', '102']);assert.deepEqual(Array.from(h.ctx.unlocatedIds), ['102']);assert.match(h.$('errorLog').value, /Sin datos modificados/);assert.match(h.$('ids').value, /101,102/);});
test('XML malformado después de un lote válido descarta todos los IDs', async () => {const h = harness([osm(Array.from({length: 100}, (_, i) => changeset(i + 100))), '<osm><changeset'], {limit: 200});await h.load();assert.equal(h.calls(), 2);assert.equal(h.ctx.order.length, 0);assert.equal(h.$('ids').value, '');assert.match(h.$('errorLog').value, /XML de OSM inválida/);assert.match(h.$('finishMessage').textContent, /descartado/);});
test('Error HTTP después de un lote válido no deja una selección reversible', async () => {const h = harness([osm(Array.from({length: 100}, (_, i) => changeset(i + 100))), 'http503']);await h.load();assert.equal(h.ctx.order.length, 0);assert.equal(h.$('ids').value, '');assert.match(h.$('errorLog').value, /HTTP 503/);});
test('Paginación bloqueada no entrega resultados parciales', async () => {const batch = osm(Array.from({length: 100}, (_, i) => changeset(i + 100)));const h = harness([batch, batch]);await h.load();assert.equal(h.ctx.order.length, 0);assert.equal(h.$('ids').value, '');assert.match(h.$('errorLog').value, /Paginación incompleta/);});
test('Error de integridad UID en segundo lote descarta la carga', async () => {const h = harness([osm(Array.from({length: 100}, (_, i) => changeset(i + 100))), osm([changeset('200', {uid: '99'})])]);await h.load();assert.equal(h.ctx.order.length, 0);assert.match(h.$('errorLog').value, /UID recibido 99/);});
test('Fecha o recuento ausente descarta la carga', async () => {for (const options of [{date: null}, {count: null}, {date: 'falsa'}, {count: '-1'}]) {const h = harness([osm([changeset('101', options)])]);await h.load();assert.equal(h.ctx.order.length, 0);assert.match(h.$('errorLog').value, /ALERTA DE INTEGRIDAD/);}});
test('Cancelar durante el segundo lote vacía la carga', async () => {const h = harness([osm(Array.from({length: 100}, (_, i) => changeset(i + 100))), 'pending']);const promise = h.load();for (let i = 0; i < 100 && h.calls() < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));assert.equal(h.calls(), 2);assert.equal(h.ctx.order.length, 100);h.$('ovX').onclick();await promise;assert.equal(h.ctx.order.length, 0);assert.equal(h.$('ids').value, '');assert.match(h.$('finishMessage').textContent, /cancelada/);});
test('Resolver por nombre conserva el UID verificado', async () => {const h = harness([osm([changeset('101')])]);h.$('userUID').value = '';h.$('userName').value = 'Jordi MF';await h.load();assert.equal(h.$('userUID').value, '8278438');assert.deepEqual(Array.from(h.ctx.order), ['101']);});
test('La ficha de usuario con UID distinto detiene la consulta', async () => {const h = harness([osm([changeset('101')])], {userUid: '9'});await h.load();assert.equal(h.ctx.order.length, 0);assert.match(h.$('errorLog').value, /Ficha del usuario/);});
test('El lazo cóncavo rechaza las cajas cuyos bordes lo atraviesan', () => {const ctx = {pts: [[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6]], lassoBounds: [0,0,6,6], Math};vm.createContext(ctx);for (const name of ['inside', 'segmentIntersection', 'bboxInsideLasso']) vm.runInContext(extract(name), ctx);assert.equal(vm.runInContext('bboxInsideLasso([1,1,5,5])', ctx), false);assert.equal(vm.runInContext('bboxInsideLasso([0.5,0.5,1.5,1.5])', ctx), true);assert.equal(vm.runInContext('bboxInsideLasso(null)', ctx), false);});
test('Al cambiar el tamaño del listado se vuelven a calcular filas visibles', () => {const ctx = {windowStart: 4, windowEnd: 18, listScheduled: false, detailBox: {}, calls: 0, renderList: () => {ctx.calls++;}, requestAnimationFrame: cb => cb(), ResizeObserver: class {constructor(cb) {this.callback = cb;ctx.observer = this;} observe(target) {assert.equal(target, ctx.detailBox);}}};vm.createContext(ctx);vm.runInContext(extract('scheduleList'), ctx);vm.runInContext(source.split('\n').find(line => line.startsWith('new ResizeObserver(')), ctx);ctx.observer.callback();assert.equal(ctx.windowStart, -1);assert.equal(ctx.windowEnd, -1);assert.equal(ctx.calls, 1);});
test('Regex recorre una tabla WITHOUT ROWID por páginas sin repeticiones', () => {const db = new DatabaseSync(':memory:');db.exec('CREATE TABLE whosthat(user_id INTEGER NOT NULL,user_name TEXT NOT NULL,date_first TEXT NOT NULL,date_last TEXT NOT NULL,PRIMARY KEY(user_id,user_name)) WITHOUT ROWID');const ins = db.prepare('INSERT INTO whosthat VALUES(?,?,?,?)');db.exec('BEGIN');for (let i = 1; i <= 253; i++) ins.run(i, 'Nombre  ' + i, '2026-01-01', '2026-10-01');db.exec('COMMIT');const sqlModule = {Database: class {}};const ctx = {TextEncoder, self: {}, postMessage: () => {}, console};vm.createContext(ctx);vm.runInContext(workerSource, ctx);const adapter = {prepare(query) {const statement = db.prepare(query);let rows = [], index = 0;return {bind(params) {rows = statement.all(...params).map(Object.values);},step() {return index < rows.length;},get() {return rows[index++];},free() {}};}};ctx.adapter = adapter;vm.runInContext('localDB = adapter', ctx);let cursor = 0;let rows = [];let page = 0;while (true) {ctx.request = {mode: 'names', match: 'regex', name: '^Nombre  +[0-9]+$', cursor};const result = vm.runInContext('historyExplore(request)', ctx);rows.push(...result.rows);page++;if (!result.more) break;cursor = result.nextCursor;assert.ok(page < 10);}assert.equal(rows.length, 253);assert.equal(new Set(rows.map(x => String(x.uid) + x.name)).size, 253);assert.equal(page, 3);db.close();});
