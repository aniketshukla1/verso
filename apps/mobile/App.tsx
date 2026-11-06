import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScanScreen, type Capture, type Stage } from './src/screens/ScanScreen';
import { VerdictScreen, type SavedState } from './src/screens/VerdictScreen';
import { ProblemScreen, type ProblemKind } from './src/screens/ProblemScreen';
import { ProcessingScreen, type ProcessingStage } from './src/screens/ProcessingScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { YouScreen, MarketScreen } from './src/screens/YouScreen';
import { MethodScreen } from './src/screens/MethodScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { CompareScreen, ComparePickerScreen, type CompareSide } from './src/screens/CompareScreen';
import { SAMPLES, type SampleLabel } from './src/screens/samples';
import { fetchVerdict, fetchMethodVersion, VersoError } from './src/api/client';
import { getOcr } from './src/ocr';
import {
  readCache, writeCache, saveHistory, listHistory, getSetting, setSetting, queueContribution,
  pendingContributions, cacheKey, titleFor, type HistoryEntry, type ScanInput,
} from './src/cache/verdicts';
import { useTheme } from './src/ui/theme';
import { TabBar, TAB_BAR_HEIGHT, type Tab } from './src/ui/kit';
import { MARKETS, placeLabel, todayIso } from './src/ui/format';
import type { Verdict } from './src/types/verdict';

// SafeAreaProvider must sit above anything that reads insets. It is also what
// lets the camera run edge to edge while the controls stay clear of the notch.
export default function App() {
  return (
    <SafeAreaProvider>
      <Verso />
    </SafeAreaProvider>
  );
}

/** A scan the app is resolving: what to send, and where it came from. */
interface Scan {
  input: ScanInput;
  origin: 'scan' | 'sample';
  sample?: SampleLabel;
  /** Kept so "Try again" can re-run it without a new photo. */
  capture: Capture;
}

type Route =
  | { name: 'processing'; capture: Capture; stage: ProcessingStage }
  | { name: 'verdict'; verdict: Verdict; scan: Scan; saved: SavedState }
  | { name: 'problem'; kind: ProblemKind; capture: Capture; detail?: string }
  | { name: 'picker'; from: CompareSide }
  | { name: 'compare'; a: CompareSide; b: CompareSide }
  | { name: 'search' }
  | { name: 'method' }
  | { name: 'market' };

const BACK_LABEL: Record<Route['name'], string> = {
  processing: 'Back', verdict: 'Result', problem: 'Back', picker: 'Compare', compare: 'Compare',
  search: 'Search', method: 'Back', market: 'Back',
};
const TAB_LABEL: Record<Tab, string> = { scan: 'Scan', library: 'Library', you: 'You' };

// The market a new install scores for: the device region when Verso covers it.
// A wrong default silently changes every score, so it is shown on the Scan tab
// ("Scoring for India") and one tap from being changed.
function localeMarket() {
  try {
    const region = Intl.DateTimeFormat().resolvedOptions().locale.split(/[-_]/)
      .find(part => /^[A-Z]{2}$/.test(part));
    return region && MARKETS.some(m => m.code === region) ? region : null;
  } catch {
    return null;
  }
}

