# Rueda — aplicación Ionic Angular

Aplicación Ionic Angular que consume la API Laravel descrita en `API_DOCUMENTATION.md`. Incluye pantallas para clientes, conductores y administradores.

## Requisitos

- Node.js y npm.
- Ionic CLI (`npm install -g @ionic/cli`).
- Backend ejecutándose y accesible desde el navegador.

## Iniciar el frontend

```powershell
npm install
npm start
```

La URL inicial configurada es `http://20.20.1.22:8000/api`. Si cambia o necesitas usar otra dirección, abre **Configuración de conexión** en la pantalla de inicio y guarda la URL base de la API.

Tu computador debe tener acceso a la red del servidor. La API debe permitir CORS desde el origen del frontend. Si no se puede conectar, verifica que el servidor esté encendido, que la URL incluya `/api` y que el backend tenga habilitado CORS para el frontend.

### Probar el panel de cliente sin el servidor

En la pantalla de inicio de sesión, pulsa **Entrar a la demo de cliente**. El modo demo usa información ficticia y cálculos locales para probar el panel, cotizar rutas, crear/cancelar solicitudes y calificar el viaje de ejemplo. No llama a la API. Sus cambios se guardan solo en la sesión actual del navegador y se borran al cerrar la pestaña.

Para compilar la aplicación móvil con Capacitor, usa `ionic build` y luego agrega la plataforma requerida con `npx cap add android` o `npx cap add ios`.

## Descargar para colaborar

Clona la rama publicada que contiene el proyecto:

```powershell
git clone --branch feat/rueda-ionic-frontend https://github.com/juan-code2026/Desarrollo-de-Apps.git
cd Desarrollo-de-Apps\Rueda-Ionic
npm install
npm start
```

La app está en `Rueda-Ionic` para no interferir con los otros proyectos del repositorio. Abre esa carpeta en VS Code para usar las tareas de Ionic.

Para compartir cambios en la misma rama:

```powershell
git pull
git add .
git commit -m "Describe el cambio"
git push
```

Si van a trabajar en paralelo, cada persona puede crear una rama propia:

```powershell
git switch -c feat/descripcion-del-cambio
git add .
git commit -m "Describe el cambio"
git push -u origin feat/descripcion-del-cambio
```

Después, abran un pull request hacia `feat/rueda-ionic-frontend`.

### Probar el panel de administrador sin el servidor

En la pantalla de inicio de sesión, pulsa **Demo de administrador**. Verás el resumen con KPIs y gráficas, la revisión de conductores (aprobar, rechazar y suspender), las tarifas con vista previa del precio, los viajes con filtros, los reportes y la auditoría, todo con datos ficticios.

## Prueba en dos computadores (cliente ↔ conductor)

Cada computador corre su propia copia de la app y los dos se conectan al mismo servidor del profesor (`http://20.20.1.22:8000/api`). El servidor es el que comunica a cliente y conductor.

**Antes de empezar (en los dos computadores):**

1. Conectarse a la red donde está el servidor del profesor.
2. `git pull` en la rama `feat/rueda-ionic-frontend`, luego `npm install` y `npm start`.
3. Abrir `http://localhost:4200`. Si la app no conecta, revisar en **Configuración de conexión** que la URL sea `http://20.20.1.22:8000/api`.
4. Usar dos navegadores o dos computadores distintos: la sesión se guarda por pestaña, así que no se pisan.

**Flujo de la prueba:**

| Paso | Computador del cliente | Computador del conductor | Qué endpoint lo hace |
|---|---|---|---|
| 1 | Inicia sesión como cliente | Inicia sesión como conductor **aprobado** y se pone **en línea** | `POST /auth/login` · `PUT /driver/availability` |
| 2 | Elige recogida y destino, **Calcular tarifa** y **Pedir viaje** | — | `POST /client/estimate-fare` · `POST /client/ride-requests` |
| 3 | Ve "Buscando conductor…" | Ve la solicitud y la **acepta** | `GET /driver/ride-requests` · `POST /driver/ride-requests/{id}/accept` |
| 4 | En máximo 5 s ve "Conductor asignado", el carro en el mapa y el tiempo de llegada | Envía su ubicación GPS cada pocos segundos | `GET /client/active` · `POST /driver/location` |
| 5 | Ve "Tu conductor llegó" | Marca **Ya llegué** | `POST /driver/trips/{id}/arrive` |
| 6 | Ve "En curso" y el carro avanzando al destino | **Inicia** el viaje | `POST /driver/trips/{id}/start` |
| 7 | Recibe "¡Llegaste!" y puede **calificar** desde el historial | **Finaliza** el viaje | `POST /driver/trips/{id}/complete` · `POST /client/trips/{id}/rating` |

