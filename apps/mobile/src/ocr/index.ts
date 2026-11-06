import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { guideBoxToPhotoRect } from './crop';
import { apiBase } from '../api/client';

// Two readers behind one interface, chosen per scan:
//
//   'server'  AI on the Verso server (Gemini's free tier by default; the
//             provider is server configuration, services/api/src/ocr). Reads
//             the photo the way a person would: returns only the ingredient
//             list, verbatim, and ignores the nutrition table, the address and
//             the barcode. Needs signal.
//   'native'  ML Kit on the phone. Instant, free and offline — but plain OCR:
//             it returns every word in the frame and misreads ("Oil" -> "0i1").
//
// The AI reader is used whenever the server reports one configured; ML Kit is
// the fallback when there is no signal, the server is down, or the AI call
// fails. A scan should degrade, not die.

export type { OcrProvider, OcrResult, OcrOptions, CaptureRegion } from './types';
import type { OcrProvider } from './types';

// The server races two AI models and gives up after 20 s, so an answer, or a
// clear failure, arrives well inside this. Past it, the phone's own reader is a
// better answer than a longer wait.
const SERVER_TIMEOUT_MS = 30_000;

export const serverOcr: OcrProvider = {
  kind: 'server',
  async recognise(imageUri, opts) {
    // Raw bytes, not FormData. React Native 0.86's spec-compliant fetch rejects
    // the legacy {uri, name, type} part shape with "unsupported formDataPart
    // implementation", and building a real Blob on device is fiddlier than just
    // posting the image as the body.
    // Same crop as the native path: send the server exactly what was framed,
    // not the whole sensor. Also cuts upload size and per-scan vision cost.
    let ctx = ImageManipulator.manipulate(imageUri);
    if (opts?.region) {
      const { box, view, photo } = opts.region;
      const r = guideBoxToPhotoRect(box, view, photo);
      ctx = ctx.crop({ originX: r.x, originY: r.y, width: r.width, height: r.height });
    }
    const rendered = await ctx.resize({ width: 1600 }).renderAsync();
    const prepared = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    const bytes = await new File(prepared.uri).arrayBuffer();

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SERVER_TIMEOUT_MS);
    opts?.signal?.addEventListener('abort', () => ctl.abort());
    try {
      const base = await apiBase();
      const res = await fetch(`${base}/v1/ocr`, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: bytes,
        signal: ctl.signal,
      });

      // 422: the AI looked and could not read the panel. That is an answer, not
      // a failure — an empty result sends the user to "No text inside the frame".
      if (res.status === 422) return { text: '', source: 'server' };

      if (!res.ok) {
        // 503 = no AI configured on the server; 4xx/5xx = provider trouble.
        let detail = `server OCR failed (${res.status})`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) detail = body.message;
        } catch {}
        throw new Error(detail);
      }

      const { text } = (await res.json()) as { text: string };
      return { text, source: 'server' };
    } finally {
      clearTimeout(timer);
    }
  },
};

// Whether the server has an AI reader configured. Checked at most once a minute:
// the answer only changes when someone edits the server's .env.
let aiCheckedAt = 0;
let aiAvailable = false;
async function serverAiAvailable(): Promise<boolean> {
  if (Date.now() - aiCheckedAt < 60_000) return aiAvailable;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const base = await apiBase();
    const res = await fetch(`${base}/health`, { signal: ctl.signal });
    const body = (await res.json()) as { ocr?: { configured?: boolean } };
    aiAvailable = !!body?.ocr?.configured;
  } catch {
    aiAvailable = false;
  } finally {
    clearTimeout(timer);
  }
  aiCheckedAt = Date.now();
  return aiAvailable;
}

// ML Kit is native code: present in the iOS/Android dev client, absent on web
// and in Expo Go.
let nativeReader: OcrProvider | null | undefined;
async function nativeOcr(): Promise<OcrProvider | null> {
  if (nativeReader !== undefined) return nativeReader;
  try {
    nativeReader = (await import('./native')).default ?? null;
  } catch {
    nativeReader = null;
  }
  return nativeReader;
}

const reader: OcrProvider = {
  kind: 'auto',
  async recognise(imageUri, opts) {
    const local = await nativeOcr();
    if (await serverAiAvailable()) {
      opts?.onProgress?.('ai');
      try {
        return await serverOcr.recognise(imageUri, opts);
      } catch (err) {
        if (!local) throw err;   // nothing to fall back to
        console.warn('AI reader failed; reading on the phone instead:', err);
      }
    }
    if (local) {
      opts?.onProgress?.('device');
      return local.recognise(imageUri, opts);
    }
    return serverOcr.recognise(imageUri, opts);   // web / Expo Go: the server is the only reader
  },
};

// Callers never branch on which reader ran; the result's `source` says.
export async function getOcr(): Promise<OcrProvider> {
  return reader;
}
