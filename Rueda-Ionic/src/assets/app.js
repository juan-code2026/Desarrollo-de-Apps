const STORAGE_KEYS = { token: 'rueda_token', user: 'rueda_user', apiUrl: 'rueda_api_url' };
const DEFAULT_API_URL = 'http://20.20.1.157:8000/api';
const app = document.querySelector('#main-content');
const topbarActions = document.querySelector('#topbar-actions');
let sessionUser = readStoredUser();
let activeView = 'overview';
let lastEstimate = null;
let selectedRating = 5;
let toastTimer;

function readStoredUser() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.user) || 'null'); }
  catch { return null; }
}

function apiUrl() {
  return (localStorage.getItem(STORAGE_KEYS.apiUrl) || DEFAULT_API_URL).replace(/\/+$/, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(amount) : '—';
}

function dateTime(value) {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function showToast(message, isError = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
}

async function request(path, options = {}) {
  const token = sessionStorage.getItem(STORAGE_KEYS.token);
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${apiUrl()}${path}`, { ...options, headers });
  } catch (error) {
    throw new Error(`No se pudo conectar con la API (${apiUrl()}). Verifica la dirección, que el servidor esté encendido y que permita solicitudes desde este origen.`);
  }
  let payload;
  try { payload = await response.json(); }
  catch { payload = null; }
  if (!response.ok) {
    const message = payload?.message || payload?.error || `La API respondió con el código ${response.status}.`;
    const validation = payload?.errors && Object.values(payload.errors).flat().join(' ');
    throw new Error(validation ? `${message} ${validation}` : message);
  }
  return payload || {};
}

function setLoading(message = 'Cargando información...') {
  app.innerHTML = `<div class="loading">${escapeHtml(message)}</div>`;
}

function updateTopbar() {
  if (!sessionUser) {
    topbarActions.innerHTML = '<button class="link-button" data-action="show-login">Iniciar sesión</button><button class="btn btn-primary btn-small" data-action="show-register">Crear cuenta <span aria-hidden="true">↗</span></button>';
    return;
  }
  topbarActions.innerHTML = `<span class="muted" style="font-size:12px">${escapeHtml(sessionUser.name || sessionUser.email || 'Usuario')}</span><button class="btn btn-outline btn-small" data-action="logout">Cerrar sesión</button>`;
}

function inputField(label, name, type = 'text', options = {}) {
  const attrs = `${options.required ? 'required' : ''} ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.max !== undefined ? `max="${options.max}"` : ''} ${options.step ? `step="${options.step}"` : ''} ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ''} autocomplete="${options.autocomplete || 'off'}"`;
  return `<div class="field"><label for="${escapeHtml(name)}">${escapeHtml(label)}</label><input id="${escapeHtml(name)}" name="${escapeHtml(name)}" type="${type}" ${attrs}></div>`;
}

function authPage(mode = 'login') {
  const registering = mode === 'register';
  app.innerHTML = `
    <section class="auth-layout">
      <div class="auth-intro">
        <p class="eyebrow">Movilidad hecha para ti</p>
        <h1>Tu ciudad,<br><em>a tu ritmo.</em></h1>
        <p class="subtitle">Pide un viaje, conduce por tu cuenta o gestiona la operación. Todo en un solo lugar.</p>
        <div class="role-pills"><span class="role-pill">◉ Clientes</span><span class="role-pill">↗ Conductores</span><span class="role-pill">▦ Administración</span></div>
      </div>
      <section class="card auth-card">
        <div class="tabs"><button class="tab ${!registering ? 'active' : ''}" data-action="show-login">Iniciar sesión</button><button class="tab ${registering ? 'active' : ''}" data-action="show-register">Crear cuenta</button></div>
        <h2>${registering ? 'Únete a Rueda' : 'Qué bueno verte'}</h2>
        <p class="muted" style="font-size:13px;margin-bottom:22px">${registering ? 'Crea tu cuenta en unos pasos.' : 'Ingresa con tu correo o teléfono.'}</p>
        <form id="auth-form">
          ${registering ? `
            ${inputField('Nombre completo', 'name', 'text', { required: true, autocomplete: 'name' })}
            <div class="form-row">${inputField('Correo electrónico', 'email', 'email', { required: true, autocomplete: 'email' })}${inputField('Teléfono', 'phone', 'tel', { autocomplete: 'tel' })}</div>
            <div class="field"><label for="role">Quiero registrarme como</label><select id="role" name="role"><option value="client">Cliente</option><option value="driver">Conductor</option></select></div>
            <div id="driver-fields" hidden>
              <div class="form-row">${inputField('Número de licencia', 'license_number', 'text', { required: true })}${inputField('Placa del vehículo', 'plate', 'text', { required: true })}</div>
              <div class="form-row">${inputField('Marca', 'brand', 'text', { required: true })}${inputField('Modelo', 'model', 'text', { required: true })}</div>
              <div class="form-row">${inputField('Año', 'year', 'number', { required: true, min: 1980, max: 2100 })}${inputField('Capacidad', 'capacity', 'number', { required: true, min: 1, max: 20 })}</div>
              ${inputField('Color', 'color', 'text', { required: true })}
            </div>
            ${inputField('Contraseña', 'password', 'password', { required: true, autocomplete: 'new-password' })}
          ` : `
            ${inputField('Correo electrónico o teléfono', 'login', 'text', { required: true, autocomplete: 'username', placeholder: 'tu@correo.com' })}
            ${inputField('Contraseña', 'password', 'password', { required: true, autocomplete: 'current-password' })}
          `}
          <button class="btn btn-primary full-width" type="submit" style="margin-top:5px">${registering ? 'Crear cuenta' : 'Iniciar sesión'} <span aria-hidden="true">→</span></button>
        </form>
        ${!registering ? '<button class="link-button" data-action="forgot-password" style="margin-top:13px;font-size:12px">¿Olvidaste tu contraseña?</button>' : ''}
        <details class="config">
          <summary>Configuración de conexión</summary>
          <form id="api-config-form" class="field">
            <label for="api-url">URL base de la API</label>
            <div class="config-url"><input class="inline-input" id="api-url" name="api_url" type="url" required value="${escapeHtml(apiUrl())}" placeholder="http://192.168.1.10:8000/api"><button class="btn btn-outline btn-small" type="submit">Guardar</button></div>
            <p class="config-saved" id="config-saved"></p>
          </form>
        </details>
      </section>
    </section>`;
}

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (['approved', 'completed', 'available', 'active', 'in_progress'].includes(value)) return 'status-green';
  if (['pending', 'requested', 'assigned', 'driver_arrived'].includes(value)) return 'status-yellow';
  if (['rejected', 'suspended', 'cancelled', 'unavailable'].includes(value)) return 'status-red';
  return 'status-blue';
}

const STATUS_LABELS = {
  requested: 'Buscando conductor', assigned: 'Conductor asignado', driver_arrived: 'Conductor llegó',
  in_progress: 'En curso', completed: 'Finalizado', cancelled: 'Cancelado',
  pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', suspended: 'Suspendido',
  available: 'En línea', unavailable: 'Desconectado',
};

function statusBadge(status) {
  return `<span class="status ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] || status || 'Sin estado')}</span>`;
}

