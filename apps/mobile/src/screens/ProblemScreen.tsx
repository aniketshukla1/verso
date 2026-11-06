import React, { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, type Theme } from '../ui/theme';
import { Header, Button } from '../ui/kit';

// One screen per way a scan can fail, because each needs a different next step.
// The old single "Nothing to read yet" screen told a user with no signal to
// scan again — which fails the same way — and printed "Network request failed".
export type ProblemKind = 'network' | 'server' | 'no_text' | 'ocr_failed' | 'not_in_catalogue';

const COPY: Record<ProblemKind, { title: string; body: string[]; primary: string; secondary?: string }> = {
  network: {
    title: 'Can’t reach Verso',
    body: [
      'Your phone isn’t connected, or Verso’s server isn’t answering.',
      'What was read from the label is kept, so trying again won’t need a new photo.',
    ],
    primary: 'Try again',
    secondary: 'Back to scan',
  },
  server: {
    title: 'Verso hit a problem',
    body: ['Something failed on Verso’s side, not yours. Trying again in a minute usually works.'],
    primary: 'Try again',
    secondary: 'Back to scan',
  },
  no_text: {
    title: 'No text inside the frame',
    body: [
      'Move closer so the ingredient list fills the frame.',
      'Tilt the pack away from lights to cut glare on foil.',
      'Flatten creases with your thumb if you can.',
    ],
    primary: 'Retake photo',
  },
  ocr_failed: {
    title: 'Couldn’t read that photo',
    body: ['The photo couldn’t be processed. Try again with the pack held steady in good light.'],
    primary: 'Retake photo',
  },
  not_in_catalogue: {
    title: 'This barcode isn’t in the catalogue yet',
    body: [
      'Most packs sold outside Europe and the US aren’t.',
      'Photograph the ingredient list instead and Verso will read it directly.',
    ],
    primary: 'Read the ingredient list',
    secondary: 'Back to scan',
  },
};

export function ProblemScreen({ kind, detail, backLabel, onPrimary, onSecondary, onBack }: {
  kind: ProblemKind;
  backLabel: string;
  /** The underlying error. Shown in development builds only. */
  detail?: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onBack: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  const copy = COPY[kind];
  const list = kind === 'no_text';

  return (
    <View style={s.page}>
      <Header onBack={onBack} backLabel={backLabel} />
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={s.title} accessibilityRole="header">{copy.title}</Text>
        {copy.body.map((line, i) => (
          <View key={i} style={list ? s.bulletRow : undefined}>
            {list && <Text style={s.bullet}>{i + 1}</Text>}
            <Text style={[s.body, list && { flex: 1, marginTop: 0 }]}>{line}</Text>
          </View>
        ))}
        <View style={s.actions}>
          <Button label={copy.primary} onPress={onPrimary} />
          {!!copy.secondary && <Button kind="secondary" label={copy.secondary} onPress={onSecondary} />}
        </View>
        {__DEV__ && !!detail && <Text style={s.detail}>Dev detail: {detail}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20, paddingTop: 24 },
  title: { color: t.ink, fontSize: type.display, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  body: { color: t.ink2, fontSize: type.bodyLg, lineHeight: 24, marginTop: 12 },
  bulletRow: { flexDirection: 'row', gap: 12, marginTop: 14, alignItems: 'flex-start' },
  bullet: { color: t.accent, fontSize: type.body, fontWeight: '700', width: 24, height: 24, lineHeight: 24,
    textAlign: 'center', borderRadius: 12, backgroundColor: t.accentSoft, overflow: 'hidden' },
  actions: { marginTop: 28, gap: 12 },
  detail: { color: t.ink3, fontSize: type.caption, marginTop: 24, fontFamily: 'Courier' },
});
