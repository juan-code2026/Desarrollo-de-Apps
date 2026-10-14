import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PokemonInfo } from '../Models/photo.model';

interface PokemonApiResponse {
  id: number;
  name: string;
  sprites: { front_default: string | null };
  types: { type: { name: string } }[];
  stats: { base_stat: number; stat: { name: string } }[];
}

@Injectable({ providedIn: 'root' })
export class PokedexService {
  private readonly http = inject(HttpClient);

  /**
   * Consulta PokéAPI con el nombre predicho localmente y adapta su respuesta
   * al formato usado por la pantalla.
   */
  async getPokemon(nameOrId: string): Promise<PokemonInfo> {
    const identifier = encodeURIComponent(nameOrId.trim().toLowerCase());
    const pokemon = await firstValueFrom(
      // Este servicio solo pide datos públicos; nunca recibe ni sube la fotografía.
      this.http.get<PokemonApiResponse>(
        `https://pokeapi.co/api/v2/pokemon/${identifier}`,
      ),
    );

    return {
      id: pokemon.id,
      name: pokemon.name,
      image: pokemon.sprites.front_default,
      types: pokemon.types.map(({ type }) => type.name),
      stats: pokemon.stats.map(({ base_stat, stat }) => ({
        name: stat.name,
        value: base_stat,
      })),
    };
  }
}