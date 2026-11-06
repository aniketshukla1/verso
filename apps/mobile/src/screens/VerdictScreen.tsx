import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Linking, Pressable, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Verdict, Ingredient, Claim, ScoreItem, Rendered } from '../types/verdict';
import type { CaptureRegion } from '../ocr/types';
import { LabelPhoto } from '../ui/LabelPhoto';
import { useTheme, statusTone, statusRank, type, TOUCH, radius, type Theme } from '../ui/theme';
import {
  Header, Card, Chip, Button, LinkButton, SectionTitle, Chevron, CloseIcon,
} from '../ui/kit';
import {
  placeShort, placeIn, placeName, shortDate, savedAt, kindLabel, hazardChip, BODY_ABOUT,
  withheldReason, plural,
} from '../ui/format';

/**
 * A verdict shown from the phone's cache. `offline` means a refresh was tried
 * and failed; `reason` says whether the phone or the server was the problem.
 */
export type SavedState = {
  at: number; offline: boolean; refreshing: boolean; reason?: 'network' | 'server';
} | null;

const open = (url: string | null) => { if (url) Linking.openURL(url).catch(() => {}); };

// An ingredient we score but have nothing on record for. Rendering it with no
// chip made TBHQ look exactly like wheat flour — the "this is fine" false
// reassurance the score gate exists to prevent. Since the official lists are
// mirrored, that usually means no list has an entry for it; a verdict saved on
// the phone before then has no checks at all, and really is unchecked.
const noRecord = (i: Ingredient) =>
  i.kind !== 'base' && i.regulatory.length === 0 && i.hazards.length === 0 && !i.listed;
const unchecked = (i: Ingredient) => noRecord(i) && !i.checks?.length;

const LIST_NAME: Record<string, string> = {
  'eu-additives': 'European Union',
  'fda-substances': 'United States (FDA)',
  iarc: 'IARC, World Health Organization',
  prop65: 'California (Proposition 65)',
  'fssai-oils': 'India (FSSAI oil standards)',
  'codex-oils': 'Codex Alimentarius (FAO/WHO)',
};

function ingredientChips(t: Theme, ing: Ingredient) {
  const chips: { key: string; label: string; fg: string; bg: string; dashed?: boolean }[] = [];
  const acted = ing.regulatory.filter(r => r.status !== 'permitted')
    .sort((a, b) => statusRank(a.status, a.pending) - statusRank(b.status, b.pending));
  for (const r of acted) {
    const tone = statusTone(t, r.status, r.pending);
    chips.push({ key: `r${r.jurisdiction}${r.status}`, label: `${tone.label} · ${placeShort(r.jurisdiction).toUpperCase()}`, fg: tone.fg, bg: tone.bg });
  }
  if (!acted.length && ing.regulatory.length) {
    const places = ing.regulatory.map(r => placeShort(r.jurisdiction).toUpperCase()).join(', ');
    chips.push({ key: 'permitted', label: `PERMITTED · ${places}`, fg: t.ok, bg: t.okSoft });
  }
  for (const h of ing.hazards) {
    const strong = h.grade === 'A' || h.grade === 'B';
    chips.push({ key: `h${h.body}${h.endpoint}`, label: hazardChip(h.body, h.finding),
      fg: strong ? t.flag : t.unknown, bg: strong ? t.flagSoft : t.unknownSoft });
  }
  if (ing.processContaminants?.length) {
    chips.push({ key: 'pc', label: 'PROCESS CONTAMINANTS', fg: t.warn, bg: t.warnSoft });
  }
  if (ing.composition) {
    const s = ing.composition.saturated;
    chips.push({ key: 'sat', label: `${s.low}–${s.high}% SATURATED FAT`, fg: t.accent, bg: t.accentSoft });
  }
  if (unchecked(ing)) chips.push({ key: 'unchecked', label: 'NOT YET CHECKED', fg: t.unknown, bg: t.unknownSoft, dashed: true });
  else if (noRecord(ing)) chips.push({ key: 'nolist', label: 'NO LIST ENTRY', fg: t.unknown, bg: t.unknownSoft, dashed: true });
  return chips;
}

