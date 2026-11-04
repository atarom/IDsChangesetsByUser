const $ = (id) => document.getElementById(id),
  Q = (s) => document.querySelector(s),
  QA = (s) => document.querySelectorAll(s),
  X = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    ),
  FC = { type: "FeatureCollection", features: [] },
  SRC = "changesets",
  LSRC = "lasso",
  L = ["cs-fill", "cs-line", "cs-point"],
  LL = ["lasso-fill", "lasso-line", "lasso-point"],
  INFO = [
    "userInfo",
    "uidInfo",
    "changesetsCountInfo",
    "tracesCountInfo",
    "blocksInfo",
    "activeBlocksInfo",
    "namesInfo"
  ],
  ov = $("overlay"),
  ovT = $("ovTitle"),
  ovL = $("ovLog"),
  ovE = $("emoji"),
  map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/fiord",
    center: [0, 0],
    zoom: 2,
    minZoom: 1,
    maxZoom: 20,
    attributionControl: false
  });

let errs = [],
  boxes = [],
  fs = [],
  draw = 0,
  pts = [],
  closed = 0,
  sel = new Set(),
  drawBtn,
  order = [],
  last = null,
  frozen = 0,
  pop,
  drag = null,
  skip = 0;

map.addControl(
  new maplibregl.NavigationControl({ showCompass: false }),
  "top-left"
);
map.addControl(
  new maplibregl.AttributionControl({ compact: true }),
  "bottom-right"
);
map.once("load", () =>
  Q(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show")
);

const xml = (t) => new DOMParser().parseFromString(t, "application/xml"),
  req = (u) =>
    fetch(u).then((r) =>
      r.ok ? r.text() : Promise.reject(Error(`HTTP ${r.status}`))
    ),
  msg = (s) => (
    ov.hidden && openOv(),
    (ovL.value += (ovL.value ? "\n" : "") + s),
    (ovL.scrollTop = ovL.scrollHeight)
  ),
  title = (s, e = 0) => (
    (ovT.textContent = s),
    ovT.classList.toggle("err", !!e),
    (ovE.textContent = e ? "⛔" : "🥸")
  ),
  openOv = (s) => (
    (frozen = 0),
    (ovL.value = ""),
    title(s || "Procesando…"),
    (ov.hidden = false)
  ),
  err = (s) => (
    (frozen = 1), title(s || "Error", 1), msg("✖ " + (s || "Error"))
  ),
  closeOv = (ms) => {
    const f = () => !frozen && (ov.hidden = true);
    ms ? setTimeout(f, ms) : f();
  },
  summary = () =>
    ($(
      "summaryInfo"
    ).textContent = `Cargados: ${order.length} · Seleccionados: ${sel.size}`),
  selected = () => (
    ($("selectedIds").value = [...sel]
      .sort(
        (a, b) => (+b || 0) - (+a || 0) || String(b).localeCompare(String(a))
      )
      .join(",")),
    summary()
  );

const state = (id, on) => {
    map.getSource(SRC) &&
      ["r", "p"].forEach((k) =>
        map.setFeatureState({ source: SRC, id: k + id }, { selected: on })
      );
    Q(`#details .detail-line[data-id="${id}"]`)?.classList.toggle(
      "selected",
      on
    );
  },
  clearSel = () => {
    sel.forEach((id) => state(id, 0));
    sel.clear();
  },
  toggle = (id) => (
    sel.has(id) ? sel.delete(id) : sel.add(id),
    state(id, sel.has(id)),
    selected()
  );

const lasso = (c = closed) => {
  const s = map.getSource(LSRC);
  if (!s) return;
  const f = pts.map((p, i) => ({
    type: "Feature",
    id: "v" + i,
    properties: { i },
    geometry: { type: "Point", coordinates: p }
  }));
  c && pts.length > 2
    ? f.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] }
      })
    : pts.length > 1 &&
      f.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: pts }
      });
  s.setData({ type: "FeatureCollection", features: f });
};

const reset = () => {
  draw = closed = 0;
  drag = null;
  pts = [];
  last = null;
  clearSel();
  pop?.remove();
  pop = null;
  map.getSource(SRC) && map.removeFeatureState({ source: SRC });
  QA(".detail-line.selected").forEach((x) => x.classList.remove("selected"));
  lasso();
  $("selectedIds").value = "";
  drawBtn &&
    (drawBtn.classList.remove("active"), (drawBtn.title = "Dibujar selección"));
  map.doubleClickZoom.enable();
  map.dragPan.enable();
  map.getCanvas().style.cursor = "";
  summary();
};

