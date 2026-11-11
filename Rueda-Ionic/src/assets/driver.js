/*
 * ============================================================================
 *  RUEDA · PANEL DEL CONDUCTOR
 * ============================================================================
 *  Todo lo del rol "driver":
 *    - Ponerse en línea / fuera de línea.
 *    - Ver solicitudes pendientes (se actualizan solas) y aceptarlas.
 *    - Llevar el viaje paso a paso: Ya llegué → Iniciar → Finalizar.
 *    - Enviar la ubicación al servidor cada 5 s para que el cliente vea el
 *      carro moverse en su mapa (GPS real o recorrido simulado).
 *
 *  Endpoints usados (ver API_DOCUMENTATION.md del profesor):
 *    PUT  /driver/availability              { status: available | unavailable }
 *    GET  /driver/ride-requests
 *    POST /driver/ride-requests/{id}/accept → { trip }
 *    POST /driver/trips/{id}/arrive | start | complete
 *    POST /driver/location                  { latitude, longitude, heading, speed, trip_id }
 *
 *  IMPORTANTE: la API NO tiene un endpoint para consultar el viaje activo del
 *  conductor ni su disponibilidad. Por eso este panel guarda en sessionStorage
 *  (por pestaña) el viaje aceptado y si está en línea. Si se cierra la pestaña
 *  en medio de un viaje, se pierde ese dato local (el viaje sigue en el servidor).
 *
 *  Se carga antes que app.js y usa sus funciones (request, escapeHtml, money,
 *  statusBadge, openModal, initActiveRideMap, drawActiveRide, fetchRoadRoute...).
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 * Estado del conductor
 * ------------------------------------------------------------------------- */

// Llave de sessionStorage con el estado local del conductor.
const DRIVER_STATE_KEY = 'rueda_driver_state';
// Cada cuánto se envía la ubicación al servidor (milisegundos).
const DRIVER_LOCATION_MS = 5000;
// Cada cuánto se buscan nuevas solicitudes cuando está en línea.
const DRIVER_REQUESTS_MS = 8000;
// Distancia que avanza el carro simulado en cada envío (km). ~0.15 km / 5 s ≈ 108 km/h,
// rápido a propósito para que la demostración no tarde mucho.
const SIMULATION_STEP_KM = 0.15;

// Pasos del viaje para la barra de progreso.
const TRIP_STEPS = [
  ['assigned', 'Aceptado'],
  ['driver_arrived', 'En recogida'],
  ['in_progress', 'En curso'],
  ['completed', 'Finalizado'],
];

let driverRequestsTimer = null; // temporizador de solicitudes
let driverLocationTimer = null; // temporizador de envío de ubicación
let driverGeoWatch = null; // id de navigator.geolocation.watchPosition
let driverPosition = null; // última posición conocida [lat, lng]
let driverHeading = 0; // rumbo en grados (para el servidor)
let driverLastSent = null; // hora del último envío exitoso
let driverLocationError = ''; // último error al enviar o leer el GPS
let driverSimRoute = null; // { target, coordinates } ruta que sigue la simulación
let driverRequestsCache = []; // últimas solicitudes mostradas
let driverKnownRequestIds = new Set(); // para avisar cuando llega una nueva

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

// Detiene temporizadores y GPS (app.js lo llama antes de cambiar de pantalla).
function stopDriverLoops() {
  clearInterval(driverRequestsTimer);
  clearInterval(driverLocationTimer);
  driverRequestsTimer = null;
  driverLocationTimer = null;
  if (driverGeoWatch !== null && navigator.geolocation) navigator.geolocation.clearWatch(driverGeoWatch);
  driverGeoWatch = null;
}

/* ---------------------------------------------------------------------------
 * Pantalla principal
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
    if (fresh.length) showToast(fresh.length === 1 ? '¡Nueva solicitud de viaje!' : `¡${fresh.length} solicitudes nuevas!`);
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
  // se buscan a partir del nombre de la dirección.
  // Las dos búsquedas se hacen al tiempo para que aceptar sea rápido.
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
  driverSimRoute = null;
  showToast(result.message || 'Viaje aceptado. Ve a recoger al cliente.');
  await renderDashboard();
}

/* ---------------------------------------------------------------------------
 * Viaje en curso
 * ------------------------------------------------------------------------- */

// Barra de progreso del viaje.
function tripStepper(status) {
  const current = TRIP_STEPS.findIndex(([key]) => key === status);
  return `<ol class="trip-stepper">${TRIP_STEPS.map(([key, label], index) => `
    <li class="${index < current ? 'done' : index === current ? 'current' : ''}"><span>${index < current ? '✓' : index + 1}</span>${label}</li>`).join('')}</ol>`;
}

