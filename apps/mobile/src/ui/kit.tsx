import React from 'react';
import {
  View, Text, Pressable, StyleSheet, Image, ActivityIndicator,
  type StyleProp, type ViewStyle, type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type, radius, TOUCH, type Theme } from './theme';

// The shared vocabulary of every screen. One card, one chip, one button family,
// one header — the review found three card treatments and four text sizes for
// the same job, which is what these replace.

// ---------- icons ----------
// Drawn from plain Views: no icon font or SVG module, so nothing here needs a
// native rebuild of the dev client.

type IconProps = { color: string; size?: number };

export function Chevron({ color, size = 12, dir = 'right' }: IconProps & { dir?: 'left' | 'right' | 'up' | 'down' }) {
  const rotate = { right: '45deg', left: '-135deg', down: '135deg', up: '-45deg' }[dir];
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: size * 0.62, height: size * 0.62, borderTopWidth: 2, borderRightWidth: 2,
        borderColor: color, transform: [{ rotate }],
        marginLeft: dir === 'right' ? -size * 0.25 : dir === 'left' ? size * 0.25 : 0,
        marginTop: dir === 'down' ? -size * 0.3 : dir === 'up' ? size * 0.3 : 0,
      }} />
    </View>
  );
}

export function CloseIcon({ color, size = 14 }: IconProps) {
  const bar = { position: 'absolute' as const, width: size * 1.2, height: 2, backgroundColor: color, borderRadius: 1 };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

export function CheckIcon({ color, size = 16 }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.36, height: size * 0.7, borderRightWidth: 2.25, borderBottomWidth: 2.25,
        borderColor: color, transform: [{ rotate: '45deg' }], marginTop: -size * 0.12 }} />
    </View>
  );
}

function ScanGlyph({ color, size = 24 }: IconProps) {
  const c = size * 0.34, w = 2.25;
  const corner = (pos: ViewStyle) => (
    <View style={[{ position: 'absolute', width: c, height: c, borderColor: color }, pos]} />
  );
  return (
    <View style={{ width: size, height: size }}>
      {corner({ top: 1, left: 1, borderTopWidth: w, borderLeftWidth: w, borderTopLeftRadius: 4 })}
      {corner({ top: 1, right: 1, borderTopWidth: w, borderRightWidth: w, borderTopRightRadius: 4 })}
      {corner({ bottom: 1, left: 1, borderBottomWidth: w, borderLeftWidth: w, borderBottomLeftRadius: 4 })}
      {corner({ bottom: 1, right: 1, borderBottomWidth: w, borderRightWidth: w, borderBottomRightRadius: 4 })}
      <View style={{ position: 'absolute', left: size * 0.28, right: size * 0.28, top: size / 2 - 1,
        height: w, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

function LibraryGlyph({ color, size = 24 }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 }}>
      <View style={{ width: size * 0.56, height: 2.25, backgroundColor: color, borderRadius: 1, marginBottom: 2.5, opacity: 0.7 }} />
      <View style={{ width: size * 0.72, height: 2.25, backgroundColor: color, borderRadius: 1, marginBottom: 2.5 }} />
      <View style={{ width: size * 0.86, height: size * 0.46, borderWidth: 2.25, borderColor: color, borderRadius: 4 }} />
    </View>
  );
}

function PersonGlyph({ color, size = 24 }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: size, borderWidth: 2.25,
        borderColor: color, marginTop: 1 }} />
      <View style={{ width: size * 0.78, height: size * 0.38, borderTopLeftRadius: size, borderTopRightRadius: size,
        borderWidth: 2.25, borderBottomWidth: 0, borderColor: color, marginTop: size * 0.1 }} />
    </View>
  );
}

// ---------- brand ----------