const inside = (p, a) => {
  let r = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [x, y] = a[i],
      [x2, y2] = a[j];
    y > p[1] !== y2 > p[1] &&
      p[0] < ((x2 - x) * (p[1] - y)) / (y2 - y) + x &&
      (r = !r);
  }
  return r;
};

const selectLasso = () => {
  clearSel();
  pts.length > 2 &&
    boxes.forEach(
      ({ id, b: [w, s, e, n] }) =>
        [
          [w, n],
          [e, n],
          [e, s],
          [w, s]
        ].every((p) => inside(p, pts)) && (sel.add(id), state(id, 1))
    );
  selected();
};

const detail = (id, t) => {
  const d = document.createElement("div");
  d.className = "detail-line";
  d.dataset.id = id;
  d.textContent = `ID: ${id}, Created: ${t}`;
  $("details").append(d);
  order.push(id);
  summary();
};

const render = () => {
  map.getSource(SRC)?.setData({ type: "FeatureCollection", features: fs });
  requestAnimationFrame(() => sel.forEach((id) => state(id, 1)));
};

const clear = () => {
  currentUserUid = null;
  ["ids", "selectedIds", "errorLog"].forEach((id) => ($(id).value = ""));
  $("details").innerHTML = "";
  $("finishMessage").textContent = "";
  $("finishMessage").hidden = true;
  INFO.forEach((id) => ($(id).textContent = ""));
  $("namesInfo").textContent = "—";
  $("namesLink").href = "#historial-local";
  errs = [];
  boxes = [];
  fs = [];
  order = [];
  last = null;
  map.getSource(SRC)?.setData(FC);
  reset();
};

const drawClick = (ll) => {
  const p = [ll.lng, ll.lat];
  if (pts.length) {
    const a = map.project(ll),
      b = map.project(pts[0]);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 12) return endDraw();
  }
  pts.push(p);
  lasso(0);
};

const popupHtml = (c) => {
  const id = c.getAttribute("id"),
    t = c.getAttribute("created_at");
  return `<strong>Changeset ID:</strong> ${X(
    id
  )}<br><strong>Usuario:</strong> ${X(
    c.getAttribute("user")
  )}<br><strong>Fecha de creación:</strong> ${X(
    new Date(t).toLocaleString()
  )}<br><strong>Cambios:</strong> ${X(
    c.getAttribute("changes_count") || "N/A"
  )}<br><a href="https://www.osm.org/changeset/${X(
    id
  )}" target="_blank" rel="noopener">Ver en OpenStreetMap</a>`;
};

const addCS = (c) => {
  const id = c.getAttribute("id"),
    a = c.getAttribute("min_lat"),
    b = c.getAttribute("min_lon"),
    d = c.getAttribute("max_lat"),
    e = c.getAttribute("max_lon"),
    cnt = +(c.getAttribute("changes_count") || 0);
  if ([a, b, d, e].some((v) => v === null))
    throw Error(cnt ? "Sin bbox." : "Sin datos modificados.");
  const s = +a,
    w = +b,
    n = +d,
    x = +e;
  if ([s, w, n, x].some(Number.isNaN)) throw Error("bbox inválido (NaN).");
  const p = { id, popup: popupHtml(c) },
    poly = [
      [w, s],
      [x, s],
      [x, n],
      [w, n],
      [w, s]
    ];
  fs.push(
    {
      type: "Feature",
      id: "r" + id,
      properties: p,
      geometry: { type: "Polygon", coordinates: [poly] }
    },
    {
      type: "Feature",
      id: "p" + id,
      properties: p,
      geometry: { type: "Point", coordinates: [(w + x) / 2, (s + n) / 2] }
    }
  );
  boxes.push({ id, b: [w, s, x, n] });
  detail(id, c.getAttribute("created_at"));
  closed && selectLasso();
};

let currentUserUid = null;

