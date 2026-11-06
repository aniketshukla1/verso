import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, type Theme } from '../ui/theme';
import { Header, Card } from '../ui/kit';
import { LabelPhoto } from '../ui/LabelPhoto';
import type { CaptureRegion } from '../ocr/types';

// Shown the moment a label is captured. The old flow kept the user on the
// camera with a spinner for as long as reading and checking took, which is half
// a minute when the AI reader is slow and reads as "stuck". This screen answers
// the two questions a user has right then: did it take the photo I meant, and
// is anything happening. Going back cancels the scan.

export type ProcessingStage = 'ai' | 'device' | 'checking';

const LINE: Record<ProcessingStage, string> = {
  ai: 'Reading the ingredient list from your photo…',
  device: 'The AI reader is slow right now, so Verso is reading the label on your phone instead…',
  checking: 'Checking each ingredient against official lists, and looking up any Verso hasn’t seen before…',
};

export function ProcessingScreen({ photoUri, region, stage, backLabel, onBack }: {
  photoUri?: string;
  region?: CaptureRegion;
  stage: ProcessingStage;
  backLabel: string;
  onBack: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const reading = stage !== 'checking';

  return (
    <View style={s.page}>
      <Header onBack={onBack} backLabel={backLabel} />
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}>
        {!!photoUri && (
          <>
            <Text style={s.eyebrow}>YOUR PHOTO</Text>
            <View style={{ marginTop: 10 }}>
              <LabelPhoto uri={photoUri} region={region} background={t.surface2} />
            </View>
          </>
        )}

        <Card style={{ marginTop: 20 }}>
          <View accessible accessibilityLiveRegion="polite"
            accessibilityLabel={`We're processing your request. ${LINE[stage]}`}>
            <View style={s.row}>
              <ActivityIndicator color={t.accent} />
              <Text style={s.title} accessibilityRole="header">We’re processing your request</Text>
            </View>
            <Text style={s.line}>{LINE[stage]}</Text>
          </View>
          <View style={s.steps}>
            <Step t={t} state={reading ? 'active' : 'done'} label="Read the ingredient list" />
            <Step t={t} state={reading ? 'waiting' : 'active'} label="Check each ingredient against bans and hazard lists" />
          </View>
          {stage === 'ai' && seconds >= 8 && (
            <Text style={s.hint}>
              This can take up to 20 seconds. If it takes longer, Verso reads the label on your phone instead.
            </Text>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

function Step({ t, state, label }: { t: Theme; state: 'done' | 'active' | 'waiting'; label: string }) {
  const color = state === 'done' ? t.ok : state === 'active' ? t.accent : t.ink3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 5 }}
      accessible accessibilityLabel={`${label}: ${state === 'done' ? 'done' : state === 'active' ? 'in progress' : 'next'}`}>
      <Text style={{ width: 18, textAlign: 'center', color, fontSize: type.body, fontWeight: '700', lineHeight: 21 }}>
        {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
      </Text>
      <Text style={{ flex: 1, color: state === 'waiting' ? t.ink3 : t.ink, fontSize: type.body, lineHeight: 21 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20, paddingTop: 16 },
  eyebrow: { color: t.ink3, fontSize: type.caption, letterSpacing: 1, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, color: t.ink, fontSize: type.title, fontWeight: '700' },
  line: { color: t.ink2, fontSize: type.body, lineHeight: 21, marginTop: 10 },
  steps: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.rule, paddingTop: 10 },
  hint: { color: t.ink3, fontSize: type.caption, lineHeight: 17, marginTop: 12 },
});