export function Mark({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/brand/icon.png')}
      style={{ width: size, height: size, borderRadius: size * 0.225 }}
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

// ---------- chip ----------

export function Chip({ label, fg, bg, dashed, style }: {
  label: string; fg: string; bg: string; dashed?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[
      k.chip, { backgroundColor: dashed ? 'transparent' : bg },
      dashed && { borderWidth: 1, borderStyle: 'dashed', borderColor: fg },
      style,
    ]}>
      <Text style={[k.chipText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ---------- card ----------

export function Card({ children, style, onPress, accessibilityLabel }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>;
  onPress?: (e: GestureResponderEvent) => void; accessibilityLabel?: string;
}) {
  const t = useTheme();
  const base = [k.card, { backgroundColor: t.surface, borderColor: t.rule }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { backgroundColor: t.surface2 }]}>
      {children}
    </Pressable>
  );
}

// ---------- buttons ----------

export function Button({ label, onPress, kind = 'primary', disabled, busy, leading, accessibilityHint, style }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'plain';
  disabled?: boolean; busy?: boolean; leading?: React.ReactNode; accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const palette = {
    primary: { bg: t.accent, fg: t.onAccent, border: t.accent },
    secondary: { bg: t.surface, fg: t.ink, border: t.rule },
    plain: { bg: 'transparent', fg: t.accent, border: 'transparent' },
  }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        kind === 'plain' ? k.plainButton : k.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        (disabled || busy) && { opacity: 0.55 },
        pressed && { opacity: 0.8 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={palette.fg} /> : (
        <View style={k.buttonRow}>
          {leading}
          <Text style={[k.buttonText, { color: palette.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** A link that is visibly a link, with a tappable area that meets 44pt. */
export function LinkButton({ label, onPress, color, external }: {
  label: string; onPress: () => void; color: string; external?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={external ? `${label}, opens in browser` : label}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [k.link, pressed && { opacity: 0.6 }]}>
      <Text style={[k.linkText, { color }]}>{label}{external ? ' ↗' : ''}</Text>
    </Pressable>
  );
}

// ---------- header ----------

export function Header({ onBack, backLabel = 'Back', title, right }: {
  onBack?: () => void; backLabel?: string; title?: string; right?: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[k.header, { paddingTop: insets.top, backgroundColor: t.paper, borderBottomColor: t.rule }]}>
      <View style={k.headerRow}>
        <View style={k.headerSide}>
          {onBack && (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              style={({ pressed }) => [k.back, pressed && { opacity: 0.6 }]}>
              <Chevron dir="left" color={t.accent} size={14} />
              <Text style={[k.backText, { color: t.accent }]} numberOfLines={1}>{backLabel}</Text>
            </Pressable>
          )}
        </View>
        {!!title && (
          <Text style={[k.headerTitle, { color: t.ink }]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        )}
        <View style={[k.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
      </View>
    </View>
  );
}

// ---------- list rows ----------

export function SectionTitle({ children, t }: { children: React.ReactNode; t: Theme }) {
  return <Text style={[k.section, { color: t.ink }]} accessibilityRole="header">{children}</Text>;
}

export function ListRow({ title, detail, value, onPress, last, trailing, accessibilityLabel }: {
  title: string; detail?: string; value?: string; onPress?: () => void; last?: boolean;
  trailing?: React.ReactNode; accessibilityLabel?: string;
}) {
  const t = useTheme();
  const body = (
    <>
      <View style={{ flex: 1 }}>
        <Text style={[k.rowTitle, { color: t.ink }]}>{title}</Text>
        {!!detail && <Text style={[k.rowDetail, { color: t.ink2 }]}>{detail}</Text>}
      </View>
      {!!value && <Text style={[k.rowValue, { color: t.ink2 }]}>{value}</Text>}
      {trailing}
      {onPress && !trailing && <Chevron color={t.ink3} />}
    </>
  );
  const style = [k.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.rule }];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [style, pressed && { backgroundColor: t.surface2 }]}>
      {body}
    </Pressable>
  );
}

// ---------- tab bar ----------

export type Tab = 'scan' | 'library' | 'you';
export const TAB_BAR_HEIGHT = 52;

export function TabBar({ tab, onChange, overCamera }: {
  tab: Tab; onChange: (t: Tab) => void; overCamera?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const on = overCamera ? '#FFFFFF' : t.accent;
  const off = overCamera ? 'rgba(255,255,255,0.74)' : t.ink3;
  const items: { id: Tab; label: string; Glyph: (p: IconProps) => React.ReactElement }[] = [
    { id: 'scan', label: 'Scan', Glyph: ScanGlyph },
    { id: 'library', label: 'Library', Glyph: LibraryGlyph },
    { id: 'you', label: 'You', Glyph: PersonGlyph },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={[k.tabBar, {
        paddingBottom: insets.bottom,
        backgroundColor: overCamera ? 'rgba(8,10,14,0.9)' : t.surface,
        borderTopColor: overCamera ? 'rgba(255,255,255,0.12)' : t.rule,
      }]}>
      {items.map(({ id, label, Glyph }) => {
        const active = id === tab;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            style={k.tab}>
            <Glyph color={active ? on : off} />
            <Text style={[k.tabLabel, { color: active ? on : off }, active && { fontWeight: '700' }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const k = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.chip, alignSelf: 'flex-start' },
  chipText: { fontSize: type.caption, fontWeight: '700', letterSpacing: 0.5 },

  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: 16 },

  button: { minHeight: 50, borderRadius: radius.button, borderWidth: 1, paddingHorizontal: 18,
    alignItems: 'center', justifyContent: 'center' },
  plainButton: { minHeight: TOUCH, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontSize: type.bodyLg, fontWeight: '600', textAlign: 'center' },

  link: { minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: type.body, fontWeight: '600' },

  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { height: TOUCH + 4, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  headerSide: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: type.bodyLg, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: TOUCH, paddingHorizontal: 8,
    alignSelf: 'flex-start' },
  backText: { fontSize: type.bodyLg },

  section: { fontSize: type.title, fontWeight: '700', marginTop: 32, marginBottom: 12, letterSpacing: -0.3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 12,
    paddingHorizontal: 16 },
  rowTitle: { fontSize: type.bodyLg, fontWeight: '500' },
  rowDetail: { fontSize: type.body, marginTop: 2, lineHeight: 20 },
  rowValue: { fontSize: type.bodyLg },

  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, height: TAB_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabLabel: { fontSize: type.caption, fontWeight: '500' },
});
