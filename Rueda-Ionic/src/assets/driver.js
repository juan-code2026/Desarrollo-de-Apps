/*
 * ============================================================================
 *  RUEDA · PANEL DEL CONDUCTOR
 * ============================================================================
 *  Todo lo del rol "driver":
 *    - Ponerse en línea / fuera de línea y ver las ganancias del día.
 *    - Ver solicitudes pendientes (se actualizan solas) y aceptarlas.
 *    - Llevar el viaje paso a paso: Ya llegué → Iniciar → Finalizar.
 *    - NAVEGACIÓN tipo Waze: mapa en tiempo real, instrucciones giro a giro
 *      en español, velocidad, tiempo y distancia restantes, rastro recorrido,
 *      pantalla completa y atajos para abrir la ruta en Waze o Google Maps.
 *    - Enviar la ubicación al servidor cada 5 s para que el cliente vea el
 *      carro moverse en su mapa (GPS real o recorrido simulado).
 *
 *  Endpoints usados (ver API_DOCUMENTATION.md del profesor):
 *    PUT  /driver/availability              { status: available | unavailable }
 *    GET  /driver/ride-requests
 *    POST /driver/ride-requests/{id}/accept → { trip }
 *    POST /driver/trips/{id}/arrive | start | complete
 *    POST /driver/location                  { latitude, longitude, heading, speed, trip_id }
 *  Servicio externo: OSRM (router.project-osrm.org) para la ruta y los giros.
 *
 *  IMPORTANTE: la API NO tiene un endpoint para consultar el viaje activo del
 *  conductor ni su disponibilidad. Por eso este panel guarda en sessionStorage
 *  (por pestaña) el viaje aceptado y si está en línea. Si se cierra la pestaña
 *  en medio de un viaje, se pierde ese dato local (el viaje sigue en el servidor).
 *
 *  Se carga antes que app.js y usa sus funciones (request, escapeHtml, money,
 *  statusBadge, openModal, carIcon, mapIcon, bearingBetween, straightDistanceKm,
 *  searchAddresses...). Solo se llaman cuando el usuario ya está en el panel.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 * Configuración y estado
 * ------------------------------------------------------------------------- */

// Llave de sessionStorage con el estado local del conductor.
const DRIVER_STATE_KEY = 'rueda_driver_state';
// Llave de localStorage con los viajes terminados (para las ganancias del día).
const DRIVER_EARNINGS_KEY = 'rueda_driver_earnings';
// Cada cuánto se envía la ubicación al servidor (milisegundos).
const DRIVER_LOCATION_MS = 5000;
// Cada cuánto se redibuja la navegación (movimiento fluido).
const DRIVER_FRAME_MS = 1000;
// Cada cuánto se buscan nuevas solicitudes cuando está en línea.
const DRIVER_REQUESTS_MS = 8000;
// Velocidad del carro simulado en km/h (rápido a propósito para la demostración).
const SIMULATION_SPEED_KMH = 70;
// A qué distancia (km) se considera que ya llegó al punto.
const ARRIVAL_RADIUS_KM = 0.04;
// Cada cuánto se recalcula la ruta aunque no cambie el destino (ms).
const ROUTE_REFRESH_MS = 30000;

// Pasos del viaje para la barra de progreso.
const TRIP_STEPS = [
  ['assigned', 'Aceptado'],
  ['driver_arrived', 'En recogida'],
  ['in_progress', 'En curso'],
  ['completed', 'Finalizado'],
];

let driverRequestsTimer = null; // temporizador de solicitudes
let driverSendTimer = null; // temporizador de envío de ubicación al servidor
let driverFrameTimer = null; // temporizador del dibujo (1 s)
let driverGeoWatch = null; // id de navigator.geolocation.watchPosition
let driverPosition = null; // última posición conocida [lat, lng]
let driverHeading = 0; // rumbo en grados (0 = norte)
let driverSpeedKmh = 0; // velocidad actual
let driverLastSent = null; // hora del último envío exitoso
let driverLocationError = ''; // último error al enviar o leer el GPS
let driverRequestsCache = []; // últimas solicitudes mostradas
let driverKnownRequestIds = new Set(); // para avisar cuando llega una nueva

// Navegación
let driverMap = null; // mapa Leaflet del viaje
let driverLayers = {}; // marcadores, carro, ruta y rastro
let driverFollow = true; // ¿la cámara sigue al carro?
let driverNav = null; // ruta actual: { key, coordinates, cumulative, steps, totalKm, totalMin, fetchedAt }
let driverRouteLoading = false; // evita pedir la ruta dos veces al tiempo
let driverTrail = []; // puntos por donde ha pasado el carro
let driverArrivedNotified = ''; // para avisar una sola vez "llegaste"

// Lee el estado local del conductor.
function driverState() {
  try {
    return { availability: null, approval: null, trip: null, simulate: false, ...JSON.parse(sessionStorage.getItem(DRIVER_STATE_KEY) || '{}') };
  } catch {
    return { availability: null, approval: null, trip: null, simulate: false };
  }
}

// Guarda cambios en el estado local (se combinan con lo que ya había).
function saveDriverState(changes) {
  const next = { ...driverState(), ...changes };
  sessionStorage.setItem(DRIVER_STATE_KEY, JSON.stringify(next));
  return next;
}

// Detiene temporizadores, GPS y mapa (app.js lo llama antes de cambiar de pantalla).
function stopDriverLoops() {
  clearInterval(driverRequestsTimer);
  clearInterval(driverSendTimer);
  clearInterval(driverFrameTimer);
  driverRequestsTimer = null;
  driverSendTimer = null;
  driverFrameTimer = null;
  if (driverGeoWatch !== null && navigator.geolocation) navigator.geolocation.clearWatch(driverGeoWatch);
  driverGeoWatch = null;
  if (driverMap) {
    driverMap.remove();
    driverMap = null;
  }
  driverLayers = {};
}

