'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/db-worker.js'), 'utf8');
const offset = date => (Date.parse(date + 'T00:00:00Z') - Date.UTC(2005, 3, 17)) / 86400000;
function workerHarness(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  db.exec("INSERT INTO metadata VALUES ('sequenceNumber','1'),('dateEpoch','2005-04-17')");
  db.exec('CREATE TABLE whosthat(user_id INTEGER NOT NULL,user_name TEXT NOT NULL,date_first INTEGER NOT NULL,date_span INTEGER NOT NULL,PRIMARY KEY(user_id,user_name)) WITHOUT ROWID');
  const insert = db.prepare('INSERT INTO whosthat VALUES(?,?,?,?)');
  for (const [uid, name, first, last] of rows) insert.run(uid, name, offset(first), offset(last) - offset(first));
  const ctx = {TextEncoder, self: {}, postMessage() {}, console, Date, Map, Blob};
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const adapter = {prepare(sql) {const stmt = db.prepare(sql);let entries = [], index = 0;return {bind(params) {entries = stmt.all(...params).map(Object.values);index = 0;},step() {return index < entries.length;},get() {return entries[index++];},free() {}};},exec(sql, params = []) {const rows = db.prepare(sql).all(...params).map(Object.values);return rows.length ? [{values: rows}] : [];}};
  ctx.adapter = adapter;
  vm.runInContext('localDB = adapter', ctx);
  const explore = params => {ctx.params = params;return JSON.parse(JSON.stringify(vm.runInContext('historyExplore(params)', ctx)));};
  return {db, explore};
}
const FIXTURE = [[1, 'Alba', '2021-01-01', '2021-02-01'], [2, 'Alba', '2023-01-01', '2023-03-01'], [3, 'Berta', '2022-01-01', '2022-05-01'], [4, 'Berta', '2024-01-01', '2024-06-01'], [5, 'Berta', '2025-01-01', '2025-02-01'], [6, 'alba', '2020-01-01', '2020-02-01'], [7, 'Único', '2020-01-01', '2020-02-01'], [8, '', '2020-01-01', '2020-02-01']];
test('Solo aparecen nombres idénticos utilizados por UID distintos, excluyendo vacíos', () => {
  const h = workerHarness(FIXTURE);
  const result = h.explore({mode: 'shared'});
  assert.deepEqual(result.rows.map(x => [x.name, x.total]), [['Berta', 3], ['Alba', 2]]);
  assert.equal(result.rows[0].first, '2022-01-01');
  assert.equal(result.rows[0].last, '2025-02-01');
  assert.equal(result.more, false);
  h.db.close();
});
test('Nombres compartidos se filtran y ordenan globalmente en ambas direcciones', () => {
  const h = workerHarness(FIXTURE);
  assert.deepEqual(h.explore({mode: 'shared', sort: 'name', direction: 'asc'}).rows.map(x => x.name), ['Alba', 'Berta']);
  assert.deepEqual(h.explore({mode: 'shared', sort: 'total', direction: 'asc'}).rows.map(x => x.total), [2, 3]);
  assert.deepEqual(h.explore({mode: 'shared', sort: 'last', direction: 'desc'}).rows.map(x => x.name), ['Berta', 'Alba']);
  assert.deepEqual(h.explore({mode: 'shared', filter: 'bert'}).rows.map(x => x.name), ['Berta']);
  assert.deepEqual(h.explore({mode: 'shared', filter: 'inexistente'}).rows, []);
  h.db.close();
});
test('Al abrir un nombre compartido se recuperan todos los UID y las fechas', () => {
  const h = workerHarness(FIXTURE);
  const result = h.explore({mode: 'shared_users', name: 'Alba'});
  assert.deepEqual(result.rows.map(x => x.uid), [1, 2]);
  assert.deepEqual(result.rows.map(x => x.last), ['2021-02-01', '2023-03-01']);
  assert.throws(() => h.explore({mode: 'shared_users', name: ''}), /incorrecto/);
  h.db.close();
});
test('Ordenar nombres por UID y fechas conserva páginas sin duplicados', () => {
  const rows = Array.from({length: 235}, (_, i) => [i + 1, 'Nombre ' + String(i + 1), '2026-01-01', '2026-01-02']);
  const h = workerHarness(rows);
  const options = {mode: 'names', match: 'starts', name: 'Nombre', sort: 'uid', direction: 'desc'};
  const a = h.explore({...options, page: 0});
  const b = h.explore({...options, page: 1});
  const c = h.explore({...options, page: 2});
  assert.equal(a.rows[0].uid, 235);
  assert.equal(c.rows.at(-1).uid, 1);
  assert.equal(new Set([...a.rows, ...b.rows, ...c.rows].map(row => row.uid)).size, 235);
  assert.equal(c.more, false);
  assert.equal(h.explore({mode: 'dates', dateMode: 'first', from: '2026-01-01', sort: 'uid', direction: 'asc'}).rows[0].uid, 1);
  h.db.close();
});
test('Ranking admite ordenar por UID y última observación', () => {
  const h = workerHarness(FIXTURE);
  const a = h.explore({mode: 'ranking', min: 1, sort: 'uid', direction: 'desc'});
  assert.equal(a.rows[0].uid, 7);
  const b = h.explore({mode: 'ranking', min: 1, sort: 'last', direction: 'asc'});
  assert.equal(b.rows[0].uid, 6);
  h.db.close();
});
test('Regex permite ordenar todos los resultados, no solo la página', () => {
  const rows = Array.from({length: 211}, (_, i) => [i + 1, 'R' + String(i).padStart(3, '0'), '2026-01-01', '2026-01-02']);
  const h = workerHarness(rows);
  const options = {mode: 'names', match: 'regex', name: '^R', sort: 'uid', direction: 'desc'};
  const a = h.explore(options);
  const b = h.explore({...options, page: 1});
  const c = h.explore({...options, page: 2});
  assert.deepEqual([a.rows[0].uid, b.rows[0].uid, c.rows[0].uid], [211, 111, 11]);
  assert.equal(c.rows.length, 11);
  h.db.close();
});
test('Los UID de un nombre compartido se pueden recorrer por páginas sin repetición', () => {
  const rows = Array.from({length: 207}, (_, i) => [i + 1, 'Compartido', '2026-01-01', '2026-02-01']);
  const h = workerHarness(rows);
  const pages = [0, 1, 2].map(page => h.explore({mode: 'shared_users', name: 'Compartido', page}));
  assert.deepEqual(pages.map(page => page.rows.length), [100, 100, 7]);
  assert.deepEqual(pages.map(page => page.more), [true, true, false]);
  assert.equal(new Set(pages.flatMap(page => page.rows.map(row => row.uid))).size, 207);
  h.db.close();
});
test('El orden solo acepta columnas y direcciones permitidas', () => {
  const h = workerHarness(FIXTURE);
  for (const query of [{mode: 'shared', sort: 'evil'}, {mode: 'shared', direction: 'DROP TABLE'}, {mode: 'names', name: 'Alba', sort: 'invalid'}, {mode: 'ranking', sort: 'name'}]) assert.throws(() => h.explore(query), /Orden de columnas incorrecto/);
  assert.equal(h.explore({mode: 'shared'}).rows.length, 2);
  h.db.close();
});
class Element {
  constructor(tag, document) {
    this.tagName = tag.toLowerCase();
    this.document = document;
    this.children = [];
    this.parentElement = null;
    this.handlers = new Map();
    this.attributes = {};
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.style = {};
    this.scrollTop = 0;
    this.classList = {contains: name => this.className.split(/\s+/).includes(name),toggle: (name, enabled) => {const names = new Set(this.className.split(/\s+/).filter(Boolean));if (enabled) names.add(name);else names.delete(name);this.className = [...names].join(' ');}};
  }
  set id(value) {this.identifier = value;this.document.ids.set(value, this);}
  get id() {return this.identifier;}
  append(...children) {for (const child of children) {this.children.push(child);child.parentElement = this;}}
  replaceChildren(...children) {this.children = [];this.append(...children);}
  after(element) {const parent = this.parentElement;assert.ok(parent);const i = parent.children.indexOf(this);parent.children.splice(i + 1, 0, element);element.parentElement = parent;}
  addEventListener(name, callback) {if (!this.handlers.has(name)) this.handlers.set(name, []);this.handlers.get(name).push(callback);}
  fire(name, target = this, attributes = {}) {const event = {target,preventDefault() {this.prevented = true;},...attributes};for (const callback of this.handlers.get(name) || []) callback(event);return event;}
  setAttribute(name, value) {this.attributes[name] = value;}
  getAttribute(name) {return this.attributes[name];}
  getClientRects() {return this.hidden ? [] : [{}];}
  focus() {this.document.activeElement = this;}
  click() {this.fire('click');}
  closest(selector) {
    let current = this;
    while (current) {
      if (selector === '[hidden]' && current.hidden) return current;
      if (selector === 'button' && current.tagName === 'button') return current;
      if (selector === 'button[data-uid]' && current.tagName === 'button' && current.dataset.uid !== undefined) return current;
      current = current.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const elements = [];
    const visit = item => {for (const child of item.children) {elements.push(child);visit(child);}};
    visit(this);
    if (selector === '.hx-tab') return elements.filter(item => item.classList.contains('hx-tab'));
    if (selector === '.hx-panel') return elements.filter(item => item.classList.contains('hx-panel'));
    if (selector === 'button, input, select, a[href]') return elements.filter(item => ['button','input','select'].includes(item.tagName) || item.tagName === 'a' && item.href);
    return [];
  }
  querySelector(selector) {if (selector === '.hx-tab.active') return this.querySelectorAll('.hx-tab').find(item => item.classList.contains('active'));return null;}
}
function uiHarness(more = false) {
  const document = {ids: new Map(),activeElement: null,createElement(tag) {return new Element(tag, this);},getElementById(id) {return this.ids.get(id);},currentScript: {src: 'https://example.test/app/js/db-explorer.js'}};
  document.head = document.createElement('head');
  const create = (id, tag = 'div', className = '') => {const element = document.createElement(tag);element.id = id;element.className = className;return element;};
  const dialog = create('historyExplorer');
  dialog.hidden = true;
  const ids = ['dbExploreOpen','hxStatus','hxResults','hxDetail','hxPrev','hxNext','hxPage','hxPosition','hxName','hxMatch','hxNameUid','hxFrom','hxTo','hxDateMode','hxMinimum','hxRankUid','hxFindRank','hxClose','userName','userUID','loadButton'];
  for (const id of ids) dialog.append(create(id, id === 'hxName' ? 'input' : 'div'));
  for (const tab of ['Names','Dates','Ranking']) {
    const button = create('hxTab' + tab, 'button', 'hx-tab');
    button.dataset.tab = tab.toLowerCase();
    if (tab === 'Names') button.className += ' active';
    dialog.append(button);
  }
  for (const panel of ['Names','Dates','Ranking']) dialog.append(create('hxPanel' + panel, 'section', 'hx-panel'));
  for (const form of ['Name','Date','Rank']) dialog.append(create('hx' + form + 'Form', 'form'));
  document.getElementById('hxMinimum').value = '2';
  document.getElementById('hxMatch').value = 'exact';
  const calls = [];
  const WhoDB = {ready: true,async explore(q) {
    calls.push(q);
    if (q.mode === 'shared') return {rows: [{name: 'Alba', total: 3, first: '2020-01-01', last: '2023-01-01'}], more: false};
    if (q.mode === 'shared_users') return {rows: [{uid: q.page ? 3 : 1, name: 'Alba', first: '2020-01-01', last: '2020-01-02'}, {uid: 2, name: 'Alba', first: '2022-01-01', last: '2023-01-01'}], more: more && !q.page};
    if (q.mode === 'user') return {rows: [{name: 'Alba', first: '2020-01-01', last: '2020-01-02'}], more: false};
    return {rows: [{uid: 1, name: 'Alba', first: '2020-01-01', last: '2020-01-02', total: 3}], more: false};
  }};
  const ctx = {document,window: {},WhoDB,console,Date,Map,Set,URL,DOMParser: class {},fetch: async () => ({ok: false,status: 404})};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/db-explorer.js'), 'utf8'), ctx);
  return {document,dialog,calls,open: ctx.window.HistoryExplorer.open,by: document.getElementById.bind(document)};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('La pestaña compartidos aparece y sus cabeceras ordenan ascendente y descendente', async () => {
  const h = uiHarness();
  h.open();
  const tab = h.by('hxTabShared');
  assert.ok(tab);
  tab.fire('click');
  await settle();
  assert.equal(h.calls.at(-1).mode, 'shared');
  const heading = h.by('hxResults').querySelectorAll('button, input, select, a[href]').find(x => x.dataset.sort === 'name');
  assert.ok(heading);
  h.by('hxResults').fire('click', heading);
  await settle();
  assert.equal(h.calls.at(-1).sort, 'name');
  assert.equal(h.calls.at(-1).direction, 'asc');
  h.by('hxResults').fire('click', h.by('hxResults').querySelectorAll('button, input, select, a[href]').find(x => x.dataset.sort === 'name'));
  await settle();
  assert.equal(h.calls.at(-1).direction, 'desc');
  assert.equal(h.by('hxPanelShared').hidden, false);
});
test('Al pulsar un nombre compartido se muestran sus UID y se puede abrir el historial', async () => {
  const h = uiHarness();
  h.open();
  h.by('hxTabShared').fire('click');
  await settle();
  const shared = h.by('hxResults').querySelectorAll('button, input, select, a[href]').find(item => item.dataset.sharedName === 'Alba');
  assert.ok(shared);
  h.by('hxResults').fire('click', shared);
  await settle();
  assert.equal(h.calls.at(-1).mode, 'shared_users');
  const uid = h.by('hxDetail').querySelectorAll('button, input, select, a[href]').find(item => item.dataset.uid === '2');
  assert.ok(uid);
  h.by('hxDetail').fire('click', uid);
  await settle();
  assert.equal(h.calls.at(-1).mode, 'user');
  assert.equal(h.calls.at(-1).uid, 2);
});
test('Las pestañas existentes conservan la búsqueda y su orden', async () => {
  const h = uiHarness();
  h.open();
  h.by('hxTabRanking').fire('click');
  await settle();
  assert.equal(h.calls.at(-1).mode, 'ranking');
  const uid = h.by('hxResults').querySelectorAll('button, input, select, a[href]').find(x => x.dataset.sort === 'uid');
  h.by('hxResults').fire('click', uid);
  await settle();
  assert.equal(h.calls.at(-1).sort, 'uid');
  h.by('hxTabNames').fire('click');
  h.by('hxName').value = 'Alba';
  h.by('hxNameForm').fire('submit');
  await settle();
  assert.equal(h.calls.at(-1).mode, 'names');
  assert.equal(h.calls.at(-1).sort, 'name');
});
test('El detalle de UID compartidos avanza y retrocede páginas', async () => {
  const h = uiHarness(true);
  h.open();
  h.by('hxTabShared').fire('click');
  await settle();
  const name = h.by('hxResults').querySelectorAll('button, input, select, a[href]').find(item => item.dataset.sharedName === 'Alba');
  h.by('hxResults').fire('click', name);
  await settle();
  const forward = h.by('hxDetail').querySelectorAll('button, input, select, a[href]').find(item => item.textContent === 'Siguiente →');
  assert.ok(forward);
  forward.fire('click');
  await settle();
  assert.equal(h.calls.at(-1).page, 1);
  const back = h.by('hxDetail').querySelectorAll('button, input, select, a[href]').find(item => item.textContent === '← Anterior');
  assert.ok(back);
  back.fire('click');
  await settle();
  assert.equal(h.calls.at(-1).page, 0);
});
test('La navegación por teclado incluye la nueva pestaña', async () => {
  const h = uiHarness();
  h.open();
  const ranking = h.by('hxTabRanking');
  ranking.focus();
  const event = h.dialog.fire('keydown', ranking, {key: 'ArrowRight'});
  await settle();
  assert.equal(event.prevented, true);
  assert.equal(h.document.activeElement, h.by('hxTabShared'));
  assert.equal(h.by('hxTabShared').getAttribute('aria-selected'), 'true');
});
