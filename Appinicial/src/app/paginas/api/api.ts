import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Data } from '../../services/data';

@Component({
  selector: 'app-api',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './api.html',
  styleUrl: './api.css',
})
export class Api implements OnInit {
  personajes: any[] = [];
  cargando: boolean = true; // Controla el estado de la petición

  constructor(private data: Data) {}

  ngOnInit(): void {
    this.obtenerDatos();
  }

  obtenerDatos(): void {
    this.cargando = true;
    this.data.obtenerPersonajes().subscribe({
      next: (response: any) => {
        this.personajes = response?.results || [];
        this.cargando = false; // Finaliza la carga con éxito
      },
      error: (err) => {
        console.error('Error cargando personajes:', err);
        this.cargando = false; // Finaliza la carga aun si ocurre un error
      },
    });
  }

  eliminarPersonaje(id: number): void {
    if (id === undefined || id === null) return;
    this.personajes = this.personajes.filter((personaje) => personaje.id !== id);
  }
}