function claimChip(t: Theme, c: Claim) {
  if (c.kind === 'regulatory' && c.status) {
    const tone = statusTone(t, c.status, !!c.pending);
    return { label: `${tone.label} · ${placeShort(c.jurisdiction ?? '').toUpperCase()}`, fg: tone.fg, bg: tone.bg };
  }
  if (c.kind === 'hazard') {
    const strong = c.grade === 'A' || c.grade === 'B';
    return { label: c.body === 'OEHHA' ? 'PROP 65 LIST' : `${c.body} CLASSIFICATION`,
      fg: strong ? t.flag : t.unknown, bg: strong ? t.flagSoft : t.unknownSoft };
  }
  if (c.kind === 'context') return { label: 'PROCESS CONTAMINANTS', fg: t.warn, bg: t.warnSoft };
  return { label: 'WHAT IT’S MADE OF', fg: t.accent, bg: t.accentSoft };
}

function itemLabel(it: ScoreItem) {
  if (it.source === 'regulatory' && it.jurisdiction) {
    const place = placeIn(it.jurisdiction);
    // home bans count for more; say so, since it explains the bigger number
    const where = it.home ? ' (your country)' : '';
    if (it.pending) return `Ban adopted in ${place}, not yet in force — half points${where}`;
    if (it.status === 'warning_required') return `Warning label required in ${place}${where}`;
    if (it.status === 'restricted') return `Restricted in ${place}${where}`;
    return `Banned in ${place}${where}`;
  }
  if (it.body === 'OEHHA') return 'On California’s Prop 65 list';
  return it.finding ? hazardChip(it.body ?? '', it.finding).replace(/^IARC GROUP/, 'IARC Group') : it.reason;
}