/* ---------------------------------------------------------------------------
 * Ganancias del día (guardadas en este computador)
 * ------------------------------------------------------------------------- */

// Viajes terminados por este conductor (se guardan por id de usuario).
function driverEarnings() {
  try {
    const all = JSON.parse(localStorage.getItem(DRIVER_EARNINGS_KEY) || '{}');
    return all[sessionUser?.id ?? 'anon'] || [];
  } catch {
    return [];
  }
}

// Agrega un viaje terminado a la lista de ganancias.
function addDriverEarning(entry) {
  try {
    const all = JSON.parse(localStorage.getItem(DRIVER_EARNINGS_KEY) || '{}');
    const key = sessionUser?.id ?? 'anon';
    all[key] = [entry, ...(all[key] || [])].slice(0, 50);
    localStorage.setItem(DRIVER_EARNINGS_KEY, JSON.stringify(all));
  } catch {
    // Sin almacenamiento: no se muestran ganancias.
  }
}

// Tarjeta con los viajes y el dinero de hoy.
function earningsCard() {
  const today = new Date().toDateString();
  const trips = driverEarnings().filter((trip) => new Date(trip.completed_at).toDateString() === today);
  const total = trips.reduce((sum, trip) => sum + (Number(trip.fare) || 0), 0);
  const km = trips.reduce((sum, trip) => sum + (Number(trip.km) || 0), 0);
  return `<section class="admin-kpis driver-kpis">
    ${adminKpi('$', 'Ganado hoy', money(total), `${trips.length} ${trips.length === 1 ? 'viaje' : 'viajes'}`, 'kpi-dark')}
    ${adminKpi('↗', 'Kilómetros hoy', `${km.toFixed(1)} km`, 'Recorridos con pasajero')}
    ${adminKpi('◷', 'Último viaje', trips[0] ? money(trips[0].fare) : '—', trips[0] ? dateTime(trips[0].completed_at) : 'Aún no hay viajes hoy')}
  </section>`;
}

/* ---------------------------------------------------------------------------
 * Pantalla principal (sin viaje)
 * ------------------------------------------------------------------------- */

// Punto de entrada: app.js llama a esta función cuando el rol es "driver".
async function renderDriver() {
  const state = driverState();
  if (state.trip) {
    renderDriverTrip(state);
    return;
  }

  // Si el servidor responde 403, el conductor no está aprobado.
  let blocked = false;
  const response = await request('/driver/ride-requests').catch((error) => {
    if (error.status !== 403) throw error;
    blocked = true;
    return { requests: [] };
  });
  driverRequestsCache = extractArray(response, 'requests');
  driverKnownRequestIds = new Set(driverRequestsCache.map((ride) => String(ride.id)));
  const approval = blocked ? 'pending' : state.approval;
  const approved = approval ? approval === 'approved' : true;
  const online = state.availability === 'available';

  app.innerHTML = `
    <section class="driver-hero ${online ? 'is-online' : ''}">
      <div>
        <p class="admin-kicker"><span></span> PANEL DEL CONDUCTOR</p>
        <h1>Hola, ${escapeHtml((sessionUser?.name || '').trim().split(/\s+/)[0] || 'conductor')}.</h1>
        <p class="admin-date">${online ? 'Estás en línea. Las solicitudes nuevas aparecen solas.' : 'Ponte en línea para empezar a recibir viajes.'}</p>
      </div>
      <button class="online-switch ${online ? 'on' : ''}" data-action="driver-availability" data-status="${online ? 'unavailable' : 'available'}" aria-pressed="${online}">
        <span class="online-knob" aria-hidden="true"></span>
        <span class="online-text"><b>${online ? 'En línea' : 'Fuera de línea'}</b><small>${online ? 'Toca para desconectarte' : 'Toca para conectarte'}</small></span>
      </button>
    </section>
    ${!approved ? '<div class="notice">El servidor indica que tu cuenta aún no está aprobada. Pide al administrador que te apruebe y vuelve a activar el interruptor.</div>' : ''}
    ${earningsCard()}
    <section class="card admin-card">
      <div class="admin-card-head"><div><p class="eyebrow">CERCA DE TI</p><h2>Solicitudes de viaje</h2><p class="muted">${online ? 'Se actualizan cada pocos segundos.' : 'Conéctate para que los clientes puedan encontrarte.'}</p></div>
        <button class="btn btn-outline btn-small" data-action="driver-refresh">↻ Actualizar</button></div>
      <div id="driver-requests">${driverRequestsMarkup(online)}</div>
    </section>`;

  if (online) driverRequestsTimer = setInterval(refreshDriverRequests, DRIVER_REQUESTS_MS);
}

// Tarjetas de solicitudes pendientes.
function driverRequestsMarkup(online) {
  if (!driverRequestsCache.length) {
    return emptyState(online ? 'No hay solicitudes por ahora. Te avisamos cuando llegue una.' : 'Estás fuera de línea.', '◷');
  }
  return `<div class="request-grid">${driverRequestsCache.map((ride) => `
    <article class="request-card">
      <div class="request-card-top">
        <div><span class="ride-label">SOLICITUD #${escapeHtml(ride.id)}</span><strong class="request-fare">${money(ride.estimated_fare)}</strong></div>
        <span class="admin-chip">${escapeHtml(ride.estimated_distance_km ?? '—')} km${ride.estimated_duration_min ? ` · ${escapeHtml(ride.estimated_duration_min)} min` : ''}</span>
      </div>
      <div class="route-summary">${tripPath(ride.origin_name, ride.destination_name)}</div>
      <p class="request-client"><span class="admin-avatar" aria-hidden="true">${escapeHtml(initials(ride.client?.name || ride.client?.user?.name || 'C'))}</span>${escapeHtml(ride.client?.name || ride.client?.user?.name || 'Cliente')}</p>
      <button class="btn btn-success full-width" data-action="driver-accept" data-id="${escapeHtml(ride.id)}">Aceptar viaje →</button>
    </article>`).join('')}</div>`;
}

