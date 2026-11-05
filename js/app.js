const $ = id => document.getElementById(id);
const Q = selector => document.querySelector(selector);
const QA = selector => document.querySelectorAll(selector);
const X = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FC = { type: 'FeatureCollection', features: [] };
const SRC = 'changesets';
const LSRC = 'lasso';
const L = ['cs-fill', 'cs-line', 'cs-point'];
const LL = ['lasso-fill', 'lasso-line', 'lasso-point'];
const INFO = ['userInfo', 'uidInfo', 'changesetsCountInfo', 'tracesCountInfo', 'blocksInfo', 'activeBlocksInfo', 'namesInfo'];
const ov = $('overlay');
const ovT = $('ovTitle');
const ovL = $('ovLog');
const ovE = $('emoji');
const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/fiord', center: [0, 0], zoom: 2, minZoom: 1, maxZoom: 20, attributionControl: false });
let errs = [], boxes = [], fs = [], order = [], indexById = new Map(), draw = 0, pts = [], closed = 0, sel = new Set(), drawBtn, last = null, frozen = 0, pop, drag = null, skip = 0;
let currentUserUid = null, activeRun = 0, loadController = null, renderedCount = 0, nodeById = new Map();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.once('load', () => Q('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
const xml = text => new DOMParser().parseFromString(text, 'application/xml');
const req = async (url, signal) => { const response = await fetch(url, { signal }); if (!response.ok)
    throw Error(`HTTP ${response.status}`); return response.text(); };
const msg = text => { if (ov.hidden)
    openOv(); ovL.value += (ovL.value ? '\n' : '') + text; ovL.scrollTop = ovL.scrollHeight; };
const title = (text, error = false) => { ovT.textContent = text; ovT.classList.toggle('err', !!error); ovE.textContent = error ? '⛔' : '🥸'; };
const openOv = text => { frozen = 0; ovL.value = ''; title(text || 'Procesando…'); ov.hidden = false; };
const err = text => { frozen = 1; title(text || 'Error', true); msg('✖ ' + (text || 'Error')); };
const closeOv = ms => { const run = activeRun; const close = () => { if (!frozen && activeRun === run)
    ov.hidden = true; }; ms ? setTimeout(close, ms) : close(); };
const summary = () => { $('summaryInfo').textContent = `Cargados: ${order.length} · Seleccionados: ${sel.size}`; };
const selected = () => { $('selectedIds').value = [...sel].sort((a, b) => (+b || 0) - (+a || 0) || String(b).localeCompare(String(a))).join(','); summary(); };
const state = (id, on) => { if (map.getSource(SRC))
    for (const k of ['r', 'p'])
        map.setFeatureState({ source: SRC, id: k + id }, { selected: !!on }); const node = nodeById.get(id); if (node) {
    node.classList.toggle('selected', !!on);
    node.setAttribute('aria-pressed', String(!!on));
} };
const clearSel = () => { for (const id of sel)
    state(id, false); sel.clear(); };
const toggle = id => { sel.has(id) ? sel.delete(id) : sel.add(id); state(id, sel.has(id)); selected(); };
const lasso = (isClosed = closed) => { const source = map.getSource(LSRC); if (!source)
    return; const features = pts.map((point, i) => ({ type: 'Feature', id: 'v' + i, properties: { i }, geometry: { type: 'Point', coordinates: point } })); if (isClosed && pts.length > 2)
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
else if (pts.length > 1)
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }); source.setData({ type: 'FeatureCollection', features }); };
const reset = () => { draw = closed = 0; drag = null; pts = []; last = null; clearSel(); pop?.remove(); pop = null; if (map.getSource(SRC))
    map.removeFeatureState({ source: SRC }); QA('.detail-line.selected').forEach(node => { node.classList.remove('selected'); node.setAttribute('aria-pressed', 'false'); }); lasso(); $('selectedIds').value = ''; if (drawBtn) {
    drawBtn.classList.remove('active');
    drawBtn.title = 'Dibujar selección';
} map.doubleClickZoom.enable(); map.dragPan.enable(); map.getCanvas().style.cursor = ''; summary(); };
const inside = (point, polygon) => { let result = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i], [xx, yy] = polygon[j];
    if ((y > point[1]) !== (yy > point[1]) && point[0] < ((xx - x) * (point[1] - y)) / (yy - y) + x)
        result = !result;
} return result; };
const selectLasso = () => { clearSel(); if (pts.length > 2)
    for (const { id, b: [w, s, e, n] } of boxes)
        if ([[w, n], [e, n], [e, s], [w, s]].every(point => inside(point, pts))) {
            sel.add(id);
            state(id, true);
        } selected(); };
