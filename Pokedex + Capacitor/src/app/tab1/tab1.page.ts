import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonGrid, IonRow, IonCol, IonImg, IonFab,
  IonFabButton, IonIcon, IonCard, IonButton,
  IonItem, IonLabel, IonToggle, IonSpinner, ToastController
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { camera, trashOutline, sparkles, flashOffOutline } from 'ionicons/icons';
import { PhotoService } from '../services/photo.service';
import { PokedexService } from '../services/pokedex.service';
import {
  PokemonRecognitionService,
  RecognitionResult,
} from '../services/pokemon-recognition.service';
import { PokemonInfo } from '../Models/photo.model';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonGrid, IonRow, IonCol, IonImg, IonFab,
    IonFabButton, IonIcon, IonCard, IonButton,
    IonItem, IonLabel, IonToggle, IonSpinner
  ]
})
export class Tab1Page {
  public photoService = inject(PhotoService);
  private toastController = inject(ToastController);
  private pokedexService = inject(PokedexService);
  private pokemonRecognition = inject(PokemonRecognitionService);
  public isHighDef = signal<boolean>(false);
  public pokemonByPhoto = signal<Record<string, PokemonInfo>>({});
  public recognizingPhotos = signal<Record<string, boolean>>({});
  public recognitionErrors = signal<Record<string, string>>({});

  constructor() {
    addIcons({ camera, trashOutline, sparkles, flashOffOutline });
  }

  toggleQuality(enabled: boolean): void {
    this.isHighDef.set(enabled);
  }

  async takePhoto(): Promise<void> {
    const result = await this.photoService.takeNewPhoto(this.isHighDef());
    if (result.success && result.photo) {
      // La captura inicia en cadena inferencia local y consulta posterior de estadísticas.
      await this.recognizePokemon(result.photo.filepath, result.photo.webPath);
    }
    if (!result.success && result.reason === 'permission_denied') {
      await this.showPermissionWarningToast();
    }
  }

  async recognizePokemon(photoPath: string, imagePath?: string): Promise<void> {
    this.recognizingPhotos.update((photos) => ({ ...photos, [photoPath]: true }));
    this.recognitionErrors.update((errors) => {
      const { [photoPath]: _removed, ...remaining } = errors;
      return remaining;
    });

    if (!imagePath) {
      this.setRecognitionError(photoPath, 'No se pudo abrir la foto para analizarla.');
      this.finishRecognition(photoPath);
      return;
    }

    let recognition: RecognitionResult | null;
    try {
      // Primera fase: el clasificador analiza la imagen en el propio dispositivo.
      recognition = await this.pokemonRecognition.recognize(imagePath);
    } catch (error) {
      console.error('Falló el reconocimiento local del Pokémon:', error);
      this.setRecognitionError(
        photoPath,
        'No se pudo iniciar el reconocimiento local. Comprueba que la aplicación tenga descargado el modelo y vuelve a intentarlo.',
      );
      this.finishRecognition(photoPath);
      return;
    }

    if (!recognition) {
      this.setRecognitionError(
        photoPath,
        'No se reconoció un Pokémon de la primera generación. Intenta acercar y enfocar mejor la imagen.',
      );
      this.finishRecognition(photoPath);
      return;
    }

    try {
      // Segunda fase: usa solo el nombre predicho para recuperar datos desde PokéAPI.
      const pokemon = await this.pokedexService.getPokemon(recognition.name);
      this.pokemonByPhoto.update((entries) => ({
        ...entries,
        [photoPath]: { ...pokemon, confidence: recognition.confidence },
      }));
    } catch (error) {
      console.error(`Se reconoció ${recognition.name}, pero falló la consulta de estadísticas:`, error);
      this.setRecognitionError(
        photoPath,
        `La foto sí se reconoció como ${recognition.name}, pero no se pudieron cargar sus estadísticas. Revisa tu conexión a internet y vuelve a intentarlo.`,
      );
    } finally {
      this.finishRecognition(photoPath);
    }
  }

  private setRecognitionError(photoPath: string, message: string): void {
    this.recognitionErrors.update((errors) => ({ ...errors, [photoPath]: message }));
  }

  private finishRecognition(photoPath: string): void {
    this.recognizingPhotos.update((photos) => {
      const { [photoPath]: _removed, ...remaining } = photos;
      return remaining;
    });
  }

  private async showPermissionWarningToast(): Promise<void> {
    const toast = await this.toastController.create({
      message: 'Permiso denegado. Conceda acceso a la cámara y galería.',
      duration: 3500,
      position: 'bottom',
      color: 'danger',
      buttons: [{ text: 'Entendido', role: 'cancel' }]
    });
    await toast.present();
  }
}