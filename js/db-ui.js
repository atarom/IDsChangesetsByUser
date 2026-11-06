(() => {
  const by = id => document.getElementById(id);
  const gate = by('dbGate');
  const form = by('dbForm');
  const input = by('dbPassword');
  const button = by('dbUnlock');
  const status = by('dbStatus');
  const remember = by('dbRemember');
  const names = by('namesInfo');
  let initializing = null;
  let unlocking = false;
  let requestedAction = null;
  const setStatus = text => { status.textContent = text; };
  let progressTimer = null;
  function showNamesProgress(message) {
    const uid = window.currentHistoryUid?.();
    if (!uid) return;
    names.classList.add('is-loading');
    names.textContent = message;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      if (names.classList.contains('is-loading') && window.currentHistoryUid?.() === uid) names.textContent = message + ' · El proceso continúa…';
    }, 4500);
  }
  function finishNamesProgress(message) {
    clearTimeout(progressTimer);
    progressTimer = null;
    names.classList.remove('is-loading');
    if (message !== undefined) names.textContent = message;
  }
  function showGate() {
    gate.hidden = false;
    if (!unlocking) { setStatus('Introduce la contraseña compartida para consultar los nombres históricos.'); input.focus(); }
  }
  function closeGate() {
    gate.hidden = true;
    input.value = '';
  }
  async function afterAccess() {
    const action = requestedAction;
    requestedAction = null;
    clearTimeout(progressTimer);
    progressTimer = null;
    if (action === 'explore') window.HistoryExplorer.open();
    if (window.currentHistoryUid?.()) await window.refreshLocalHistory?.();
  }
  WhoDB.onProgress(message => {
    setStatus(message);
    if (initializing || unlocking) showNamesProgress(message);
  });
  async function requestAccess(action) {
    if (action === 'names' && !window.currentHistoryUid?.()) {
      finishNamesProgress('Primero carga un usuario para consultar sus nombres.');
      return;
    }
    if (WhoDB.ready) {
      if (action === 'explore') window.HistoryExplorer.open();
      else await window.refreshLocalHistory?.();
      return;
    }
    requestedAction = action;
    if (unlocking) { showGate(); return; }
    if (initializing) return;
    if (action === 'names') showNamesProgress('Comprobando acceso al historial…');
    initializing = WhoDB.init();
    try {
      const result = await initializing;
      if (result.ready) await afterAccess();
      else {
        if (window.currentHistoryUid?.()) finishNamesProgress('🔒 Introduce la contraseña para consultar');
        showGate();
      }
    } catch (error) {
      if (window.currentHistoryUid?.()) finishNamesProgress('No se pudo abrir el historial: ' + error.message);
      showGate();
      setStatus('⛔ ' + error.message);
    } finally { initializing = null; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (unlocking) return;
    unlocking = true;
    button.disabled = true;
    input.disabled = true;
    showNamesProgress('Comprobando contraseña y abriendo historial…');
    setStatus('Comprobando contraseña…');
    try {
      await WhoDB.unlock(input.value, remember.checked);
      closeGate();
      await afterAccess();
    } catch (error) {
      setStatus('⛔ ' + error.message);
      if (window.currentHistoryUid?.()) finishNamesProgress('No se pudo abrir el historial: ' + error.message);
    } finally {
      unlocking = false;
      button.disabled = false;
      input.disabled = false;
    }
  });
  by('namesLink').addEventListener('click', event => { event.preventDefault(); void requestAccess('names'); });
  by('dbExploreOpen').addEventListener('click', () => { void requestAccess('explore'); });
  by('dbDismiss').addEventListener('click', () => { requestedAction = null; closeGate(); });
})();
