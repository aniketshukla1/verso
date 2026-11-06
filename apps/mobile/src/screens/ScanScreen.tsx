import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Linking, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, type, TOUCH, radius, type Theme } from '../ui/theme';
import { Button, Chevron, Mark } from '../ui/kit';
import { placeIn } from '../ui/format';
import { SAMPLES, type SampleLabel } from './samples';
import type { CaptureRegion } from '../ocr/types';

export type Capture = {
  gtin?: string;
  panelUri?: string;
  /** Label text already known: a dev sample, typed text, or OCR text kept for a retry. */
  knownText?: string;
  market?: string;
  /** Where the guide box sat, so OCR reads only what was framed. */
  region?: CaptureRegion;
  sample?: SampleLabel;
};

export type Stage = 'barcode' | 'panel';

// Layout constants for the guide box. Sizing it from screen FRACTIONS was
// wrong: the box then overlapped the guidance text and buttons, because the HUD
// is laid out in normal flow and its height depends on the copy, the safe-area
// inset and whether the dev sample strip is showing. The box is derived from
// the space that is actually free instead, measured at runtime.
const EDGE = 16;        // side margin
const GAP = 12;         // clearance between box and HUD
const BARCODE_H = 190;  // a barcode needs a shallow band, not the whole screen
const MIN_BOX_H = 200;  // never collapse to a useless sliver
const SHUTTER = 68;

