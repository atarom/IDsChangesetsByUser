/* Adaptador de comunicación con el trabajador del historial local. */
(function () {
  // No crear siquiera el Worker hasta que alguien pulse «Nombres conocidos».
  let worker = null;
  function getWorker() {
    if (!worker) {
      worker = new Worker('./js/db-worker.js');
      worker.onmessage = onWorkerMessage;
      worker.onerror = onWorkerError;
    }
    return worker;
  }
  const pending = new Map();
  const observers = new Set();
  let serial = 0;
  const api = {
    ready: false,
    version: null,
    onProgress(callback) { observers.add(callback); return () => observers.delete(callback); },
    call(action, params = {}) {
      const id = ++serial;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject});
        try { getWorker().postMessage({id, action, ...params}); }
        catch (e) { pending.delete(id); reject(e); }
      });
    },
    async init() {
      const result = await this.call('init');
      this.ready = !!result.ready;
      this.version = result.version;
      return result;
    },
    async unlock(password, remember) {
      const result = await this.call('unlock', {password, remember});
      this.ready = true;
      this.version = result.version;
      return result;
    },
    async lookup(uid) { return this.call('lookup', {uid}); },
    async lock() { const result = await this.call('lock'); this.ready = false; return result; },
  };
  function onWorkerMessage({data}) {
    if (data.event === 'progress') { observers.forEach(cb => cb(data.message)); return; }
    const pendingCall = pending.get(data.id);
    if (!pendingCall) return;
    pending.delete(data.id);
    if (data.ok) pendingCall.resolve(data.result);
    else pendingCall.reject(Error(data.error || 'Error del trabajador SQLite'));
  }
  function onWorkerError(error) {
    for (const item of pending.values()) item.reject(Error('Error al iniciar trabajador: ' + error.message));
    pending.clear();
  }
  window.WhoDB = api;
})();
