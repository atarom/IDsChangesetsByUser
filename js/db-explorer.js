(() => {
  const by = id => document.getElementById(id);
  const dialog = by('historyExplorer');
  const results = by('hxResults');
  const status = by('hxStatus');
  const detail = by('hxDetail');
  const prev = by('hxPrev');
  const next = by('hxNext');
  const pageInfo = by('hxPage');
  const PAGE_SIZE = 100;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const validUid = value => { const uid = Number(value); return Number.isSafeInteger(uid) && uid > 0 ? uid : null; };
  const sorts = {names: {sort: 'name', direction: 'asc', custom: false}, dates: {sort: 'first', direction: 'desc', custom: false}, ranking: {sort: 'total', direction: 'desc', custom: false}, shared: {sort: 'total', direction: 'desc', custom: false}};
  const state = {tab: 'names', request: null, page: 0, cursors: [0], more: false, busy: false, generation: 0, detailGeneration: 0, lastFocus: null};
  const source = document.currentScript?.src;
  if (source) {
    const stylesheet = node('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('../css/db-explorer-advanced.css', source).href;
    document.head.append(stylesheet);
  }
  const tabShared = node('button', 'Nombres compartidos', 'hx-tab');
  tabShared.id = 'hxTabShared';
  tabShared.type = 'button';
  tabShared.dataset.tab = 'shared';
  tabShared.setAttribute('role', 'tab');
  tabShared.setAttribute('aria-controls', 'hxPanelShared');
  tabShared.setAttribute('aria-selected', 'false');
  tabShared.tabIndex = -1;
  by('hxTabRanking').after(tabShared);
  const panelShared = node('section', undefined, 'hx-panel');
  panelShared.id = 'hxPanelShared';
  panelShared.hidden = true;
  panelShared.setAttribute('role', 'tabpanel');
  panelShared.setAttribute('aria-labelledby', 'hxTabShared');
  const sharedForm = node('form', undefined, 'hx-form');
  sharedForm.id = 'hxSharedForm';
  const sharedLabel = node('label', 'Filtrar nombres compartidos');
  const sharedFilter = node('input');
  sharedFilter.id = 'hxSharedFilter';
  sharedFilter.type = 'search';
  sharedFilter.maxLength = 120;
  sharedFilter.placeholder = 'Todos los nombres';
  sharedLabel.append(sharedFilter);
  const sharedSubmit = node('button', 'Filtrar');
  sharedSubmit.type = 'submit';
  sharedForm.append(sharedLabel, sharedSubmit);
  panelShared.append(sharedForm);
  by('hxPanelRanking').after(panelShared);
  function resetDetail() { state.detailGeneration++; detail.hidden = true; detail.replaceChildren(); }
  function resetResults(message) {
    state.generation++;
    state.request = null;
    state.page = 0;
    state.cursors = [0];
    state.busy = false;
    state.more = false;
    results.replaceChildren(node('p', message, 'hx-empty'));
    status.textContent = message;
    pageInfo.textContent = 'Sin resultados';
    prev.disabled = true;
    next.disabled = true;
    resetDetail();
  }
  function switchTab(tab) {
    if (!Object.hasOwn(sorts, tab)) return;
    state.tab = tab;
    for (const button of dialog.querySelectorAll('.hx-tab')) {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of dialog.querySelectorAll('.hx-panel')) panel.hidden = panel.id !== 'hxPanel' + tab[0].toUpperCase() + tab.slice(1);
    resetResults(tab === 'ranking' || tab === 'shared' ? 'Consultando la base local…' : 'Introduce los filtros y pulsa Buscar.');
    by('hxPosition').textContent = '';
    if (tab === 'ranking') void startSearch({mode: 'ranking', min: Number(by('hxMinimum').value)});
    if (tab === 'shared') void startSearch({mode: 'shared', filter: sharedFilter.value.trim()});
  }
  function open() {
    if (!WhoDB.ready) return;
    state.lastFocus = by('dbExploreOpen');
    dialog.hidden = false;
    switchTab(state.tab);
    dialog.querySelector('.hx-tab.active').focus();
  }
  function close() {
    dialog.hidden = true;
    resetDetail();
    state.generation++;
    state.busy = false;
    state.lastFocus?.focus?.();
  }
  function tableColumns() {
    if (state.tab === 'ranking') return [['N.º', null], ['UID', 'uid'], ['Nombres distintos', 'total'], ['Última observación', 'last']];
    if (state.tab === 'shared') return [['Nombre histórico', 'name'], ['UID diferentes', 'total'], ['Primera observación', 'first'], ['Última observación', 'last']];
    return [['UID', 'uid'], ['Nombre histórico', 'name'], ['Primera observación', 'first'], ['Última observación', 'last']];
  }
  function renderRows(rows) {
    const table = node('table', undefined, state.tab === 'shared' ? 'hx-table hx-table-shared' : 'hx-table');
    const head = node('thead');
    const hr = node('tr');
    const active = sorts[state.tab];
    for (const [label, key] of tableColumns()) {
      const th = node('th');
      if (key) {
        const selected = active.sort === key;
        if (selected) th.setAttribute('aria-sort', active.direction === 'asc' ? 'ascending' : 'descending');
        const arrow = selected ? (active.direction === 'asc' ? ' ↑' : ' ↓') : '';
        const button = node('button', label + arrow, 'hx-sort');
        button.type = 'button';
        button.dataset.sort = key;
        button.title = 'Ordenar por ' + label.toLowerCase();
        th.append(button);
      } else th.textContent = label;
      hr.append(th);
    }
    head.append(hr);
    const body = node('tbody');
    rows.forEach((row, index) => {
      const tr = node('tr');
      if (state.tab === 'shared') {
        const cell = node('td');
        const button = node('button', row.name, 'hx-uid hx-shared-name');
        button.type = 'button';
        button.dataset.sharedName = row.name;
        button.title = 'Ver todos los UID que utilizaron este nombre';
        cell.append(button);
        tr.append(cell, node('td', Number(row.total).toLocaleString('es-ES')), node('td', row.first || '—'), node('td', row.last || '—'));
      } else {
        if (state.tab === 'ranking') tr.append(node('td', String(state.page * PAGE_SIZE + index + 1)));
        const cell = node('td');
        const button = node('button', String(row.uid), 'hx-uid');
        button.type = 'button';
        button.dataset.uid = String(row.uid);
        button.title = 'Ver nombres históricos y cargar usuario';
        cell.append(button);
        tr.append(cell);
        if (state.tab === 'ranking') tr.append(node('td', Number(row.total).toLocaleString('es-ES')), node('td', row.last || '—'));
        else tr.append(node('td', row.name, 'hx-name'), node('td', row.first || '—'), node('td', row.last || '—'));
      }
      body.append(tr);
    });
    table.append(head, body);
    results.replaceChildren(table);
    results.scrollTop = 0;
  }
  async function runSearch() {
    if (!state.request) return;
    const active = sorts[state.tab];
    const request = {...state.request, page: state.page, sort: active.sort, direction: active.direction};
    const regexCursor = request.mode === 'names' && request.match === 'regex' && request.name && !request.uid && request.sort === 'uid' && request.direction === 'asc';
    if (regexCursor) request.cursor = state.cursors[state.page] || 0;
    const generation = ++state.generation;
    state.busy = true;
    prev.disabled = true;
    next.disabled = true;
    status.textContent = 'Consultando la base local…';
    resetDetail();
    try {
      const response = await WhoDB.explore(request);
      if (generation !== state.generation || dialog.hidden) return;
      state.more = !!response.more;
      if (regexCursor) state.cursors[state.page + 1] = response.nextCursor;
      const rows = response.rows || [];
      if (rows.length) renderRows(rows);
      else results.replaceChildren(node('p', 'No hay resultados con estos filtros.', 'hx-empty'));
      status.textContent = rows.length ? `${rows.length} resultados en esta página.` : 'Sin coincidencias.';
      pageInfo.textContent = `Página ${state.page + 1}`;
    } catch (error) {
      if (generation !== state.generation || dialog.hidden) return;
      state.more = false;
      results.replaceChildren(node('p', 'No se ha podido completar la consulta.', 'hx-empty'));
      status.textContent = 'Error: ' + error.message;
      pageInfo.textContent = 'Sin resultados';
    } finally {
      if (generation === state.generation) {
        state.busy = false;
        prev.disabled = state.page === 0;
        next.disabled = !state.more;
      }
    }
  }
  async function startSearch(params) {
    if (params.mode === 'names' && !sorts.names.custom) sorts.names = params.match === 'regex' && params.name && !params.uid ? {sort: 'uid', direction: 'asc', custom: false} : {sort: 'name', direction: 'asc', custom: false};
    if (params.mode === 'dates' && !sorts.dates.custom) sorts.dates = {sort: params.dateMode === 'last' ? 'last' : 'first', direction: 'desc', custom: false};
    state.request = params;
    state.page = 0;
    state.cursors = [0];
    await runSearch();
  }
  function changeSort(key) {
    if (!state.request || state.busy || !tableColumns().some(([, col]) => col === key)) return;
    const current = sorts[state.tab];
    const direction = current.sort === key ? (current.direction === 'asc' ? 'desc' : 'asc') : key === 'total' ? 'desc' : 'asc';
    sorts[state.tab] = {sort: key, direction, custom: true};
    state.page = 0;
    state.cursors = [0];
    void runSearch();
  }
  async function showSharedName(name, page = 0) {
    const sequence = ++state.detailGeneration;
    detail.hidden = false;
    detail.replaceChildren(node('p', 'Consultando UID que utilizaron este nombre…'));
    try {
      const response = await WhoDB.explore({mode: 'shared_users', name, page});
      if (sequence !== state.detailGeneration || dialog.hidden) return;
      const header = node('div', undefined, 'hx-detail-head');
      header.append(node('strong', `${name} · UID diferentes · Página ${page + 1}`));
      const actions = node('div', undefined, 'hx-detail-actions');
      if (page > 0) {
        const back = node('button', '← Anterior', 'hx-secondary');
        back.type = 'button';
        back.addEventListener('click', () => { void showSharedName(name, page - 1); });
        actions.append(back);
      }
      if (response.more) {
        const forward = node('button', 'Siguiente →', 'hx-secondary');
        forward.type = 'button';
        forward.addEventListener('click', () => { void showSharedName(name, page + 1); });
        actions.append(forward);
      }
      const closeButton = node('button', 'Cerrar detalle', 'hx-secondary');
      closeButton.type = 'button';
      closeButton.addEventListener('click', resetDetail);
      actions.append(closeButton);
      header.append(actions);
      const list = node('div', undefined, 'hx-names-list');
      for (const row of response.rows) {
        const item = node('div', undefined, 'hx-name-entry');
        const uid = node('button', 'UID ' + row.uid, 'hx-uid');
        uid.type = 'button';
        uid.dataset.uid = String(row.uid);
        uid.title = 'Ver historial del UID';
        item.append(uid, node('small', `${row.first} → ${row.last}`));
        list.append(item);
      }
      detail.replaceChildren(header, list);
    } catch (error) { if (sequence === state.detailGeneration && !dialog.hidden) detail.replaceChildren(node('p', 'Error: ' + error.message)); }
  }
  async function showUid(uid) {
    if (!validUid(uid)) return;
    const sequence = ++state.detailGeneration;
    detail.hidden = false;
    detail.replaceChildren(node('p', 'Consultando nombres del UID ' + uid + '…'));
    try {
      const response = await WhoDB.explore({mode: 'user', uid});
      if (sequence !== state.detailGeneration || dialog.hidden) return;
      const header = node('div', undefined, 'hx-detail-head');
      header.append(node('strong', `UID ${uid} · ${response.rows.length}${response.more ? '+' : ''} nombres registrados`));
      const actions = node('div', undefined, 'hx-detail-actions');
      const load = node('button', 'Cargar usuario', 'hx-load');
      load.type = 'button';
      load.dataset.uid = String(uid);
      const link = node('a', 'Consultando perfil…');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const apiLink = node('a', 'Ficha API ↗');
      apiLink.href = 'https://www.openstreetmap.org/api/0.6/user/' + encodeURIComponent(uid);
      apiLink.target = '_blank';
      apiLink.rel = 'noopener noreferrer';
      const hide = node('button', 'Cerrar detalle', 'hx-secondary');
      hide.type = 'button';
      hide.addEventListener('click', resetDetail);
      actions.append(load, link, apiLink, hide);
      header.append(actions);
      const list = node('div', undefined, 'hx-names-list');
      for (const entry of response.rows) {
        const line = node('div', undefined, 'hx-name-entry');
        line.append(node('span', entry.name), node('small', `${entry.first} → ${entry.last}`));
        list.append(line);
      }
      if (!response.rows.length) list.append(node('p', 'No hay nombres registrados para este UID.'));
      if (response.more) list.append(node('p', 'Mostrando los primeros 1.000 nombres.'));
      detail.replaceChildren(header, list);
      void (async () => {
        try {
          const response = await fetch('https://api.openstreetmap.org/api/0.6/user/' + encodeURIComponent(uid));
          if (!response.ok) throw Error('HTTP ' + response.status);
          const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
          const user = xml.getElementsByTagName('user')[0];
          if (!user || user.getAttribute('id') !== String(uid) || !user.getAttribute('display_name') || xml.getElementsByTagName('parsererror').length) throw Error('La API no ha devuelto un usuario válido para este UID.');
          if (sequence !== state.detailGeneration || dialog.hidden) return;
          link.href = 'https://www.openstreetmap.org/user/' + encodeURIComponent(user.getAttribute('display_name'));
          link.textContent = 'Perfil OSM ↗';
        } catch (error) {
          if (sequence !== state.detailGeneration || dialog.hidden) return;
          link.textContent = 'Perfil no disponible';
          link.title = error.message;
        }
      })();
    } catch (error) { if (sequence === state.detailGeneration && !dialog.hidden) detail.replaceChildren(node('p', 'Error: ' + error.message)); }
  }
  by('hxNameForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = by('hxName').value.trim(), match = by('hxMatch').value, uidText = by('hxNameUid').value.trim();
    if (!name && !uidText) { status.textContent = 'Introduce un nombre, patrón o UID.'; return; }
    if (uidText && !validUid(uidText)) { status.textContent = 'UID incorrecto.'; return; }
    if (match === 'regex' && name) { try { new RegExp(name, 'i'); } catch (error) { status.textContent = 'Regex no válida: ' + error.message; return; } }
    void startSearch({mode: 'names', match, name, uid: uidText || null});
  });
  by('hxDateForm').addEventListener('submit', event => {
    event.preventDefault();
    const from = by('hxFrom').value, to = by('hxTo').value;
    if (!from && !to) { status.textContent = 'Introduce al menos una fecha.'; return; }
    if (from && to && from > to) { status.textContent = 'La fecha inicial es posterior a la final.'; return; }
    void startSearch({mode: 'dates', dateMode: by('hxDateMode').value, from, to});
  });
  by('hxRankForm').addEventListener('submit', event => {
    event.preventDefault();
    const min = Number(by('hxMinimum').value);
    if (!Number.isSafeInteger(min) || min < 1 || min > 100000) { status.textContent = 'Mínimo de nombres incorrecto.'; return; }
    by('hxPosition').textContent = '';
    void startSearch({mode: 'ranking', min});
  });
  sharedForm.addEventListener('submit', event => { event.preventDefault(); void startSearch({mode: 'shared', filter: sharedFilter.value.trim()}); });
  by('hxFindRank').addEventListener('click', async () => {
    const uid = validUid(by('hxRankUid').value), min = Number(by('hxMinimum').value), output = by('hxPosition');
    if (!uid) { output.textContent = 'Introduce un UID válido.'; return; }
    if (!Number.isSafeInteger(min) || min < 1 || min > 100000) { output.textContent = 'Mínimo de nombres incorrecto.'; return; }
    const tab = state.tab;
    output.textContent = 'Calculando posición…';
    try {
      const result = await WhoDB.explore({mode: 'position', uid, min});
      if (dialog.hidden || state.tab !== tab) return;
      output.textContent = result.position ? `UID ${uid}: puesto ${result.position.toLocaleString('es-ES')} · ${result.total} nombres distintos.` : `UID ${uid}: ${result.total} nombres distintos · no entra en este ranking.`;
    } catch (error) { if (!dialog.hidden) output.textContent = 'Error: ' + error.message; }
  });
  for (const tab of dialog.querySelectorAll('.hx-tab')) tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  prev.addEventListener('click', () => { if (state.busy || state.page < 1) return; state.page--; void runSearch(); });
  next.addEventListener('click', () => { if (state.busy || !state.more) return; state.page++; void runSearch(); });
  results.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.sort) changeSort(button.dataset.sort);
    else if (button.dataset.sharedName !== undefined) void showSharedName(button.dataset.sharedName);
    else if (button.dataset.uid) void showUid(Number(button.dataset.uid));
  });
  detail.addEventListener('click', event => {
    const button = event.target.closest('button[data-uid]');
    if (!button) return;
    const uid = validUid(button.dataset.uid);
    if (!uid) return;
    if (!button.classList.contains('hx-load')) { void showUid(uid); return; }
    close();
    by('userName').value = '';
    by('userUID').value = String(uid);
    by('loadButton').click();
  });
  by('hxClose').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && event.target.classList.contains('hx-tab')) {
      event.preventDefault();
      const tabs = [...dialog.querySelectorAll('.hx-tab')];
      const index = tabs.indexOf(event.target), nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      switchTab(tabs[nextIndex].dataset.tab);
      tabs[nextIndex].focus();
    }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button, input, select, a[href]')].filter(item => !item.disabled && !item.closest('[hidden]') && item.getClientRects().length);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  });
  window.HistoryExplorer = {open};
})();