export function VerdictScreen({
  verdict: v, photo, sampleTitle, saved, backLabel, onBack, onRetry, onCompare, compareLabel,
  onContribute, onMethod,
}: {
  verdict: Verdict;
  /** The photo this verdict was read from, when it came from the camera. */
  photo?: { uri: string; region?: CaptureRegion } | null;
  sampleTitle?: string;
  saved: SavedState;
  backLabel: string;
  onBack: () => void;
  onRetry: () => void;
  onCompare: () => void;
  compareLabel: string;
  onContribute?: () => Promise<number>;
  onMethod: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const insets = useSafeAreaInsets();
  const h = v.hazard;
  const [detail, setDetail] = useState<Ingredient | null>(null);
  const [showWorking, setShowWorking] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);

  // The at-a-glance row: one chip per status, naming the places. This used to
  // be the smallest text on screen, at the very bottom.
  const summary = useMemo(() => {
    const groups = new Map<string, { fg: string; bg: string; rank: number; places: string[] }>();
    for (const ing of v.ingredients) {
      for (const r of ing.regulatory) {
        if (r.status === 'permitted') continue;
        const tone = statusTone(t, r.status, r.pending);
        const g = groups.get(tone.label) ?? { fg: tone.fg, bg: tone.bg, rank: statusRank(r.status, r.pending), places: [] };
        const place = placeShort(r.jurisdiction).toUpperCase();
        if (!g.places.includes(place)) g.places.push(place);
        groups.set(tone.label, g);
      }
    }
    const chips = [...groups.entries()].sort((a, b) => a[1].rank - b[1].rank)
      .map(([label, g]) => ({ label: `${label} · ${g.places.join(', ')}`, fg: g.fg, bg: g.bg, dashed: false }));
    const listed = v.ingredients.filter(i => i.hazards.some(x => x.grade === 'A' || x.grade === 'B')).length;
    if (listed) chips.push({ label: `ON HAZARD LISTS · ${listed}`, fg: t.flag, bg: t.flagSoft, dashed: false });
    if (h.unresearched.length) {
      // Checked, and no official list has an entry for them. "Not yet checked"
      // stopped being true once every ingredient was looked up in the lists.
      chips.push({ label: `NO LIST ENTRY · ${h.unresearched.length}`, fg: t.unknown, bg: t.unknownSoft, dashed: true });
    }
    return chips;
  }, [v, t, h.unresearched.length]);

  const eyebrow = `${v.resolvedFrom === 'catalogue' ? 'FROM THE CATALOGUE' : 'READ FROM THE LABEL'}` +
    ` · SCORED FOR ${placeIn(v.market ?? v.product?.market ?? '').toUpperCase()}`;

  const itemsFor = (name: string) => h.items.filter(it => it.ingredient === name);

  return (
    <View style={s.page}>
      <Header onBack={onBack} backLabel={backLabel} />
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 40 }]}>
        {saved?.offline && (
          <View style={s.banner} accessibilityRole="alert">
            <Text style={s.bannerTitle}>
              {saved.reason === 'server' ? 'Couldn’t check for updates' : 'No connection'}
            </Text>
            <Text style={s.bannerBody}>
              Showing the result saved {savedAt(saved.at)}. It may be out of date.
            </Text>
            <LinkButton label="Try again" onPress={onRetry} color={t.accent} />
          </View>
        )}
        {!!v.identifying?.length && (
          <Text style={s.refreshing} accessibilityLiveRegion="polite">
            Looking up {v.identifying.length === 1 ? 'one ingredient' : `${v.identifying.length} ingredients`} Verso
            hasn’t seen before… this page updates when they’re found.
          </Text>
        )}
        {saved && !saved.offline && saved.refreshing && (
          <Text style={s.refreshing}>Saved {savedAt(saved.at)} · checking for updates…</Text>
        )}

        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text style={s.headline} accessibilityRole="header">{v.headline.text}</Text>
        {!!v.product && (
          <Text style={s.product}>{v.product.name}{v.product.brand ? ` · ${v.product.brand}` : ''}</Text>
        )}
        {!v.product && !!sampleTitle && <Text style={s.product}>Test label: {sampleTitle}</Text>}

        {!!photo && (
          <View style={s.photo}>
            <LabelPhoto uri={photo.uri} region={photo.region} maxHeight={140} radius={10}
              background={t.surface2} label="The photo this result was read from" />
            <Text style={s.photoCaption}>Read from your photo</Text>
          </View>
        )}

        {summary.length > 0 && (
          <View style={s.chips}>
            {summary.map(c => <Chip key={c.label} label={c.label} fg={c.fg} bg={c.bg} dashed={c.dashed} />)}
          </View>
        )}

        <Button label={compareLabel} onPress={onCompare} style={{ marginTop: 20 }}
          accessibilityHint="Lines this label up against the same product's label from another country" />

        {/* Score, or an honest explanation of its absence. Withholding the number
            is not withholding the facts — the flags below still render in full. */}
        <Card style={{ marginTop: 16 }}>
          {h.suppressed ? (
            <>
              <Text style={s.cardTitle}>Not scored</Text>
              <Text style={s.cardBody}>{withheldReason(h)}</Text>
              <Text style={s.cardBody}>Every finding below is still checked and cited.</Text>
            </>
          ) : (
            <View style={s.scoreRow}>
              <Text style={s.scoreNum} accessibilityLabel={`Score ${h.score} out of 100`}>
                {h.score}<Text style={s.scoreOf}>/100</Text>
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>Score</Text>
                <Text style={s.cardBodyTight}>
                  Starts at 100. Points come off only for bans, warnings and hazard listings on record.
                </Text>
              </View>
            </View>
          )}

          {h.byIngredient.length > 0 && (
            <>
              <Pressable
                onPress={() => setShowWorking(x => !x)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showWorking }}
                style={({ pressed }) => [s.working, pressed && { opacity: 0.6 }]}>
                <Text style={s.workingText}>
                  {h.suppressed ? 'Points on record' : 'How this score was worked out'}
                </Text>
                <Chevron dir={showWorking ? 'up' : 'down'} color={t.accent} size={12} />
              </Pressable>
              {showWorking && (
                <View style={s.breakdown}>
                  {!h.suppressed && <BreakRow t={t} label="Starts at" value="100" strong />}
                  {h.byIngredient.map(b => (
                    <View key={b.ingredient} style={s.breakGroup}>
                      <BreakRow t={t} label={b.ingredient} value={`−${b.points}`} strong />
                      {b.uncapped > b.points && (
                        <Text style={s.breakNote}>
                          Capped at {h.cap} per ingredient ({b.uncapped} points on record)
                        </Text>
                      )}
                      {itemsFor(b.ingredient).map((it, i) => (
                        <BreakRow key={i} t={t} label={itemLabel(it)} value={`−${it.points}`} sub />
                      ))}
                    </View>
                  ))}
                  {!h.suppressed && (
                    <View style={s.breakGroup}>
                      <BreakRow t={t} label="Score" value={`${h.score}/100`} strong />
                    </View>
                  )}
                </View>
              )}
            </>
          )}
          <LinkButton label="How scores work" onPress={onMethod} color={t.accent} />
        </Card>

        {v.claims.length > 0 && (
          <>
            <SectionTitle t={t}>What the record says</SectionTitle>
            {v.claims.map((c, i) => {
              const chip = claimChip(t, c);
              return (
                <Card key={`${c.templateId}${c.ingredient}${i}`} style={s.claim}>
                  <Chip label={chip.label} fg={chip.fg} bg={chip.bg} />
                  <Text style={s.claimText}>{c.text}</Text>
                  {!!c.citation && <Text style={s.citation}>{c.citation}</Text>}
                  {!!c.sourceUrl && (
                    <LinkButton label="View source" external color={t.accent} onPress={() => open(c.sourceUrl)} />
                  )}
                </Card>
              );
            })}
          </>
        )}

        <SectionTitle t={t}>Ingredients ({v.ingredients.length})</SectionTitle>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {v.ingredients.map((ing, i) => {
            const chips = ingredientChips(t, ing);
            return (
              <Pressable
                key={ing.slug}
                onPress={() => setDetail(ing)}
                accessibilityRole="button"
                accessibilityLabel={`${ing.displayName}. ${chips.map(c => c.label).join('. ')}`}
                accessibilityHint="Opens the rules, hazard lists and sources for this ingredient"
                style={({ pressed }) => [
                  s.ing,
                  i < v.ingredients.length - 1 && s.ingRule,
                  pressed && { backgroundColor: t.surface2 },
                ]}>
                <View style={{ flex: 1 }}>
                  <View style={s.ingHead}>
                    <Text style={s.ingName}>{ing.displayName}</Text>
                    {!!ing.eNumber && <Text style={s.eNum}>{ing.eNumber}</Text>}
                  </View>
                  <Text style={s.kind}>
                    {kindLabel(ing.kind)}{ing.identified ? ' · identified automatically' : ''}
                  </Text>
                  {chips.length > 0 && (
                    <View style={s.rowChips}>
                      {chips.map(c => <Chip key={c.key} label={c.label} fg={c.fg} bg={c.bg} dashed={c.dashed} />)}
                    </View>
                  )}
                </View>
                <Chevron color={t.ink3} />
              </Pressable>
            );
          })}
        </Card>

        {v.unresolved.length > 0 && (
          <Card style={{ marginTop: 16 }}>
            <Text style={s.cardTitle}>
              {plural(v.unresolved.length, 'item')} Verso couldn’t identify
            </Text>
            <Text style={s.cardBody}>{v.unresolved.join(' · ')}</Text>
            {onContribute && (queued === null ? (
              <Button kind="secondary" label="Add this label to the review queue" style={{ marginTop: 14 }}
                onPress={async () => setQueued(await onContribute())} />
            ) : (
              <Text style={[s.cardBody, { color: t.ink }]}>
                Queued on this phone ({plural(queued, 'label')} waiting). Sending to the Verso team
                isn’t switched on yet.
              </Text>
            ))}
          </Card>
        )}

        {/* ODbL requires attribution wherever layer-1 data is shown. Not optional. */}
        <View style={s.foot}>
          {!!v.note && <Text style={s.footText}>{v.note.text}</Text>}
          {!!v.product && <Text style={s.footText}>{v.product.attribution}</Text>}
          <Text style={s.footText}>
            Method {v.methodVersion}.{h.byIngredient.length ? ' Every point taken off is listed in the score card.' : ''}
          </Text>
        </View>
      </ScrollView>

      <IngredientSheet ing={detail} note={v.note ?? null} onClose={() => setDetail(null)} />
    </View>
  );
}

