(() => {
  const by = id => document.getElementById(id);
  const gate = by('dbGate');
  const form = by('dbForm');
  const input = by('dbPassword');
  const button = by('dbUnlock');
  const status = by('dbStatus');
  const remember = by('dbRemember');
  const names = by('namesInfo');
  const loadDialog = document.createElement('div');
  loadDialog.className = 'db-gate';
  loadDialog.hidden = true;
  loadDialog.tabIndex = -1;
  loadDialog.setAttribute('role', 'dialog');
  loadDialog.setAttribute('aria-modal', 'true');
  loadDialog.setAttribute('aria-labelledby', 'dbLoadTitle');
  const loadCard = document.createElement('div');
  loadCard.className = 'db-card';
  const loadTitle = document.createElement('h2');
  loadTitle.id = 'dbLoadTitle';
  loadTitle.textContent = 'Preparando el explorador de nombres históricos';
  const loadStatus = document.createElement('p');
  loadStatus.className = 'db-status';
  loadStatus.setAttribute('role', 'status');
  loadStatus.setAttribute('aria-live', 'polite');
  const loadBar = document.createElement('progress');
  loadBar.setAttribute('aria-label', 'Cargando la base de datos');
  const loadHint = document.createElement('small');
  loadHint.textContent = 'La base se procesa en tu navegador. Puede tardar unos segundos.';
  loadCard.append(loadTitle, loadStatus, loadBar, loadHint);
  loadDialog.append(loadCard);
  loadDialog.addEventListener('keydown', event => { if (event.key === 'Tab') event.preventDefault(); });
  document.body.append(loadDialog);
  let initializing = null;
  let unlocking = false;
  let requestedAction = null;
  let loadTimer = null;
  const setStatus = text => { status.textContent = text; };
  function showLoadProgress(message) {
    clearTimeout(loadTimer);
    loadStatus.textContent = message;
    loadTimer = setTimeout(() => {
      if (!loadDialog.hidden) loadStatus.textContent = message + ' · El proceso continúa…';
    }, 4500);
  }
  function showLoad() {
    showLoadProgress('Comprobando el acceso a la base de datos…');
    loadDialog.hidden = false;
    loadDialog.focus({preventScroll: true});
  }
  function hideLoad() {
    clearTimeout(loadTimer);
    loadTimer = null;
    loadDialog.hidden = true;
  }
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
    hideLoad();
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
    hideLoad();
    if (action === 'explore') window.HistoryExplorer.open();
    if (window.currentHistoryUid?.()) await window.refreshLocalHistory?.();
  }
  WhoDB.onProgress(message => {
    setStatus(message);
    if (!loadDialog.hidden) showLoadProgress(message);
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
    if (initializing) { if (action === 'explore' && loadDialog.hidden) showLoad(); return; }
    if (action === 'explore') showLoad();
    else showNamesProgress('Comprobando acceso al historial…');
    initializing = WhoDB.init();
    try {
      const result = await initializing;
      if (result.ready) await afterAccess();
      else {
        if (window.currentHistoryUid?.()) finishNamesProgress('Introduce la contraseña para consultar');
        showGate();
      }
    } catch (error) {
      if (window.currentHistoryUid?.()) finishNamesProgress('No se pudo abrir el historial: ' + error.message);
      showGate();
      setStatus('No se pudo abrir el historial: ' + error.message);
    } finally {
      hideLoad();
      initializing = null;
    }
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
      setStatus('No se pudo abrir el historial: ' + error.message);
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
