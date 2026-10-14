export interface UserPhoto {
    filepath: string;
    webPath?: string;
    format: string;
}

export interface PokemonInfo {
    id: number;
    name: string;
    image: string | null;
    types: string[];
    stats: { name: string; value: number }[];
    confidence?: number;
}