function pageHeader(title, subtitle, actions = '') {
  return `<div class="dashboard-head"><div><p class="eyebrow">${escapeHtml(sessionUser?.role || 'Rueda')}</p><h1>${title}</h1><p class="muted">${subtitle}</p></div><div class="head-actions">${actions}</div></div>`;
}

function emptyState(message, icon = '↗') {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div>${escapeHtml(message)}</div>`;
}

function statCard(label, value, detail = '') {
  return `<article class="card stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value ?? '—')}</div>${detail ? `<div class="stat-detail">${escapeHtml(detail)}</div>` : ''}</article>`;
}

function tripPath(origin, destination) {
  return `<div class="ride-line"><span class="dot"></span><span>${escapeHtml(origin || 'Origen no disponible')}</span></div><div class="ride-line destination"><span class="dot"></span><span>${escapeHtml(destination || 'Destino no disponible')}</span></div>`;
}

async function login(form) {
  const data = Object.fromEntries(new FormData(form));
  const result = await request('/auth/login', { method: 'POST', body: JSON.stringify(data) });
  if (!result.access_token || !result.user) throw new Error('La respuesta de inicio de sesión no incluye el token o el perfil del usuario.');
  sessionStorage.setItem(STORAGE_KEYS.token, result.access_token);
  sessionStorage.setItem(STORAGE_KEYS.user, JSON.stringify(result.user));
  sessionUser = result.user;
  activeView = 'overview';
  updateTopbar();
  await renderDashboard();
  showToast(`Hola, ${sessionUser.name || 'bienvenido/a'}`);
}

async function register(form) {
  const data = Object.fromEntries(new FormData(form));
  data.role = form.elements.role.value;
  if (data.role === 'driver') {
    for (const field of ['year', 'capacity']) data[field] = Number(data[field]);
  } else {
    for (const field of ['license_number', 'plate', 'brand', 'model', 'year', 'capacity', 'color']) delete data[field];
  }
  const result = await request('/auth/register', { method: 'POST', body: JSON.stringify(data) });
  if (result.access_token && result.user) {
    sessionStorage.setItem(STORAGE_KEYS.token, result.access_token);
    sessionStorage.setItem(STORAGE_KEYS.user, JSON.stringify(result.user));
    sessionUser = result.user;
    updateTopbar();
    await renderDashboard();
    showToast(result.message || 'Cuenta creada correctamente.');
  } else {
    showToast(result.message || 'Cuenta creada. Inicia sesión para continuar.');
    authPage('login');
  }
}

function extractArray(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
  }
  return [];
}

function findActive(data) {
  if (data?.has_active && data.data) return data.data;
  return null;
}

async function renderDashboard() {
  updateTopbar();
  if (!sessionStorage.getItem(STORAGE_KEYS.token)) {
    sessionUser = null;
    updateTopbar();
    return authPage();
  }
  setLoading();
  try {
    if (sessionUser?.role === 'client') await renderClient();
    else if (sessionUser?.role === 'driver') await renderDriver();
    else if (sessionUser?.role === 'admin') await renderAdmin();
    else throw new Error('La API devolvió un rol desconocido. Contacta al profesor para validar los roles configurados.');
  } catch (error) {
    if (/401|no autenticado|token/i.test(error.message)) {
      clearSession();
      authPage();
    } else {
      app.innerHTML = `<section class="card section-card"><h2>No pudimos cargar el panel</h2><p class="muted">${escapeHtml(error.message)}</p><button class="btn btn-outline" data-action="refresh">Intentar de nuevo</button></section>`;
    }
  }
}