const detail = (id, date, fragment) => { const node = document.createElement('div'); node.className = 'detail-line'; node.dataset.id = id; node.textContent = `ID: ${id}, Created: ${date}`; node.tabIndex = order.length ? -1 : 0; node.setAttribute('role', 'button'); node.setAttribute('aria-pressed', 'false'); fragment.append(node); indexById.set(id, order.length); nodeById.set(id, node); order.push(id); };
const render = () => { map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: fs }); renderedCount = order.length; requestAnimationFrame(() => { for (const id of sel)
    state(id, true); }); };
const abortLoad = () => { activeRun++; loadController?.abort(); loadController = null; };
const clear = () => { abortLoad(); currentUserUid = null; frozen = 0; ov.hidden = true; for (const id of ['ids', 'selectedIds', 'errorLog'])
    $(id).value = ''; $('details').replaceChildren(); $('finishMessage').textContent = ''; $('finishMessage').hidden = true; for (const id of INFO)
    $(id).textContent = ''; $('namesInfo').textContent = '—'; $('namesLink').href = '#historial-local'; errs = []; boxes = []; fs = []; order = []; indexById = new Map(); nodeById = new Map(); last = null; renderedCount = 0; map.getSource(SRC)?.setData(FC); reset(); };
const drawClick = point => { const coordinates = [point.lng, point.lat]; if (pts.length) {
    const a = map.project(point), b = map.project(pts[0]);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 12)
        return endDraw();
} pts.push(coordinates); lasso(false); };
const popupHtml = changeset => { const id = changeset.getAttribute('id'), date = changeset.getAttribute('created_at'); return `<strong>Changeset ID:</strong> ${X(id)}<br><strong>Usuario:</strong> ${X(changeset.getAttribute('user'))}<br><strong>Fecha de creación:</strong> ${X(new Date(date).toLocaleString())}<br><strong>Cambios:</strong> ${X(changeset.getAttribute('changes_count') || 'N/A')}<br><a href="https://www.osm.org/changeset/${X(id)}" target="_blank" rel="noopener">Ver en OpenStreetMap</a>`; };
const addCS = (changeset, fragment) => { const id = changeset.getAttribute('id'), a = changeset.getAttribute('min_lat'), b = changeset.getAttribute('min_lon'), c = changeset.getAttribute('max_lat'), d = changeset.getAttribute('max_lon'), count = +(changeset.getAttribute('changes_count') || 0); if ([a, b, c, d].some(value => value === null))
    throw Error(count ? 'Sin bbox.' : 'Sin datos modificados.'); const s = +a, w = +b, n = +c, e = +d; if ([s, w, n, e].some(Number.isNaN))
    throw Error('bbox inválido (NaN).'); const properties = { id, popup: popupHtml(changeset) }, polygon = [[w, s], [e, s], [e, n], [w, n], [w, s]]; fs.push({ type: 'Feature', id: 'r' + id, properties, geometry: { type: 'Polygon', coordinates: [polygon] } }, { type: 'Feature', id: 'p' + id, properties, geometry: { type: 'Point', coordinates: [(w + e) / 2, (s + n) / 2] } }); boxes.push({ id, b: [w, s, e, n] }); detail(id, changeset.getAttribute('created_at'), fragment); };