// El historial solo se activa al pulsar «Nombres conocidos».
// Una vez desbloqueado, se consulta automáticamente al cargar cada usuario.
const wt = async (uid) => {
  if (!uid) return;
  const selectedUID = String(uid);
  if (!window.WhoDB?.ready) return;
  $("namesInfo").textContent = "Consultando historial local…";
  try {
    const names = await WhoDB.lookup(selectedUID);
    if (currentUserUid !== selectedUID) return;
    $("namesInfo").innerHTML = names.length
      ? names.map(x => `<span class="name-row"><b>${X(x.name)}</b><br><small>${X(x.first)} → ${X(x.last)}</small></span>`).join("")
      : "Sin historial conocido";
  } catch (e) {
    if (currentUserUid === selectedUID)
      $("namesInfo").textContent = "Error al consultar la base: " + e.message;
  }
};
window.currentHistoryUid = () => currentUserUid;
window.refreshLocalHistory = () => currentUserUid && wt(currentUserUid);

const user = (uid) =>
  req(`https://api.openstreetmap.org/api/0.6/user/${uid}`).then((t) => {
    const u = xml(t).getElementsByTagName("user")[0];
    if (!u) throw Error("No se pudieron obtener los datos del usuario.");
    const dn = u.getAttribute("display_name") || "",
      ch = u.getElementsByTagName("changesets")[0],
      tr = u.getElementsByTagName("traces")[0],
      rc = u
        .getElementsByTagName("blocks")[0]
        ?.getElementsByTagName("received")[0];
    $("userName").value = dn;
    $("userInfo").textContent = dn;
    $("uidInfo").textContent = uid;
    $("changesetsCountInfo").textContent = ch?.getAttribute("count") || 0;
    $("tracesCountInfo").textContent = tr?.getAttribute("count") || 0;
    $("blocksInfo").textContent = rc?.getAttribute("count") || 0;
    $("activeBlocksInfo").textContent = rc?.getAttribute("active") || 0;
    currentUserUid = String(uid);
    if (window.WhoDB?.ready) {
      // La base ya fue desbloqueada: consultar sin volver a pedir contraseña.
      void wt(currentUserUid);
    } else {
      $("namesInfo").textContent = "Pulsa «Nombres conocidos» para consultar";
    }
  });

const fit = () => {
  if (!boxes.length) return;
  const b = new maplibregl.LngLatBounds();
  boxes.forEach(({ b: [w, s, e, n] }) => (b.extend([w, s]), b.extend([e, n])));
  b.isEmpty() || map.fitBounds(b, { padding: 25, maxZoom: 16, duration: 500 });
};

const done = (s) => {
  msg("✔ " + s);
  $("finishMessage").textContent = s;
  $("finishMessage").hidden = false;
  $("ids").value = $("ids").value.replace(/,$/, "");
  render();
  fit();
  if (errs.length) {
    const g = errs.reduce(
      (a, { id, error }) => ((a[error] ??= []).push(id), a),
      {}
    );
    $("errorLog").value +=
      ($("errorLog").value ? "\n" : "") + "Resumen IDs con error:";
    Object.entries(g).forEach(
      ([e, ids]) => ($("errorLog").value += `\n${e}: ${ids.join(",")}`)
    );
  }
  closeOv(1500);
};

const loadCS = (uid, lim, n = 0, last = "") => {
  if (frozen) return;
  if (n >= lim)
    return done(`Alcanzado límite de ${lim} changesets especificado.`);
  const batch = Math.min(100, lim - n),
    url = `https://api.openstreetmap.org/api/0.6/changesets?user=${uid}&limit=${batch}${
      last ? `&time=2000-01-01,${last}` : ""
    }`;
  msg(`↻ Cargando lote (${n}/${lim})`);
  req(url)
    .then((t) => {
      if (frozen) return;
      const cs = [...xml(t).getElementsByTagName("changeset")];
      if (!cs.length)
        return done(`Sin más changesets disponibles. Total cargados: ${n}.`);
      cs.forEach((c) => {
        const id = c.getAttribute("id");
        try {
          addCS(c);
          $("ids").value += id + ",";
          n++;
        } catch (e) {
          errs.push({ id, error: e.message });
          $("errorLog").value += `Changeset ${id}: ${e.message}\n`;
        }
      });
      render();
      setTimeout(
        () => loadCS(uid, lim, n, cs.at(-1).getAttribute("created_at")),
        500
      );
    })
    .catch((e) => err("Error al cargar los changesets: " + e.message));
};

