import React, { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, radius, type Theme } from '../ui/theme';
import { Button, Chevron } from '../ui/kit';
import { placeName, savedAt } from '../ui/format';
import type { HistoryEntry } from '../cache/verdicts';

// Every scan, kept on the phone. This is the offline promise made visible: a
// label seen once reopens in a shop with no signal.
export function LibraryScreen({ entries, bottomInset, onOpen, onScan }: {
  entries: HistoryEntry[];
  bottomInset: number;
  onOpen: (e: HistoryEntry) => void;
  onScan: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[s.pad, { paddingTop: insets.top + 20, paddingBottom: bottomInset + 32 }]}>
      <Text style={s.title} accessibilityRole="header">Library</Text>
      <Text style={s.lede}>Saved on this phone. Opens without signal.</Text>

      {entries.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>Nothing saved yet</Text>
          <Text style={s.emptyBody}>
            Every label you scan is kept here, so you can reopen it in a shop with no signal.
          </Text>
          <Button label="Scan a label" onPress={onScan} style={{ marginTop: 20, alignSelf: 'stretch' }} />
        </View>
      ) : (
        <View style={s.list}>
          {entries.map((e, i) => (
            <Pressable
              key={e.key}
              onPress={() => onOpen(e)}
              accessibilityRole="button"
              accessibilityLabel={`${e.title}. ${placeName(e.market)}. ${e.score === null ? 'Not scored' : `Score ${e.score} out of 100`}`}
              style={({ pressed }) => [s.row, i < entries.length - 1 && s.rule, pressed && { backgroundColor: t.surface2 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>{e.title}</Text>
                <Text style={s.rowHeadline} numberOfLines={2}>{e.headline}</Text>
                <Text style={s.rowMeta}>
                  {placeName(e.market)} · {savedAt(e.scannedAt)} · {e.score === null ? 'Not scored' : `${e.score}/100`}
                  {e.origin === 'sample' ? ' · test label' : ''}
                </Text>
              </View>
              <Chevron color={t.ink3} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20 },
  title: { color: t.ink, fontSize: type.display, fontWeight: '800', letterSpacing: -0.6 },
  lede: { color: t.ink2, fontSize: type.body, marginTop: 4 },
  empty: { marginTop: 40, alignItems: 'center', paddingHorizontal: 12 },
  emptyTitle: { color: t.ink, fontSize: type.title, fontWeight: '700' },
  emptyBody: { color: t.ink2, fontSize: type.bodyLg, lineHeight: 24, textAlign: 'center', marginTop: 8 },
  list: { marginTop: 20, backgroundColor: t.surface, borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.rule, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.rule },
  rowTitle: { color: t.ink, fontSize: type.bodyLg, fontWeight: '600' },
  rowHeadline: { color: t.ink2, fontSize: type.body, lineHeight: 20, marginTop: 2 },
  rowMeta: { color: t.ink3, fontSize: type.caption, marginTop: 6 },
});
