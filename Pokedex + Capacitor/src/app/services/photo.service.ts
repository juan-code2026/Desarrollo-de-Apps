import { Injectable, signal } from '@angular/core';
import {
  Camera,
  CameraResultType,
  CameraSource,
  Photo,
} from '@capacitor/camera';
import { UserPhoto } from '../Models/photo.model';

@Injectable({
  providedIn: 'root',
})
export class PhotoService {
  private photosSignal = signal<UserPhoto[]>([]);
  public readonly photos = this.photosSignal.asReadonly();

  async takeNewPhoto(
    isHighDef: boolean,
  ): Promise<{
    success: boolean;
    reason?: 'permission_denied' | 'cancelled' | 'error';
    photo?: UserPhoto;
  }> {
    try {
      const imageQuality = isHighDef ? 95 : 60;
      const targetWidth = isHighDef ? 1920 : 800;

      // Capacitor permite tomar una foto o elegir una existente en web y móvil.
      // getPhoto() abre la interfaz modal en PC y solicita la cámara automáticamente
      const capturedPhoto: Photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        quality: imageQuality,
        width: targetWidth,
        allowEditing: false,
        promptLabelHeader: 'Seleccionar Origen',
        promptLabelPhoto: 'Elegir de la Galería',
        promptLabelPicture: 'Tomar Fotografía',
      });

      const newPhoto: UserPhoto = {
        filepath: `${Date.now()}.${capturedPhoto.format}`,
        webPath: capturedPhoto.webPath,
        format: capturedPhoto.format,
      };

      this.photosSignal.update((photos) => [newPhoto, ...photos]);
      return { success: true, photo: newPhoto };
    } catch (error: any) {
      if (
        error?.message?.includes('cancelled') ||
        error?.message?.includes('User cancelled')
      ) {
        return { success: false, reason: 'cancelled' };
      }
      console.error('Error en la captura:', error);
      return { success: false, reason: 'error' };
    }
  }

  deletePhoto(index: number): void {
    this.photosSignal.update((photos) => photos.filter((_, i) => i !== index));
  }
}
