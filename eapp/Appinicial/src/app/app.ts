import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgFor } from '@angular/common';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, FormsModule, NgFor],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App {
  protected readonly title = signal('Appinicial');
  nuevaTarea: string = '';
  tareas: string[] = [];

  agregarTarea(): void {
    const tarea = this.nuevaTarea.trim();
    if (tarea) {
      this.tareas.push(tarea);
      this.nuevaTarea = '';
    }
  }

  eliminarTarea(index: number) {
    this.tareas.splice(index, 1);
  }

}
