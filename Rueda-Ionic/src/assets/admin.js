/*
 * ============================================================================
 *  RUEDA · PANEL DE ADMINISTRADOR
 * ============================================================================
 *  Este archivo contiene todo lo del rol "admin":
 *    - Resumen (KPIs, gráficas de viajes y conductores, viajes e incidencias).
 *    - Conductores (buscar, filtrar y aprobar / rechazar / suspender).
 *    - Tarifas (ver las tarifas y crear nuevas con vista previa del precio).
 *    - Viajes (tabla con filtros por estado, cliente, conductor y fecha).
 *    - Reportes (muestra lo que devuelva /admin/reports de forma legible).
 *    - Auditoría (registro de acciones con buscador).
 *    - Modo demo de administrador (datos ficticios, sin servidor).
 *
 *  Se carga ANTES que app.js (ver home.page.ts). Usa funciones de app.js como
 *  request(), escapeHtml(), money(), statusBadge(), openModal(), etc. Esas
 *  funciones solo se llaman cuando el usuario ya está dentro del panel, así
 *  que para ese momento app.js ya terminó de cargar.
 *
 *  Endpoints usados (ver API_DOCUMENTATION.md del profesor):
 *    GET   /admin/dashboard
 *    GET   /admin/drivers?approval_status=
 *    PATCH /admin/drivers/{id}/approval
 *    GET   /admin/fares      ·  POST /admin/fares
 *    GET   /admin/trips?status=&client_id=&driver_id=&date=
 *    GET   /admin/reports
 *    GET   /admin/audit-logs
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 * Estado del panel de administrador
 * (las variables empiezan por "admin" para no chocar con las de app.js)
 * ------------------------------------------------------------------------- */

// Token falso que identifica la sesión de demostración del administrador.
const ADMIN_DEMO_TOKEN = 'rueda-local-admin-demo';
// Clave de sessionStorage donde se guardan los datos ficticios de la demo.
const ADMIN_DEMO_DATA_KEY = 'rueda_admin_demo_data';

// Pestañas del panel: [clave, texto, ícono].
const ADMIN_TABS = [
  ['overview', 'Resumen', '▦'],
  ['drivers', 'Conductores', '◉'],
  ['fares', 'Tarifas', '$'],
  ['trips', 'Viajes', '↗'],
  ['reports', 'Reportes', '▤'],
  ['audit', 'Auditoría', '◷'],
];

// Filtros elegidos en cada pestaña; se conservan al cambiar de pestaña.
let adminDriverFilter = '';
let adminDriverSearch = '';
let adminTripFilters = { status: '', client_id: '', driver_id: '', date: '' };
let adminAuditSearch = '';
// Últimos datos cargados (para filtrar en pantalla sin volver a llamar a la API).
let adminDriversCache = [];
let adminAuditCache = [];
// Número de conductores pendientes; se muestra como globito en la pestaña.
let adminPendingCount = 0;

// Texto en español para los estados de aprobación que puede elegir el admin.
const APPROVAL_ACTIONS = {
  approved: { label: 'Aprobar', verb: 'aprobar', button: 'btn-primary' },
  rejected: { label: 'Rechazar', verb: 'rechazar', button: 'btn-danger-solid' },
  suspended: { label: 'Suspender', verb: 'suspender', button: 'btn-outline' },
};

/* ---------------------------------------------------------------------------
 * Utilidades pequeñas
 * ------------------------------------------------------------------------- */

// ¿La sesión actual es la demo del administrador?
function isDemoAdmin() {
  return sessionStorage.getItem(STORAGE_KEYS.token) === ADMIN_DEMO_TOKEN;
}

// Iniciales para el avatar: "Carlos Rodríguez" → "CR".
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