const startDraw = () => {
  reset();
  draw = 1;
  pop?.remove();
  pop = null;
  map.doubleClickZoom.disable();
  map.getCanvas().style.cursor = "crosshair";
  drawBtn &&
    (drawBtn.classList.add("active"), (drawBtn.title = "Finalizar selección"));
};

const endDraw = () => {
  if (!draw) return;
  draw = 0;
  map.doubleClickZoom.enable();
  map.getCanvas().style.cursor = "";
  drawBtn &&
    (drawBtn.classList.remove("active"), (drawBtn.title = "Dibujar selección"));
  if (pts.length < 3) {
    pts = [];
    closed = 0;
    return lasso();
  }
  closed = 1;
  lasso(1);
  selectLasso();
};

const startLoad = () => {
  currentUserUid = null;
  const name = $("userName").value.trim(),
    uid = $("userUID").value.trim(),
    lim = +$("maxChangesets").value;
  if (!name && !uid) return alert("Especifica nombre de usuario o UID.");
  if (!lim || lim < 1) return alert("Especifica número máximo de Changesets.");

  openOv("Cargando…");
  msg("• Preparando");
  $("finishMessage").hidden = true;

  ["details", "ids", "selectedIds", "errorLog"].forEach((id) => {
    const e = $(id);
    "value" in e ? (e.value = "") : (e.innerHTML = "");
  });

  INFO.forEach((id) => ($(id).textContent = ""));
  $("namesInfo").textContent = "—";
  $("namesLink").href = "#historial-local";

  errs = [];
  boxes = [];
  fs = [];
  order = [];
  last = null;
  map.getSource(SRC)?.setData(FC);
  reset();

  const p = uid
    ? Promise.resolve(uid)
    : req(
        `https://api.openstreetmap.org/api/0.6/changesets?display_name=${encodeURIComponent(
          name
        )}&limit=1`
      ).then((t) => {
        const c = xml(t).getElementsByTagName("changeset")[0];
        if (!c) throw Error("No se encontró el usuario.");
        return ($("userUID").value = c.getAttribute("uid"));
      });

  p.then((u) => (msg("• Consultando usuario"), user(u).then(() => u)))
    .then((u) => (msg("• Cargando changesets"), loadCS(u, lim)))
    .catch((e) => err(e.message));
};

class LassoControl {
  onAdd() {
    const c = (this._container = document.createElement("div")),
      a = document.createElement("button"),
      b = document.createElement("button");
    c.className = "maplibregl-ctrl maplibregl-ctrl-group map-toolbar";
    a.type = b.type = "button";
    a.innerHTML = "⬚";
    b.innerHTML = "✖";
    a.title = "Dibujar selección";
    b.title = "Limpiar selección";
    a.onclick = (e) => (e.stopPropagation(), draw ? endDraw() : startDraw());
    b.onclick = (e) => (e.stopPropagation(), reset());
    c.append(a, b);
    drawBtn = a;
    return c;
  }
  onRemove() {
    this._container?.remove();
  }
}

map.addControl(new LassoControl(), "top-left");

map.on("load", () => {
  map.addSource(SRC, { type: "geojson", data: FC });
  map.addSource(LSRC, { type: "geojson", data: FC });

  [
    [
      L[0],
      "fill",
      ["==", ["geometry-type"], "Polygon"],
      {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#65d8ff",
          "#8db6e8"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.3,
          0.14
        ]
      }
    ],
    [
      L[1],
      "line",
      ["==", ["geometry-type"], "Polygon"],
      {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#65d8ff",
          "#8db6e8"
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          3,
          1.5
        ],
        "line-opacity": 0.95
      }
    ],
    [
      L[2],
      "circle",
      ["==", ["geometry-type"], "Point"],
      {
        "circle-radius": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          6,
          5
        ],
        "circle-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#65d8ff",
          "#8db6e8"
        ],
        "circle-stroke-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#fff",
          "#162033"
        ],
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1.5,
          1
        ],
        "circle-opacity": 1
      }
    ],
    [
      LL[0],
      "fill",
      ["==", ["geometry-type"], "Polygon"],
      { "fill-color": "#8db6e8", "fill-opacity": 0.2 }
    ],
    [
      LL[1],
      "line",
      null,
      {
        "line-color": "#8db6e8",
        "line-width": 4,
        "line-opacity": 1,
        "line-dasharray": [1.5, 1]
      }
    ],
    [
      LL[2],
      "circle",
      ["==", ["geometry-type"], "Point"],
      {
        "circle-radius": 6,
        "circle-color": "#65d8ff",
        "circle-stroke-color": "#eaf7ff",
        "circle-stroke-width": 2
      }
    ]
  ].forEach(([id, type, filter, paint]) => {
    const layer = {
      id,
      type,
      source: id.startsWith("lasso") ? LSRC : SRC,
      paint
    };
    if (filter) layer.filter = filter;
    map.addLayer(layer);
  });

  fs.length && render();
});

