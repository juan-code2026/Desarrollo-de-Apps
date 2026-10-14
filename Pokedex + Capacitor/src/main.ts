import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from
'@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { provideHttpClient } from '@angular/common/http';
// IMPORTACIÓN DE PWA ELEMENTS
import { defineCustomElements } from '@ionic/pwa-elements/loader';
import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
// REGISTRO DE ELEMENTOS EN EL OBJETO WINDOW
defineCustomElements(window);
bootstrapApplication(AppComponent, {
providers: [
{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
provideIonicAngular(),
provideHttpClient(),
provideRouter(routes, withPreloading(PreloadAllModules)),
],
}).catch(err => console.error(err));