// Vuelve a pedir las solicitudes y avisa si llegó alguna nueva (sin repintar todo).
async function refreshDriverRequests() {
  const container = document.querySelector('#driver-requests');
  if (!container || driverState().trip) return;
  try {
    const response = await request('/driver/ride-requests');
    driverRequestsCache = extractArray(response, 'requests');
    const fresh = driverRequestsCache.filter((ride) => !driverKnownRequestIds.has(String(ride.id)));
    if (fresh.length) {
      showToast(fresh.length === 1 ? '¡Nueva solicitud de viaje!' : `¡${fresh.length} solicitudes nuevas!`);
      navigator.vibrate?.(200);
    }
    driverKnownRequestIds = new Set(driverRequestsCache.map((ride) => String(ride.id)));
    container.innerHTML = driverRequestsMarkup(driverState().availability === 'available');
  } catch {
    // Si falla una consulta, se intenta en la siguiente vuelta.
  }
}

/* ---------------------------------------------------------------------------
 * Disponibilidad y aceptar viaje
 * ------------------------------------------------------------------------- */

// PUT /driver/availability. Si responde 403, el conductor no está aprobado.
async function setDriverAvailability(status) {
  try {
    const result = await request('/driver/availability', { method: 'PUT', body: JSON.stringify({ status }) });
    saveDriverState({ availability: result.availability_status || status, approval: 'approved' });
    showToast(status === 'available' ? 'Estás en línea.' : 'Te desconectaste.');
  } catch (error) {
    if (error.status === 403) saveDriverState({ availability: 'unavailable', approval: error.payload?.approval_status || 'pending' });
    showToast(error.message, true);
  }
  await renderDashboard();
}

// Busca coordenadas de una dirección con Photon (respaldo si la API no las envía).
async function geocodeName(name) {
  if (!name) return null;
  try {
    const [feature] = await searchAddresses(name);
    if (!feature) return null;
    const [longitude, latitude] = feature.geometry.coordinates;
    return [latitude, longitude];
  } catch {
    return null;
  }
}

// POST /driver/ride-requests/{id}/accept y guarda el viaje localmente.
async function acceptRide(button) {
  const ride = driverRequestsCache.find((item) => String(item.id) === button.dataset.id) || { id: button.dataset.id };
  button.disabled = true;
  button.textContent = 'Aceptando…';
  let result;
  try {
    result = await request(`/driver/ride-requests/${encodeURIComponent(ride.id)}/accept`, { method: 'POST', body: JSON.stringify({}) });
  } catch (error) {
    // 409 = otro conductor la tomó primero o el cliente canceló.
    showToast(error.message, true);
    await renderDashboard();
    return;
  }
  const trip = result.trip || {};
  // La lista de solicitudes de la documentación no trae coordenadas: si faltan,
  // se buscan a partir del nombre de la dirección (las dos al tiempo).
  const [origin, destination] = await Promise.all([
    toPoint(ride.origin_latitude, ride.origin_longitude) || geocodeName(ride.origin_name),
    toPoint(ride.destination_latitude, ride.destination_longitude) || geocodeName(ride.destination_name),
  ]);
  saveDriverState({
    availability: 'available',
    approval: 'approved',
    trip: {
      id: trip.id ?? ride.id,
      request_id: trip.request_id ?? ride.id,
      status: trip.status || 'assigned',
      estimated_fare: trip.estimated_fare ?? ride.estimated_fare,
      estimated_distance_km: ride.estimated_distance_km,
      origin_name: ride.origin_name,
      destination_name: ride.destination_name,
      origin_latitude: origin?.[0], origin_longitude: origin?.[1],
      destination_latitude: destination?.[0], destination_longitude: destination?.[1],
      client: ride.client || null,
      accepted_at: new Date().toISOString(),
      traveled_km: 0,
    },
  });
  driverPosition = null;
  driverNav = null;
  driverTrail = [];
  showToast(result.message || 'Viaje aceptado. Ve a recoger al cliente.');
  await renderDashboard();
}

/* ---------------------------------------------------------------------------
 * Pantalla del viaje (navegación)
 * ------------------------------------------------------------------------- */

// Barra de progreso del viaje.
function tripStepper(status) {
  const current = TRIP_STEPS.findIndex(([key]) => key === status);
  return `<ol class="trip-stepper">${TRIP_STEPS.map(([key, label], index) => `
    <li class="${index < current ? 'done' : index === current ? 'current' : ''}"><span>${index < current ? '✓' : index + 1}</span>${label}</li>`).join('')}</ol>`;
}

// Botón grande con la siguiente acción según el estado.
function nextTripAction(trip) {
  if (trip.status === 'assigned') return `<button class="btn btn-warning-solid full-width trip-cta" id="trip-cta" data-action="driver-trip" data-step="arrive">Ya llegué al punto de recogida</button>`;
  if (trip.status === 'driver_arrived') return `<button class="btn btn-primary full-width trip-cta" id="trip-cta" data-action="driver-trip" data-step="start">Cliente a bordo · Iniciar viaje →</button>`;
  if (trip.status === 'in_progress') return `<button class="btn btn-success full-width trip-cta" id="trip-cta" data-action="driver-finish">Finalizar viaje ✓</button>`;
  return '';
}

