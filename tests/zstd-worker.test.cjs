'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const worker = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-worker.js'), 'utf8');
const manifest = filename => ({format: 'WTHDB01', filename, dateEpoch: '2005-04-17', sha256: 'a'.repeat(64), sequenceNumber: 124177, records: 2634622, sqliteBytes: 65998848, encryptedBytes: 37225885});
function harness(decompress) {
  const ctx = {TextEncoder, Blob, self: {fzstd: {decompress}}, postMessage() {}, console, Date, Map};
  vm.createContext(ctx);
  vm.runInContext(worker, ctx);
  return {ctx, evalJs: expression => vm.runInContext(expression, ctx)};
}
test('La versión ZSTD es admitida por el worker', () => {
  const h = harness(() => new Uint8Array());
  h.ctx.manifest = manifest('whosthat.db.zst.enc');
  assert.equal(h.evalJs('checkManifest(manifest).filename'), 'whosthat.db.zst.enc');
});
test('El navegador rechaza manifiestos GZIP antiguos', () => {
  const h = harness(() => new Uint8Array());
  h.ctx.manifest = manifest('whosthat.db.gz.enc');
  assert.throws(() => h.evalJs('checkManifest(manifest)'), /formato exclusivo/);
});
test('La descompresión utiliza ZSTD, no el flujo GZIP antiguo', () => {
  let received;
  const h = harness(bytes => { received = Array.from(bytes); return Uint8Array.from([83, 81, 76, 105, 116, 101]); });
  const output = h.evalJs('unpackZstd(new Uint8Array([1, 2, 3]))');
  assert.deepEqual(received, [1, 2, 3]);
  assert.deepEqual(Array.from(output), [83, 81, 76, 105, 116, 101]);
});
test('La apertura del explorador conserva las consultas históricas', async () => {
  const h = harness(() => new Uint8Array());
  h.ctx.adapter = {exec(sql) {
    if (sql.includes('SELECT user_name,date_first,date_span FROM whosthat WHERE user_id')) return [{values: [['Alba', 0, 4]]}];
    return [];
  }};
  h.evalJs('localDB = adapter');
  h.ctx.query = {action: 'lookup', uid: 1};
  const result = await h.evalJs('handle(query)');
  assert.equal(result[0].name, 'Alba');
  assert.equal(result[0].first, '2005-04-17');
  assert.equal(result[0].last, '2005-04-21');
});
