import { Injectable } from '@angular/core';
import * as ort from 'onnxruntime-web';

export interface RecognitionResult {
  name: string;
  confidence: number;
}

/**
 * Clasifica imágenes en el dispositivo con ONNX Runtime Web.
 * El modelo y sus etiquetas están en src/assets/models; la foto no se envía a una API.
 */
@Injectable({ providedIn: 'root' })
export class PokemonRecognitionService {
  private modelPromise: Promise<ort.InferenceSession> | null = null;
  private labelsPromise: Promise<string[]> | null = null;

  /** Devuelve la predicción más probable entre los 151 Pokémon de primera generación. */
  async recognize(imageUrl: string): Promise<RecognitionResult | null> {
    const [session, labels] = await Promise.all([
      this.getSession(),
      this.getLabels(),
    ]);

    const image = await this.loadImage(imageUrl);
    const tensor = this.preprocess(image);
    const output = await session.run({ [session.inputNames[0]]: tensor });
    const logitsTensor = output[session.outputNames[0]] as ort.Tensor;
    const logits = Array.from(logitsTensor.data as Float32Array);
    const probabilities = this.softmax(logits, 0.25);
    const bestIndex = this.argmax(probabilities);
    const bestName = labels[bestIndex];
    const bestProbability = probabilities[bestIndex] * 100;

    // Evita mostrar una predicción vacía o con una probabilidad prácticamente nula.
    if (!bestName || bestProbability < 10) {
      return null;
    }

    return {
      name: bestName,
      confidence: Number(bestProbability.toFixed(1)),
    };
  }

  private async getSession(): Promise<ort.InferenceSession> {
    if (!this.modelPromise) {
      const modelUrl = new URL('assets/models/pokemon_classifier.onnx', document.baseURI).toString();
      // Reutiliza la sesión entre fotos; si la carga falla, permite volver a intentarlo.
      this.modelPromise = ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      }).catch((error: unknown) => {
        this.modelPromise = null;
        throw error;
      });
    }

    return this.modelPromise;
  }

  private async getLabels(): Promise<string[]> {
    if (!this.labelsPromise) {
      const labelsUrl = new URL('assets/models/pokemon_labels.json', document.baseURI).toString();
      this.labelsPromise = fetch(labelsUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`No se pudieron cargar las etiquetas (${response.status}).`);
          }
          return response.json();
        })
        .then((items: { id: number; name: string }[]) => {
          if (items.length !== 151) {
            throw new Error(`El clasificador requiere 151 etiquetas y recibió ${items.length}.`);
          }
          return items.map((label) => label.name);
        })
        .catch((error: unknown) => {
          this.labelsPromise = null;
          throw error;
        });
    }

    return this.labelsPromise;
  }

  private async loadImage(imageUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar la imagen capturada.'));
      img.src = imageUrl;
    });
  }

  private preprocess(image: HTMLImageElement): ort.Tensor {
    const width = 224;
    const height = 224;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo preparar la imagen para reconocimiento.');
    }

    ctx.drawImage(image, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height).data;
    const pixels = width * height;
    // El modelo espera RGB normalizado y en orden de canales [1, 3, alto, ancho].
    const data = new Float32Array(pixels * 3);

    for (let pixel = 0; pixel < pixels; pixel++) {
      const imageIndex = pixel * 4;
      data[pixel] = ((imageData[imageIndex] / 255) - 0.485) / 0.229;
      data[pixels + pixel] = ((imageData[imageIndex + 1] / 255) - 0.456) / 0.224;
      data[pixels * 2 + pixel] = ((imageData[imageIndex + 2] / 255) - 0.406) / 0.225;
    }

    return new ort.Tensor('float32', data, [1, 3, height, width]);
  }

  private softmax(values: number[], temperature: number): number[] {
    const max = Math.max(...values);
    const exp = values.map((value) => Math.exp((value - max) / temperature));
    const sum = exp.reduce((total, current) => total + current, 0);
    return exp.map((value) => value / sum);
  }

  private argmax(values: number[]): number {
    return values.reduce((bestIndex, value, index, array) => {
      return value > array[bestIndex] ? index : bestIndex;
    }, 0);
  }
}
