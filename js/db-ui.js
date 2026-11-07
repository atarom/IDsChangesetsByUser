(() => {
  const by = id => document.getElementById(id);
  const gate = by('dbGate');
  const form = by('dbForm');
  const input = by('dbPassword');
  const button = by('dbUnlock');
  const status = by('dbStatus');
  const remember = by('dbRemember');
  const names = by('namesInfo');
  let loadDialog = null;
  let loadStatus = null;
  function ensureLoadDialog() {
    if (loadDialog) return;
    loadDialog = document.createElement('div');
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
    loadStatus = document.createElement('p');
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
  }
  let initializing = null;
  let unlocking = false;
  let requestedAction = null;
  let loadTimer = null;
  const setStatus = text => { status.textContent = text; };
  function showLoadProgress(message) {
    clearTimeout(loadTimer);
    loadStatus.textContent = message;
    loadTimer = setTimeout(() => {
      if (loadDialog && !loadDialog.hidden) loadStatus.textContent = message + ' · El proceso continúa…';
    }, 4500);
  }
  function showLoad() {
    ensureLoadDialog();
    showLoadProgress('Comprobando el acceso a la base de datos…');
    loadDialog.hidden = false;
    loadDialog.focus({preventScroll: true});
  }
  function hideLoad() {
    clearTimeout(loadTimer);
    loadTimer = null;
    if (loadDialog) loadDialog.hidden = true;
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
    if (loadDialog && !loadDialog.hidden) showLoadProgress(message);
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
    if (initializing) { if (action === 'explore' && (!loadDialog || loadDialog.hidden)) showLoad(); return; }
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
  function renderExplorerStatistics(container, manifest) {
    const stats = manifest.statistics;
    const integer = value => Number(value).toLocaleString('es-ES');
    const decimal = value => Number(value).toLocaleString('es-ES', {maximumFractionDigits: 2});
    const percentage = value => decimal(value * 100) + ' %';
    const size = value => decimal(value / 1048576) + ' MiB';
    const localDate = value => value ? value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4) : '—';
    const updated = new Date(manifest.updatedAt);
    const text = (tag, value, className) => {
      const element = document.createElement(tag);
      element.textContent = String(value);
      if (className) element.className = className;
      return element;
    };
    const section = title => {
      const element = document.createElement('section');
      element.className = 'hx-stats-section';
      element.append(text('h3', title));
      container.append(element);
      return element;
    };
    const rows = items => {
      const list = document.createElement('dl');
      list.className = 'hx-stats-rows';
      for (const [label, value] of items) {
        list.append(text('dt', label), text('dd', value));
      }
      return list;
    };
    container.replaceChildren();
    const overview = document.createElement('div');
    overview.className = 'hx-stats-overview';
    for (const [label, value] of [['Registros históricos', manifest.records], ['Usuarios con nombre', stats.users], ['Nombres distintos', stats.uniqueNames]]) {
      const item = document.createElement('div');
      item.append(text('strong', integer(value)), text('span', label));
      overview.append(item);
    }
    container.append(overview);
    const distribution = section('Distribución de nombres por usuario');
    const chart = document.createElement('div');
    chart.className = 'hx-stats-chart';
    for (const [key, label] of [['1', '1 nombre'], ['2', '2 nombres'], ['3', '3 nombres'], ['4', '4 nombres'], ['5+', '5 o más']]) {
      const count = stats.usersByNameCount[key];
      const ratio = stats.users ? count / stats.users : 0;
      const item = document.createElement('div');
      item.className = 'hx-stats-bar-row';
      const track = document.createElement('div');
      track.className = 'hx-stats-track';
      const bar = document.createElement('span');
      bar.style.width = ratio * 100 + '%';
      if (!count) bar.style.minWidth = '0';
      track.append(bar);
      item.append(text('span', label), track, text('span', integer(count) + ' · ' + percentage(ratio)));
      chart.append(item);
    }
    distribution.append(chart);
    const names = section('Nombres y observaciones');
    names.append(rows([
      ['Usuarios con varios nombres', integer(stats.users - stats.usersByNameCount['1']) + ' (' + percentage(stats.users ? (stats.users - stats.usersByNameCount['1']) / stats.users : 0) + ')'],
      ['Nombres compartidos entre UID', integer(stats.sharedNames)],
      ['Máximo de nombres por usuario', integer(stats.maxNamesPerUser)],
      ['Media de nombres por usuario', decimal(stats.avgNamesPerUser)],
      ['Primera observación', localDate(stats.firstObserved)],
      ['Última observación', localDate(stats.lastObserved)],
      ['Duración media observada por nombre', decimal(stats.avgObservedDays) + ' días'],
    ]));
    const technical = section('Publicación y almacenamiento');
    technical.append(rows([
      ['Última publicación', Number.isNaN(updated.getTime()) ? '—' : updated.toLocaleString('es-ES')],
      ['Secuencia OSM procesada', integer(manifest.sequenceNumber)],
      ['Tamaño SQLite', size(manifest.sqliteBytes)],
      ['Tamaño cifrado', size(manifest.encryptedBytes)],
      ['Reducción de tamaño', percentage(1 - manifest.encryptedBytes / manifest.sqliteBytes)],
      ['Cifrado', 'SQLite + GZIP + AES-256-GCM'],
      ['Fecha de referencia', localDate(manifest.dateEpoch)],
      ['SHA-256', manifest.sha256],
    ]));
    container.append(text('p', 'Los nombres son observaciones históricas, no fechas exactas de cambio. Los nombres vacíos se excluyen de los recuentos por usuario.', 'hx-stats-note'));
  }
  function attachExplorerStatistics() {
    const header = by('historyExplorer')?.querySelector('.hx-header');
    if (!header) return;
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./css/db-stats.css', document.baseURI).href;
    document.head.append(stylesheet);
    const panel = document.createElement('section');
    panel.className = 'hx-stats';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'hxStatsToggle';
    toggle.className = 'hx-stats-toggle';
    toggle.textContent = 'Estadísticas de la base de datos';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'hxStatsContent');
    const content = document.createElement('div');
    content.id = 'hxStatsContent';
    content.className = 'hx-stats-content';
    content.tabIndex = 0;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-labelledby', 'hxStatsToggle');
    content.hidden = true;
    content.setAttribute('aria-live', 'polite');
    panel.append(toggle, content);
    header.after(panel);
    let loaded = false;
    let pending = false;
    toggle.addEventListener('click', async () => {
      const opening = content.hidden;
      content.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if (!opening || loaded || pending) return;
      pending = true;
      content.textContent = 'Cargando estadísticas publicadas…';
      try {
        const response = await fetch(new URL('./data/version.json', document.baseURI), {cache: 'no-store'});
        if (!response.ok) throw Error('HTTP ' + response.status);
        const manifest = await response.json();
        if (!manifest.statistics) {
          content.textContent = 'Las estadísticas aparecerán tras la próxima actualización de la base.';
          return;
        }
        renderExplorerStatistics(content, manifest);
        loaded = true;
      } catch (error) {
        content.textContent = 'No se pudieron cargar las estadísticas: ' + error.message + '. Cierra y vuelve a abrir este apartado para reintentarlo.';
      } finally {
        pending = false;
      }
    });
  }
  attachExplorerStatistics();
})();
