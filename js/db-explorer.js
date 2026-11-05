(() => {
  const by = id => document.getElementById(id);
  const dialog = by('historyExplorer');
  const results = by('hxResults');
  const status = by('hxStatus');
  const detail = by('hxDetail');
  const prev = by('hxPrev');
  const next = by('hxNext');
  const pageInfo = by('hxPage');
  const state = {tab: 'names', request: null, page: 0, cursors: [0], more: false, busy: false, generation: 0, detailGeneration: 0, lastFocus: null};
  const PAGE_SIZE = 100;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const validUid = value => { const uid = Number(value); return Number.isSafeInteger(uid) && uid > 0 ? uid : null; };
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
    if (!['names', 'dates', 'ranking'].includes(tab)) return;
    state.tab = tab;
    for (const button of dialog.querySelectorAll('.hx-tab')) { const active = button.dataset.tab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; }
    for (const panel of dialog.querySelectorAll('.hx-panel')) panel.hidden = panel.id !== 'hxPanel' + tab[0].toUpperCase() + tab.slice(1);
    resetResults(tab === 'ranking' ? 'Consultando usuarios con más nombres…' : 'Introduce los filtros y pulsa Buscar.');
    by('hxPosition').textContent = '';
    if (tab === 'ranking') void startSearch({mode: 'ranking', min: Number(by('hxMinimum').value)});
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
  function renderRows(rows) {
    const table = node('table', undefined, 'hx-table');
    const head = node('thead');
    const hr = node('tr');
    const isRanking = state.tab === 'ranking';
    const headings = isRanking ? ['#', 'UID', 'Nombres distintos', 'Última observación'] : ['UID', 'Nombre histórico', 'Primera observación', 'Última observación'];
    for (const label of headings) hr.append(node('th', label));
    head.append(hr);
    const body = node('tbody');
    rows.forEach((row, index) => {
      const tr = node('tr');
      if (isRanking) tr.append(node('td', String(state.page * PAGE_SIZE + index + 1)));
      const uidCell = node('td');
      const openUid = node('button', String(row.uid), 'hx-uid');
      openUid.type = 'button';
      openUid.dataset.uid = String(row.uid);
      openUid.title = 'Ver nombres históricos y cargar usuario';
      uidCell.append(openUid);
      tr.append(uidCell);
      if (isRanking) { tr.append(node('td', Number(row.total).toLocaleString('es-ES'))); tr.append(node('td', row.last || '—')); }
      else { tr.append(node('td', row.name, 'hx-name')); tr.append(node('td', row.first || '—')); tr.append(node('td', row.last || '—')); }
      body.append(tr);
    });
    table.append(head, body);
    results.replaceChildren(table);
    results.scrollTop = 0;
  }
  async function runSearch() {
    if (!state.request) return;
    const request = {...state.request, page: state.page};
    if (request.mode === 'names' && request.match === 'regex' && request.name && !request.uid) request.cursor = state.cursors[state.page] || 0;
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
      if (request.cursor !== undefined) state.cursors[state.page + 1] = response.nextCursor;
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
    state.request = params;
    state.page = 0;
    state.cursors = [0];
    await runSearch();
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
      const link = node('a', 'Perfil OSM ↗');
      link.href = 'https://www.openstreetmap.org/user/' + encodeURIComponent(uid);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const hide = node('button', 'Cerrar detalle', 'hx-secondary');
      hide.type = 'button';
      hide.addEventListener('click', resetDetail);
      actions.append(load, link, hide);
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
  results.addEventListener('click', event => { const button = event.target.closest('button[data-uid]'); if (button) void showUid(Number(button.dataset.uid)); });
  detail.addEventListener('click', event => {
    const button = event.target.closest('button.hx-load[data-uid]');
    if (!button) return;
    const uid = validUid(button.dataset.uid);
    if (!uid) return;
    close();
    by('userName').value = '';
    by('userUID').value = String(uid);
    by('loadButton').click();
  });
  by('hxClose').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      if (event.target.classList.contains('hx-tab')) {
        event.preventDefault();
        const tabs = [...dialog.querySelectorAll('.hx-tab')];
        const index = tabs.indexOf(event.target), nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        switchTab(tabs[nextIndex].dataset.tab);
        tabs[nextIndex].focus();
      }
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
