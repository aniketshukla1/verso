import React, { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, radius, type Theme } from '../ui/theme';
import { Header, ListRow, CheckIcon } from '../ui/kit';
import { MARKETS, placeName, plural } from '../ui/format';

export function YouScreen({ market, queued, methodVersion, bottomInset, onMarket, onMethod, onSearch }: {
  market: string;
  queued: number;
  methodVersion: string | null;
  bottomInset: number;
  onMarket: () => void;
  onMethod: () => void;
  onSearch: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[s.pad, { paddingTop: insets.top + 20, paddingBottom: bottomInset + 32 }]}>
      <Text style={s.title} accessibilityRole="header">You</Text>

      <Text style={s.group}>SCORING</Text>
      <View style={s.card}>
        <ListRow title="Country you shop in" value={placeName(market)} onPress={onMarket} last
          accessibilityLabel={`Country you shop in: ${placeName(market)}. Change`} />
      </View>
      <Text style={s.note}>A ban where you shop takes more points off than the same ban elsewhere.</Text>

      <Text style={s.group}>VERSO</Text>
      <View style={s.card}>
        <ListRow title="How Verso scores" onPress={onMethod} />
        <ListRow title="Search by name" detail="Find a product without the camera" onPress={onSearch} />
        <ListRow title="Labels in the review queue" value={String(queued)} last
          detail={queued ? `${plural(queued, 'label')} saved on this phone. Sending isn’t switched on yet.` : undefined} />
      </View>

      <Text style={s.foot}>
        Product data from Open Food Facts, licensed under ODbL 1.0.{methodVersion ? ` Method ${methodVersion}.` : ''}
      </Text>
    </ScrollView>
  );
}

export function MarketScreen({ market, onPick, onBack }: {
  market: string; onPick: (code: string) => void; onBack: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  return (
    <View style={s.page}>
      <Header onBack={onBack} title="Country you shop in" />
      <ScrollView contentContainerStyle={[s.pad, { paddingTop: 16, paddingBottom: insets.bottom + 32 }]}>
        <Text style={s.lede}>
          Verso scores a label for the country you pick. The findings are the same everywhere; only
          the points change.
        </Text>
        <View style={[s.card, { marginTop: 16 }]}>
          {MARKETS.map((m, i) => (
            <ListRow
              key={m.code}
              title={m.name}
              onPress={() => onPick(m.code)}
              last={i === MARKETS.length - 1}
              accessibilityLabel={`${m.name}${m.code === market ? ', selected' : ''}`}
              trailing={m.code === market ? <CheckIcon color={t.accent} /> : <View style={{ width: 16 }} />}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20 },
  title: { color: t.ink, fontSize: type.display, fontWeight: '800', letterSpacing: -0.6 },
  lede: { color: t.ink2, fontSize: type.bodyLg, lineHeight: 24 },
  group: { color: t.ink3, fontSize: type.caption, fontWeight: '700', letterSpacing: 1, marginTop: 28,
    marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: t.surface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.rule, overflow: 'hidden' },
  note: { color: t.ink3, fontSize: type.body, lineHeight: 20, marginTop: 8, marginHorizontal: 4 },
  foot: { color: t.ink3, fontSize: type.caption, lineHeight: 17, marginTop: 32, marginHorizontal: 4 },
});