// Punto al que se navega según el estado: recogida antes de llegar, destino después.
function navTarget(trip) {
  if (trip.status === 'assigned') return toPoint(trip.origin_latitude, trip.origin_longitude);
  if (trip.status === 'in_progress') return toPoint(trip.destination_latitude, trip.destination_longitude);
  return null;
}

// Enlaces para abrir la ruta en Waze o Google Maps (útil con el celular en la mano).
function externalNavLinks(trip) {
  const target = navTarget(trip) || toPoint(trip.destination_latitude, trip.destination_longitude);
  if (!target) return '';
  const [lat, lng] = target;
  return `<div class="external-nav">
    <a class="btn btn-outline btn-small" target="_blank" rel="noopener" href="https://waze.com/ul?ll=${lat},${lng}&navigate=yes">Abrir en Waze ↗</a>
    <a class="btn btn-outline btn-small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving">Google Maps ↗</a>
  </div>`;
}

// Pantalla del viaje: navegación, pasos, cliente, ubicación y siguiente acción.
function renderDriverTrip(state) {
  stopDriverLoops();
  const { trip } = state;
  const clientName = trip.client?.name || trip.client?.user?.name || 'Cliente';
  const clientPhone = trip.client?.phone || trip.client?.user?.phone;
  const heading = { assigned: 'Ve a recoger al cliente', driver_arrived: 'Espera al cliente', in_progress: 'Lleva al cliente a su destino' }[trip.status] || 'Viaje en curso';
  app.innerHTML = `
    <section class="driver-hero is-online driver-hero-compact">
      <div>
        <p class="admin-kicker"><span></span> VIAJE #${escapeHtml(trip.id)}</p>
        <h1>${escapeHtml(heading)}</h1>
      </div>
      ${statusBadge(trip.status)}
    </section>
    ${tripStepper(trip.status)}
    <div class="admin-grid driver-trip-grid">
      <section class="card admin-card driver-map-card" id="driver-map-card">
        <div class="nav-wrap">
          <div id="driver-map" class="driver-map" role="application" aria-label="Mapa de navegación"></div>

          <!-- Instrucción del próximo giro (arriba) -->
          <div class="nav-instruction" id="nav-instruction" aria-live="polite">
            <span class="nav-turn" id="nav-turn" aria-hidden="true">↑</span>
            <div><strong id="nav-step-distance">Calculando ruta…</strong><span id="nav-step-text">Un momento</span></div>
          </div>

          <!-- Velocímetro -->
          <div class="nav-speed" aria-label="Velocidad"><b id="nav-speed">0</b><small>km/h</small></div>

          <!-- Botones del mapa -->
          <div class="nav-buttons">
            <button type="button" class="nav-button active" data-action="driver-follow" aria-pressed="true" title="Seguir al carro">◎</button>
            <button type="button" class="nav-button" data-action="driver-overview" title="Ver toda la ruta">⤢</button>
            <button type="button" class="nav-button" data-action="driver-fullscreen" title="Pantalla completa">⛶</button>
          </div>

          <!-- Resumen de llegada (abajo) -->
          <div class="nav-summary">
            <div><b id="nav-eta-min">—</b><small>min</small></div>
            <div><b id="nav-remaining">—</b><small id="nav-remaining-unit">km</small></div>
            <div><b id="nav-arrival">—</b><small>llegada</small></div>
            <span class="nav-phase">${trip.status === 'assigned' ? 'A LA RECOGIDA' : trip.status === 'in_progress' ? 'AL DESTINO' : 'EN RECOGIDA'}</span>
          </div>
          <div class="nav-progress"><span id="nav-progress"></span></div>
        </div>
      </section>
      <div class="stack">
        <section class="card admin-card">
          <div class="route-summary">${tripPath(trip.origin_name, trip.destination_name)}</div>
          <div class="driver-summary"><span class="driver-avatar" aria-hidden="true">${escapeHtml(initials(clientName))}</span><div><strong>${escapeHtml(clientName)}</strong><span>${escapeHtml(clientPhone || 'Cliente')}</span></div>${clientPhone ? `<a class="btn btn-outline btn-small driver-call" href="tel:${escapeHtml(clientPhone)}">Llamar</a>` : ''}</div>
          <div class="active-ride-bottom"><div><span class="inline-meta">Valor estimado</span><strong class="fare-value">${money(trip.estimated_fare)}</strong></div>${trip.status === 'in_progress' ? `<div><span class="inline-meta">Recorrido</span><strong class="fare-value" id="trip-traveled">${(trip.traveled_km || 0).toFixed(1)} km</strong></div>` : ''}</div>
          ${nextTripAction(trip)}
          ${externalNavLinks(trip)}
        </section>
        <section class="card admin-card location-card">
          <div class="admin-card-head"><div><p class="eyebrow">TU UBICACIÓN</p><h2>Compartiendo con el cliente</h2></div></div>
          <div class="location-mode" role="group" aria-label="Fuente de la ubicación">
            <button class="filter-chip ${!state.simulate ? 'active' : ''}" data-action="driver-location-mode" data-mode="gps" aria-pressed="${!state.simulate}">◎ GPS real</button>
            <button class="filter-chip ${state.simulate ? 'active' : ''}" data-action="driver-location-mode" data-mode="sim" aria-pressed="${state.simulate}">▶ Simular recorrido</button>
          </div>
          <p class="location-status" id="location-status">Preparando…</p>
          <p class="field-hint">Si el computador no tiene GPS, usa “Simular recorrido”: el carro avanza solo por las calles hasta la recogida y, después de iniciar, hasta el destino.</p>
        </section>
      </div>
    </div>`;

  initDriverMap(trip);
  startDriverLoops();
}