**Importante para el panel del conductor:** el mapa del cliente solo se mueve si el conductor envía su ubicación con `POST /driver/location` (incluyendo `trip_id`) mientras tiene un viaje asignado o en curso. Por ejemplo, con `navigator.geolocation.watchPosition` cada 5 segundos. Si no la envía, el cliente verá "Esperando la ubicación GPS del conductor…".

**Qué hace el panel del cliente durante la prueba:** consulta `GET /client/active` cada 5 segundos y avisa cada cambio de estado. Recuerda el origen y el destino que pidió, porque la API deja de enviarlos cuando hay conductor asignado. Si la sesión vence, vuelve al inicio de sesión.

## Estructura del código

| Archivo | Qué contiene |
|---|---|
| `src/assets/app.js` | Sesión, inicio de sesión/registro, panel de cliente (mapa, viaje en vivo, autocompletado) y panel de conductor. |
| `src/assets/admin.js` | Todo el panel de administrador y su modo demo. Se carga antes que `app.js`. |
| `src/assets/styles.css` | Estilos generales y del cliente. |
| `src/assets/admin.css` | Estilos del panel de administrador. |
| `src/app/home/home.page.ts` | Carga los scripts en orden. |

El código está comentado en español: cada sección y cada función tiene una explicación de lo que hace.

## Funcionalidades conectadas

- **Todos:** inicio de sesión, registro y cierre de sesión. El registro permite crear clientes o conductores; no se permite el autorregistro de administradores.
- **Cliente:** cálculo de tarifa, solicitud y cancelación de viajes, viaje activo, ubicación del conductor en OpenStreetMap, historial y calificaciones.
- **Conductor:** disponibilidad, solicitudes pendientes, aceptar un viaje y marcar llegada, inicio y finalización.
- **Administrador:** resumen, revisión y aprobación de conductores, creación de tarifas, filtros de viajes, reportes y registros de auditoría.

El JWT se conserva en `sessionStorage` durante la sesión de la pestaña. La dirección del backend se guarda en `localStorage`.

## Notas para la integración

- Los nombres y payloads enviados siguen los ejemplos de `API_DOCUMENTATION.md`.
- La documentación no describe un endpoint para consultar el viaje activo del conductor. La interfaz intenta `GET /driver/active`; si el backend no lo implementa, las solicitudes y demás acciones siguen disponibles, pero el viaje en curso del conductor requiere que el profesor agregue/documente ese endpoint.
- La documentación tampoco especifica la forma de la respuesta de reportes y auditoría; la interfaz admite las estructuras de lista habituales de Laravel y muestra una respuesta alternativa cuando el reporte no contiene campos tabulares conocidos.
- El panel de cliente incluye un mapa interactivo de OpenStreetMap: haz clic para colocar los puntos de recogida y destino, arrastra los marcadores para ajustarlos o usa la ubicación del dispositivo. El mapa requiere conexión a internet para cargar sus mosaicos; la ubicación del dispositivo solo se consulta cuando pulsas el botón y autorizas al navegador.
- **Viaje en vivo (estilo navegación):** mientras el cliente tiene un viaje activo, el panel consulta `GET /client/active` cada 5 s y mueve el carro del conductor en el mapa. Muestra la ruta por calles reales (servicio público OSRM de OpenStreetMap), el tiempo y la distancia restantes y la hora estimada de llegada. El botón **Seguir** centra la cámara en el conductor. Si OSRM no responde, se dibuja una línea recta aproximada.
- La cancelación y la calificación usan ventanas propias: motivo de cancelación, estrellas, comentario y reporte de incidencia (`has_incident`).
- En el modo demo, un conductor ficticio se asigna a los pocos segundos y recorre el trayecto hasta el destino para probar el seguimiento en vivo.
- En el modo demo, el mapa y la selección de puntos funcionan sin el backend; las solicitudes y demás datos siguen siendo locales y ficticios.