// Botón grande con la siguiente acción según el estado.
function nextTripAction(trip) {
  if (trip.status === 'assigned') return `<button class="btn btn-warning-solid full-width trip-cta" data-action="driver-trip" data-step="arrive">Ya llegué al punto de recogida</button>`;
  if (trip.status === 'driver_arrived') return `<button class="btn btn-primary full-width trip-cta" data-action="driver-trip" data-step="start">Iniciar viaje →</button>`;
  if (trip.status === 'in_progress') return `<button class="btn btn-success full-width trip-cta" data-action="driver-finish">Finalizar viaje ✓</button>`;
  return '';
}

// "Viaje" con la forma que esperan las funciones del mapa en vivo de app.js.
function driverTripForMap(trip) {
  return {
    ...trip,
    driver: driverPosition ? { latest_location: { latitude: driverPosition[0], longitude: driverPosition[1] } } : null,
  };
}

// Pantalla del viaje en curso: mapa, pasos, cliente, ubicación y siguiente acción.
function renderDriverTrip(state) {
  const { trip } = state;
  const clientName = trip.client?.name || trip.client?.user?.name || 'Cliente';
  const clientPhone = trip.client?.phone || trip.client?.user?.phone;
  app.innerHTML = `
    <section class="driver-hero is-online">
      <div>
        <p class="admin-kicker"><span></span> VIAJE #${escapeHtml(trip.id)}</p>
        <h1>${escapeHtml({ assigned: 'Ve a recoger al cliente', driver_arrived: 'Espera al cliente', in_progress: 'Lleva al cliente a su destino' }[trip.status] || 'Viaje en curso')}</h1>
        <p class="admin-date">El cliente ve tu ubicación en tiempo real.</p>
      </div>
      ${statusBadge(trip.status)}
    </section>
    ${tripStepper(trip.status)}
    <div class="admin-grid driver-trip-grid">
      <section class="card admin-card driver-map-card">
        <div class="live-map-wrap">
          <div id="active-map" class="active-map driver-map" role="application" aria-label="Mapa del viaje"></div>
          <div class="nav-banner" id="nav-banner" aria-live="polite"><span class="nav-banner-icon" aria-hidden="true">➤</span><div><strong id="nav-eta">Ubicándote…</strong><span id="nav-detail">Activando la ubicación</span></div></div>
          <button type="button" class="map-follow-button active" data-action="toggle-follow" aria-pressed="true">◎ Seguir</button>
        </div>
      </section>
      <div class="stack">
        <section class="card admin-card">
          <div class="route-summary">${tripPath(trip.origin_name, trip.destination_name)}</div>
          <div class="driver-summary"><span class="driver-avatar" aria-hidden="true">${escapeHtml(initials(clientName))}</span><div><strong>${escapeHtml(clientName)}</strong><span>${escapeHtml(clientPhone || 'Cliente')}</span></div>${clientPhone ? `<a class="btn btn-outline btn-small driver-call" href="tel:${escapeHtml(clientPhone)}">Llamar</a>` : ''}</div>
          <div class="active-ride-bottom"><div><span class="inline-meta">Valor estimado</span><strong class="fare-value">${money(trip.estimated_fare)}</strong></div></div>
          ${nextTripAction(trip)}
        </section>
        <section class="card admin-card location-card">
          <div class="admin-card-head"><div><p class="eyebrow">TU UBICACIÓN</p><h2>Compartiendo con el cliente</h2></div></div>
          <div class="location-mode" role="group" aria-label="Fuente de la ubicación">
            <button class="filter-chip ${!state.simulate ? 'active' : ''}" data-action="driver-location-mode" data-mode="gps" aria-pressed="${!state.simulate}">◎ GPS real</button>
            <button class="filter-chip ${state.simulate ? 'active' : ''}" data-action="driver-location-mode" data-mode="sim" aria-pressed="${state.simulate}">▶ Simular recorrido</button>
          </div>
          <p class="location-status" id="location-status">Preparando…</p>
          <p class="field-hint">Si el computador no tiene GPS, usa “Simular recorrido”: el carro avanza solo por las calles hasta la recogida y luego al destino.</p>
        </section>
      </div>
    </div>`;

  initActiveRideMap(driverTripForMap(trip));
  startLocationSharing();
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
 * Ubicación: GPS real o recorrido simulado
 * ------------------------------------------------------------------------- */

// Empieza a leer la posición y a enviarla al servidor cada 5 s.
function startLocationSharing() {
  stopDriverLoops();
  const state = driverState();
  driverLocationError = '';
  if (!state.simulate) {
    if (!navigator.geolocation) {
      switchToSimulation('Este navegador no tiene GPS. Se activó el recorrido simulado.');
      return;
    }
    driverGeoWatch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        moveDriverTo([coords.latitude, coords.longitude]);
        if (Number.isFinite(coords.heading)) driverHeading = coords.heading;
        driverLocationError = '';
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) switchToSimulation('No diste permiso de ubicación. Se activó el recorrido simulado.');
        else driverLocationError = 'no se pudo leer el GPS, reintentando…';
        updateLocationStatus();
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
  }
  locationTick();
  driverLocationTimer = setInterval(locationTick, DRIVER_LOCATION_MS);
}