/* ---------------------------------------------------------------------------
 * Mapa de navegación
 * ------------------------------------------------------------------------- */

// Crea el mapa con la recogida, el destino y el rastro recorrido.
function initDriverMap(trip) {
  const element = document.querySelector('#driver-map');
  if (!element || !window.L) return;
  const origin = toPoint(trip.origin_latitude, trip.origin_longitude);
  const destination = toPoint(trip.destination_latitude, trip.destination_longitude);
  driverMap = L.map(element, { zoomControl: false }).setView(origin || [4.6533, -74.0836], 16);
  L.control.zoom({ position: 'bottomleft' }).addTo(driverMap);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(driverMap);
  // Si el conductor mueve el mapa con la mano, se deja de seguir el carro.
  driverMap.on('dragstart', () => setDriverFollow(false));
  driverLayers = {};
  if (origin) driverLayers.origin = L.marker(origin, { icon: mapIcon('origin'), interactive: false }).addTo(driverMap);
  if (destination) driverLayers.destination = L.marker(destination, { icon: mapIcon('destination'), interactive: false }).addTo(driverMap);
  driverLayers.trail = L.polyline(driverTrail, { color: '#455A64', weight: 4, opacity: 0.45, dashArray: '2 8', lineCap: 'round' }).addTo(driverMap);
  setTimeout(() => driverMap?.invalidateSize(), 60);
}

// Activa o desactiva que la cámara siga al carro.
function setDriverFollow(value) {
  driverFollow = value;
  const button = document.querySelector('[data-action="driver-follow"]');
  if (button) {
    button.classList.toggle('active', value);
    button.setAttribute('aria-pressed', String(value));
  }
  if (value && driverPosition && driverMap) driverMap.setView(driverPosition, 17, { animate: true });
}

// Ajusta el mapa para ver toda la ruta.
function showRouteOverview() {
  if (!driverMap) return;
  setDriverFollow(false);
  const points = [driverPosition, ...(driverNav?.coordinates || []),
    driverLayers.origin?.getLatLng(), driverLayers.destination?.getLatLng()].filter(Boolean);
  if (points.length > 1) driverMap.fitBounds(L.latLngBounds(points), { padding: [70, 40], maxZoom: 17 });
}

// Alterna el mapa entre pantalla completa y normal.
function toggleDriverFullscreen() {
  const card = document.querySelector('#driver-map-card');
  if (!card) return;
  const full = card.classList.toggle('map-fullscreen');
  document.body.classList.toggle('no-scroll', full);
  setTimeout(() => driverMap?.invalidateSize(), 80);
}

/* ---------------------------------------------------------------------------
 * Ruta y giros (OSRM) → instrucciones en español
 * ------------------------------------------------------------------------- */

// Flechas para cada tipo de giro.
const TURN_ICONS = {
  left: '↰', 'slight left': '↖', 'sharp left': '↰', right: '↱', 'slight right': '↗', 'sharp right': '↱',
  straight: '↑', uturn: '↶',
};

// Traducción del giro: "a la derecha", "levemente a la izquierda"...
const TURN_TEXT = {
  left: 'a la izquierda', 'slight left': 'levemente a la izquierda', 'sharp left': 'fuerte a la izquierda',
  right: 'a la derecha', 'slight right': 'levemente a la derecha', 'sharp right': 'fuerte a la derecha',
  straight: 'derecho', uturn: 'en U',
};

// Convierte un paso de OSRM en una instrucción en español.
function stepInstruction(step) {
  const { type, modifier, exit } = step.maneuver;
  const turn = TURN_TEXT[modifier] || '';
  const street = step.name ? ` por ${step.name}` : '';
  if (type === 'arrive') return 'Llegas a tu destino';
  if (type === 'depart') return `Sal${street}`;
  if (type === 'roundabout' || type === 'rotary') return `En la glorieta, toma la ${exit ? `${exit}.ª ` : ''}salida${street}`;
  if (type === 'fork') return `Mantente ${turn}${street}`;
  if (type === 'merge') return `Incorpórate ${turn}${street}`;
  if (type === 'end of road') return `Al final de la vía, gira ${turn}${street}`;
  if (type === 'continue' || type === 'new name') return modifier === 'uturn' ? `Da la vuelta en U${street}` : `Continúa ${turn || 'derecho'}${street}`;
  if (modifier === 'uturn') return `Da la vuelta en U${street}`;
  return `Gira ${turn}${street}`;
}

// Pide la ruta con los giros. Si OSRM no responde, línea recta sin giros.
async function fetchNavRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('sin ruta');
    const route = (await response.json()).routes?.[0];
    if (!route) throw new Error('sin ruta');
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    // Distancia acumulada en cada punto de la ruta (para saber cuánto falta).
    const cumulative = [0];
    for (let i = 1; i < coordinates.length; i += 1) cumulative.push(cumulative[i - 1] + straightDistanceKm(coordinates[i - 1], coordinates[i]));
    // Cada paso empieza donde terminó el anterior.
    let start = 0;
    const steps = route.legs[0].steps.map((step) => {
      const item = { startKm: start, text: stepInstruction(step), icon: step.maneuver.type === 'arrive' ? '⚑' : (TURN_ICONS[step.maneuver.modifier] || '↑') };
      start += step.distance / 1000;
      return item;
    });
    return { coordinates, cumulative, steps, totalKm: route.distance / 1000, totalMin: route.duration / 60, road: true };
  } catch {
    const km = straightDistanceKm(from, to);
    return { coordinates: [from, to], cumulative: [0, km], steps: [{ startKm: 0, text: 'Dirígete al punto (ruta aproximada)', icon: '↑' }, { startKm: km, text: 'Llegas a tu destino', icon: '⚑' }], totalKm: km, totalMin: (km / 25) * 60, road: false };
  }
}

