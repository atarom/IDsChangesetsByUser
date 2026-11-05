(function () {
  let worker = null;
  const pending = new Map();
  const observers = new Set();
  let serial = 0;
  function onWorkerMessage({data}) {
    if (data.event === 'progress') { observers.forEach(callback => callback(data.message)); return; }
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.ok) call.resolve(data.result);
    else call.reject(Error(data.error || 'Error del trabajador SQLite'));
  }
  function onWorkerError(event) {
    worker?.terminate();
    worker = null;
    api.ready = false;
    const reason = Error('Error del trabajador SQLite: ' + (event?.message || 'comunicación interrumpida'));
    for (const call of pending.values()) call.reject(reason);
    pending.clear();
  }
  function getWorker() {
    if (!worker) {
      worker = new Worker('./js/db-worker.js');
      worker.onmessage = onWorkerMessage;
      worker.onerror = onWorkerError;
      worker.onmessageerror = onWorkerError;
    }
    return worker;
  }
  const api = {
    ready: false,
    version: null,
    onProgress(callback) { observers.add(callback); return () => observers.delete(callback); },
    call(action, params = {}) {
      const id = ++serial;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject});
        try { getWorker().postMessage({id, action, ...params}); }
        catch (error) { pending.delete(id); reject(error); }
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
    async explore(params) { return this.call('explore', params); }
  };
  window.WhoDB = api;
})();
