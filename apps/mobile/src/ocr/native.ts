import TextRecognition from '@react-native-ml-kit/text-recognition';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { guideBoxToPhotoRect } from './crop';
import type { OcrProvider, OcrOptions } from './types';

/**
 * On-device text recognition via Google ML Kit.
 *
 * Offline, free per scan, sub-second — which matters because the common case is
 * someone in a supermarket aisle on bad signal. The server path stays as the
 * fallback for frames ML Kit cannot read.
 *
 * Requires a custom dev client: ML Kit is native code, so adding it to an
 * already-built app crashes with "Cannot find native module" until you rebuild.
 */
const nativeOcr: OcrProvider = {
  kind: 'native',

  async recognise(imageUri, opts?: OcrOptions) {
    let ctx = ImageManipulator.manipulate(imageUri);

    // Crop to the guide box FIRST. Without this ML Kit reads the whole frame —
    // including the wide strip of sensor either side that the preview never
    // showed — so a scan picks up the brand name, the barcode and whatever is
    // on the next packet. Cropping is what makes the box mean anything.
    if (opts?.region) {
      const { box, view, photo } = opts.region;
      const r = guideBoxToPhotoRect(box, view, photo);
      ctx = ctx.crop({ originX: r.x, originY: r.y, width: r.width, height: r.height });
    }

    // Then downscale. ML Kit reads small text better on a moderate image than a
    // 12MP one — fewer pixels, less sensor noise — and it is far faster. 1600px
    // across a cropped panel leaves the text comfortably oversampled.
    ctx = ctx.resize({ width: 1600 });

    const rendered = await ctx.renderAsync();
    const prepared = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });

    const result = await TextRecognition.recognize(prepared.uri);

    // ML Kit returns blocks in reading order. An ingredient panel is one
    // paragraph wrapped across lines, so join with spaces: a newline mid-phrase
    // would split "Edible Vegetable Oil (Palmolein)" into fragments and defeat
    // the resolver, which splits on commas and brackets.
    const text = (result?.blocks ?? [])
      .map(b => (b.text ?? '').replace(/\s*\n\s*/g, ' '))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return { text, source: 'native' };
  },
};

export default nativeOcr;
