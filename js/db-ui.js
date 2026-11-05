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
  WhoDB.onProgress(message => {
    setStatus(message);
    if (initializing || unlocking) names.textContent = '⏳ ' + message;
  });
  async function onHistoryClick(event) {
    event.preventDefault();
    if (!window.currentHistoryUid?.()) {
      names.textContent = 'Primero carga un usuario para consultar sus nombres.';
      return;
    }
    if (WhoDB.ready) {
      await window.refreshLocalHistory?.();
      return;
    }
    if (unlocking) {
      showGate();
      return;
    }
    if (initializing) return;
    names.textContent = 'Preparando acceso al historial…';
    initializing = WhoDB.init();
    try {
      const result = await initializing;
      if (result.ready) {
        await window.refreshLocalHistory?.();
      } else {
        names.textContent = '🔒 Introduce la contraseña para consultar';
        showGate();
      }
    } catch (e) {
      names.textContent = 'No se pudo abrir el historial: ' + e.message;
      showGate();
      setStatus('⛔ ' + e.message);
    } finally {
      initializing = null;
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (unlocking) return;
    unlocking = true;
    button.disabled = true;
    input.disabled = true;
    names.textContent = 'Abriendo historial local…';
    setStatus('Comprobando contraseña…');
    try {
      await WhoDB.unlock(input.value, remember.checked);
      closeGate();
      await window.refreshLocalHistory?.();
    } catch (e) {
      setStatus('⛔ ' + e.message);
      names.textContent = 'No se pudo abrir el historial. Comprueba la contraseña.';
    } finally {
      unlocking = false;
      button.disabled = false;
      input.disabled = false;
    }
  });
  by('namesLink').addEventListener('click', onHistoryClick);
  by('dbDismiss').addEventListener('click', closeGate);
})();