function BreakRow({ t, label, value, strong, sub }: {
  t: Theme; label: string; value: string; strong?: boolean; sub?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 4, paddingLeft: sub ? 12 : 0 }}>
      <Text style={{ flex: 1, fontSize: sub ? type.body : type.bodyLg, color: sub ? t.ink2 : t.ink,
        fontWeight: strong ? '600' : '400', lineHeight: sub ? 20 : 22 }}>{label}</Text>
      <Text style={{ fontSize: sub ? type.body : type.bodyLg, color: sub ? t.ink2 : t.ink,
        fontWeight: strong ? '600' : '400', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

function IngredientSheet({ ing, note, onClose }: { ing: Ingredient | null; note: Rendered | null; onClose: () => void }) {
  const t = useTheme();
  const s = useMemo(() => sheetStyles(t), [t]);
  const insets = useSafeAreaInsets();
  if (!ing) return null;
  const sat = ing.composition?.saturated;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close details" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <View style={s.grabber} />
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} accessibilityRole="header">{ing.displayName}</Text>
              <Text style={s.kind}>{kindLabel(ing.kind)}{ing.eNumber ? ` · ${ing.eNumber}` : ''}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
              style={({ pressed }) => [s.close, pressed && { opacity: 0.6 }]}>
              <CloseIcon color={t.ink2} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {unchecked(ing) && (
              <View style={s.block}>
                <Chip label="NOT YET CHECKED" fg={t.unknown} bg={t.unknownSoft} dashed />
                <Text style={s.body}>
                  Verso hasn’t checked {ing.displayName} against bans or hazard lists yet. That isn’t
                  the same as it being fine — it means nobody at Verso has looked.
                </Text>
              </View>
            )}
            {!!ing.identified && (
              <View style={s.block}>
                <Chip label="IDENTIFIED AUTOMATICALLY" fg={t.accent} bg={t.accentSoft} />
                <Text style={s.body}>
                  The label says “{ing.identified.term}”. Verso’s AI identified it as{' '}
                  {(ing.identified.name ?? ing.displayName).toLowerCase()}.{' '}
                  {ing.identified.verifiedBy === 'e_number' ? 'Confirmed by its E number on the EU additives list.'
                    : ing.identified.verifiedBy === 'cas' ? 'Confirmed by its CAS number on an official list.'
                    : ing.identified.verifiedBy === 'canon_name' ? 'That name is an ingredient Verso already knows.'
                    : 'No official list confirms it yet, so it never counts toward the score.'}
                </Text>
              </View>
            )}
            {noRecord(ing) && !unchecked(ing) && (
              <View style={s.block}>
                <Chip label="NO LIST ENTRY" fg={t.unknown} bg={t.unknownSoft} dashed />
                <Text style={s.body}>
                  None of the official lists Verso checks has an entry for {ing.displayName}. That isn’t
                  the same as it being fine.
                </Text>
              </View>
            )}
            {ing.kind === 'base' && ing.regulatory.length === 0 && ing.hazards.length === 0 && !sat && (
              <View style={s.block}>
                <Text style={s.body}>
                  A basic food. No additive rules apply to it, so it doesn’t count toward the score.
                </Text>
              </View>
            )}

            {ing.regulatory.length > 0 && (
              <>
                <Text style={s.subhead}>Rules by place</Text>
                {[...ing.regulatory]
                  .sort((a, b) => statusRank(a.status, a.pending) - statusRank(b.status, b.pending))
                  .map(r => {
                    const tone = statusTone(t, r.status, r.pending);
                    const date = shortDate(r.effectiveFrom);
                    return (
                      <View key={`${r.jurisdiction}${r.status}`} style={s.block}>
                        <View style={s.line}>
                          <Chip label={tone.label} fg={tone.fg} bg={tone.bg} />
                          <Text style={s.place}>{placeName(r.jurisdiction)}</Text>
                        </View>
                        {!!date && (
                          <Text style={s.body}>{r.pending ? `Takes effect ${date}` : `In force since ${date}`}</Text>
                        )}
                        {!!r.note && <Text style={s.body}>{r.note}</Text>}
                        <Text style={s.citation}>{r.instrument}</Text>
                        {!!r.sourceUrl && (
                          <LinkButton label="View source" external color={t.accent} onPress={() => open(r.sourceUrl)} />
                        )}
                      </View>
                    );
                  })}
              </>
            )}

            {ing.hazards.length > 0 && (
              <>
                <Text style={s.subhead}>Hazard lists</Text>
                {ing.hazards.map(hz => (
                  <View key={`${hz.body}${hz.endpoint}`} style={s.block}>
                    <Chip label={hazardChip(hz.body, hz.finding)}
                      fg={hz.grade === 'A' || hz.grade === 'B' ? t.flag : t.unknown}
                      bg={hz.grade === 'A' || hz.grade === 'B' ? t.flagSoft : t.unknownSoft} />
                    <Text style={s.finding}>“{hz.finding}”</Text>
                    {!!BODY_ABOUT[hz.body] && <Text style={s.body}>{BODY_ABOUT[hz.body]}</Text>}
                    <Text style={s.citation}>{hz.instrument}</Text>
                    {!!hz.sourceUrl && (
                      <LinkButton label="View source" external color={t.accent} onPress={() => open(hz.sourceUrl)} />
                    )}
                  </View>
                ))}
              </>
            )}

            {!!ing.checks?.length && (
              <>
                <Text style={s.subhead}>Checked against official lists</Text>
                {ing.checks.map(c => (
                  <View key={c.source} style={s.block}>
                    <Text style={s.place}>{LIST_NAME[c.source] ?? c.body}</Text>
                    <Text style={s.checkText}>{c.text}</Text>
                    {!!c.note && <Text style={s.body}>“{c.note}”</Text>}
                    {!!c.caveat && <Text style={s.body}>{c.caveat}</Text>}
                    {!!c.citation && <Text style={s.citation}>{c.citation}</Text>}
                    <View style={s.links}>
                      {!!c.url && <LinkButton label="View source" external color={t.accent} onPress={() => open(c.url)} />}
                      {(c.links ?? []).map(l => (
                        <LinkButton key={l.url} label={l.label} external color={t.accent} onPress={() => open(l.url)} />
                      ))}
                    </View>
                  </View>
                ))}
                {!!note && <Text style={[s.citation, { marginTop: 16 }]}>{note.text}</Text>}
              </>
            )}

            {!!ing.processContaminants?.length && (
              <>
                <Text style={s.subhead}>Process contaminants</Text>
                <View style={s.block}>
                  <Text style={s.body}>
                    Shown for context, never scored: the label names the oil, not the contaminant. In the words of
                    EFSA, the European Food Safety Authority:
                  </Text>
                  {[...new Set([ing.processContaminants[0].finding, ...ing.processContaminants.flatMap(p => p.quotes)])]
                    .map(q => <Text key={q} style={s.finding}>“{q}”</Text>)}
                  <Text style={s.citation}>{ing.processContaminants[0].instrument}</Text>
                  {!!ing.processContaminants[0].sourceUrl && (
                    <LinkButton label="View source" external color={t.accent}
                      onPress={() => open(ing.processContaminants![0].sourceUrl)} />
                  )}
                </View>
                {ing.processContaminants.map(pc => (
                  <View key={pc.cas} style={s.block}>
                    <Text style={s.place}>{pc.contaminant}</Text>
                    {pc.classifications.map(k => (
                      <View key={k.body} style={{ marginTop: 6 }}>
                        <Text style={s.checkText}>{k.text}</Text>
                        {!!k.url && <LinkButton label="View source" external color={t.accent} onPress={() => open(k.url)} />}
                      </View>
                    ))}
                    <Text style={s.body}>EU limit: {pc.limit.note}</Text>
                    <Text style={s.citation}>{pc.limit.instrument}</Text>
                    {!!pc.limit.sourceUrl && (
                      <LinkButton label="View regulation" external color={t.accent} onPress={() => open(pc.limit.sourceUrl)} />
                    )}
                  </View>
                ))}
              </>
            )}

            {!!sat && (
              <>
                <Text style={s.subhead}>What it’s made of</Text>
                <View style={s.block}>
                  <Text style={s.finding}>Saturated fat: {sat.low}–{sat.high}% of its fatty acids</Text>
                  <Text style={s.body}>
                    The sum of the Codex standard’s range for each saturated fatty acid. Composition is
                    shown for context and never changes the score.
                  </Text>
                  {!!sat.instrument && <Text style={s.citation}>{sat.instrument}</Text>}
                  {!!sat.sourceUrl && (
                    <LinkButton label="View source" external color={t.accent} onPress={() => open(sat.sourceUrl ?? null)} />
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.paper },
  pad: { paddingHorizontal: 20, paddingTop: 16 },
  banner: { backgroundColor: t.warnSoft, borderRadius: radius.card, paddingHorizontal: 16, paddingTop: 14,
    marginBottom: 16 },
  bannerTitle: { color: t.ink, fontSize: type.bodyLg, fontWeight: '600' },
  bannerBody: { color: t.ink, fontSize: type.body, lineHeight: 21, marginTop: 4 },
  refreshing: { color: t.ink3, fontSize: type.caption, marginBottom: 10 },

  eyebrow: { color: t.ink3, fontSize: type.caption, letterSpacing: 1, fontWeight: '600' },
  headline: { color: t.ink, fontSize: type.display, lineHeight: 34, fontWeight: '800', marginTop: 8,
    letterSpacing: -0.6 },
  product: { color: t.ink2, fontSize: type.bodyLg, marginTop: 6 },
  photo: { marginTop: 16, alignItems: 'flex-start' },
  photoCaption: { color: t.ink3, fontSize: type.caption, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },

  cardTitle: { color: t.ink, fontSize: type.title, fontWeight: '700' },
  cardBody: { color: t.ink2, fontSize: type.body, lineHeight: 21, marginTop: 8 },
  cardBodyTight: { color: t.ink2, fontSize: type.body, lineHeight: 20, marginTop: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  scoreNum: { color: t.ink, fontSize: 34, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  scoreOf: { color: t.ink3, fontSize: type.bodyLg, fontWeight: '600', letterSpacing: 0 },
  working: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH,
    marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.rule },
  workingText: { color: t.accent, fontSize: type.body, fontWeight: '600' },
  breakdown: { paddingBottom: 4 },
  breakGroup: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.rule, paddingTop: 6, marginTop: 6 },
  breakNote: { color: t.ink3, fontSize: type.caption, marginBottom: 2 },

  claim: { marginBottom: 12 },
  claimText: { color: t.ink, fontSize: type.bodyLg, lineHeight: 24, marginTop: 10 },
  citation: { color: t.ink3, fontSize: type.caption, lineHeight: 17, marginTop: 8 },

  ing: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16,
    minHeight: 60 },
  ingRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.rule },
  ingHead: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 },
  ingName: { color: t.ink, fontSize: type.bodyLg, fontWeight: '600' },
  eNum: { color: t.ink3, fontSize: type.body, fontVariant: ['tabular-nums'] },
  kind: { color: t.ink3, fontSize: type.body, marginTop: 2 },
  rowChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },

  foot: { marginTop: 32, gap: 6 },
  footText: { color: t.ink3, fontSize: type.caption, lineHeight: 17 },
});

const sheetStyles = (t: Theme) => StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: t.paper, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%',
    paddingHorizontal: 20 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: t.rule, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 12, paddingBottom: 8 },
  title: { color: t.ink, fontSize: type.title, fontWeight: '700' },
  kind: { color: t.ink2, fontSize: type.body, marginTop: 2 },
  close: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', marginRight: -10,
    marginTop: -8 },
  subhead: { color: t.ink3, fontSize: type.caption, fontWeight: '700', letterSpacing: 1, marginTop: 20,
    marginBottom: 4, textTransform: 'uppercase' },
  block: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.rule, paddingTop: 12, marginTop: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  place: { color: t.ink, fontSize: type.bodyLg, fontWeight: '600' },
  finding: { color: t.ink, fontSize: type.bodyLg, lineHeight: 24, marginTop: 8 },
  body: { color: t.ink2, fontSize: type.body, lineHeight: 21, marginTop: 6 },
  citation: { color: t.ink3, fontSize: type.caption, lineHeight: 17, marginTop: 8 },
  checkText: { color: t.ink, fontSize: type.body, lineHeight: 21, marginTop: 6 },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
});
