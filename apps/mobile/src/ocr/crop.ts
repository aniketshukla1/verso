/**
 * Translate the on-screen guide box into pixel coordinates in the captured photo.
 *
 * The guide box used to be decorative: ML Kit read the whole frame, so a scan
 * picked up the brand name, the barcode, neighbouring packets — anything in
 * shot. Cropping to the box is what makes "what you see is what gets read" true.
 *
 * expo-camera renders the preview with a COVER fit: the photo is scaled up until
 * it fills the view and the overflow is centre-cropped. The sensor is also a
 * different aspect ratio from the screen (typically 4:3 against ~19.5:9), so the
 * two coordinate spaces do not line up and the transform has to be undone
 * explicitly rather than assumed away.
 */

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

export function guideBoxToPhotoRect(box: Rect, view: Size, photo: Size): Rect {
  // Degenerate inputs (a view measured before layout) must not produce NaN —
  // fall back to the whole photo, which is the old behaviour.
  if (!view.width || !view.height || !photo.width || !photo.height) {
    return { x: 0, y: 0, width: photo.width, height: photo.height };
  }

  // cover: scale so the photo covers BOTH axes, hence max not min.
  const scale = Math.max(view.width / photo.width, view.height / photo.height);
  const shownW = photo.width * scale;
  const shownH = photo.height * scale;

  // How much of the scaled photo hangs off each edge of the view.
  const offX = (shownW - view.width) / 2;
  const offY = (shownH - view.height) / 2;

  const x = (box.x + offX) / scale;
  const y = (box.y + offY) / scale;
  const width = box.width / scale;
  const height = box.height / scale;

  // Clamp into the photo: a box near the edge of a letterboxed preview can
  // otherwise ask for pixels that do not exist, and the native cropper throws.
  const cx = Math.max(0, Math.min(x, photo.width));
  const cy = Math.max(0, Math.min(y, photo.height));
  return {
    x: Math.round(cx),
    y: Math.round(cy),
    width: Math.max(1, Math.round(Math.min(width, photo.width - cx))),
    height: Math.max(1, Math.round(Math.min(height, photo.height - cy))),
  };
}
