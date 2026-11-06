import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, radius, type Theme } from '../ui/theme';
import { Header, Button, ListRow } from '../ui/kit';
import { placeName, placeIn } from '../ui/format';
import { searchProducts, VersoError } from '../api/client';
import type { CatalogueProduct } from '../types/verdict';

// The way forward without a camera: search the catalogue by name, or type the
// ingredient list. The second matters more than it looks — most packs outside
// Europe and the US are not in any catalogue, so a search alone would be a
// dead end for most of the world.
export function SearchScreen({ market, onPickProduct, onCheckText, onBack }: {
  market: string;
  onPickProduct: (p: CatalogueProduct) => void;
  onCheckText: (text: string) => void;
  onBack: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogueProduct[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'offline' | 'error'>('idle');
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults(null); setState('idle'); return; }
    const n = ++seq.current;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setState('loading');
      try {
        const found = await searchProducts(query, market, ctl.signal);
        if (n === seq.current) { setResults(found); setState('idle'); }
      } catch (err) {
        if (n !== seq.current || ctl.signal.aborted) return;
        setState(err instanceof VersoError && err.kind === 'network' ? 'offline' : 'error');
      }
    }, 300);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, market]);

  const withIngredients = results?.filter(r => r.hasIngredients) ?? [];

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header onBack={onBack} title="Search by name" />
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Product or brand"
          placeholderTextColor={t.ink3}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Product or brand"
          style={s.input}
        />

        {state === 'loading' && <ActivityIndicator style={{ marginTop: 20 }} color={t.ink2} />}
        {state === 'offline' && <Text style={s.note}>Search needs a connection. Your Library still works offline.</Text>}
        {state === 'error' && <Text style={s.note}>Search isn’t working right now. Try again in a minute.</Text>}

        {state === 'idle' && results && (withIngredients.length ? (
          <>
            <View style={s.card}>
              {withIngredients.map((p, i) => (
                <ListRow key={`${p.gtin}${p.market}`} title={p.name}
                  detail={`${p.brand ? `${p.brand} · ` : ''}${placeName(p.market)}`}
                  onPress={() => onPickProduct(p)} last={i === withIngredients.length - 1} />
              ))}
            </View>
            <Text style={s.attribution}>{withIngredients[0].attribution}</Text>
          </>
        ) : (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Not in the catalogue yet</Text>
            <Text style={s.note}>
              Most packs sold outside Europe and the US aren’t. Type the ingredient list instead and
              Verso will check it the same way.
            </Text>
          </View>
        ))}

        <View style={s.divider} />
        {typing ? (
          <>
            <Text style={s.label}>Ingredient list, as printed on the pack</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="e.g. Potato, Edible Vegetable Oil (Palmolein), Salt"
              placeholderTextColor={t.ink3}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Ingredient list"
              style={[s.input, s.area]}
            />
            <Button label={`Check for ${placeIn(market)}`} onPress={() => onCheckText(text.trim())}
              disabled={text.trim().length < 3} style={{ marginTop: 12 }} />
          </>
        ) : (
          <Button kind="secondary" label="Type the ingredients instead" onPress={() => setTyping(true)} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20, paddingTop: 16 },
  input: { backgroundColor: t.surface, borderColor: t.rule, borderWidth: 1, borderRadius: radius.button,
    minHeight: 50, paddingHorizontal: 14, fontSize: type.bodyLg, color: t.ink },
  area: { minHeight: 120, paddingTop: 12, lineHeight: 22 },
  card: { marginTop: 16, backgroundColor: t.surface, borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.rule, overflow: 'hidden' },
  attribution: { color: t.ink3, fontSize: type.caption, marginTop: 8 },
  empty: { marginTop: 20 },
  emptyTitle: { color: t.ink, fontSize: type.title, fontWeight: '700' },
  note: { color: t.ink2, fontSize: type.body, lineHeight: 21, marginTop: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.rule, marginVertical: 24 },
  label: { color: t.ink, fontSize: type.body, fontWeight: '600', marginBottom: 8 },
});