// ¿Cuánto de la ruta ya se recorrió (km)? Proyecta el carro sobre el tramo de
// calle más cercano (no solo el punto más cercano, que en cuadras largas se queda atrás).
function progressOnRoute(position) {
  if (!driverNav) return 0;
  const { coordinates, cumulative } = driverNav;
  if (coordinates.length < 2) return 0;
  // Aproximación plana: a esta escala (una ciudad) es suficiente.
  const scale = Math.cos((position[0] * Math.PI) / 180);
  let bestKm = 0;
  let bestDistance = Infinity;
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const dx = (b[1] - a[1]) * scale;
    const dy = b[0] - a[0];
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq ? (((position[1] - a[1]) * scale) * dx + (position[0] - a[0]) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const projected = [a[0] + dy * t, a[1] + (b[1] - a[1]) * t];
    const distance = straightDistanceKm(position, projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKm = cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t;
    }
  }
  driverNav.offRouteKm = bestDistance;
  return bestKm;
}

// Recalcula la ruta si cambió el destino, si pasó mucho tiempo o si el carro se desvió.
async function ensureNavRoute(trip) {
  const target = navTarget(trip);
  if (!target || !driverPosition || driverRouteLoading) return;
  const key = target.join(',');
  const stale = !driverNav || driverNav.key !== key
    || Date.now() - driverNav.fetchedAt > ROUTE_REFRESH_MS
    || (driverNav.offRouteKm || 0) > 0.06;
  if (!stale) return;
  driverRouteLoading = true;
  try {
    const route = await fetchNavRoute(driverPosition, target);
    // legKm = largo total del tramo desde que empezó (no cambia al recalcular),
    // así la barra de avance no vuelve a empezar cada vez que se recalcula la ruta.
    const legKm = driverNav?.key === key ? driverNav.legKm : route.totalKm;
    driverNav = { ...route, key, legKm: Math.max(legKm, route.totalKm), fetchedAt: Date.now(), offRouteKm: 0 };
    if (!driverMap) return;
    if (driverLayers.routeCasing) driverLayers.routeCasing.setLatLngs(route.coordinates);
    else driverLayers.routeCasing = L.polyline(route.coordinates, { color: '#263238', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(driverMap);
    if (driverLayers.route) driverLayers.route.setLatLngs(route.coordinates);
    else driverLayers.route = L.polyline(route.coordinates, { color: '#B0BEC5', weight: 6, lineCap: 'round', lineJoin: 'round' }).addTo(driverMap);
  } finally {
    driverRouteLoading = false;
  }
}

/* ---------------------------------------------------------------------------
 * Movimiento: GPS real o simulación
 * ------------------------------------------------------------------------- */

// Actualiza la posición del carro, el rumbo, el rastro y los km del viaje.
function moveDriverTo(point) {
  const state = driverState();
  if (driverPosition) {
    const step = straightDistanceKm(driverPosition, point);
    if (step > 0.002) driverHeading = (bearingBetween(driverPosition, point) + 90 + 360) % 360;
    if (state.trip?.status === 'in_progress') {
      saveDriverState({ trip: { ...state.trip, traveled_km: (state.trip.traveled_km || 0) + step } });
    }
  }
  driverPosition = point;
  driverTrail.push(point);
  if (driverTrail.length > 600) driverTrail.shift();
}

// Avanza el carro simulado un segundo por la ruta calculada.
function simulationStep(trip) {
  const origin = toPoint(trip.origin_latitude, trip.origin_longitude);
  // Posición inicial: un poco al norte de la recogida, como si viniera llegando.
  if (!driverPosition) {
    const start = trip.status === 'assigned' && origin ? [origin[0] + 0.011, origin[1] + 0.006] : origin || [4.6533, -74.0836];
    moveDriverTo(start);
    driverSpeedKmh = 0;
    return;
  }
  if (!driverNav || !navTarget(trip)) {
    driverSpeedKmh = 0;
    return;
  }
  const stepKm = (SIMULATION_SPEED_KMH / 3600) * (DRIVER_FRAME_MS / 1000);
  const done = Math.min(driverNav.totalKm, progressOnRoute(driverPosition) + stepKm);
  // Punto de la ruta que corresponde a la distancia recorrida.
  const { coordinates, cumulative } = driverNav;
  let index = cumulative.findIndex((value) => value >= done);
  if (index <= 0) index = index === 0 ? 0 : coordinates.length - 1;
  const before = coordinates[Math.max(0, index - 1)];
  const after = coordinates[index];
  const span = cumulative[index] - cumulative[Math.max(0, index - 1)] || 1;
  const ratio = Math.min(1, Math.max(0, (done - cumulative[Math.max(0, index - 1)]) / span));
  moveDriverTo([before[0] + (after[0] - before[0]) * ratio, before[1] + (after[1] - before[1]) * ratio]);
  driverSpeedKmh = done >= driverNav.totalKm ? 0 : SIMULATION_SPEED_KMH;
}

// Empieza a leer el GPS (o la simulación), redibujar cada segundo y enviar cada 5 s.
function startDriverLoops() {
  const state = driverState();
  driverLocationError = '';
  driverArrivedNotified = '';
  if (!state.simulate) {
    if (!navigator.geolocation) {
      switchToSimulation('Este navegador no tiene GPS. Se activó el recorrido simulado.');
      return;
    }
    driverGeoWatch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        moveDriverTo([coords.latitude, coords.longitude]);
        if (Number.isFinite(coords.heading)) driverHeading = coords.heading;
        driverSpeedKmh = Number.isFinite(coords.speed) ? coords.speed * 3.6 : driverSpeedKmh;
        driverLocationError = '';
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) switchToSimulation('No diste permiso de ubicación. Se activó el recorrido simulado.');
        else driverLocationError = 'no se pudo leer el GPS, reintentando…';
        updateLocationStatus();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }
  driverFrame();
  sendDriverLocation();
  driverFrameTimer = setInterval(driverFrame, DRIVER_FRAME_MS);
  driverSendTimer = setInterval(sendDriverLocation, DRIVER_LOCATION_MS);
}

// Cambia a modo simulado (por ejemplo, si el GPS no está disponible).
function switchToSimulation(message) {
  saveDriverState({ simulate: true });
  if (message) showToast(message, true);
  renderDriverTrip(driverState());
}

/* ---------------------------------------------------------------------------
 * Dibujo de cada segundo
 * ------------------------------------------------------------------------- */

// Formatea distancias para la instrucción: "350 m" o "1.2 km".
function formatDistance(km) {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(1)} km`;
}

// Cada segundo: mueve el carro, actualiza ruta, instrucción, tiempos y cámara.
async function driverFrame() {
  const { trip, simulate } = driverState();
  if (!trip || !driverMap) return;
  if (simulate) simulationStep(trip);
  if (!driverPosition) {
    updateLocationStatus();
    return;
  }
  await ensureNavRoute(trip);
  if (!driverMap) return;

  // Carro y rastro
  const bearing = driverHeading - 90; // carIcon() espera el ángulo del ícono ➤
  if (!driverLayers.car) driverLayers.car = L.marker(driverPosition, { icon: carIcon(bearing), zIndexOffset: 1000 }).addTo(driverMap);
  else {
    driverLayers.car.setIcon(carIcon(bearing));
    animateMarker(driverLayers.car, driverPosition, DRIVER_FRAME_MS * 0.9);
  }
  driverLayers.trail?.setLatLngs(driverTrail);
  if (driverFollow) driverMap.panTo(driverPosition, { animate: true, duration: 0.8 });

  // Velocímetro y km recorridos
  const speed = document.querySelector('#nav-speed');
  if (speed) speed.textContent = Math.round(driverSpeedKmh);
  const traveled = document.querySelector('#trip-traveled');
  if (traveled) traveled.textContent = `${(trip.traveled_km || 0).toFixed(1)} km`;

  updateNavPanel(trip);
}

// Actualiza la instrucción de giro, el tiempo, la distancia y la barra de avance.
function updateNavPanel(trip) {
  const set = (id, text) => { const element = document.querySelector(id); if (element) element.textContent = text; };
  const card = document.querySelector('#driver-map-card');

  if (trip.status === 'driver_arrived') {
    set('#nav-turn', '⚑');
    set('#nav-step-distance', 'Estás en la recogida');
    set('#nav-step-text', 'Cuando el cliente suba, toca “Iniciar viaje”.');
    ['#nav-eta-min', '#nav-remaining', '#nav-arrival'].forEach((id) => set(id, '—'));
    driverSpeedKmh = 0;
    return;
  }
  if (!driverNav) return;

  const done = progressOnRoute(driverPosition);
  const remainingKm = Math.max(0, driverNav.totalKm - done);
  const minutes = Math.max(remainingKm > ARRIVAL_RADIUS_KM ? 1 : 0, Math.round((remainingKm / Math.max(driverNav.totalKm, 0.001)) * driverNav.totalMin));
  const arrival = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.now() + minutes * 60000));

  // Próximo giro: el primer paso que empieza más adelante de donde va el carro.
  const next = driverNav.steps.find((step) => step.startKm > done + 0.005) || driverNav.steps[driverNav.steps.length - 1];
  const toNext = Math.max(0, next.startKm - done);

  set('#nav-turn', next.icon);
  set('#nav-step-distance', remainingKm <= ARRIVAL_RADIUS_KM ? '¡Llegaste!' : formatDistance(toNext));
  set('#nav-step-text', remainingKm <= ARRIVAL_RADIUS_KM
    ? (trip.status === 'assigned' ? 'Toca “Ya llegué” para avisarle al cliente.' : 'Toca “Finalizar viaje”.')
    : next.text);
  set('#nav-eta-min', String(minutes));
  set('#nav-remaining', remainingKm < 1 ? String(Math.round(remainingKm * 1000)) : remainingKm.toFixed(1));
  set('#nav-remaining-unit', remainingKm < 1 ? 'm' : 'km');
  set('#nav-arrival', arrival);
  const bar = document.querySelector('#nav-progress');
  if (bar) bar.style.width = `${Math.min(100, (1 - remainingKm / Math.max(driverNav.legKm || driverNav.totalKm, 0.001)) * 100)}%`;

  // Al llegar: resalta el botón de la siguiente acción y avisa una vez.
  const arrived = remainingKm <= ARRIVAL_RADIUS_KM;
  card?.classList.toggle('nav-arrived', arrived);
  document.querySelector('#trip-cta')?.classList.toggle('pulse', arrived);
  if (arrived && driverArrivedNotified !== trip.status) {
    driverArrivedNotified = trip.status;
    showToast(trip.status === 'assigned' ? 'Llegaste a la recogida. Avísale al cliente.' : 'Llegaste al destino. Finaliza el viaje.');
    navigator.vibrate?.([150, 80, 150]);
  }
}

/* ---------------------------------------------------------------------------
 * Envío de la ubicación al servidor (cada 5 s)
 * ------------------------------------------------------------------------- */

// POST /driver/location: así el cliente ve el carro moverse en su mapa.
async function sendDriverLocation() {
  const { trip } = driverState();
  if (!trip || !driverPosition || !document.querySelector('#driver-map')) {
    updateLocationStatus();
    return;
  }
  try {
    await request('/driver/location', {
      method: 'POST',
      body: JSON.stringify({
        latitude: Number(driverPosition[0].toFixed(6)),
        longitude: Number(driverPosition[1].toFixed(6)),
        heading: Number(driverHeading.toFixed(1)),
        speed: Number(driverSpeedKmh.toFixed(1)),
        trip_id: trip.id,
      }),
    });
    driverLastSent = Date.now();
    driverLocationError = '';
  } catch (error) {
    driverLocationError = `no se pudo enviar (${error.message})`;
  }
  updateLocationStatus();
}

// Texto del estado de la ubicación (fuente, último envío o error).
function updateLocationStatus() {
  const element = document.querySelector('#location-status');
  if (!element) return;
  const source = driverState().simulate ? 'Recorrido simulado' : 'GPS del dispositivo';
  if (driverLocationError) {
    element.className = 'location-status error';
    element.textContent = `${source}: ${driverLocationError}`;
  } else if (driverLastSent) {
    const seconds = Math.round((Date.now() - driverLastSent) / 1000);
    element.className = 'location-status ok';
    element.textContent = `${source} · enviada al servidor hace ${seconds} s`;
  } else {
    element.className = 'location-status';
    element.textContent = `${source} · esperando la primera posición…`;
  }
}

/* ---------------------------------------------------------------------------
 * Pasos del viaje
 * ------------------------------------------------------------------------- */

// POST /driver/trips/{id}/arrive | start y actualiza el estado local.
async function advanceTrip(step, button) {
  const { trip } = driverState();
  button.disabled = true;
  try {
    const result = await request(`/driver/trips/${encodeURIComponent(trip.id)}/${step}`, { method: 'POST', body: JSON.stringify({}) });
    const status = result.trip?.status || (step === 'arrive' ? 'driver_arrived' : 'in_progress');
    saveDriverState({ trip: { ...trip, status, ...(step === 'start' ? { started_at: new Date().toISOString(), traveled_km: 0 } : {}) } });
    driverNav = null;
    if (step === 'start') driverTrail = driverPosition ? [driverPosition] : [];
    showToast(result.message || 'Estado actualizado.');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
    return;
  }
  await renderDashboard();
}

// Ventana para finalizar: propone la distancia recorrida y los minutos transcurridos.
function openFinishModal() {
  const { trip } = driverState();
  const minutes = trip.started_at ? Math.max(1, Math.round((Date.now() - new Date(trip.started_at).getTime()) / 60000)) : 5;
  const km = Math.max(0.1, Number((trip.traveled_km || trip.estimated_distance_km || 1).toFixed(2)));
  openModal(`
    <h2 id="modal-title">Finalizar viaje</h2>
    <p class="muted">Confirma los datos reales del recorrido. Con ellos el servidor calcula la tarifa definitiva.</p>
    <form id="finish-form">
      <div class="form-row">
        ${inputField('Distancia recorrida (km)', 'actual_distance_km', 'number', { required: true, min: 0.1, step: '0.01' })}
        ${inputField('Duración (minutos)', 'actual_duration_min', 'number', { required: true, min: 1, step: '1' })}
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">Volver</button><button type="submit" class="btn btn-success">Finalizar</button></div>
    </form>`, 'modal-title');
  document.querySelector('#actual_distance_km').value = km;
  document.querySelector('#actual_duration_min').value = minutes;
}

// POST /driver/trips/{id}/complete, guarda la ganancia y vuelve a las solicitudes.
async function finishTrip(form) {
  const { trip } = driverState();
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const body = { actual_distance_km: Number(values.actual_distance_km), actual_duration_min: Number(values.actual_duration_min) };
    const result = await request(`/driver/trips/${encodeURIComponent(trip.id)}/complete`, { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    const fare = result.trip?.final_fare ?? trip.estimated_fare;
    addDriverEarning({ trip_id: trip.id, fare, km: body.actual_distance_km, completed_at: new Date().toISOString() });
    // Según la API, al finalizar el conductor vuelve a quedar disponible.
    saveDriverState({ trip: null, availability: 'available' });
    stopDriverLoops();
    driverPosition = null;
    driverNav = null;
    driverTrail = [];
    document.body.classList.remove('no-scroll');
    showToast(`Viaje finalizado. Tarifa: ${money(fare)}`);
    await renderDashboard();
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

/* ---------------------------------------------------------------------------
 * Eventos del panel del conductor
 * ------------------------------------------------------------------------- */

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || sessionUser?.role !== 'driver') return;
  const action = target.dataset.action;
  try {
    if (action === 'driver-availability') await setDriverAvailability(target.dataset.status);
    else if (action === 'driver-refresh') await renderDashboard();
    else if (action === 'driver-accept') await acceptRide(target);
    else if (action === 'driver-trip') await advanceTrip(target.dataset.step, target);
    else if (action === 'driver-finish') openFinishModal();
    else if (action === 'driver-follow') setDriverFollow(!driverFollow);
    else if (action === 'driver-overview') showRouteOverview();
    else if (action === 'driver-fullscreen') toggleDriverFullscreen();
    else if (action === 'driver-location-mode') {
      saveDriverState({ simulate: target.dataset.mode === 'sim' });
      driverNav = null;
      renderDriverTrip(driverState());
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'finish-form' || sessionUser?.role !== 'driver') return;
  event.preventDefault();
  await finishTrip(event.target);
});

// Esc sale de la pantalla completa del mapa.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.querySelector('.map-fullscreen')) toggleDriverFullscreen();
});

// El reloj de "enviada hace X s" se actualiza cada segundo.
setInterval(() => { if (sessionUser?.role === 'driver') updateLocationStatus(); }, 1000);