function Verso() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('scan');
  const [stack, setStack] = useState<Route[]>([]);
  const [market, setMarketState] = useState('IN');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [queued, setQueued] = useState(0);
  const [methodVersion, setMethodVersion] = useState<string | null>(null);
  const [stageRequest, setStageRequest] = useState<{ stage: Stage; n: number }>();
  const [pendingCompare, setPendingCompare] = useState<{ from: CompareSide; market: string } | null>(null);

  // Refs for values read inside async flows, which must not act on stale state.
  const pendingCompareRef = useRef(pendingCompare);
  pendingCompareRef.current = pendingCompare;
  const busyRef = useRef(false);
  // Every navigation away bumps this, so a slow response for a screen the user
  // has already left cannot yank them back to it.
  const flow = useRef(0);

  const top = stack[stack.length - 1];
  const push = useCallback((r: Route) => setStack(s => [...s, r]), []);
  // Leaving a screen abandons whatever it was waiting for, so the capture
  // button is free again at once rather than when the old request gives up.
  const release = () => { busyRef.current = false; setBusy(false); };
  const pop = useCallback(() => { flow.current++; release(); setStack(s => s.slice(0, -1)); }, []);
  const home = useCallback((next: Tab = 'scan') => { flow.current++; release(); setStack([]); setTab(next); }, []);

  // A result, a problem or the processing screen replaces any of those;
  // anything else stacks, so Back from a searched result returns to the search.
  const show = useCallback((r: Route) => setStack(s => {
    const last = s[s.length - 1];
    const replaceable = last && (last.name === 'verdict' || last.name === 'problem' || last.name === 'processing');
    return replaceable ? [...s.slice(0, -1), r] : [...s, r];
  }), []);

  const refreshHistory = useCallback(() => { listHistory().then(setHistory).catch(() => {}); }, []);
  const refreshQueued = useCallback(() => {
    pendingContributions().then(rows => setQueued(rows.length)).catch(() => {});
  }, []);

  useEffect(() => {
    getSetting('market').then(saved => setMarketState(saved ?? localeMarket() ?? 'IN')).catch(() => {});
    refreshHistory();
    refreshQueued();
    fetchMethodVersion().then(v => { if (v) setMethodVersion(prev => prev ?? v); });
  }, [refreshHistory, refreshQueued]);

  const setMarket = useCallback((code: string) => {
    if (pendingCompareRef.current) {
      setPendingCompare(p => (p ? { ...p, market: code } : p));
      return;
    }
    setMarketState(code);
    setSetting('market', code).catch(() => {});
  }, []);

  // Android's back button walks the stack, then returns to Scan, then leaves.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) { pop(); return true; }
      if (tab !== 'scan') { setTab('scan'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, pop]);

  const sideOf = (scan: Scan, verdict?: Verdict): CompareSide => ({
    market: scan.input.market,
    ingredientsText: scan.input.ingredientsText,
    gtin: scan.input.gtin,
    origin: scan.origin,
    date: todayIso(),
    title: verdict ? titleFor(verdict, scan.sample?.label) : scan.sample?.label ?? 'Label',
    productKey: scan.sample?.productKey ?? null,
  });

  // Resolve a scan into a verdict. The order is the offline promise:
  //   1. show the saved verdict at once, if there is one
  //   2. refresh it from the server
  //   3. if the refresh fails, KEEP the saved verdict and say it is saved —
  //      a failed request must never replace a result the user already has.
  // (The old flow did step 3 wrong: the error screen overwrote the saved
  // verdict, so the cache failed exactly when there was no signal.)
  // `fromCapture` is true only for a label captured on the Scan tab: reopening a
  // Library entry while a comparison is pending must not silently complete it.
  // `flowId` lets a capture that is already under way keep its own identity, so
  // Back pressed while the photo is being read cancels the whole scan.
  // `refreshes` counts automatic re-asks while new ingredients are being looked
  // up: those skip the saved copy, which is the answer they are replacing.
  const resolveScan = useCallback(async (scan: Scan, fromCapture = false, flowId?: number, refreshes = 0) => {
    const id = flowId ?? ++flow.current;
    const current = () => id === flow.current;

    const cached = refreshes ? null : await readCache(scan.input).catch(() => null);
    const saved = cached && cached.verdict.found ? { verdict: cached.verdict, at: cached.cachedAt } : null;
    if (saved && current()) {
      show({ name: 'verdict', verdict: saved.verdict, scan, saved: { at: saved.at, offline: false, refreshing: true } });
    }

    try {
      const fresh = await fetchVerdict(scan.input);
      if (!current()) return;
      setMethodVersion(fresh.methodVersion);
      if (!fresh.found) {
        if (saved) {
          show({ name: 'verdict', verdict: saved.verdict, scan, saved: { at: saved.at, offline: false, refreshing: false } });
        } else {
          show({ name: 'problem', kind: fresh.code === 'not_in_catalogue' ? 'not_in_catalogue' : 'no_text',
            capture: scan.capture });
        }
        return;
      }

      await writeCache(scan.input, fresh).catch(() => {});
      await saveHistory({
        key: cacheKey(scan.input),
        title: titleFor(fresh, scan.sample?.label),
        market: scan.input.market,
        origin: fresh.resolvedFrom === 'catalogue' ? 'catalogue' : scan.origin,
        productKey: scan.sample?.productKey ?? null,
        score: fresh.hazard.score,
        headline: fresh.headline.text,
        input: scan.input,
        scannedAt: Date.now(),
      }).catch(() => {});
      refreshHistory();
      if (!current()) return;

      // The second label of a comparison goes straight to the comparison.
      const comparing = pendingCompareRef.current;
      if (comparing && fromCapture) {
        setPendingCompare(null);
        show({ name: 'compare', a: comparing.from, b: sideOf(scan, fresh) });
        return;
      }
      show({ name: 'verdict', verdict: fresh, scan, saved: null });
      // Ingredients new to Verso were still being looked up: ask again once the
      // lookup has had time to land in the server's cache. Three tries at most.
      if (fresh.identifying?.length && refreshes < 3) {
        setTimeout(() => { if (current()) resolveScanRef.current?.(scan, false, id, refreshes + 1); }, 8000);
      }
    } catch (err) {
      if (!current()) return;
      const kind = err instanceof VersoError ? err.kind : 'server';
      if (saved) {
        show({ name: 'verdict', verdict: saved.verdict, scan,
          saved: { at: saved.at, offline: true, refreshing: false, reason: kind } });
        return;
      }
      show({ name: 'problem', kind, capture: scan.capture,
        detail: err instanceof Error ? err.message : String(err) });
    }
  }, [show, refreshHistory]);
  // the delayed re-ask above needs the current resolveScan, not the one it closed over
  const resolveScanRef = useRef(resolveScan);
  resolveScanRef.current = resolveScan;

  const run = useCallback(async (capture: Capture) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const id = ++flow.current;
    const current = () => id === flow.current;
    try {
      const scanMarket = capture.market ?? pendingCompareRef.current?.market ?? market;
      let text = capture.knownText;
      if (!text && capture.panelUri) {
        // Leave the camera at once. The photo, and a line saying what is
        // happening, answer "did it work?" better than a spinner on the shutter.
        show({ name: 'processing', capture, stage: 'ai' });
        try {
          const ocr = await getOcr();
          // Pass the guide rect through: without it the provider reads the whole
          // frame, including the strip of sensor the preview never showed.
          text = (await ocr.recognise(capture.panelUri, {
            region: capture.region,
            onProgress: reader => { if (current()) show({ name: 'processing', capture, stage: reader }); },
          })).text;
        } catch (err) {
          if (current()) {
            show({ name: 'problem', kind: 'ocr_failed', capture,
              detail: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (!current()) return;   // the user went back while it was being read
        if (!text?.trim()) {
          show({ name: 'problem', kind: 'no_text', capture });
          return;
        }
        show({ name: 'processing', capture, stage: 'checking' });
      }
      await resolveScan({
        input: { gtin: capture.gtin, market: scanMarket, ingredientsText: text?.trim() || undefined },
        origin: capture.sample ? 'sample' : 'scan',
        sample: capture.sample,
        // keep the text: a retry after a network failure must not need a new photo
        capture: { ...capture, knownText: text, market: scanMarket },
      }, true, id);
    } finally {
      // a newer scan owns the busy flag once this one has been abandoned
      if (current()) release();
    }
  }, [market, show, resolveScan]);

  const openHistory = useCallback((e: HistoryEntry) => {
    const sample = e.origin === 'sample'
      ? SAMPLES.find(x => x.market === e.market && x.text === e.input.ingredientsText)
      : undefined;
    resolveScan({
      input: e.input,
      origin: e.origin === 'sample' ? 'sample' : 'scan',
      sample,
      capture: { knownText: e.input.ingredientsText, gtin: e.input.gtin, market: e.market, sample },
    });
  }, [resolveScan]);

  // The label to offer beside a verdict: the same product in another market,
  // when Verso has one. Today that link exists only for test labels; for real
  // scans the verdict offers the picker instead (see samples.ts).
  const counterpartFor = (scan: Scan): CompareSide | null => {
    const key = scan.sample?.productKey;
    if (!key) return null;
    const saved = history.find(e => e.productKey === key && e.market !== scan.input.market);
    if (saved) {
      return { market: saved.market, ingredientsText: saved.input.ingredientsText, gtin: saved.input.gtin,
        origin: saved.origin === 'sample' ? 'sample' : 'scan', title: saved.title, productKey: key,
        date: new Date(saved.scannedAt).toISOString().slice(0, 10) };
    }
    const sample = __DEV__ ? SAMPLES.find(x => x.productKey === key && x.market !== scan.input.market) : undefined;
    return sample
      ? { market: sample.market, ingredientsText: sample.text, origin: 'sample', title: sample.label,
          productKey: key, date: todayIso() }
      : null;
  };

  const toPanel = () => { home('scan'); setStageRequest({ stage: 'panel', n: Date.now() }); };
  const backLabel = () => {
    const below = stack[stack.length - 2];
    return below ? BACK_LABEL[below.name] : TAB_LABEL[tab];
  };

  const renderRoute = (r: Route) => {
    switch (r.name) {
      case 'processing':
        return (
          <ProcessingScreen
            photoUri={r.capture.panelUri}
            region={r.capture.region}
            stage={r.stage}
            backLabel={backLabel()}
            onBack={pop}
          />
        );
      case 'verdict': {
        const counterpart = counterpartFor(r.scan);
        const from = sideOf(r.scan, r.verdict);
        return (
          <VerdictScreen
            verdict={r.verdict}
            photo={r.scan.capture.panelUri ? { uri: r.scan.capture.panelUri, region: r.scan.capture.region } : null}
            sampleTitle={r.scan.sample?.label}
            saved={r.saved}
            backLabel={backLabel()}
            onBack={pop}
            onRetry={() => { resolveScan(r.scan); }}
            compareLabel={counterpart ? `See the ${placeLabel(counterpart.market)} label` : 'Compare with another country'}
            onCompare={() => push(counterpart
              ? { name: 'compare', a: from, b: counterpart }
              : { name: 'picker', from })}
            onContribute={r.scan.origin === 'scan' && r.scan.input.ingredientsText ? async () => {
              await queueContribution({ gtin: r.scan.input.gtin, market: r.scan.input.market,
                ocrText: r.scan.input.ingredientsText! });
              const n = (await pendingContributions()).length;
              setQueued(n);
              return n;
            } : undefined}
            onMethod={() => push({ name: 'method' })}
          />
        );
      }
      case 'problem':
        return (
          <ProblemScreen
            kind={r.kind}
            detail={r.detail}
            backLabel={backLabel()}
            onBack={pop}
            onPrimary={() => {
              if (r.kind === 'network' || r.kind === 'server') run(r.capture);
              else toPanel();
            }}
            onSecondary={() => home('scan')}
          />
        );
      case 'picker':
        return (
          <ComparePickerScreen
            from={r.from}
            library={history}
            onBack={pop}
            onPick={b => push({ name: 'compare', a: r.from, b })}
            onScanOther={code => {
              setPendingCompare({ from: r.from, market: code });
              toPanel();
            }}
          />
        );
      case 'compare':
        return <CompareScreen a={r.a} b={r.b} onBack={pop} />;
      case 'search':
        return (
          <SearchScreen
            market={market}
            onBack={pop}
            onPickProduct={p => run({ gtin: p.gtin, market: p.market })}
            onCheckText={text => run({ knownText: text, market })}
          />
        );
      case 'method':
        return <MethodScreen methodVersion={methodVersion} onBack={pop} />;
      case 'market':
        return (
          <MarketScreen
            market={pendingCompare?.market ?? market}
            onBack={pop}
            onPick={code => { setMarket(code); pop(); }}
          />
        );
    }
  };

  const bottomInset = TAB_BAR_HEIGHT + insets.bottom;
  const overCamera = !top && tab === 'scan' && preview;

  return (
    <View style={[s.root, { backgroundColor: t.paper }]}>
      {/* `style` is the CONTENT colour of the status bar: light over the camera
          preview, automatic over the page. */}
      <StatusBar style={overCamera ? 'light' : 'auto'} />
      {top ? renderRoute(top) : (
        <View style={s.root}>
          {tab === 'scan' && (
            <ScanScreen
              market={pendingCompare?.market ?? market}
              onCapture={run}
              busy={busy}
              bottomInset={bottomInset}
              stageRequest={stageRequest}
              compareWith={pendingCompare ? { label: `${placeLabel(pendingCompare.from.market)} label` } : null}
              onCancelCompare={() => setPendingCompare(null)}
              onChangeMarket={() => push({ name: 'market' })}
              onSearch={() => push({ name: 'search' })}
              onPreview={setPreview}
            />
          )}
          {tab === 'library' && (
            <LibraryScreen entries={history} bottomInset={bottomInset} onOpen={openHistory}
              onScan={() => setTab('scan')} />
          )}
          {tab === 'you' && (
            <YouScreen
              market={market}
              queued={queued}
              methodVersion={methodVersion}
              bottomInset={bottomInset}
              onMarket={() => push({ name: 'market' })}
              onMethod={() => push({ name: 'method' })}
              onSearch={() => push({ name: 'search' })}
            />
          )}
          <View style={s.tabBar}>
            <TabBar
              tab={tab}
              overCamera={tab === 'scan' && preview}
              onChange={next => {
                if (next === 'library') refreshHistory();
                if (next === 'you') refreshQueued();
                setTab(next);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