// Guided capture. Real packaging is curved, glossy and often multilingual, and a
// single blind photo fails on it far more often than a model upgrade can fix.
// The barcode is tried first because when it hits, the answer is instant.
export function ScanScreen({
  market, onCapture, busy, bottomInset, stageRequest, compareWith, onCancelCompare,
  onChangeMarket, onSearch, onPreview,
}: {
  market: string;
  onCapture: (c: Capture) => void;
  busy?: boolean;
  /** Height of whatever sits over the bottom of the preview (the tab bar, with its inset). */
  bottomInset: number;
  /** Asks for a stage from outside, e.g. "Read the ingredient list" after a barcode miss. */
  stageRequest?: { stage: Stage; n: number };
  /** Set while scanning the second label of a comparison. */
  compareWith?: { label: string } | null;
  onCancelCompare?: () => void;
  onChangeMarket: () => void;
  onSearch: () => void;
  /** Whether the live preview is showing (camera permission granted). */
  onPreview?: (showing: boolean) => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>(stageRequest?.stage ?? 'barcode');
  const cam = useRef<CameraView>(null);
  const locked = useRef(false);

  useEffect(() => { if (stageRequest) setStage(stageRequest.stage); }, [stageRequest]);
  useEffect(() => { onPreview?.(!!perm?.granted); }, [perm?.granted, onPreview]);

  // Measured, not assumed: the crop maths needs the real preview size, and the
  // box must sit between the top controls and the HUD. The size comes from a
  // plain wrapper View — CameraView does not report layout on every platform,
  // and when it did not, the box never drew and OCR silently read the whole frame.
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [hudHeight, setHudHeight] = useState(0);
  const [topBottom, setTopBottom] = useState(0);

  const bottomPad = bottomInset + 16;
  const hudTop = viewSize.height - bottomPad - hudHeight;
  const topEdge = Math.max(insets.top, topBottom) + GAP;
  const available = Math.max(MIN_BOX_H, hudTop - GAP - topEdge);

  const boxH = stage === 'barcode' ? Math.min(available, BARCODE_H) : available;
  const guide = {
    x: EDGE,
    y: stage === 'barcode' ? topEdge + Math.max(0, (available - boxH) * 0.3) : topEdge,
    width: Math.max(0, viewSize.width - EDGE * 2),
    height: boxH,
  };

  const onBarcode = useCallback((r: BarcodeScanningResult) => {
    if (locked.current || stage !== 'barcode' || busy) return;
    locked.current = true;
    onCapture({ gtin: r.data });
    setTimeout(() => { locked.current = false; }, 2500);
  }, [stage, busy, onCapture]);

  const shootPanel = useCallback(async () => {
    // skipProcessing is off on purpose: it returns the frame in raw sensor
    // orientation, which would silently invalidate the crop rectangle. Quality
    // is high because we crop to the box and downscale afterwards, so the bytes
    // that survive are the ones with the text in them.
    const photo = await cam.current?.takePictureAsync({ quality: 0.9 });
    if (!photo?.uri) return;
    onCapture({
      panelUri: photo.uri,
      // Only send a region once the preview has actually been measured. A zero
      // box against a measured view crops to 1x1 and OCR silently returns
      // nothing; omitting the region falls back to the whole frame instead.
      region: photo.width && photo.height && guide.width > 1 && guide.height > 1
        ? { box: guide, view: viewSize, photo: { width: photo.width, height: photo.height } }
        : undefined,
    });
  }, [onCapture, guide, viewSize]);

  const samples = (onCamera: boolean) => __DEV__ ? (
    <View style={s.samples}>
      <Text style={[s.samplesTitle, onCamera && { color: 'rgba(255,255,255,0.72)' }]}>
        DEV · RUN A TEST LABEL
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sampleRow}>
        {SAMPLES.map(sample => (
          <Pressable key={sample.id} disabled={busy}
            style={({ pressed }) => [onCamera ? s.sampleOnCamera : s.sample, pressed && { opacity: 0.7 }]}
            onPress={() => onCapture({ knownText: sample.text, market: sample.market, sample })}>
            <Text style={onCamera ? s.sampleTextOnCamera : s.sampleText}>{sample.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  ) : null;

  if (!perm) return <View style={s.black} />;

  if (!perm.granted) {
    const blocked = !perm.canAskAgain;
    return (
      <ScrollView
        style={{ backgroundColor: t.paper }}
        contentContainerStyle={[s.perm, { paddingTop: insets.top + 48, paddingBottom: bottomInset + 32 }]}>
        <Mark size={72} />
        <Text style={s.permTitle} accessibilityRole="header">Read the back of the pack</Text>
        <Text style={s.permBody}>
          Scan a barcode or an ingredient list. Verso shows which ingredients are banned or
          restricted, where, and who decided — with a source for every line.
        </Text>
        <View style={s.permActions}>
          {blocked && Platform.OS !== 'web' ? (
            <Button label="Turn on camera in Settings" onPress={() => Linking.openSettings()} />
          ) : (
            <Button label="Allow camera" onPress={requestPerm} />
          )}
          <Button kind="secondary" label="Search by name instead" onPress={onSearch} />
        </View>
        <Text style={s.permNote}>
          {blocked
            ? 'Camera access is off for Verso. You can still search for a product or type its ingredients.'
            : 'The camera is on only while you’re on the Scan tab.'}
        </Text>
        {samples(false)}
      </ScrollView>
    );
  }

  return (
    <View
      // The key forces a fresh mount. Without it React reuses the placeholder
      // View above (same type, same position) and only adds onLayout to it — and
      // a handler added to an already-laid-out view never fires, on web or on
      // Fabric. The guide box then never drew and OCR read the whole frame.
      key="preview"
      style={s.black}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        setViewSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}>
      <CameraView
        ref={cam}
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={stage === 'barcode' ? onBarcode : undefined}
      />

      {/* A camera preview is arbitrary brightness — white packaging under a
          shop light will wash out white status-bar icons and white copy alike.
          These scrims guarantee contrast without dimming the middle of the
          frame, which is where the user is actually aiming. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
        style={[s.scrimTop, { height: insets.top + 120 }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)']}
        style={s.scrimBottom}
        pointerEvents="none"
      />

      {/* Drawn at exactly the rect that gets cropped — the border is the
          promise that what you frame is what gets read. */}
      {viewSize.width > 0 && (
        <View
          pointerEvents="none"
          style={[s.frame, { left: guide.x, top: guide.y, width: guide.width, height: guide.height }]}
        />
      )}

      <View
        style={[s.top, { paddingTop: insets.top + 8 }]}
        onLayout={e => {
          const { y, height } = e.nativeEvent.layout;
          setTopBottom(prev => (Math.abs(prev - (y + height)) < 1 ? prev : y + height));
        }}>
        {compareWith ? (
          <View style={s.compareBanner} accessibilityRole="summary">
            <Text style={s.compareText}>
              Scan the other label to compare with the {compareWith.label}.
            </Text>
            <Pressable onPress={onCancelCompare} accessibilityRole="button"
              style={({ pressed }) => [s.cancel, pressed && { opacity: 0.6 }]}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          onPress={onChangeMarket}
          accessibilityRole="button"
          accessibilityLabel={`Scoring for ${placeIn(market)}. Change country`}
          style={({ pressed }) => [s.marketPill, pressed && { opacity: 0.7 }]}>
          <Text style={s.marketText}>Scoring for {placeIn(market)}</Text>
          <Chevron dir="down" color="#FFFFFF" size={11} />
        </Pressable>
      </View>

      <View style={[s.overlay, { paddingBottom: bottomPad }]} pointerEvents="box-none">
        <View
          style={s.hud}
          onLayout={e => {
            const h = e.nativeEvent.layout.height;
            setHudHeight(prev => (Math.abs(prev - h) < 1 ? prev : h));
          }}>
          <Text style={s.hudTitle}>
            {stage === 'barcode' ? 'Point at the barcode' : 'Fill the frame with the ingredient list'}
          </Text>
          <Text style={s.hudBody}>
            {stage === 'barcode'
              ? 'Most packs outside Europe and the US aren’t in a catalogue yet. If nothing happens, switch to Ingredient list.'
              : 'Hold steady, and tilt away from lights to avoid glare.'}
          </Text>

          <View style={s.segment} accessibilityRole="tablist">
            {(['barcode', 'panel'] as const).map(id => {
              const on = stage === id;
              return (
                <Pressable key={id} onPress={() => setStage(id)} accessibilityRole="tab"
                  accessibilityState={{ selected: on }} style={[s.segItem, on && s.segOn]}>
                  <Text style={[s.segText, on && s.segTextOn]}>{id === 'barcode' ? 'Barcode' : 'Ingredient list'}</Text>
                </Pressable>
              );
            })}
          </View>

          {stage === 'panel' ? (
            <View style={s.shutterRow}>
              <Pressable
                onPress={shootPanel}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Take photo of the ingredient list"
                style={({ pressed }) => [s.shutter, pressed && { transform: [{ scale: 0.94 }] }]}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <View style={s.shutterInner} />}
              </Pressable>
              {busy && <Text style={s.status}>Reading the label…</Text>}
            </View>
          ) : (
            <View style={s.statusRow}>
              {busy && <ActivityIndicator color="#FFFFFF" />}
              <Text style={s.status}>{busy ? 'Checking…' : 'Looking for a barcode…'}</Text>
            </View>
          )}
          {stage === 'barcode' && samples(true)}
        </View>
      </View>
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },

  perm: { alignItems: 'center', paddingHorizontal: 28, flexGrow: 1 },
  permTitle: { color: t.ink, fontSize: type.display, lineHeight: 34, fontWeight: '800', textAlign: 'center',
    marginTop: 24, letterSpacing: -0.6 },
  permBody: { color: t.ink2, fontSize: type.bodyLg, lineHeight: 24, textAlign: 'center', marginTop: 12 },
  permActions: { alignSelf: 'stretch', gap: 12, marginTop: 28 },
  permNote: { color: t.ink3, fontSize: type.body, lineHeight: 21, textAlign: 'center', marginTop: 14 },

  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%' },
  frame: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(255,255,255,0.92)', borderRadius: 12 },

  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: EDGE, gap: 8 },
  marketPill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    minHeight: TOUCH, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)' },
  marketText: { color: '#FFFFFF', fontSize: type.body, fontWeight: '600' },
  compareBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.accent,
    borderRadius: radius.button, paddingLeft: 14 },
  compareText: { flex: 1, color: t.onAccent, fontSize: type.body, lineHeight: 20, paddingVertical: 10,
    fontWeight: '600' },
  cancel: { minHeight: TOUCH, paddingHorizontal: 14, justifyContent: 'center' },
  cancelText: { color: t.onAccent, fontSize: type.body, fontWeight: '700' },

  // The camera preview runs edge to edge under the system bars on purpose —
  // that is the modern camera look. Padding here is applied from live insets so
  // no control ever lands under a notch, cutout, gesture bar or the tab bar.
  // flex-end, NOT space-between: the HUD is the only child in flow, and
  // space-between with one child pins it to the START — the bug that put the
  // buttons inside the guide box.
  overlay: { flex: 1, justifyContent: 'flex-end' },
  hud: { paddingHorizontal: 20 },
  hudTitle: { color: '#FFFFFF', fontSize: type.title, fontWeight: '700', textAlign: 'center' },
  hudBody: { color: 'rgba(255,255,255,0.86)', fontSize: type.body, lineHeight: 21, textAlign: 'center',
    marginTop: 6 },

  segment: { flexDirection: 'row', marginTop: 16, padding: 3, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', width: '100%', maxWidth: 360 },
  segItem: { flex: 1, minHeight: TOUCH, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#FFFFFF' },
  segText: { color: '#FFFFFF', fontSize: type.body, fontWeight: '600' },
  segTextOn: { color: '#111418' },

  shutterRow: { alignItems: 'center', marginTop: 16, gap: 8 },
  shutter: { width: SHUTTER, height: SHUTTER, borderRadius: SHUTTER / 2, borderWidth: 4, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: SHUTTER - 16, height: SHUTTER - 16, borderRadius: (SHUTTER - 16) / 2,
    backgroundColor: '#FFFFFF' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: TOUCH,
    marginTop: 10 },
  status: { color: 'rgba(255,255,255,0.86)', fontSize: type.body },

  samples: { marginTop: 12, alignSelf: 'stretch' },
  samplesTitle: { color: t.ink3, fontSize: type.caption, letterSpacing: 1, textAlign: 'center',
    marginBottom: 8, fontWeight: '700' },
  sampleRow: { gap: 8, paddingHorizontal: 4 },
  sample: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.rule, backgroundColor: t.surface,
    borderRadius: 20, minHeight: TOUCH - 8, paddingHorizontal: 14, justifyContent: 'center' },
  sampleText: { color: t.ink2, fontSize: type.caption, fontWeight: '600' },
  sampleOnCamera: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 20, minHeight: TOUCH - 8,
    paddingHorizontal: 14, justifyContent: 'center' },
  sampleTextOnCamera: { color: '#FFFFFF', fontSize: type.caption, fontWeight: '600' },
});
