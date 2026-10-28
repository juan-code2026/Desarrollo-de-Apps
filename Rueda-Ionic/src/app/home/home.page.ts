import { AfterViewInit, Component } from '@angular/core';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements AfterViewInit {
  ngAfterViewInit(): void {
    const script = document.createElement('script');
    script.src = 'assets/app.js';
    script.defer = true;
    script.onerror = () => {
      const content = document.querySelector('#main-content');
      if (content) {
        content.innerHTML = '<section class="card section-card"><h2>No se pudo iniciar la aplicación</h2><p class="muted">Recarga la página. Si el problema continúa, ejecuta de nuevo el servidor de desarrollo.</p></section>';
      }
    };
    document.body.appendChild(script);
  }
}