// Cambia a modo simulado (por ejemplo, si el GPS no está disponible).
function switchToSimulation(message) {
  saveDriverState({ simulate: true });
  if (message) showToast(message, true);
  renderDriverTrip(driverState());
}

// Actualiza la posición del conductor y suma la distancia recorrida en el viaje.
function moveDriverTo(point) {
  const state = driverState();
  if (driverPosition && state.trip?.status === 'in_progress') {
    saveDriverState({ trip: { ...state.trip, traveled_km: (state.trip.traveled_km || 0) + straightDistanceKm(driverPosition, point) } });
  }
  if (driverPosition) driverHeading = (bearingBetween(driverPosition, point) + 90 + 360) % 360;
  driverPosition = point;
}

// Avanza el carro simulado por la ruta real (OSRM) hacia el siguiente punto.
async function simulationStep(trip) {
  const origin = toPoint(trip.origin_latitude, trip.origin_longitude);
  const destination = toPoint(trip.destination_latitude, trip.destination_longitude);
  // Posición inicial: un poco al norte de la recogida, como si viniera llegando.
  if (!driverPosition) {
    driverPosition = origin ? [origin[0] + 0.011, origin[1] + 0.006] : [4.6533, -74.0836];
    if (trip.status !== 'assigned' && origin) driverPosition = origin;
  }
  const target = trip.status === 'assigned' ? origin : trip.status === 'in_progress' ? destination : null;
  if (!target) return; // En recogida: el carro se queda quieto.
  const key = target.join(',');
  if (!driverSimRoute || driverSimRoute.target !== key) {
    const route = await fetchRoadRoute(driverPosition, target);
    driverSimRoute = { target: key, coordinates: route.coordinates.slice() };
  }
  // Recorre la ruta hasta completar SIMULATION_STEP_KM.
  let budget = SIMULATION_STEP_KM;
  let current = driverPosition;
  const path = driverSimRoute.coordinates;
  while (path.length && budget > 0) {
    const next = path[0];
    const segment = straightDistanceKm(current, next);
    if (segment <= budget) {
      budget -= segment;
      current = path.shift();
    } else {
      const ratio = budget / segment;
      current = [current[0] + (next[0] - current[0]) * ratio, current[1] + (next[1] - current[1]) * ratio];
      budget = 0;
    }
  }
  moveDriverTo(current);
}

// Cada 5 s: (si simula) avanza, envía POST /driver/location y redibuja el mapa.
async function locationTick() {
  const state = driverState();
  const trip = state.trip;
  if (!trip || !document.querySelector('#active-map')) return;
  if (state.simulate) await simulationStep(trip);
  if (driverPosition) {
    try {
      await request('/driver/location', {
        method: 'POST',
        body: JSON.stringify({
          latitude: Number(driverPosition[0].toFixed(6)),
          longitude: Number(driverPosition[1].toFixed(6)),
          heading: Number(driverHeading.toFixed(1)),
          speed: state.simulate ? 30 : 0,
          trip_id: trip.id,
        }),
      });
      driverLastSent = Date.now();
      driverLocationError = '';
    } catch (error) {
      driverLocationError = `no se pudo enviar (${error.message})`;
    }
    await drawActiveRide(driverTripForMap(driverState().trip));
  }
  updateLocationStatus();
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
    driverSimRoute = null;
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

// POST /driver/trips/{id}/complete y vuelve a la lista de solicitudes.
async function finishTrip(form) {
  const { trip } = driverState();
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await request(`/driver/trips/${encodeURIComponent(trip.id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ actual_distance_km: Number(values.actual_distance_km), actual_duration_min: Number(values.actual_duration_min) }),
    });
    closeModal();
    // Según la API, al finalizar el conductor vuelve a quedar disponible.
    saveDriverState({ trip: null, availability: 'available' });
    stopDriverLoops();
    driverPosition = null;
    driverSimRoute = null;
    const fare = result.trip?.final_fare;
    showToast(fare !== undefined ? `Viaje finalizado. Tarifa: ${money(fare)}` : (result.message || 'Viaje finalizado.'));
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
    else if (action === 'driver-location-mode') {
      saveDriverState({ simulate: target.dataset.mode === 'sim' });
      driverSimRoute = null;
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

// El reloj de "enviada hace X s" se actualiza cada segundo.
setInterval(() => { if (sessionUser?.role === 'driver') updateLocationStatus(); }, 1000);