map.on("mousedown", LL[2], (e) => {
  if (!closed || draw) return;
  const f = e.features?.[0];
  if (!f) return;
  e.preventDefault();
  drag = +f.properties.i;
  skip = 1;
  pop?.remove();
  pop = null;
  map.dragPan.disable();
  map.getCanvas().style.cursor = "grabbing";
});

map.on("mousemove", (e) => {
  if (drag !== null) {
    pts[drag] = [e.lngLat.lng, e.lngLat.lat];
    return lasso(1);
  }
  if (draw) {
    map.getCanvas().style.cursor = "crosshair";
    return;
  }
  if (
    closed &&
    map.getLayer(LL[2]) &&
    map.queryRenderedFeatures(e.point, { layers: [LL[2]] }).length
  ) {
    map.getCanvas().style.cursor = "grab";
    return;
  }
  const ls = L.filter((id) => map.getLayer(id));
  map.getCanvas().style.cursor =
    ls.length && map.queryRenderedFeatures(e.point, { layers: ls }).length
      ? "pointer"
      : "";
});

const endDrag = () => {
  if (drag === null) return;
  drag = null;
  map.dragPan.enable();
  map.getCanvas().style.cursor = "";
  lasso(1);
  selectLasso();
  setTimeout(() => (skip = 0));
};

map.on("mouseup", endDrag);
map.on("mouseleave", endDrag);

map.on("click", (e) => {
  if (skip) return;
  if (draw) return drawClick(e.lngLat);
  const ls = L.filter((id) => map.getLayer(id)),
    f = ls.length && map.queryRenderedFeatures(e.point, { layers: ls })[0];
  if (!f) return;
  pop?.remove();
  pop = new maplibregl.Popup({ maxWidth: "380px" })
    .setLngLat(e.lngLat)
    .setHTML(f.properties.popup)
    .addTo(map);
});

map.on("dblclick", (e) => {
  if (draw) {
    e.preventDefault();
    endDraw();
  }
});

$("ovX").onclick = () => {
  frozen = 0;
  ov.hidden = true;
};

$("userName").oninput = () => {
  $("userUID").value = "";
  clear();
};

$("userUID").oninput = () => {
  $("userName").value = "";
  clear();
};

$("loadButton").onclick = startLoad;

$("details").onmousedown = (e) => {
  if (!e.target.closest(".detail-line")) return;
  e.preventDefault();
  const s = getSelection();
  s && s.removeAllRanges();
};

$("details").onclick = (e) => {
  const d = e.target.closest(".detail-line");
  if (!d) return;
  const id = d.dataset.id,
    i = order.indexOf(id);

  if (e.shiftKey && last !== null && i > -1) {
    const [a, b] = [last, i].sort((x, y) => x - y);
    for (let n = a; n <= b; n++) {
      sel.add(order[n]);
      state(order[n], 1);
    }
    selected();
  } else toggle(id);

  last = i;
};

const fallback = (t) => {
  const x = document.createElement("textarea");
  x.value = t;
  x.style.cssText = "position:fixed;opacity:0";
  document.body.append(x);
  x.select();
  try {
    document.execCommand("copy");
  } catch {}
  x.remove();
};

QA(".copy-btn").forEach(
  (b) =>
    (b.onclick = () => {
      const e = $(b.dataset.target),
        t = ("value" in e ? e.value : e.textContent) || "";
      if (!t) return;
      navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(t).catch(() => fallback(t))
        : fallback(t);
    })
);

