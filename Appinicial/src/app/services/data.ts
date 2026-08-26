import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})

export class Data {
  constructor(private http: HttpClient) {}
  urlBase: string = 'https://rickandmortyapi.com/api/character'; 

  obtenerPersonajes() {
    return this.http.get(this.urlBase);
  }
}