import React, { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, radius, type Theme } from '../ui/theme';
import { Header } from '../ui/kit';

// The plain-language form of docs/methodology.md. The footer of every verdict
// points here, so this page is what makes "every point is explained" true.
// Keep the numbers in step with packages/verdict/src/score.js.
const POINTS: [string, string, string][] = [
  ['Banned or never authorised', '−25', '−12'],
  ['Warning label required', '−10', '−5'],
  ['Allowed only in named foods', '−4', '−4'],
  ['Ban adopted, not yet in force', 'half', 'half'],
];
const LISTS: [string, string][] = [
  ['On a statutory hazard list (e.g. California’s Prop 65)', '−10'],
  ['Classified by a health agency (e.g. IARC Group 2A or 2B)', '−6'],
  ['Weaker, peer-reviewed findings', '−2'],
];

export function MethodScreen({ methodVersion, onBack }: { methodVersion: string | null; onBack: () => void }) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();

  return (
    <View style={s.page}>
      <Header onBack={onBack} title="How Verso scores" />
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={s.h1} accessibilityRole="header">A score you can check line by line</Text>
        <Text style={s.p}>
          Every label starts at 100. Points come off only for things on the public record: bans,
          warning labels, restrictions and hazard listings. 100 means nothing on record against the
          ingredients Verso has checked — not that a food is healthy.
        </Text>

        <Text style={s.h2}>What takes points off</Text>
        <View style={s.table}>
          <View style={[s.tr, s.th]}>
            <Text style={[s.td, s.tdMain, s.thText]}>Rule</Text>
            <Text style={[s.td, s.thText]}>Where you shop</Text>
            <Text style={[s.td, s.thText]}>Elsewhere</Text>
          </View>
          {POINTS.map(([label, home, away], i) => (
            <View key={label} style={[s.tr, i < POINTS.length - 1 && s.rule]}>
              <Text style={[s.td, s.tdMain]}>{label}</Text>
              <Text style={[s.td, s.num]}>{home}</Text>
              <Text style={[s.td, s.num]}>{away}</Text>
            </View>
          ))}
        </View>
        <View style={[s.table, { marginTop: 12 }]}>
          {LISTS.map(([label, pts], i) => (
            <View key={label} style={[s.tr, i < LISTS.length - 1 && s.rule]}>
              <Text style={[s.td, s.tdMain]}>{label}</Text>
              <Text style={[s.td, s.num]}>{pts}</Text>
            </View>
          ))}
        </View>
        <Text style={s.p}>No single ingredient can take off more than 30 points.</Text>

        <Text style={s.h2}>What never changes the score</Text>
        <Text style={s.p}>
          Contested or single-study findings, however alarming they sound. And what an ingredient is
          made of — like the saturated fat in an oil — which Verso shows for context but never scores.
        </Text>

        <Text style={s.h2}>When there is no score</Text>
        <Text style={s.p}>
          If Verso can read less than half of a label, or has checked less than half of the
          ingredients it scores, it shows “Not scored” instead of a number. A number then would
          suggest everything had been checked. The findings it does have are still shown in full.
        </Text>

        <Text style={s.h2}>Where the facts come from</Text>
        <Text style={s.p}>
          Every finding names its source — the regulation, the agency list, or the standard — with a
          link to the original. Verso quotes classifications in the agency’s own words and never
          upgrades them.
        </Text>

        {!!methodVersion && <Text style={s.foot}>Method {methodVersion}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20, paddingTop: 20 },
  h1: { color: t.ink, fontSize: type.display, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  h2: { color: t.ink, fontSize: type.title, fontWeight: '700', marginTop: 32 },
  p: { color: t.ink2, fontSize: type.bodyLg, lineHeight: 25, marginTop: 10 },
  table: { marginTop: 14, backgroundColor: t.surface, borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.rule, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  th: { backgroundColor: t.surface2 },
  thText: { color: t.ink3, fontSize: type.caption, fontWeight: '700' },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.rule },
  td: { color: t.ink, fontSize: type.body, width: 76, textAlign: 'right' },
  tdMain: { flex: 1, width: undefined, textAlign: 'left', lineHeight: 20 },
  num: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  foot: { color: t.ink3, fontSize: type.caption, marginTop: 32 },
});
