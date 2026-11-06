import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, radius, type Theme } from '../ui/theme';
import { Header, Button, Card, LinkButton, ListRow, SectionTitle } from '../ui/kit';
import { MARKETS, placeName, savedAt } from '../ui/format';
import { fetchComparison, VersoError } from '../api/client';
import { SAMPLES } from './samples';
import type { HistoryEntry } from '../cache/verdicts';
import type { Comparison, CompareIngredient, CompareSideOut } from '../types/verdict';

/** One side of a comparison, as the app holds it before asking the server. */
export interface CompareSide {
  market: string;
  ingredientsText?: string;
  gtin?: string;
  origin: 'scan' | 'sample';
  date: string;
  title: string;
  productKey?: string | null;
}

// ---------- picker ----------

export function ComparePickerScreen({ from, library, onPick, onScanOther, onBack }: {
  from: CompareSide;
  library: HistoryEntry[];
  onPick: (side: CompareSide) => void;
  onScanOther: (market: string) => void;
  onBack: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  const others = library.filter(e => e.market !== from.market);
  const samples = __DEV__ ? SAMPLES.filter(x => x.market !== from.market) : [];

  return (
    <View style={s.page}>
      <Header onBack={onBack} title="Compare" />
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={s.h1} accessibilityRole="header">Compare with another country</Text>
        <Text style={s.p}>
          Pick the same product’s label from another country. Verso lines the two ingredient lists up
          and shows only the differences it can confirm.
        </Text>

        <Text style={s.group}>IN YOUR LIBRARY</Text>
        {others.length ? (
          <View style={s.card}>
            {others.map((e, i) => (
              <ListRow key={e.key} title={e.title} detail={`${placeName(e.market)} · ${savedAt(e.scannedAt)}`}
                last={i === others.length - 1}
                onPress={() => onPick({
                  market: e.market, ingredientsText: e.input.ingredientsText, gtin: e.input.gtin,
                  origin: e.origin === 'sample' ? 'sample' : 'scan', title: e.title, productKey: e.productKey,
                  date: new Date(e.scannedAt).toISOString().slice(0, 10),
                })} />
            ))}
          </View>
        ) : (
          <Text style={s.empty}>Labels you scan from other countries will appear here.</Text>
        )}

        {samples.length > 0 && (
          <>
            <Text style={s.group}>DEV · TEST LABELS</Text>
            <View style={s.card}>
              {samples.map((x, i) => (
                <ListRow key={x.id} title={x.label} detail={placeName(x.market)} last={i === samples.length - 1}
                  onPress={() => onPick({ market: x.market, ingredientsText: x.text, origin: 'sample',
                    title: x.label, productKey: x.productKey, date: new Date().toISOString().slice(0, 10) })} />
              ))}
            </View>
          </>
        )}

        <Text style={s.group}>OR SCAN IT NOW — WHICH COUNTRY IS IT FROM?</Text>
        <View style={s.card}>
          {MARKETS.filter(m => m.code !== from.market).map((m, i, arr) => (
            <ListRow key={m.code} title={m.name} last={i === arr.length - 1} onPress={() => onScanOther(m.code)} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ---------- comparison ----------

type Load =
  | { state: 'loading' }
  | { state: 'ready'; data: Comparison }
  | { state: 'failed'; kind: 'network' | 'server' | 'no_text' };

export function CompareScreen({ a, b, onBack }: { a: CompareSide; b: CompareSide; onBack: () => void }) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    const ctl = new AbortController();
    setLoad({ state: 'loading' });
    const side = (x: CompareSide) => ({ market: x.market, gtin: x.gtin, ingredientsText: x.ingredientsText,
      origin: x.origin, date: x.date });
    fetchComparison(side(a), side(b), ctl.signal)
      .then(out => setLoad(out.found ? { state: 'ready', data: out } : { state: 'failed', kind: 'no_text' }))
      .catch(err => {
        if (ctl.signal.aborted) return;
        setLoad({ state: 'failed', kind: err instanceof VersoError && err.kind === 'network' ? 'network' : 'server' });
      });
    return () => ctl.abort();
  }, [a, b, attempt]);

  if (load.state === 'loading') {
    return (
      <View style={s.page}>
        <Header onBack={onBack} title="Compare" />
        <View style={s.center}>
          <ActivityIndicator color={t.ink2} />
          <Text style={s.p}>Lining up the two lists…</Text>
        </View>
      </View>
    );
  }

  if (load.state === 'failed') {
    const copy = {
      network: ['Can’t reach Verso', 'Comparing needs a connection. Both labels are still saved in your Library.'],
      server: ['Verso hit a problem', 'Something failed on Verso’s side. Trying again in a minute usually works.'],
      no_text: ['One label has no ingredient list', 'Verso can only compare two labels it can read.'],
    }[load.kind];
    return (
      <View style={s.page}>
        <Header onBack={onBack} title="Compare" />
        <ScrollView contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={s.h1} accessibilityRole="header">{copy[0]}</Text>
          <Text style={s.p}>{copy[1]}</Text>
          {load.kind !== 'no_text' && <Button label="Try again" onPress={retry} style={{ marginTop: 24 }} />}
        </ScrollView>
      </View>
    );
  }

  const d = load.data;
  const changed = (side: 'a' | 'b') => new Set(d.deltas.flatMap(x => x[side].map(i => i.slug)));
  const changedA = changed('a'), changedB = changed('b');

  return (
    <View style={s.page}>
      <Header onBack={onBack} title="Compare" />
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={s.eyebrow}>COMPARE LABELS</Text>
        <Text style={s.h1} accessibilityRole="header">
          {d.headline?.text ?? 'Verso won’t compare these two labels yet'}
        </Text>

        <View style={s.labels}>
          <LabelCard t={t} side={d.a} title={a.title} />
          <LabelCard t={t} side={d.b} title={b.title} />
        </View>

        {d.suppressed && (
          <Card style={{ marginTop: 16 }}>
            <Text style={s.cardBody}>
              {d.suppressionCode === 'coverage'
                ? `Verso could read only ${Math.round((d.unreadableSide === 'a' ? d.a : d.b).coverage * 100)}% of the ${(d.unreadableSide === 'a' ? d.a : d.b).label}. It compares labels only when it can read at least 80% of each, so it won’t guess at differences.`
                : 'Some items on one label couldn’t be identified, so Verso can’t confirm what is missing from either list. It doesn’t show differences it can’t confirm.'}
            </Text>
          </Card>
        )}

        {d.deltas.length > 0 && (
          <>
            <SectionTitle t={t}>Differences</SectionTitle>
            {d.deltas.map(delta => (
              <Card key={`${delta.type}${delta.position}${delta.a.concat(delta.b).map(i => i.slug).join()}`}
                style={{ marginBottom: 12 }}>
                <Text style={s.claim}>{delta.claim.text}</Text>
                <View style={s.columns}>
                  <Column t={t} heading={d.a.label} items={delta.a} />
                  <View style={s.columnRule} />
                  <Column t={t} heading={d.b.label} items={delta.b} />
                </View>
              </Card>
            ))}
          </>
        )}

        <SectionTitle t={t}>Both lists in full</SectionTitle>
        <Card>
          <View style={s.columns}>
            <FullList t={t} side={d.a} changed={changedA} />
            <View style={s.columnRule} />
            <FullList t={t} side={d.b} changed={changedB} />
          </View>
        </Card>

        <View style={s.foot}>
          <Text style={s.footText}>{d.sourced.text}</Text>
          {!!d.compositionSource && (
            <>
              <Text style={s.footText}>Saturated fat ranges: {d.compositionSource.instrument}</Text>
              {!!d.compositionSource.sourceUrl && (
                <LinkButton label="View source" external color={t.accent}
                  onPress={() => Linking.openURL(d.compositionSource!.sourceUrl!).catch(() => {})} />
              )}
            </>
          )}
          {!d.suppressed && d.withheld > 0 && (
            <Text style={s.footText}>
              Part of one label couldn’t be read, so {d.withheld === 1 ? 'one possible difference is' : `${d.withheld} possible differences are`} not shown.
            </Text>
          )}
          <Text style={s.footText}>Verso shows what the two labels say. It doesn’t say why they differ.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function LabelCard({ t, side, title }: { t: Theme; side: CompareSideOut; title: string }) {
  const s = styles(t);
  return (
    <Card style={{ flex: 1, padding: 12 }}>
      <Text style={s.labelName}>{side.label.replace(/^\w/, c => c.toUpperCase())}</Text>
      <Text style={s.labelMeta} numberOfLines={2}>{side.product?.name ?? title}</Text>
      <Text style={s.labelMeta}>{side.source.replace(/^\w/, c => c.toUpperCase())}</Text>
    </Card>
  );
}

function Column({ t, heading, items }: { t: Theme; heading: string; items: CompareIngredient[] }) {
  const s = styles(t);
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.colHead}>{heading.toUpperCase()}</Text>
      {items.length === 0 ? <Text style={s.absent}>Not listed</Text> : items.map(i => (
        <View key={i.slug} style={{ marginTop: 6 }}>
          <Text style={s.colItem}>{i.displayName}</Text>
          {!!i.saturated && <Text style={s.colMeta}>{i.saturated.low}–{i.saturated.high}% saturated fat</Text>}
        </View>
      ))}
    </View>
  );
}

function FullList({ t, side, changed }: { t: Theme; side: CompareSideOut; changed: Set<string> }) {
  const s = styles(t);
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.colHead}>{side.label.toUpperCase()}</Text>
      {side.items.map(item => {
        const hit = item.ingredients.some(i => changed.has(i.slug));
        return (
          <Text key={item.position} style={[s.fullItem, hit && s.fullItemChanged]}>
            {item.text}
          </Text>
        );
      })}
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20, paddingTop: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  eyebrow: { color: t.ink3, fontSize: type.caption, letterSpacing: 1, fontWeight: '600' },
  h1: { color: t.ink, fontSize: type.display, lineHeight: 34, fontWeight: '800', marginTop: 8, letterSpacing: -0.6 },
  p: { color: t.ink2, fontSize: type.bodyLg, lineHeight: 24, marginTop: 10 },
  group: { color: t.ink3, fontSize: type.caption, fontWeight: '700', letterSpacing: 1, marginTop: 28,
    marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: t.surface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.rule, overflow: 'hidden' },
  empty: { color: t.ink3, fontSize: type.body, marginLeft: 4 },

  labels: { flexDirection: 'row', gap: 12, marginTop: 20 },
  labelName: { color: t.ink, fontSize: type.bodyLg, fontWeight: '700' },
  labelMeta: { color: t.ink3, fontSize: type.caption, lineHeight: 17, marginTop: 4 },
  cardBody: { color: t.ink2, fontSize: type.body, lineHeight: 21 },

  claim: { color: t.ink, fontSize: type.bodyLg, lineHeight: 24 },
  columns: { flexDirection: 'row', gap: 12, marginTop: 14 },
  columnRule: { width: StyleSheet.hairlineWidth, backgroundColor: t.rule },
  colHead: { color: t.ink3, fontSize: type.caption, fontWeight: '700', letterSpacing: 0.8 },
  colItem: { color: t.ink, fontSize: type.body, fontWeight: '600' },
  colMeta: { color: t.ink2, fontSize: type.caption, marginTop: 2 },
  absent: { color: t.ink3, fontSize: type.body, marginTop: 6, fontStyle: 'italic' },
  fullItem: { color: t.ink2, fontSize: type.body, lineHeight: 20, marginTop: 8 },
  fullItemChanged: { color: t.ink, fontWeight: '700' },

  foot: { marginTop: 28, gap: 8 },
  footText: { color: t.ink3, fontSize: type.caption, lineHeight: 17 },
});