const wt = async (uid) => { if (!uid || !window.WhoDB?.ready)
    return; const selectedUID = String(uid); $('namesInfo').textContent = 'Consultando historial local…'; try {
    const names = await WhoDB.lookup(selectedUID);
    if (currentUserUid !== selectedUID)
        return;
    $('namesInfo').innerHTML = names.length ? names.map(x => `<span class="name-row"><b>${X(x.name)}</b><br><small>${X(x.first)} → ${X(x.last)}</small></span>`).join('') : 'Sin historial conocido';
}
catch (error) {
    if (currentUserUid === selectedUID)
        $('namesInfo').textContent = 'Error al consultar la base: ' + error.message;
} };
window.currentHistoryUid = () => currentUserUid;
window.refreshLocalHistory = () => currentUserUid && wt(currentUserUid);
const user = async (uid, signal, run) => { const text = await req(`https://api.openstreetmap.org/api/0.6/user/${encodeURIComponent(uid)}`, signal); if (run !== activeRun || signal.aborted)
    return; const node = xml(text).getElementsByTagName('user')[0]; if (!node)
    throw Error('No se pudieron obtener los datos del usuario.'); const name = node.getAttribute('display_name') || '', changesets = node.getElementsByTagName('changesets')[0], traces = node.getElementsByTagName('traces')[0], received = node.getElementsByTagName('blocks')[0]?.getElementsByTagName('received')[0]; $('userName').value = name; $('userInfo').textContent = name; $('uidInfo').textContent = uid; $('changesetsCountInfo').textContent = changesets?.getAttribute('count') || 0; $('tracesCountInfo').textContent = traces?.getAttribute('count') || 0; $('blocksInfo').textContent = received?.getAttribute('count') || 0; $('activeBlocksInfo').textContent = received?.getAttribute('active') || 0; currentUserUid = String(uid); if (window.WhoDB?.ready)
    void wt(currentUserUid);
else
    $('namesInfo').textContent = 'Pulsa «Nombres conocidos» para consultar'; };
const fit = () => { if (!boxes.length)
    return; const bounds = new maplibregl.LngLatBounds(); for (const { b: [w, s, e, n] } of boxes) {
    bounds.extend([w, s]);
    bounds.extend([e, n]);
} if (!bounds.isEmpty())
    map.fitBounds(bounds, { padding: 25, maxZoom: 16, duration: 500 }); };
