import React, { useState } from 'react';
import { View, Image, type LayoutChangeEvent } from 'react-native';
import { guideBoxToPhotoRect } from '../ocr/crop';
import type { CaptureRegion } from '../ocr/types';

/**
 * The part of a captured photo that sat inside the guide box: exactly what
 * Verso reads, so a glance says whether the right panel was framed. The whole
 * photo is scaled so the framed rectangle fits, then shifted so only that
 * rectangle shows through a clipping view. Without a region (a capture from
 * before the guide box, or a gallery image) the whole photo is shown.
 */
export function LabelPhoto({ uri, region, maxHeight = 320, radius = 12, background, label }: {
  uri: string;
  region?: CaptureRegion;
  maxHeight?: number;
  radius?: number;
  background: string;
  label?: string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const a11y = { accessible: true, accessibilityRole: 'image' as const,
    accessibilityLabel: label ?? 'The photo you took of the ingredient list' };

  if (!region) {
    return (
      <Image source={{ uri }} resizeMode="contain" accessibilityIgnoresInvertColors {...a11y}
        style={{ width: '100%', height: maxHeight, borderRadius: radius, backgroundColor: background }} />
    );
  }

  const rect = guideBoxToPhotoRect(region.box, region.view, region.photo);
  const k = width ? Math.min(width / rect.width, maxHeight / rect.height) : 0;
  return (
    <View onLayout={onLayout} style={{ width: '100%', alignItems: 'center' }}>
      {k > 0 && (
        <View {...a11y} style={{ width: rect.width * k, height: rect.height * k, overflow: 'hidden',
          borderRadius: radius, backgroundColor: background }}>
          <Image source={{ uri }} accessibilityIgnoresInvertColors
            style={{ position: 'absolute', left: -rect.x * k, top: -rect.y * k,
              width: region.photo.width * k, height: region.photo.height * k }} />
        </View>
      )}
    </View>
  );
}