async function renderClient() {
  const [activeResponse, tripsResponse, fareResponse] = await Promise.all([
    request('/client/active'), request('/client/trips'), request('/fares/active'),
  ]);
  const active = findActive(activeResponse);
  const trips = extractArray(tripsResponse, 'trips');
  const fare = fareResponse.fare;
  const activeHtml = active ? `
    <article class="record"><div><h3>Viaje activo #${escapeHtml(active.id)}</h3>${tripPath(active.origin_name, active.destination_name)}${active.driver ? `<p>Conductor: ${escapeHtml(active.driver.user?.name || 'Asignado')} · ${escapeHtml(active.driver.user?.phone || '')}</p>` : ''}${active.vehicle ? `<p>Vehículo: ${escapeHtml([active.vehicle.color, active.vehicle.brand, active.vehicle.model, active.vehicle.plate].filter(Boolean).join(' · '))}</p>` : ''}<div class="record-actions"><a class="btn btn-outline btn-small" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(active.driver?.latest_location?.latitude || '')}&mlon=${encodeURIComponent(active.driver?.latest_location?.longitude || '')}#map=16/${encodeURIComponent(active.driver?.latest_location?.latitude || '')}/${encodeURIComponent(active.driver?.latest_location?.longitude || '')}">Ver ubicación en mapa ↗</a>${!['in_progress', 'completed', 'cancelled'].includes(active.status) ? `<button class="btn btn-danger btn-small" data-action="cancel-ride" data-id="${escapeHtml(active.id)}">Cancelar viaje</button>` : ''}</div></div><div class="record-right">${statusBadge(active.status)}<p class="inline-meta" style="margin-top:10px">${money(active.estimated_fare || active.final_fare)}</p></div></article>` : emptyState('Cuando pidas un viaje, aquí podrás seguir su estado.');
  const tripsHtml = trips.length ? trips.slice(0, 5).map((trip) => `<article class="record"><div><h3>Viaje #${escapeHtml(trip.id)}</h3><p>${escapeHtml(trip.driver?.user?.name || 'Conductor')} · ${escapeHtml(trip.vehicle?.plate || '')}</p><p>${dateTime(trip.completed_at)}</p>${trip.status === 'completed' && !trip.rating ? `<div class="record-actions"><button class="btn btn-outline btn-small" data-action="rate-trip" data-id="${escapeHtml(trip.id)}">Calificar viaje</button></div>` : ''}</div><div class="record-right">${statusBadge(trip.status)}<p class="inline-meta" style="margin-top:9px">${money(trip.final_fare)}</p></div></article>`).join('') : emptyState('Tus viajes finalizados aparecerán aquí.', '◷');

  app.innerHTML = `${pageHeader(`Hola, ${escapeHtml((sessionUser.name || '').split(' ')[0] || 'viajero/a')}.`, '¿A dónde vamos hoy?')}
    <div class="stat-grid">${statCard('Tarifa mínima', money(fare?.minimum_fare), fare?.name || 'Tarifa urbana activa')}${statCard('Por kilómetro', money(fare?.price_per_km), 'Estimación según la ruta')}${statCard('Por minuto', money(fare?.price_per_minute), 'El valor final puede variar')}${statCard('Viajes realizados', trips.length, 'En tu historial')}</div>
    <div class="content-grid">
      <section class="card section-card"><div class="section-title"><h2>Solicita un viaje</h2><span class="status status-green">Bogotá</span></div>
        <form id="ride-form" class="trip-form">
          <div class="location-fields">
            <span class="location-marker"></span>
            <div class="field"><label for="origin_name">Punto de recogida</label><input id="origin_name" name="origin_name" required value="Parque de la 93, Bogotá" placeholder="Dirección o lugar"></div>
            <div class="form-row"><div class="field"><label for="origin_latitude">Latitud</label><input id="origin_latitude" name="origin_latitude" type="number" step="any" required value="4.6766"></div><div class="field"><label for="origin_longitude">Longitud</label><input id="origin_longitude" name="origin_longitude" type="number" step="any" required value="-74.0483"></div></div>
            <span class="location-marker destination"></span>
            <div class="field"><label for="destination_name">¿A dónde vas?</label><input id="destination_name" name="destination_name" required value="Centro Comercial Andino, Bogotá" placeholder="Dirección o lugar"></div>
            <div class="form-row"><div class="field"><label for="destination_latitude">Latitud</label><input id="destination_latitude" name="destination_latitude" type="number" step="any" required value="4.6664"></div><div class="field"><label for="destination_longitude">Longitud</label><input id="destination_longitude" name="destination_longitude" type="number" step="any" required value="-74.0536"></div></div>
          </div>
          <div id="estimate-result">${lastEstimate ? estimateMarkup(lastEstimate) : ''}</div>
          <div class="form-row"><button type="button" class="btn btn-outline" data-action="estimate-fare">Calcular tarifa</button><button type="submit" class="btn btn-primary" ${active ? 'disabled' : ''}>Pedir viaje →</button></div>
          <p class="field-hint">Puedes editar las coordenadas según tu punto exacto. Los valores iniciales son una ruta de ejemplo en Bogotá.</p>
        </form>
      </section>
      <div class="stack"><section class="card section-card"><div class="section-title"><h2>Tu viaje actual</h2><button class="btn btn-outline btn-small" data-action="refresh">Actualizar</button></div>${activeHtml}</section>
      <section class="card section-card"><div class="section-title"><h2>Actividad reciente</h2></div>${tripsHtml}</section></div>
    </div>`;
}

