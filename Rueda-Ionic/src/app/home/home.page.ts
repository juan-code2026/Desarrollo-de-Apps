import { AfterViewInit, Component } from '@angular/core';

/**
 * Página única de Rueda.
 * La interfaz se construye con JavaScript plano (src/assets/*.js) que pinta
 * el contenido dentro de #main-content. Aquí solo se cargan esos scripts.
 */
@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements AfterViewInit {
  /**
   * Scripts a cargar, en orden:
   *  1. admin.js → panel de administrador (debe existir antes de que app.js arranque).
   *  2. driver.js → panel del conductor.
   *  3. app.js   → sesión, panel de cliente y arranque de la app.
   */
  private readonly scripts = ['assets/admin.js', 'assets/driver.js', 'assets/app.js'];

  ngAfterViewInit(): void {
    this.loadScripts(this.scripts);
  }

  /** Carga los scripts uno por uno para respetar el orden. */
  private loadScripts([next, ...rest]: string[]): void {
    if (!next) return;
    const script = document.createElement('script');
    script.src = next;
    script.onload = () => this.loadScripts(rest);
    script.onerror = () => this.showLoadError();
    document.body.appendChild(script);
  }

  /** Mensaje si algún script no carga (por ejemplo, si el servidor se detuvo). */
  private showLoadError(): void {
    const content = document.querySelector('#main-content');
    if (content) {
      content.innerHTML = '<section class="card section-card"><h2>No se pudo iniciar la aplicación</h2><p class="muted">Recarga la página. Si el problema continúa, ejecuta de nuevo el servidor de desarrollo.</p></section>';
    }
  }
}
