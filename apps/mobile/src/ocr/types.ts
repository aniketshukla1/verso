import type { Rect, Size } from './crop';

export interface OcrResult { text: string; source: 'native' | 'server' }

/** Where the guide box sat, so the provider can crop to exactly what was framed. */
export interface CaptureRegion {
  /** Guide box in view coordinates. */
  box: Rect;
  /** Size of the camera preview view those coordinates are relative to. */
  view: Size;
  /** Pixel size of the captured photo. */
  photo: Size;
}

export interface OcrOptions {
  region?: CaptureRegion;
  signal?: AbortSignal;
  /** Which reader is working now, so a waiting screen can say so. */
  onProgress?: (reader: 'ai' | 'device') => void;
}

export interface OcrProvider {
  readonly kind: 'native' | 'server' | 'auto';
  recognise(imageUri: string, opts?: OcrOptions): Promise<OcrResult>;
}