// Convierte a número; si no se puede, devuelve 0 (útil para sumar KPIs).
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Porcentaje entero de "part" sobre "total", sin dividir por cero.
function percent(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// Convierte "total_revenue" en "Total revenue" para mostrar llaves de la API.
function humanizeKey(key) {
  const text = String(key).replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------------------------------------------------------------------------
 * Estructura general del panel
 * ------------------------------------------------------------------------- */

// Encabezado oscuro del panel con saludo, fecha, botón de actualizar y pestañas.
function adminHeader() {
  const firstName = escapeHtml((sessionUser?.name || '').trim().split(/\s+/)[0] || 'admin');
  const today = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return `
    ${isDemoAdmin() ? '<div class="demo-mode-banner"><span aria-hidden="true">●</span><div><strong>Modo de demostración del administrador</strong><span>Los datos son ficticios; los cambios no se envían al servidor y se borran al cerrar la pestaña.</span></div></div>' : ''}
    <section class="admin-hero">
      <div class="admin-hero-top">
        <div>
          <p class="admin-kicker"><span></span> CENTRO DE CONTROL</p>
          <h1>Hola, ${firstName}.</h1>
          <p class="admin-date">${escapeHtml(today)} · Así va la operación de Rueda.</p>
        </div>
        <button class="btn admin-refresh" data-action="refresh"><span aria-hidden="true">↻</span> Actualizar</button>
      </div>
      <nav class="admin-tabs" aria-label="Secciones del panel">
        ${ADMIN_TABS.map(([key, label, icon]) => `
          <button class="admin-tab ${activeView === key ? 'active' : ''}" data-action="admin-view" data-view="${key}" ${activeView === key ? 'aria-current="page"' : ''}>
            <span aria-hidden="true">${icon}</span>${label}
            ${key === 'drivers' && adminPendingCount ? `<b class="tab-badge" aria-label="${adminPendingCount} pendientes">${adminPendingCount}</b>` : ''}
          </button>`).join('')}
      </nav>
    </section>`;
}

// Punto de entrada del panel: app.js llama a esta función cuando el rol es "admin".
// Carga la pestaña activa y pinta todo dentro de #main-content.
async function renderAdmin() {
  const views = {
    overview: adminOverview,
    drivers: adminDrivers,
    fares: adminFares,
    trips: adminTrips,
    reports: adminReports,
    audit: adminAudit,
  };
  if (!views[activeView]) activeView = 'overview';
  const content = await views[activeView]();
  app.innerHTML = `${adminHeader()}<div class="admin-body">${content}</div>`;
}

/* ---------------------------------------------------------------------------
 * Pestaña: RESUMEN
 * ------------------------------------------------------------------------- */

// Tarjeta de indicador (KPI) con ícono, valor grande y detalle.
function adminKpi(icon, label, value, detail = '', tone = '') {
  return `<article class="admin-kpi ${tone}">
    <span class="admin-kpi-icon" aria-hidden="true">${icon}</span>
    <div><span class="admin-kpi-label">${escapeHtml(label)}</span>
    <strong class="admin-kpi-value">${escapeHtml(value ?? '—')}</strong>
    ${detail ? `<span class="admin-kpi-detail">${escapeHtml(detail)}</span>` : ''}</div>
  </article>`;
}

// Barra horizontal apilada: muestra cómo se reparten los viajes por estado.
function tripsBar(stats) {
  const parts = [
    ['Completados', toNumber(stats.completed_trips), 'seg-completed'],
    ['Activos', toNumber(stats.active_trips), 'seg-active'],
    ['Solicitudes', toNumber(stats.pending_requests), 'seg-pending'],
    ['Cancelados', toNumber(stats.cancelled_trips), 'seg-cancelled'],
  ];
  const total = parts.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return emptyState('Todavía no hay viajes registrados.', '↗');
  return `<div class="stacked-bar" role="img" aria-label="Distribución de ${total} viajes por estado">
      ${parts.filter(([, value]) => value).map(([label, value, css]) => `<span class="${css}" style="width:${percent(value, total)}%" title="${label}: ${value}"></span>`).join('')}
    </div>
    <ul class="bar-legend">
      ${parts.map(([label, value, css]) => `<li><span class="legend-dot ${css}"></span>${label}<b>${value}</b><small>${percent(value, total)}%</small></li>`).join('')}
    </ul>`;
}

// Anillo (donut) hecho con CSS conic-gradient: aprobados vs. pendientes.
function driversDonut(stats) {
  const approved = toNumber(stats.approved_drivers);
  const pending = toNumber(stats.pending_drivers);
  const total = Math.max(toNumber(stats.total_drivers), approved + pending);
  const others = Math.max(0, total - approved - pending);
  const approvedDeg = total ? (approved / total) * 360 : 0;
  const pendingDeg = total ? (pending / total) * 360 : 0;
  return `<div class="donut-wrap">
    <div class="donut" style="background:conic-gradient(var(--slate-dark) 0 ${approvedDeg}deg, var(--slate-light) ${approvedDeg}deg ${approvedDeg + pendingDeg}deg, #CFD8DC ${approvedDeg + pendingDeg}deg 360deg)" role="img" aria-label="${approved} aprobados y ${pending} pendientes de ${total} conductores">
      <div><strong>${total}</strong><span>conductores</span></div>
    </div>
    <ul class="bar-legend donut-legend">
      <li><span class="legend-dot seg-completed"></span>Aprobados<b>${approved}</b></li>
      <li><span class="legend-dot seg-pending"></span>Pendientes<b>${pending}</b></li>
      ${others ? `<li><span class="legend-dot seg-other"></span>Otros<b>${others}</b></li>` : ''}
    </ul>
  </div>`;
}

// Fila de un viaje en las listas cortas del resumen.
function adminTripRow(trip) {
  const client = trip.client?.user?.name || trip.client?.name || 'Cliente';
  const driver = trip.driver?.user?.name || trip.driver?.name || 'Sin conductor';
  return `<article class="admin-row">
    <span class="admin-avatar" aria-hidden="true">${escapeHtml(initials(client))}</span>
    <div class="admin-row-main"><strong>Viaje #${escapeHtml(trip.id)}</strong><span>${escapeHtml(client)} · ${escapeHtml(driver)}</span><small>${dateTime(trip.completed_at || trip.created_at)}</small></div>
    <div class="admin-row-side">${statusBadge(trip.status)}<b>${money(trip.final_fare || trip.estimated_fare)}</b></div>
  </article>`;
}

// Pestaña Resumen: KPIs + gráficas + viajes recientes + incidencias.
async function adminOverview() {
  const response = await request('/admin/dashboard');
  const stats = response.stats || {};
  adminPendingCount = toNumber(stats.pending_drivers);
  const trips = extractArray({ trips: response.recent_trips }, 'trips');
  const incidents = Array.isArray(response.recent_incidents) ? response.recent_incidents : [];
  const completed = toNumber(stats.completed_trips);
  const average = completed ? toNumber(stats.total_revenue) / completed : 0;

  return `
    <section class="admin-kpis">
      ${adminKpi('$', 'Ingresos registrados', money(stats.total_revenue), `${completed} viajes completados`, 'kpi-dark')}
      ${adminKpi('↗', 'Viajes activos', stats.active_trips ?? 0, `${stats.pending_requests ?? 0} solicitudes esperando`)}
      ${adminKpi('◉', 'Clientes', stats.total_clients ?? 0, 'Registrados en la plataforma')}
      ${adminKpi('⛟', 'Conductores', stats.total_drivers ?? 0, `${stats.pending_drivers ?? 0} por aprobar`)}
    </section>

    ${adminPendingCount ? `<button class="admin-alert" data-action="admin-view" data-view="drivers" data-filter="pending">
      <span aria-hidden="true">!</span><div><strong>${adminPendingCount} ${adminPendingCount === 1 ? 'conductor espera' : 'conductores esperan'} aprobación</strong><small>Revisa sus documentos para que puedan empezar a recibir viajes.</small></div><b aria-hidden="true">→</b>
    </button>` : ''}

    <div class="admin-grid">
      <section class="card admin-card">
        <div class="admin-card-head"><div><p class="eyebrow">OPERACIÓN</p><h2>Estado de los viajes</h2></div><span class="admin-chip">Ticket promedio ${money(average)}</span></div>
        ${tripsBar(stats)}
      </section>
      <section class="card admin-card">
        <div class="admin-card-head"><div><p class="eyebrow">FLOTA</p><h2>Conductores</h2></div></div>
        ${driversDonut(stats)}
      </section>
    </div>

    <div class="admin-grid">
      <section class="card admin-card">
        <div class="admin-card-head"><div><p class="eyebrow">ÚLTIMOS MOVIMIENTOS</p><h2>Viajes recientes</h2></div><button class="btn btn-outline btn-small" data-action="admin-view" data-view="trips">Ver todos</button></div>
        ${trips.length ? trips.slice(0, 6).map(adminTripRow).join('') : emptyState('No hay viajes recientes para mostrar.')}
      </section>
      <section class="card admin-card">
        <div class="admin-card-head"><div><p class="eyebrow">SEGURIDAD</p><h2>Incidencias recientes</h2></div><span class="admin-chip ${incidents.length ? 'chip-alert' : ''}">${incidents.length}</span></div>
        ${incidents.length ? incidents.slice(0, 6).map((incident) => `<article class="admin-row">
          <span class="admin-avatar avatar-alert" aria-hidden="true">!</span>
          <div class="admin-row-main"><strong>Incidencia #${escapeHtml(incident.id)}${incident.trip_id ? ` · viaje #${escapeHtml(incident.trip_id)}` : ''}</strong><span>${escapeHtml(incident.description || incident.comment || incident.type || 'Sin descripción')}</span><small>${dateTime(incident.created_at)}</small></div>
        </article>`).join('') : emptyState('Sin incidencias. ¡Todo en orden!', '✓')}
      </section>
    </div>`;
}

/* ---------------------------------------------------------------------------
 * Pestaña: CONDUCTORES
 * ------------------------------------------------------------------------- */

// Tarjeta de un conductor con su vehículo, calificación y botones de acción.
function driverCard(driver) {
  const vehicle = driver.vehicles?.[0] || driver.vehicle || {};
  const name = driver.user?.name || driver.name || 'Conductor';
  const status = driver.approval_status || 'pending';
  // Solo se ofrecen las acciones que cambian el estado actual.
  const actions = Object.entries(APPROVAL_ACTIONS).filter(([value]) => value !== status);
  return `<article class="driver-card" data-status="${escapeHtml(status)}">
    <div class="driver-card-top">
      <span class="admin-avatar avatar-large" aria-hidden="true">${escapeHtml(initials(name))}</span>
      <div class="driver-card-name"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(driver.user?.email || '')}</span></div>
      ${statusBadge(status)}
    </div>
    <dl class="driver-facts">
      <div><dt>Licencia</dt><dd>${escapeHtml(driver.license_number || '—')}</dd></div>
      <div><dt>Calificación</dt><dd>★ ${escapeHtml(driver.rating_average ?? '—')}</dd></div>
      <div class="span-2"><dt>Vehículo</dt><dd>${vehicle.plate ? `<span class="plate">${escapeHtml(vehicle.plate)}</span>` : ''}${escapeHtml([vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' ') || 'Sin vehículo registrado')}</dd></div>
    </dl>
    <div class="driver-card-actions">
      ${actions.map(([value, action]) => `<button class="btn btn-small ${action.button}" data-action="driver-approval" data-id="${escapeHtml(driver.id)}" data-status="${value}" data-name="${escapeHtml(name)}">${action.label}</button>`).join('')}
    </div>
  </article>`;
}

// Filtra en pantalla por nombre, correo, licencia, placa, marca o modelo (sin llamar a la API).
function filteredDrivers() {
  const query = adminDriverSearch.trim().toLowerCase();
  if (!query) return adminDriversCache;
  return adminDriversCache.filter((driver) => [
    driver.user?.name, driver.user?.email, driver.license_number,
    ...(driver.vehicles || []).flatMap((vehicle) => [vehicle.plate, vehicle.brand, vehicle.model]),
  ].filter(Boolean).join(' ').toLowerCase().includes(query));
}

// Lista de tarjetas de conductores (se repinta al escribir en el buscador).
function driversGrid() {
  const drivers = filteredDrivers();
  return drivers.length
    ? `<div class="driver-grid">${drivers.map(driverCard).join('')}</div>`
    : emptyState(adminDriverSearch ? 'Ningún conductor coincide con la búsqueda.' : 'No hay conductores en este filtro.');
}

// Pestaña Conductores: chips de estado (filtran en la API) + buscador local.
async function adminDrivers() {
  const query = adminDriverFilter ? `?approval_status=${encodeURIComponent(adminDriverFilter)}` : '';
  const response = await request(`/admin/drivers${query}`);
  adminDriversCache = extractArray(response, 'drivers');
  // Recalcula el globito de pendientes cuando la lista lo permite.
  if (!adminDriverFilter) adminPendingCount = adminDriversCache.filter((driver) => driver.approval_status === 'pending').length;
  else if (adminDriverFilter === 'pending') adminPendingCount = adminDriversCache.length;
  const chips = [['', 'Todos'], ['pending', 'Pendientes'], ['approved', 'Aprobados'], ['rejected', 'Rechazados'], ['suspended', 'Suspendidos']];
  return `<section class="card admin-card">
    <div class="admin-card-head"><div><p class="eyebrow">FLOTA</p><h2>Revisión de conductores</h2><p class="muted">Aprueba a los conductores con documentos al día para que puedan recibir viajes.</p></div></div>
    <div class="admin-toolbar">
      <div class="filter-chips" role="group" aria-label="Filtrar por estado">
        ${chips.map(([value, label]) => `<button class="filter-chip ${adminDriverFilter === value ? 'active' : ''}" data-action="driver-filter" data-filter="${value}" aria-pressed="${adminDriverFilter === value}">${label}</button>`).join('')}
      </div>
      <label class="admin-search"><span aria-hidden="true">⌕</span><input id="driver-search" type="search" placeholder="Buscar por nombre, placa o vehículo" value="${escapeHtml(adminDriverSearch)}" aria-label="Buscar conductor"></label>
    </div>
    <div id="drivers-grid">${driversGrid()}</div>
  </section>`;
}

// Ventana para confirmar el cambio de estado de un conductor con notas opcionales.
function openApprovalModal(button) {
  const status = button.dataset.status;
  const action = APPROVAL_ACTIONS[status];
  openModal(`
    <h2 id="modal-title">${action.label} conductor</h2>
    <p class="muted">Vas a ${action.verb} a <strong>${escapeHtml(button.dataset.name)}</strong>. Las notas quedan en el registro de auditoría.</p>
    <form id="approval-form" data-id="${escapeHtml(button.dataset.id)}" data-status="${status}">
      <div class="field"><label for="admin_notes">Notas para el registro (opcional)</label>
        <textarea id="admin_notes" name="admin_notes" maxlength="500" placeholder="${status === 'approved' ? 'Ej. Documentación de SOAT y licencia verificada.' : 'Ej. Licencia vencida.'}"></textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">Volver</button><button type="submit" class="btn ${action.button}">${action.label}</button></div>
    </form>`, 'modal-title');
}

// Envía PATCH /admin/drivers/{id}/approval y recarga el panel.
async function submitApproval(form) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await request(`/admin/drivers/${encodeURIComponent(form.dataset.id)}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ approval_status: form.dataset.status, admin_notes: (new FormData(form).get('admin_notes') || '').trim() }),
    });
    closeModal();
    showToast(result.message || 'Estado del conductor actualizado.');
    await renderDashboard();
  } finally {
    button.disabled = false;
  }
}

/* ---------------------------------------------------------------------------
 * Pestaña: TARIFAS
 * ------------------------------------------------------------------------- */

// Calcula el precio de un viaje de ejemplo con la misma fórmula de la API:
// max(mínima, (base + km × precio_km + min × precio_min) × multiplicador).
function sampleFare(fare, km = 5, minutes = 15) {
  const total = (toNumber(fare.base_fare) + km * toNumber(fare.price_per_km) + minutes * toNumber(fare.price_per_minute))
    * (toNumber(fare.surge_multiplier) || 1);
  return Math.max(toNumber(fare.minimum_fare), total);
}

// Tarjeta de una tarifa configurada; la activa se resalta en oscuro.
function fareCard(fare) {
  return `<article class="fare-card ${fare.active ? 'fare-active' : ''}">
    <div class="fare-card-head"><strong>${escapeHtml(fare.name || 'Tarifa')}</strong>${fare.active ? '<span class="fare-flag">ACTIVA</span>' : statusBadge('unavailable')}</div>
    <div class="fare-card-price"><span>Viaje de 5 km · 15 min</span><b>${money(sampleFare(fare))}</b></div>
    <dl class="fare-card-grid">
      <div><dt>Base</dt><dd>${money(fare.base_fare)}</dd></div>
      <div><dt>Por km</dt><dd>${money(fare.price_per_km)}</dd></div>
      <div><dt>Por minuto</dt><dd>${money(fare.price_per_minute)}</dd></div>
      <div><dt>Mínima</dt><dd>${money(fare.minimum_fare)}</dd></div>
      <div><dt>Dinámica</dt><dd>× ${escapeHtml(fare.surge_multiplier ?? 1)}</dd></div>
    </dl>
  </article>`;
}

// Pestaña Tarifas: lista de tarifas + formulario para crear una nueva.
async function adminFares() {
  const response = await request('/admin/fares');
  // Las tarifas activas primero.
  const fares = extractArray(response, 'fares').sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
  return `<div class="admin-grid admin-grid-fares">
    <section class="card admin-card">
      <div class="admin-card-head"><div><p class="eyebrow">PRECIOS</p><h2>Tarifas configuradas</h2></div><span class="admin-chip">${fares.length}</span></div>
      ${fares.length ? `<div class="fare-list">${fares.map(fareCard).join('')}</div>` : emptyState('Aún no hay tarifas configuradas.', '$')}
    </section>
    <section class="card admin-card">
      <div class="admin-card-head"><div><p class="eyebrow">NUEVA TARIFA</p><h2>Crear tarifa</h2></div></div>
      <form id="fare-form">
        ${inputField('Nombre de la tarifa', 'name', 'text', { required: true, placeholder: 'Ej. Tarifa hora pico' })}
        <div class="form-row">${inputField('Tarifa base (COP)', 'base_fare', 'number', { required: true, min: 0, placeholder: '4500' })}${inputField('Precio por km (COP)', 'price_per_km', 'number', { required: true, min: 0, placeholder: '1500' })}</div>
        <div class="form-row">${inputField('Precio por minuto (COP)', 'price_per_minute', 'number', { required: true, min: 0, placeholder: '350' })}${inputField('Tarifa mínima (COP)', 'minimum_fare', 'number', { required: true, min: 0, placeholder: '8000' })}</div>
        <div class="form-row">${inputField('Multiplicador dinámico', 'surge_multiplier', 'number', { required: true, min: 0, step: '0.05', placeholder: '1.0' })}
          <div class="field"><label for="active">Estado</label><select id="active" name="active"><option value="true">Activa</option><option value="false">Inactiva</option></select></div></div>
        <div class="fare-preview" id="fare-preview" aria-live="polite">Llena los valores para ver cuánto costaría un viaje de 5 km y 15 min.</div>
        <button class="btn btn-primary full-width" type="submit">Guardar tarifa</button>
      </form>
    </section>
  </div>`;
}

// Actualiza la vista previa del precio mientras el admin escribe la tarifa.
function updateFarePreview() {
  const form = document.querySelector('#fare-form');
  const preview = document.querySelector('#fare-preview');
  if (!form || !preview) return;
  const values = Object.fromEntries(new FormData(form));
  const ready = ['base_fare', 'price_per_km', 'price_per_minute', 'minimum_fare'].every((key) => values[key] !== '');
  preview.innerHTML = ready
    ? `<span>Un viaje de 5 km y 15 min costaría</span><b>${money(sampleFare(values))}</b>`
    : 'Llena los valores para ver cuánto costaría un viaje de 5 km y 15 min.';
}

// Envía POST /admin/fares con los números convertidos y recarga el panel.
async function saveFare(form) {
  const data = Object.fromEntries(new FormData(form));
  for (const field of ['base_fare', 'price_per_km', 'price_per_minute', 'minimum_fare', 'surge_multiplier']) data[field] = Number(data[field]);
  data.active = data.active === 'true';
  const result = await request('/admin/fares', { method: 'POST', body: JSON.stringify(data) });
  showToast(result.message || 'Tarifa creada correctamente.');
  await renderDashboard();
}

/* ---------------------------------------------------------------------------
 * Pestaña: VIAJES
 * ------------------------------------------------------------------------- */

// Pestaña Viajes: filtros (se envían como query string a la API) + tabla.
async function adminTrips() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(adminTripFilters)) if (value) params.set(key, value);
  const response = await request(`/admin/trips${params.size ? `?${params}` : ''}`);
  const trips = extractArray(response, 'trips');
  const total = trips.reduce((sum, trip) => sum + toNumber(trip.final_fare), 0);
  const filters = adminTripFilters;
  return `<section class="card admin-card">
    <div class="admin-card-head"><div><p class="eyebrow">HISTORIAL</p><h2>Registro de viajes</h2></div>
      <div class="admin-summary"><span>${trips.length} ${trips.length === 1 ? 'viaje' : 'viajes'}</span><b>${money(total)}</b></div></div>
    <form id="trip-filters" class="admin-filters">
      <label><span>Estado</span><select name="status"><option value="">Todos</option>${['requested', 'assigned', 'driver_arrived', 'in_progress', 'completed', 'cancelled'].map((value) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${STATUS_LABELS[value]}</option>`).join('')}</select></label>
      <label><span>ID cliente</span><input name="client_id" type="number" min="1" value="${escapeHtml(filters.client_id)}" placeholder="Ej. 2"></label>
      <label><span>ID conductor</span><input name="driver_id" type="number" min="1" value="${escapeHtml(filters.driver_id)}" placeholder="Ej. 1"></label>
      <label><span>Fecha</span><input name="date" type="date" value="${escapeHtml(filters.date)}"></label>
      <div class="admin-filter-actions"><button class="btn btn-primary btn-small" type="submit">Filtrar</button><button class="btn btn-outline btn-small" type="button" data-action="clear-trip-filters">Limpiar</button></div>
    </form>
    ${trips.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Viaje</th><th>Cliente</th><th>Conductor</th><th>Fecha</th><th>Estado</th><th class="num">Valor</th></tr></thead><tbody>
      ${trips.map((trip) => `<tr>
        <td><div class="table-name">#${escapeHtml(trip.id)}</div><div class="table-sub">${escapeHtml(trip.origin_name || trip.request?.origin_name || '—')} → ${escapeHtml(trip.destination_name || trip.request?.destination_name || '—')}</div></td>
        <td>${escapeHtml(trip.client?.user?.name || trip.client?.name || '—')}</td>
        <td>${escapeHtml(trip.driver?.user?.name || trip.driver?.name || 'Sin conductor')}${trip.vehicle?.plate ? `<div class="table-sub">${escapeHtml(trip.vehicle.plate)}</div>` : ''}</td>
        <td>${dateTime(trip.created_at || trip.completed_at)}</td>
        <td>${statusBadge(trip.status)}</td>
        <td class="num">${money(trip.final_fare || trip.estimated_fare)}</td>
      </tr>`).join('')}
    </tbody></table></div>` : emptyState('No hay viajes que coincidan con los filtros.')}
  </section>`;
}

/* ---------------------------------------------------------------------------
 * Pestaña: REPORTES
 * ------------------------------------------------------------------------- */

// La documentación no dice qué forma tiene el reporte, así que se dibuja según
// lo que llegue: números → tarjetas, listas de objetos → tablas, objetos → secciones.
function renderReportValue(key, value, depth = 0) {
  if (Array.isArray(value)) {
    if (!value.length) return `<section class="report-block"><h3>${escapeHtml(humanizeKey(key))}</h3>${emptyState('Sin datos.')}</section>`;
    if (typeof value[0] !== 'object' || value[0] === null) {
      return `<section class="report-block"><h3>${escapeHtml(humanizeKey(key))}</h3><p class="muted">${value.map(escapeHtml).join(', ')}</p></section>`;
    }
    // Columnas = llaves simples del primer elemento.
    const columns = Object.keys(value[0]).filter((column) => typeof value[0][column] !== 'object').slice(0, 7);
    return `<section class="report-block"><h3>${escapeHtml(humanizeKey(key))}</h3><div class="table-wrap"><table class="admin-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(humanizeKey(column))}</th>`).join('')}</tr></thead><tbody>
      ${value.map((row) => `<tr>${columns.map((column) => `<td>${formatReportCell(column, row[column])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></section>`;
  }
  if (value && typeof value === 'object') {
    const simple = Object.entries(value).filter(([, item]) => item === null || typeof item !== 'object');
    const nested = Object.entries(value).filter(([, item]) => item !== null && typeof item === 'object');
    return `<section class="report-block ${depth ? 'report-nested' : ''}">${key ? `<h3>${escapeHtml(humanizeKey(key))}</h3>` : ''}
      ${simple.length ? `<div class="report-stats">${simple.map(([itemKey, item]) => `<article class="report-stat"><span>${escapeHtml(humanizeKey(itemKey))}</span><b>${formatReportCell(itemKey, item)}</b></article>`).join('')}</div>` : ''}
      ${nested.map(([itemKey, item]) => renderReportValue(itemKey, item, depth + 1)).join('')}
    </section>`;
  }
  return '';
}

// Da formato a un valor del reporte: dinero si la llave lo sugiere, fechas, etc.
function formatReportCell(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && /revenue|income|fare|total_amount|amount|ingreso|valor/i.test(key)) return money(value);
  if (typeof value === 'number' && /rate|percent|porcentaje/i.test(key)) return `${escapeHtml(value)}%`;
  if (typeof value === 'string' && /_at$|date|fecha/i.test(key)) return dateTime(value);
  if (key === 'status' || key === 'approval_status') return statusBadge(value);
  return escapeHtml(value);
}

// Pestaña Reportes: GET /admin/reports y lo dibuja con renderReportValue().
async function adminReports() {
  const response = await request('/admin/reports');
  const { success, message, ...rest } = response;
  const report = rest.report || rest.reports || rest.data || rest;
  return `<section class="card admin-card">
    <div class="admin-card-head"><div><p class="eyebrow">ANÁLISIS</p><h2>Reporte consolidado</h2><p class="muted">Cancelaciones, ingresos y desempeño de conductores.</p></div><button class="btn btn-outline btn-small" data-action="print-report">Imprimir</button></div>
    ${Object.keys(report || {}).length ? renderReportValue('', report) : emptyState('La API no devolvió datos para el reporte.')}
  </section>`;
}

/* ---------------------------------------------------------------------------
 * Pestaña: AUDITORÍA
 * ------------------------------------------------------------------------- */

// Filas de la tabla de auditoría filtradas por el buscador.
function auditRows() {
  const query = adminAuditSearch.trim().toLowerCase();
  const logs = query
    ? adminAuditCache.filter((log) => JSON.stringify(log).toLowerCase().includes(query))
    : adminAuditCache;
  if (!logs.length) return `<tr><td colspan="4">${emptyState(query ? 'Ninguna acción coincide con la búsqueda.' : 'No hay acciones de auditoría para mostrar.', '◷')}</td></tr>`;
  return logs.map((log) => `<tr>
    <td>${dateTime(log.created_at || log.timestamp)}</td>
    <td><div class="table-name">${escapeHtml(log.user?.name || log.user_name || '—')}</div>${log.user?.role ? `<div class="table-sub">${escapeHtml(log.user.role)}</div>` : ''}</td>
    <td><span class="audit-action">${escapeHtml(log.action || log.event || '—')}</span></td>
    <td>${escapeHtml(log.description || log.details || '—')}${log.ip_address ? `<div class="table-sub">IP ${escapeHtml(log.ip_address)}</div>` : ''}</td>
  </tr>`).join('');
}

// Pestaña Auditoría: GET /admin/audit-logs + buscador local.
async function adminAudit() {
  const response = await request('/admin/audit-logs');
  adminAuditCache = extractArray(response, 'audit_logs', 'logs', 'data');
  return `<section class="card admin-card">
    <div class="admin-card-head"><div><p class="eyebrow">SEGURIDAD</p><h2>Registro de auditoría</h2><p class="muted">Acciones administrativas y de seguridad en orden cronológico.</p></div>
      <label class="admin-search"><span aria-hidden="true">⌕</span><input id="audit-search" type="search" placeholder="Buscar acción, usuario o IP" value="${escapeHtml(adminAuditSearch)}" aria-label="Buscar en auditoría"></label></div>
    <div class="table-wrap"><table class="admin-table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody id="audit-body">${auditRows()}</tbody></table></div>
  </section>`;
}

/* ---------------------------------------------------------------------------
 * Eventos del panel (clics, formularios y buscadores)
 * Se registran aquí para no mezclar la lógica del admin con la del cliente.
 * ------------------------------------------------------------------------- */

// Clics: cambiar de pestaña, filtrar conductores, aprobar, limpiar filtros...
document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || sessionUser?.role !== 'admin') return;
  const action = target.dataset.action;
  try {
    if (action === 'admin-view') {
      // data-filter permite saltar del aviso del resumen a "Pendientes".
      if (target.dataset.filter !== undefined) adminDriverFilter = target.dataset.filter;
      activeView = target.dataset.view;
      await renderDashboard();
    } else if (action === 'driver-filter') {
      adminDriverFilter = target.dataset.filter;
      await renderDashboard();
    } else if (action === 'driver-approval') {
      openApprovalModal(target);
    } else if (action === 'clear-trip-filters') {
      adminTripFilters = { status: '', client_id: '', driver_id: '', date: '' };
      await renderDashboard();
    } else if (action === 'print-report') {
      window.print();
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

// Formularios: aprobación, nueva tarifa y filtros de viajes.
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || sessionUser?.role !== 'admin') return;
  try {
    if (form.id === 'approval-form') {
      event.preventDefault();
      await submitApproval(form);
    } else if (form.id === 'fare-form') {
      event.preventDefault();
      await saveFare(form);
    } else if (form.id === 'trip-filters') {
      event.preventDefault();
      adminTripFilters = Object.fromEntries(new FormData(form));
      await renderDashboard();
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

// Escritura: buscadores (filtran sin llamar a la API) y vista previa de tarifa.
document.addEventListener('input', (event) => {
  if (sessionUser?.role !== 'admin') return;
  const field = event.target;
  if (field.id === 'driver-search') {
    adminDriverSearch = field.value;
    const grid = document.querySelector('#drivers-grid');
    if (grid) grid.innerHTML = driversGrid();
  } else if (field.id === 'audit-search') {
    adminAuditSearch = field.value;
    const body = document.querySelector('#audit-body');
    if (body) body.innerHTML = auditRows();
  } else if (field.closest?.('#fare-form')) {
    updateFarePreview();
  }
});

/* ---------------------------------------------------------------------------
 * MODO DEMO DEL ADMINISTRADOR
 * Simula las respuestas de la API con datos ficticios para probar el panel
 * sin el servidor. app.js llama a demoAdminRequest() cuando el token es el
 * de la demo. Nada de esto se envía a ningún lado.
 * ------------------------------------------------------------------------- */

// Datos iniciales de la demo (o los guardados en esta pestaña si ya existen).
function adminDemoData() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(ADMIN_DEMO_DATA_KEY) || 'null');
    if (stored?.drivers) return stored;
  } catch {
    sessionStorage.removeItem(ADMIN_DEMO_DATA_KEY);
  }
  const day = 86400000;
  const now = Date.now();
  const iso = (offset) => new Date(now - offset).toISOString();
  const people = {
    juan: { name: 'Juan Pérez' }, daniela: { name: 'Daniela Morales' }, laura: { name: 'Laura Gómez' },
    carlos: { name: 'Carlos Rodríguez' }, hector: { name: 'Héctor Fabio' }, camila: { name: 'Camila Rodríguez' },
  };
  return {
    nextFareId: 3,
    nextLogId: 9,
    drivers: [
      { id: 1, license_number: 'LC-55120-CO', approval_status: 'approved', rating_average: 4.95, user: { name: 'Carlos Rodríguez', email: 'carlos@uber.com' }, vehicles: [{ plate: 'UBR-123', brand: 'Chevrolet', model: 'Onix Turbo', year: 2023 }] },
      { id: 2, license_number: 'LC-77231-CO', approval_status: 'approved', rating_average: 4.82, user: { name: 'Camila Rodríguez', email: 'camila@uber.com' }, vehicles: [{ plate: 'RDA-245', brand: 'Renault', model: 'Logan', year: 2022 }] },
      { id: 3, license_number: 'LC-11928-CO', approval_status: 'pending', rating_average: 5.0, user: { name: 'Andrés Torres', email: 'andres@uber.com' }, vehicles: [{ plate: 'NEW-456', brand: 'Kia', model: 'Rio', year: 2024 }] },
      { id: 4, license_number: 'LC-88291-CO', approval_status: 'pending', rating_average: 5.0, user: { name: 'Héctor Fabio', email: 'hector@ejemplo.com' }, vehicles: [{ plate: 'HJK-987', brand: 'Mazda', model: 'Mazda 3', year: 2024 }] },
      { id: 5, license_number: 'LC-30017-CO', approval_status: 'suspended', rating_average: 3.4, user: { name: 'Mario Castaño', email: 'mario@uber.com' }, vehicles: [{ plate: 'XYZ-321', brand: 'Hyundai', model: 'Accent', year: 2019 }] },
    ],
    fares: [
      { id: 1, name: 'Tarifa Estándar Urbana', base_fare: 3800, price_per_km: 1250, price_per_minute: 250, minimum_fare: 6500, surge_multiplier: 1, active: true },
      { id: 2, name: 'Tarifa Dinámica Nocturna', base_fare: 4200, price_per_km: 1400, price_per_minute: 350, minimum_fare: 7000, surge_multiplier: 1.25, active: false },
    ],
    trips: [
      { id: 12, status: 'in_progress', client_id: 2, driver_id: 1, client: { user: people.juan }, driver: { user: people.carlos }, vehicle: { plate: 'UBR-123' }, origin_name: 'Parque de la 93', destination_name: 'Centro Andino', estimated_fare: 6500, created_at: iso(600000) },
      { id: 11, status: 'completed', client_id: 8, driver_id: 2, client: { user: people.daniela }, driver: { user: people.camila }, vehicle: { plate: 'RDA-245' }, origin_name: 'Usaquén', destination_name: 'Unicentro', final_fare: 9300, created_at: iso(day * 0.3), completed_at: iso(day * 0.28) },
      { id: 10, status: 'completed', client_id: 2, driver_id: 1, client: { user: people.juan }, driver: { user: people.carlos }, vehicle: { plate: 'UBR-123' }, origin_name: 'Zona T', destination_name: 'Aeropuerto El Dorado', final_fare: 38400, created_at: iso(day), completed_at: iso(day * 0.97) },
      { id: 9, status: 'cancelled', client_id: 9, driver_id: null, client: { user: people.laura }, driver: null, origin_name: 'Chapinero', destination_name: 'Salitre Plaza', estimated_fare: 12100, created_at: iso(day * 1.4) },
      { id: 8, status: 'completed', client_id: 9, driver_id: 2, client: { user: people.laura }, driver: { user: people.camila }, vehicle: { plate: 'RDA-245' }, origin_name: 'Centro Internacional', destination_name: 'Candelaria', final_fare: 7000, created_at: iso(day * 2), completed_at: iso(day * 1.98) },
      { id: 7, status: 'completed', client_id: 8, driver_id: 1, client: { user: people.daniela }, driver: { user: people.carlos }, vehicle: { plate: 'UBR-123' }, origin_name: 'Cedritos', destination_name: 'Parque de la 93', final_fare: 15800, created_at: iso(day * 3), completed_at: iso(day * 2.98) },
    ],
    pendingRequests: 2,
    incidents: [
      { id: 3, trip_id: 8, description: 'El cliente reporta que el conductor tomó una ruta más larga.', created_at: iso(day * 1.9) },
    ],
    logs: [
      { id: 8, action: 'fare.created', description: 'Se creó la tarifa "Tarifa Dinámica Nocturna"', user: { name: 'Administrador', role: 'admin' }, ip_address: '20.20.1.10', created_at: iso(day * 1.1) },
      { id: 7, action: 'driver.suspended', description: 'Conductor Mario Castaño suspendido por calificación baja', user: { name: 'Administrador', role: 'admin' }, ip_address: '20.20.1.10', created_at: iso(day * 2.5) },
      { id: 6, action: 'auth.login', description: 'Inicio de sesión exitoso', user: { name: 'Administrador', role: 'admin' }, ip_address: '20.20.1.10', created_at: iso(day * 2.6) },
      { id: 5, action: 'driver.approved', description: 'Conductor Camila Rodríguez aprobado', user: { name: 'Administrador', role: 'admin' }, ip_address: '20.20.1.10', created_at: iso(day * 6) },
    ],
  };
}

// Guarda los datos de la demo en esta pestaña.
function saveAdminDemoData(data) {
  sessionStorage.setItem(ADMIN_DEMO_DATA_KEY, JSON.stringify(data));
}

// Agrega una entrada al registro de auditoría de la demo.
function addDemoLog(data, action, description) {
  data.logs.unshift({ id: data.nextLogId++, action, description, user: { name: sessionUser?.name || 'Administrador', role: 'admin' }, ip_address: '127.0.0.1', created_at: new Date().toISOString() });
}

// Calcula los KPIs del resumen a partir de los datos ficticios.
function demoAdminStats(data) {
  const count = (status) => data.trips.filter((trip) => trip.status === status).length;
  return {
    total_clients: new Set(data.trips.map((trip) => trip.client_id)).size,
    total_drivers: data.drivers.length,
    pending_drivers: data.drivers.filter((driver) => driver.approval_status === 'pending').length,
    approved_drivers: data.drivers.filter((driver) => driver.approval_status === 'approved').length,
    active_trips: data.trips.filter((trip) => ['assigned', 'driver_arrived', 'in_progress'].includes(trip.status)).length,
    completed_trips: count('completed'),
    cancelled_trips: count('cancelled'),
    pending_requests: data.pendingRequests,
    total_revenue: data.trips.reduce((sum, trip) => sum + (trip.status === 'completed' ? toNumber(trip.final_fare) : 0), 0),
  };
}

// "Servidor" falso: responde igual que la API del profesor pero con datos locales.
async function demoAdminRequest(path, options = {}) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const method = (options.method || 'GET').toUpperCase();
  const [route, queryString = ''] = path.split('?');
  const query = new URLSearchParams(queryString);
  const data = adminDemoData();

  if (route === '/admin/dashboard') {
    return { success: true, stats: demoAdminStats(data), recent_trips: data.trips.slice(0, 6), recent_incidents: data.incidents };
  }
  if (route === '/admin/drivers' && method === 'GET') {
    const status = query.get('approval_status');
    return { success: true, drivers: status ? data.drivers.filter((driver) => driver.approval_status === status) : data.drivers };
  }
  const approvalMatch = route.match(/^\/admin\/drivers\/(\d+)\/approval$/);
  if (approvalMatch && method === 'PATCH') {
    const driver = data.drivers.find((item) => String(item.id) === approvalMatch[1]);
    if (!driver) throw new Error('Conductor no encontrado.');
    const body = JSON.parse(options.body || '{}');
    driver.approval_status = body.approval_status;
    addDemoLog(data, `driver.${body.approval_status}`, `Conductor ${driver.user.name} → ${STATUS_LABELS[body.approval_status] || body.approval_status}${body.admin_notes ? `. Notas: ${body.admin_notes}` : ''}`);
    saveAdminDemoData(data);
    return { success: true, message: `Estado del conductor actualizado a: ${body.approval_status}`, driver: { id: driver.id, approval_status: driver.approval_status } };
  }
  if (route === '/admin/fares' && method === 'GET') {
    return { success: true, fares: data.fares };
  }
  if (route === '/admin/fares' && method === 'POST') {
    const fare = { id: data.nextFareId++, ...JSON.parse(options.body || '{}') };
    // Como en la API, solo puede haber una tarifa activa a la vez.
    if (fare.active) data.fares.forEach((item) => { item.active = false; });
    data.fares.unshift(fare);
    addDemoLog(data, 'fare.created', `Se creó la tarifa "${fare.name}"`);
    saveAdminDemoData(data);
    return { success: true, message: 'Tarifa configurada exitosamente', fare };
  }
  if (route === '/admin/trips') {
    const date = query.get('date');
    const trips = data.trips.filter((trip) => (!query.get('status') || trip.status === query.get('status'))
      && (!query.get('client_id') || String(trip.client_id) === query.get('client_id'))
      && (!query.get('driver_id') || String(trip.driver_id) === query.get('driver_id'))
      && (!date || (trip.created_at || '').slice(0, 10) === date));
    return { success: true, trips: { data: trips } };
  }
  if (route === '/admin/reports') {
    const stats = demoAdminStats(data);
    const totalTrips = data.trips.length;
    return {
      success: true,
      report: {
        total_trips: totalTrips,
        total_revenue: stats.total_revenue,
        cancellation_rate: percent(stats.cancelled_trips, totalTrips),
        average_fare: Math.round(stats.total_revenue / Math.max(1, stats.completed_trips)),
        drivers_performance: data.drivers.filter((driver) => driver.approval_status === 'approved').map((driver) => {
          const trips = data.trips.filter((trip) => trip.driver_id === driver.id && trip.status === 'completed');
          return { driver: driver.user.name, completed_trips: trips.length, total_revenue: trips.reduce((sum, trip) => sum + toNumber(trip.final_fare), 0), rating_average: driver.rating_average };
        }),
        cancellations: data.trips.filter((trip) => trip.status === 'cancelled').map((trip) => ({ trip_id: trip.id, client: trip.client?.user?.name, created_at: trip.created_at })),
      },
    };
  }
  if (route === '/admin/audit-logs') {
    return { success: true, audit_logs: data.logs };
  }
  if (route === '/auth/logout') {
    return { success: true, message: 'Sesión demo cerrada.' };
  }
  throw new Error(`La acción ${method} ${route} no está disponible en la demostración del administrador.`);
}

// Entra al panel de administrador con datos ficticios (botón de la pantalla de inicio).
async function startAdminDemo() {
  sessionStorage.setItem(STORAGE_KEYS.token, ADMIN_DEMO_TOKEN);
  sessionUser = { id: 1, name: 'Admin Demo', email: 'admin.demo@rueda.local', role: 'admin', status: 'active' };
  sessionStorage.setItem(STORAGE_KEYS.user, JSON.stringify(sessionUser));
  activeView = 'overview';
  updateTopbar();
  await renderDashboard();
  showToast('Entraste a la demostración del panel de administrador.');
}
