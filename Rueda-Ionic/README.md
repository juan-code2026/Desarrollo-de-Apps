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

La URL inicial configurada es `http://20.20.1.157:8000/api`. Si cambia o necesitas usar otra dirección, abre **Configuración de conexión** en la pantalla de inicio y guarda la URL base de la API.

Tu computador debe tener acceso a la red del servidor. La API debe permitir CORS desde el origen del frontend. Si no se puede conectar, verifica que el servidor esté encendido, que la URL incluya `/api` y que el backend tenga habilitado CORS para el frontend.

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
- No se incluye un mapa embebido ni geocodificación: el formulario permite indicar las coordenadas y ofrece enlaces a OpenStreetMap.
