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
  function showGate() {
    gate.hidden = false;
    setStatus('Introduce la contraseña compartida para consultar los nombres históricos.');
    input.focus();
  }
  function closeGate() {
    gate.hidden = true;
    input.value = '';
  }
  async function afterAccess() {
    const action = requestedAction;
    requestedAction = null;
    if (action === 'explore') window.HistoryExplorer.open();
    if (window.currentHistoryUid?.()) await window.refreshLocalHistory?.();
  }
  WhoDB.onProgress(message => {
    setStatus(message);
    if ((initializing || unlocking) && window.currentHistoryUid?.()) names.textContent = '⏳ ' + message;
  });
  async function requestAccess(action) {
    if (action === 'names' && !window.currentHistoryUid?.()) {
      names.textContent = 'Primero carga un usuario para consultar sus nombres.';
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
    if (action === 'names') names.textContent = 'Preparando acceso al historial…';
    initializing = WhoDB.init();
    try {
      const result = await initializing;
      if (result.ready) await afterAccess();
      else {
        if (window.currentHistoryUid?.()) names.textContent = '🔒 Introduce la contraseña para consultar';
        showGate();
      }
    } catch (error) {
      if (window.currentHistoryUid?.()) names.textContent = 'No se pudo abrir el historial: ' + error.message;
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
    if (window.currentHistoryUid?.()) names.textContent = 'Abriendo historial local…';
    setStatus('Comprobando contraseña…');
    try {
      await WhoDB.unlock(input.value, remember.checked);
      closeGate();
      await afterAccess();
    } catch (error) {
      setStatus('⛔ ' + error.message);
      if (window.currentHistoryUid?.()) names.textContent = 'No se pudo abrir el historial. Comprueba la contraseña.';
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