function estimateMarkup(estimate) {
  return `<div class="trip-result"><div><div class="inline-meta">${escapeHtml(estimate.distance_km)} km · ${escapeHtml(estimate.duration_min)} min aprox.</div><div class="field-hint">Estimación de la API · ${escapeHtml(estimate.currency || 'COP')}</div></div><div class="fare-value">${money(estimate.estimated_fare)}</div></div>`;
}

async function renderDriver() {
  const [requestsResponse, activeResponse] = await Promise.all([
    request('/driver/ride-requests'),
    request('/auth/me'),
  ]);
  const requests = extractArray(requestsResponse, 'requests');
  const driver = activeResponse.user?.driver || activeResponse.user?.profile || activeResponse.driver || {};
  const approved = driver.approval_status === 'approved';
  const available = driver.availability_status === 'available' || sessionUser.availability_status === 'available';
  const requestsHtml = requests.length ? requests.map((ride) => `<article class="record"><div><h3>Solicitud #${escapeHtml(ride.id)}</h3>${tripPath(ride.origin_name, ride.destination_name)}<p>${escapeHtml(ride.client?.name || 'Cliente')} · ${escapeHtml(ride.client?.phone || '')}</p><div class="record-actions"><button class="btn btn-primary btn-small" data-action="accept-ride" data-id="${escapeHtml(ride.id)}" ${!approved || !available ? 'disabled' : ''}>Aceptar viaje →</button><a class="btn btn-outline btn-small" target="_blank" rel="noopener" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(ride.origin_name || '')}">Ver origen ↗</a></div></div><div class="record-right"><span class="fare-value">${money(ride.estimated_fare)}</span><p class="inline-meta">${escapeHtml(ride.estimated_distance_km || '—')} km</p></div></article>`).join('') : emptyState('Cuando estés disponible, aquí aparecerán las solicitudes de viaje.', '◷');
  app.innerHTML = `${pageHeader(`Hola, ${escapeHtml((sessionUser.name || '').split(' ')[0] || 'conductor/a')}.`, 'Tu próxima oportunidad empieza aquí.', '<button class="btn btn-outline btn-small" data-action="refresh">Actualizar solicitudes</button>')}
    <div class="content-grid">
      <div class="stack"><section class="driver-banner"><div class="availability-row"><div><p class="eyebrow" style="color:#d7fa55">Panel del conductor</p><h2>${approved ? (available ? 'Estás en línea.' : 'Tú decides cuándo salir.') : 'Cuenta pendiente de aprobación'}</h2><p>${approved ? (available ? 'Ya puedes recibir solicitudes cercanas.' : 'Activa tu disponibilidad para empezar a recibir viajes.') : 'El administrador debe aprobar tus documentos antes de activar la disponibilidad.'}</p></div>${approved ? `<button class="toggle ${available ? 'on' : ''}" aria-label="Cambiar disponibilidad" data-action="availability" data-status="${available ? 'unavailable' : 'available'}"><span></span></button>` : ''}</div></section>
      ${!approved ? '<div class="notice">Tu cuenta de conductor aún no está aprobada. Contacta al administrador de la plataforma para revisar el estado de tu solicitud.</div>' : ''}
      <section class="card section-card"><div class="section-title"><h2>Solicitudes cercanas</h2>${available ? statusBadge('available') : statusBadge('unavailable')}</div>${requestsHtml}</section>
      <section class="card section-card"><div class="section-title"><h2>Viaje en curso</h2></div><div id="driver-trip-content">${emptyState('Acepta una solicitud para empezar un viaje.', '↗')}</div></section></div>
      <div class="stack"><section class="card section-card"><div class="section-title"><h2>Tu cuenta</h2></div><div class="record"><div><h3>${escapeHtml(sessionUser.name || 'Conductor')}</h3><p>${escapeHtml(sessionUser.email || '')}</p></div>${statusBadge(driver.approval_status || 'pending')}</div><p class="field-hint">Estado de aprobación y disponibilidad se consultan directamente en la API.</p></section><section class="card section-card"><div class="section-title"><h3>Recordatorio</h3></div><p class="muted" style="font-size:13px">Acepta una solicitud para ver los datos del cliente y completar cada etapa del viaje desde este panel.</p></section></div>
    </div>`;
  await loadDriverCurrentTrip();
}