const done = text => { msg('✔ ' + text); $('finishMessage').textContent = text; $('finishMessage').hidden = false; $('ids').value = $('ids').value.replace(/,$/, ''); if (renderedCount !== order.length)
    render(); fit(); if (errs.length) {
    const groups = errs.reduce((acc, { id, error }) => ((acc[error] ??= []).push(id), acc), {});
    $('errorLog').value += ($('errorLog').value ? '\n' : '') + 'Resumen IDs con error:';
    for (const [error, ids] of Object.entries(groups))
        $('errorLog').value += `\n${error}: ${ids.join(',')}`;
} closeOv(1500); };
const loadCS = async (uid, limit, run, signal) => { const seen = new Set(); let cursor = null, batches = 0; while (run === activeRun && !signal.aborted && order.length < limit) {
    const url = `https://api.openstreetmap.org/api/0.6/changesets?user=${encodeURIComponent(uid)}&limit=100${cursor ? `&from=2000-01-01T00%3A00%3A00Z&to=${encodeURIComponent(cursor)}` : ''}`;
    msg(`↻ Cargando lote (${order.length}/${limit})`);
    const text = await req(url, signal);
    if (run !== activeRun || signal.aborted)
        return;
    const changesets = [...xml(text).getElementsByTagName('changeset')];
    if (!changesets.length)
        return done(`Sin más changesets disponibles. Total cargados: ${order.length}.`);
    const fragment = document.createDocumentFragment(), ids = [];
    let fresh = 0;
    for (const changeset of changesets) {
        const id = changeset.getAttribute('id');
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        fresh++;
        if (order.length >= limit)
            break;
        try {
            addCS(changeset, fragment);
            ids.push(id);
        }
        catch (error) {
            errs.push({ id, error: error.message });
            $('errorLog').value += `Changeset ${id}: ${error.message}\n`;
        }
    }
    $('details').append(fragment);
    if (ids.length)
        $('ids').value += ids.join(',') + ',';
    summary();
    if (closed)
        selectLasso();
    batches++;
    if (!renderedCount || order.length - renderedCount >= 500 || changesets.length < 100 || order.length >= limit)
        render();
    if (order.length >= limit)
        return done(`Alcanzado límite de ${limit} changesets especificado.`);
    if (changesets.length < 100)
        return done(`Sin más changesets disponibles. Total cargados: ${order.length}.`);
    const oldest = changesets.at(-1).getAttribute('created_at'), time = Date.parse(oldest);
    if (!Number.isFinite(time))
        throw Error('Fecha de changeset inválida; paginación interrumpida.');
    const next = new Date(time + 1000).toISOString();
    if (!fresh || (cursor && next >= cursor)) {
        $('errorLog').value += 'Paginación: demasiados changesets con la misma fecha de creación; el servidor no permite avanzar.\n';
        render();
        fit();
        err(`Paginación incompleta: ${order.length} changesets cargados.`);
        return;
    }
    cursor = next;
    await new Promise(resolve => setTimeout(resolve, 500));
} };
const startDraw = () => { reset(); draw = 1; pop?.remove(); pop = null; map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair'; if (drawBtn) {
    drawBtn.classList.add('active');
    drawBtn.title = 'Finalizar selección';
} };
const endDraw = () => { if (!draw)
    return; draw = 0; map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ''; if (drawBtn) {
    drawBtn.classList.remove('active');
    drawBtn.title = 'Dibujar selección';
} if (pts.length < 3) {
    pts = [];
    closed = 0;
    lasso();
    return;
} closed = 1; lasso(true); selectLasso(); };
const startLoad = async () => { const name = $('userName').value.trim(), uid = $('userUID').value.trim(), limit = Number($('maxChangesets').value); if (!name && !uid)
    return alert('Especifica nombre de usuario o UID.'); if (!Number.isSafeInteger(limit) || limit < 1)
    return alert('Especifica un máximo de Changesets válido (entero positivo).'); abortLoad(); const run = activeRun, controller = new AbortController(); loadController = controller; const { signal } = controller; currentUserUid = null; openOv('Cargando…'); msg('• Preparando'); $('finishMessage').hidden = true; for (const id of ['details', 'ids', 'selectedIds', 'errorLog']) {
    const node = $(id);
    if ('value' in node)
        node.value = '';
    else
        node.replaceChildren();
} for (const id of INFO)
    $(id).textContent = ''; $('namesInfo').textContent = '—'; $('namesLink').href = '#historial-local'; errs = []; boxes = []; fs = []; order = []; indexById = new Map(); nodeById = new Map(); last = null; renderedCount = 0; map.getSource(SRC)?.setData(FC); reset(); try {
    let chosen = uid;
    if (!chosen) {
        const response = await req(`https://api.openstreetmap.org/api/0.6/changesets?display_name=${encodeURIComponent(name)}&limit=1`, signal);
        if (run !== activeRun || signal.aborted)
            return;
        const changeset = xml(response).getElementsByTagName('changeset')[0];
        if (!changeset)
            throw Error('No se encontró el usuario.');
        chosen = changeset.getAttribute('uid');
        $('userUID').value = chosen;
    }
    if (run !== activeRun || signal.aborted)
        return;
    msg('• Consultando usuario');
    await user(chosen, signal, run);
    if (run !== activeRun || signal.aborted)
        return;
    msg('• Cargando changesets');
    await loadCS(chosen, limit, run, signal);
}
catch (error) {
    if (run === activeRun && !signal.aborted)
        err('Error al cargar los changesets: ' + error.message);
}
finally {
    if (run === activeRun)
        loadController = null;
} };
class LassoControl {
    onAdd() { const container = this._container = document.createElement('div'), a = document.createElement('button'), b = document.createElement('button'); container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-toolbar'; a.type = b.type = 'button'; a.innerHTML = '⬚'; b.innerHTML = '✖'; a.title = 'Dibujar selección'; b.title = 'Limpiar selección'; a.onclick = e => { e.stopPropagation(); draw ? endDraw() : startDraw(); }; b.onclick = e => { e.stopPropagation(); reset(); }; container.append(a, b); drawBtn = a; return container; }
    onRemove() { this._container?.remove(); }
}
map.addControl(new LassoControl(), 'top-left');
map.on('load', () => { map.addSource(SRC, { type: 'geojson', data: FC }); map.addSource(LSRC, { type: 'geojson', data: FC }); const selectedColor = ['case', ['boolean', ['feature-state', 'selected'], false], '#65d8ff', '#8db6e8']; const layers = [[L[0], 'fill', ['==', ['geometry-type'], 'Polygon'], { 'fill-color': selectedColor, 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.3, 0.14] }], [L[1], 'line', ['==', ['geometry-type'], 'Polygon'], { 'line-color': selectedColor, 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5], 'line-opacity': 0.95 }], [L[2], 'circle', ['==', ['geometry-type'], 'Point'], { 'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 6, 5], 'circle-color': selectedColor, 'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#fff', '#162033'], 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 1.5, 1], 'circle-opacity': 1 }], [LL[0], 'fill', ['==', ['geometry-type'], 'Polygon'], { 'fill-color': '#8db6e8', 'fill-opacity': 0.2 }], [LL[1], 'line', null, { 'line-color': '#8db6e8', 'line-width': 4, 'line-opacity': 1, 'line-dasharray': [1.5, 1] }], [LL[2], 'circle', ['==', ['geometry-type'], 'Point'], { 'circle-radius': 6, 'circle-color': '#65d8ff', 'circle-stroke-color': '#eaf7ff', 'circle-stroke-width': 2 }]]; for (const [id, type, filter, paint] of layers) {
    const layer = { id, type, source: id.startsWith('lasso') ? LSRC : SRC, paint };
    if (filter)
        layer.filter = filter;
    map.addLayer(layer);
} if (fs.length)
    render(); });
map.on('mousedown', LL[2], event => { if (!closed || draw)
    return; const feature = event.features?.[0]; if (!feature)
    return; event.preventDefault(); drag = +feature.properties.i; skip = 1; pop?.remove(); pop = null; map.dragPan.disable(); map.getCanvas().style.cursor = 'grabbing'; });
map.on('mousemove', event => { if (drag !== null) {
    pts[drag] = [event.lngLat.lng, event.lngLat.lat];
    lasso(true);
    return;
} if (draw) {
    map.getCanvas().style.cursor = 'crosshair';
    return;
} if (closed && map.getLayer(LL[2]) && map.queryRenderedFeatures(event.point, { layers: [LL[2]] }).length) {
    map.getCanvas().style.cursor = 'grab';
    return;
} const layers = L.filter(id => map.getLayer(id)); map.getCanvas().style.cursor = layers.length && map.queryRenderedFeatures(event.point, { layers }).length ? 'pointer' : ''; });
const endDrag = () => { if (drag === null)
    return; drag = null; map.dragPan.enable(); map.getCanvas().style.cursor = ''; lasso(true); selectLasso(); setTimeout(() => skip = 0); };
map.on('mouseup', endDrag);
map.on('mouseleave', endDrag);
map.on('click', event => { if (skip)
    return; if (draw)
    return drawClick(event.lngLat); const layers = L.filter(id => map.getLayer(id)), feature = layers.length && map.queryRenderedFeatures(event.point, { layers })[0]; if (!feature)
    return; pop?.remove(); pop = new maplibregl.Popup({ maxWidth: '380px' }).setLngLat(event.lngLat).setHTML(feature.properties.popup).addTo(map); });
map.on('dblclick', event => { if (draw) {
    event.preventDefault();
    endDraw();
} });
$('ovX').onclick = () => { abortLoad(); frozen = 0; ov.hidden = true; };
$('userName').oninput = () => { $('userUID').value = ''; clear(); };
$('userUID').oninput = () => { $('userName').value = ''; clear(); };
$('loadButton').onclick = startLoad;
$('details').onmousedown = event => { if (!event.target.closest('.detail-line'))
    return; event.preventDefault(); const selection = getSelection(); selection?.removeAllRanges(); };
const clickDetail = (node, shift) => { const id = node.dataset.id, i = indexById.get(id); if (shift && last !== null && i !== undefined) {
    const [a, b] = [last, i].sort((x, y) => x - y);
    for (let n = a; n <= b; n++) {
        sel.add(order[n]);
        state(order[n], true);
    }
    selected();
}
else
    toggle(id); last = i; };
$('details').onclick = event => { const node = event.target.closest('.detail-line'); if (node)
    clickDetail(node, event.shiftKey); };
$('details').onkeydown = event => { const node = event.target.closest('.detail-line'); if (!node)
    return; if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    clickDetail(node, event.shiftKey);
    return;
} if (!['ArrowDown', 'ArrowUp'].includes(event.key))
    return; event.preventDefault(); const i = indexById.get(node.dataset.id), next = $('details').children[Math.max(0, Math.min(order.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))]; if (next && next !== node) {
    node.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
} };
const fallback = text => { const node = document.createElement('textarea'); node.value = text; node.style.cssText = 'position:fixed;opacity:0'; document.body.append(node); node.select(); try {
    document.execCommand('copy');
}
catch { } node.remove(); };
QA('.copy-btn').forEach(button => button.onclick = () => { const node = $(button.dataset.target), text = ('value' in node ? node.value : node.textContent) || ''; if (!text)
    return; navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).catch(() => fallback(text)) : fallback(text); });