async function loadDriverCurrentTrip() {
  try {
    const [clientActive, me] = await Promise.all([request('/driver/active').catch((error) => {
      if (/404/.test(error.message)) return null;
      throw error;
    }), request('/auth/me')]);
    const trip = clientActive?.trip || clientActive?.data || clientActive?.active_trip;
    const container = document.querySelector('#driver-trip-content');
    if (!container) return;
    if (!trip) {
      container.innerHTML = emptyState('No tienes un viaje activo.', '↗');
      return;
    }
    container.innerHTML = `<article class="record"><div><h3>Viaje #${escapeHtml(trip.id)}</h3>${tripPath(trip.request?.origin_name || trip.origin_name, trip.request?.destination_name || trip.destination_name)}<p>Cliente: ${escapeHtml(trip.client?.name || trip.client?.user?.name || 'Cliente')}</p><div class="record-actions">${trip.status === 'assigned' ? `<button class="btn btn-outline btn-small" data-action="trip-arrive" data-id="${escapeHtml(trip.id)}">Ya llegué</button>` : ''}${trip.status === 'driver_arrived' ? `<button class="btn btn-primary btn-small" data-action="trip-start" data-id="${escapeHtml(trip.id)}">Iniciar viaje</button>` : ''}${trip.status === 'in_progress' ? `<button class="btn btn-primary btn-small" data-action="trip-complete" data-id="${escapeHtml(trip.id)}">Finalizar viaje</button>` : ''}</div></div><div class="record-right">${statusBadge(trip.status)}<p class="inline-meta" style="margin-top:9px">${money(trip.estimated_fare)}</p></div></article>`;
    const driver = me.user?.driver || me.user?.profile || {};
    if (driver.availability_status) sessionUser.availability_status = driver.availability_status;
  } catch (error) {
    const container = document.querySelector('#driver-trip-content');
    if (container) container.innerHTML = `<div class="error-box">No se pudo consultar el viaje activo: ${escapeHtml(error.message)}</div>`;
  }
}

function adminTabs() {
  const tabs = [['overview', 'Resumen'], ['drivers', 'Conductores'], ['fares', 'Tarifas'], ['trips', 'Viajes'], ['reports', 'Reportes'], ['audit', 'Auditoría']];
  return `<nav class="subnav">${tabs.map(([key, label]) => `<button class="nav-chip ${activeView === key ? 'active' : ''}" data-action="admin-view" data-view="${key}">${label}</button>`).join('')}</nav>`;
}

async function renderAdmin() {
  const title = activeView === 'drivers' ? 'Conductores' : activeView === 'fares' ? 'Tarifas' : activeView === 'trips' ? 'Viajes' : activeView === 'reports' ? 'Reportes' : activeView === 'audit' ? 'Auditoría' : 'Resumen general';
  let content = '';
  if (activeView === 'drivers') content = await adminDrivers();
  else if (activeView === 'fares') content = await adminFares();
  else if (activeView === 'trips') content = await adminTrips();
  else if (activeView === 'reports') content = await adminReports();
  else if (activeView === 'audit') content = await adminAudit();
  else content = await adminOverview();
  app.innerHTML = `${pageHeader(title, 'Monitorea y administra la operación de Rueda.', '<button class="btn btn-outline btn-small" data-action="refresh">Actualizar</button>')}${adminTabs()}${content}`;
}

async function adminOverview() {
  const response = await request('/admin/dashboard');
  const stats = response.stats || {};
  const trips = extractArray({ trips: response.recent_trips }, 'trips');
  const incidents = Array.isArray(response.recent_incidents) ? response.recent_incidents : [];
  return `<div class="stat-grid">${statCard('Clientes', stats.total_clients)}${statCard('Conductores', stats.total_drivers, `${stats.pending_drivers ?? 0} por aprobar`)}${statCard('Viajes activos', stats.active_trips, `${stats.pending_requests ?? 0} solicitudes pendientes`)}${statCard('Ingresos registrados', money(stats.total_revenue), `${stats.completed_trips ?? 0} viajes completados`)}</div>
    <div class="content-grid"><section class="card section-card"><div class="section-title"><h2>Viajes recientes</h2></div>${trips.length ? trips.slice(0, 8).map((trip) => `<article class="record"><div><h3>Viaje #${escapeHtml(trip.id)}</h3><p>${escapeHtml(trip.client?.user?.name || trip.client?.name || 'Cliente')} → ${escapeHtml(trip.driver?.user?.name || trip.driver?.name || 'Conductor')}</p><p>${dateTime(trip.completed_at || trip.created_at)}</p></div><div class="record-right">${statusBadge(trip.status)}<p class="inline-meta" style="margin-top:8px">${money(trip.final_fare || trip.estimated_fare)}</p></div></article>`).join('') : emptyState('No hay viajes recientes para mostrar.')}</section>
    <section class="card section-card"><div class="section-title"><h2>Incidencias recientes</h2></div>${incidents.length ? incidents.slice(0, 8).map((incident) => `<article class="record"><div><h3>Incidencia #${escapeHtml(incident.id)}</h3><p>${escapeHtml(incident.description || incident.comment || incident.type || 'Sin descripción')}</p><p>${dateTime(incident.created_at)}</p></div></article>`).join('') : emptyState('No hay incidencias recientes.', '!')}</section></div>`;
}

async function adminDrivers() {
  const filter = document.querySelector('#driver-filter')?.value || '';
  const query = filter ? `?approval_status=${encodeURIComponent(filter)}` : '';
  const response = await request(`/admin/drivers${query}`);
  const drivers = extractArray(response, 'drivers');
  return `<section class="card section-card"><div class="section-title"><h2>Revisión de conductores</h2><select id="driver-filter" aria-label="Filtrar por estado" data-action="filter-drivers"><option value="">Todos los estados</option><option value="pending" ${filter === 'pending' ? 'selected' : ''}>Pendientes</option><option value="approved" ${filter === 'approved' ? 'selected' : ''}>Aprobados</option><option value="rejected" ${filter === 'rejected' ? 'selected' : ''}>Rechazados</option><option value="suspended" ${filter === 'suspended' ? 'selected' : ''}>Suspendidos</option></select></div>
    ${drivers.length ? `<div class="table-wrap"><table><thead><tr><th>Conductor</th><th>Vehículo</th><th>Calificación</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${drivers.map((driver) => { const vehicle = driver.vehicles?.[0] || {}; return `<tr><td><div class="table-name">${escapeHtml(driver.user?.name || 'Conductor')}</div><div class="table-sub">${escapeHtml(driver.user?.email || '')} · ${escapeHtml(driver.license_number || 'Sin licencia')}</div></td><td>${escapeHtml([vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(' · ') || 'Sin vehículo')}</td><td>★ ${escapeHtml(driver.rating_average ?? '—')}</td><td>${statusBadge(driver.approval_status)}</td><td><select class="inline-input" data-action="driver-approval" data-id="${escapeHtml(driver.id)}" aria-label="Cambiar aprobación de ${escapeHtml(driver.user?.name || 'conductor')}" style="width:auto;min-height:33px;padding:4px"><option value="">Cambiar…</option><option value="approved">Aprobar</option><option value="rejected">Rechazar</option><option value="suspended">Suspender</option></select></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No hay conductores en este filtro.')}</section>`;
}

async function adminFares() {
  const response = await request('/admin/fares');
  const fares = extractArray(response, 'fares');
  return `<div class="content-grid"><section class="card section-card"><div class="section-title"><h2>Tarifas configuradas</h2></div>${fares.length ? fares.map((fare) => `<article class="record"><div><h3>${escapeHtml(fare.name || 'Tarifa')}</h3><p>Base ${money(fare.base_fare)} · ${money(fare.price_per_km)}/km · ${money(fare.price_per_minute)}/min</p><p>Mínimo ${money(fare.minimum_fare)} · multiplicador ×${escapeHtml(fare.surge_multiplier)}</p></div><div class="record-right">${statusBadge(fare.active ? 'active' : 'unavailable')}</div></article>`).join('') : emptyState('Aún no hay tarifas configuradas.')}</section>
    <section class="card section-card"><div class="section-title"><h2>Crear tarifa</h2></div><form id="fare-form">
      ${inputField('Nombre de la tarifa', 'name', 'text', { required: true, placeholder: 'Tarifa urbana estándar' })}
      <div class="form-row">${inputField('Tarifa base (COP)', 'base_fare', 'number', { required: true, min: 0 })}${inputField('Precio por km (COP)', 'price_per_km', 'number', { required: true, min: 0 })}</div>
      <div class="form-row">${inputField('Precio por minuto (COP)', 'price_per_minute', 'number', { required: true, min: 0 })}${inputField('Tarifa mínima (COP)', 'minimum_fare', 'number', { required: true, min: 0 })}</div>
      <div class="form-row">${inputField('Multiplicador dinámico', 'surge_multiplier', 'number', { required: true, min: 0, step: '0.1' })}<div class="field"><label for="active">Estado</label><select id="active" name="active"><option value="true">Activa</option><option value="false">Inactiva</option></select></div></div>
      <button class="btn btn-primary" type="submit">Guardar tarifa</button>
    </form></section></div>`;
}

async function adminTrips() {
  const params = new URLSearchParams();
  const status = document.querySelector('#trip-status')?.value;
  const client = document.querySelector('#trip-client')?.value;
  const driver = document.querySelector('#trip-driver')?.value;
  const date = document.querySelector('#trip-date')?.value;
  if (status) params.set('status', status);
  if (client) params.set('client_id', client);
  if (driver) params.set('driver_id', driver);
  if (date) params.set('date', date);
  const response = await request(`/admin/trips${params.size ? `?${params}` : ''}`);
  const trips = extractArray(response, 'trips');
  return `<section class="card section-card"><div class="section-title"><h2>Registro de viajes</h2></div><form id="trip-filters" class="filters"><select id="trip-status"><option value="">Todos los estados</option>${['requested','assigned','driver_arrived','in_progress','completed','cancelled'].map((value) => `<option value="${value}" ${status === value ? 'selected' : ''}>${STATUS_LABELS[value]}</option>`).join('')}</select><input id="trip-client" type="number" min="1" value="${escapeHtml(client || '')}" placeholder="ID cliente"><input id="trip-driver" type="number" min="1" value="${escapeHtml(driver || '')}" placeholder="ID conductor"><input id="trip-date" type="date" value="${escapeHtml(date || '')}"><button class="btn btn-outline btn-small" type="submit">Filtrar</button></form>
    ${trips.length ? `<div class="table-wrap"><table><thead><tr><th>Viaje</th><th>Cliente / Conductor</th><th>Fecha</th><th>Estado</th><th>Valor</th></tr></thead><tbody>${trips.map((trip) => `<tr><td><div class="table-name">#${escapeHtml(trip.id)}</div><div class="table-sub">${escapeHtml(trip.origin_name || trip.request?.origin_name || '—')} → ${escapeHtml(trip.destination_name || trip.request?.destination_name || '—')}</div></td><td>${escapeHtml(trip.client?.user?.name || trip.client?.name || '—')}<div class="table-sub">${escapeHtml(trip.driver?.user?.name || trip.driver?.name || 'Sin conductor')}</div></td><td>${dateTime(trip.created_at || trip.completed_at)}</td><td>${statusBadge(trip.status)}</td><td>${money(trip.final_fare || trip.estimated_fare)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No hay viajes que coincidan con los filtros.')}</section>`;
}

async function adminReports() {
  const response = await request('/admin/reports');
  const report = response.report || response.stats || response;
  const entries = Object.entries(report).filter(([, value]) => typeof value !== 'object');
  return `<section class="card section-card"><div class="section-title"><h2>Reporte consolidado</h2></div>${entries.length ? `<div class="stat-grid">${entries.map(([key, value]) => statCard(key.replaceAll('_', ' '), typeof value === 'number' && /revenue|income|fare|total/i.test(key) ? money(value) : value)).join('')}</div>` : `<pre class="field-hint" style="white-space:pre-wrap">${escapeHtml(JSON.stringify(response, null, 2))}</pre>`}</section>`;
}

async function adminAudit() {
  const response = await request('/admin/audit-logs');
  const logs = extractArray(response, 'audit_logs', 'logs', 'data');
  return `<section class="card section-card"><div class="section-title"><h2>Registro de auditoría</h2></div>${logs.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>${logs.map((log) => `<tr><td>${dateTime(log.created_at || log.timestamp)}</td><td>${escapeHtml(log.user?.name || log.user_name || '—')}</td><td>${escapeHtml(log.action || log.event || '—')}</td><td>${escapeHtml(log.description || log.details || log.ip_address || '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No hay acciones de auditoría para mostrar.', '◷')}</section>`;
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEYS.token);
  sessionStorage.removeItem(STORAGE_KEYS.user);
  sessionUser = null;
  activeView = 'overview';
  updateTopbar();
}

function getFormData(form) {
  return Object.fromEntries(new FormData(form));
}

async function estimateFare() {
  const form = document.querySelector('#ride-form');
  if (!form.reportValidity()) return;
  const values = getFormData(form);
  const body = {};
  for (const key of ['origin_latitude', 'origin_longitude', 'destination_latitude', 'destination_longitude']) body[key] = Number(values[key]);
  const result = await request('/client/estimate-fare', { method: 'POST', body: JSON.stringify(body) });
  if (!result.estimate) throw new Error('La API no devolvió la estimación de la tarifa.');
  lastEstimate = result.estimate;
  const target = document.querySelector('#estimate-result');
  if (target) target.innerHTML = estimateMarkup(lastEstimate);
}

async function requestRide(form) {
  if (!form.reportValidity()) return;
  const values = getFormData(form);
  for (const key of ['origin_latitude', 'origin_longitude', 'destination_latitude', 'destination_longitude']) values[key] = Number(values[key]);
  const result = await request('/client/ride-requests', { method: 'POST', body: JSON.stringify(values) });
  showToast(result.message || 'Tu solicitud fue enviada.');
  lastEstimate = null;
  await renderDashboard();
}

async function cancelRide(id) {
  if (!window.confirm('¿Seguro que quieres cancelar este viaje?')) return;
  const reason = window.prompt('Motivo de cancelación (opcional):') || 'Cancelación solicitada por el cliente';
  const result = await request(`/client/cancel/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ reason }) });
  showToast(result.message || 'Viaje cancelado.');
  await renderDashboard();
}

async function submitRating(id) {
  const score = selectedRating;
  const comment = window.prompt(`Calificación: ${score} de 5 estrellas. ¿Quieres agregar un comentario?`) || '';
  const result = await request(`/client/trips/${encodeURIComponent(id)}/rating`, {
    method: 'POST', body: JSON.stringify({ score, comment, has_incident: false }),
  });
  showToast(result.message || 'Gracias por calificar tu viaje.');
  await renderDashboard();
}

async function driverAction(action, id) {
  if (action === 'accept-ride') {
    const result = await request(`/driver/ride-requests/${encodeURIComponent(id)}/accept`, { method: 'POST', body: JSON.stringify({}) });
    showToast(result.message || 'Viaje aceptado.');
  } else {
    const endpoint = { 'trip-arrive': 'arrive', 'trip-start': 'start', 'trip-complete': 'complete' }[action];
    let body = {};
    if (action === 'trip-complete') {
      const actual_distance_km = Number(window.prompt('Distancia recorrida en km:', '1.5'));
      const actual_duration_min = Number(window.prompt('Duración del viaje en minutos:', '10'));
      if (!Number.isFinite(actual_distance_km) || !Number.isFinite(actual_duration_min) || actual_distance_km <= 0 || actual_duration_min <= 0) {
        showToast('Ingresa una distancia y duración válidas.', true);
        return;
      }
      body = { actual_distance_km, actual_duration_min };
    }
    const result = await request(`/driver/trips/${encodeURIComponent(id)}/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
    showToast(result.message || 'Estado del viaje actualizado.');
  }
  await renderDashboard();
}

async function saveFare(form) {
  const data = getFormData(form);
  for (const field of ['base_fare', 'price_per_km', 'price_per_minute', 'minimum_fare', 'surge_multiplier']) data[field] = Number(data[field]);
  data.active = data.active === 'true';
  const result = await request('/admin/fares', { method: 'POST', body: JSON.stringify(data) });
  showToast(result.message || 'Tarifa creada correctamente.');
  await renderDashboard();
}

async function updateDriverApproval(select) {
  if (!select.value) return;
  const admin_notes = window.prompt('Notas para el registro (opcional):') || '';
  const result = await request(`/admin/drivers/${encodeURIComponent(select.dataset.id)}/approval`, {
    method: 'PATCH', body: JSON.stringify({ approval_status: select.value, admin_notes }),
  });
  showToast(result.message || 'Estado del conductor actualizado.');
  await renderDashboard();
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === 'auth-form') {
    event.preventDefault();
    try { await (form.querySelector('[name="login"]') ? login(form) : register(form)); }
    catch (error) { showToast(error.message, true); }
  } else if (form.id === 'api-config-form') {
    event.preventDefault();
    const value = new FormData(form).get('api_url');
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Usa una dirección HTTP o HTTPS.');
      localStorage.setItem(STORAGE_KEYS.apiUrl, url.toString().replace(/\/+$/, ''));
      const saved = document.querySelector('#config-saved');
      if (saved) saved.textContent = 'Dirección guardada.';
      showToast('URL de la API guardada.');
    } catch (error) { showToast(error.message || 'La URL no es válida.', true); }
  } else if (form.id === 'ride-form') {
    event.preventDefault();
    try { await requestRide(form); } catch (error) { showToast(error.message, true); }
  } else if (form.id === 'fare-form') {
    event.preventDefault();
    try { await saveFare(form); } catch (error) { showToast(error.message, true); }
  } else if (form.id === 'trip-filters') {
    event.preventDefault();
    try { await renderDashboard(); } catch (error) { showToast(error.message, true); }
  }
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  try {
    if (action === 'home' || action === 'show-login') { event.preventDefault(); authPage('login'); }
    else if (action === 'show-register') authPage('register');
    else if (action === 'logout') {
      try { await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }); }
      catch (error) { console.warn('La API no confirmó el cierre de sesión:', error.message); }
      clearSession();
      authPage('login');
      showToast('Sesión cerrada.');
    } else if (action === 'forgot-password') {
      const email = window.prompt('Ingresa el correo de tu cuenta:');
      if (!email) return;
      const new_password = window.prompt('Ingresa tu nueva contraseña:');
      if (!new_password) return;
      const result = await request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email, new_password }) });
      showToast(result.message || 'Contraseña restablecida.');
    } else if (action === 'refresh') await renderDashboard();
    else if (action === 'estimate-fare') {
      try { await estimateFare(); } catch (error) { showToast(error.message, true); }
    } else if (action === 'cancel-ride') await cancelRide(target.dataset.id);
    else if (action === 'rate-trip') await submitRating(target.dataset.id);
    else if (['accept-ride', 'trip-arrive', 'trip-start', 'trip-complete'].includes(action)) await driverAction(action, target.dataset.id);
    else if (action === 'availability') {
      const result = await request('/driver/availability', { method: 'PUT', body: JSON.stringify({ status: target.dataset.status }) });
      sessionUser.availability_status = result.availability_status;
      sessionStorage.setItem(STORAGE_KEYS.user, JSON.stringify(sessionUser));
      showToast(result.message || 'Disponibilidad actualizada.');
      await renderDashboard();
    } else if (action === 'admin-view') {
      activeView = target.dataset.view;
      await renderDashboard();
    }
  } catch (error) { showToast(error.message, true); }
}

document.addEventListener('submit', handleSubmit);
document.addEventListener('click', handleClick);
document.addEventListener('change', async (event) => {
  if (event.target.id === 'role') {
    const fields = document.querySelector('#driver-fields');
    const isDriver = event.target.value === 'driver';
    fields.hidden = !isDriver;
    fields.querySelectorAll('input').forEach((input) => { input.required = isDriver; });
  } else if (event.target.id === 'driver-filter') {
    try { await renderDashboard(); } catch (error) { showToast(error.message, true); }
  } else if (event.target.matches('[data-action="driver-approval"]')) {
    try { await updateDriverApproval(event.target); } catch (error) { showToast(error.message, true); }
  }
});

document.addEventListener('click', (event) => {
  const star = event.target.closest('[data-rating]');
  if (!star) return;
  selectedRating = Number(star.dataset.rating);
  document.querySelectorAll('[data-rating]').forEach((button) => {
    button.classList.toggle('selected', Number(button.dataset.rating) <= selectedRating);
  });
});

async function init() {
  if (!sessionStorage.getItem(STORAGE_KEYS.token)) {
    sessionUser = null;
    updateTopbar();
    authPage();
    return;
  }
  updateTopbar();
  try {
    const result = await request('/auth/me');
    if (result.user) {
      sessionUser = result.user;
      sessionStorage.setItem(STORAGE_KEYS.user, JSON.stringify(sessionUser));
    }
    await renderDashboard();
  } catch (error) {
    clearSession();
    authPage();
    showToast(`No se pudo recuperar la sesión: ${error.message}`, true);
  }
}

init();
