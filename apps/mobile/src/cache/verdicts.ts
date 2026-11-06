import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import type { VerdictResult, Verdict } from '../types/verdict';

// Supermarkets have bad signal. A verdict the user has already seen must come
// back instantly and offline — this is a product requirement, not an
// optimisation. Cached rows are shown immediately while a fresh one is fetched,
// and a failed refresh must never replace them (see App.tsx `run`).

const TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type ScanInput = { gtin?: string; market: string; ingredientsText?: string };

export interface HistoryEntry {
  key: string;
  title: string;
  market: string;
  origin: 'scan' | 'sample' | 'catalogue';
  /** Links the same product across markets. Only dev samples carry one today. */
  productKey: string | null;
  score: number | null;
  headline: string;
  input: ScanInput;
  scannedAt: number;
}

// SQLite is a native concern. On the web build (development only) the same
// API sits on localStorage, so the Library and settings survive a reload while
// iterating on screens. Every access is guarded: storage can throw outright.
const NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

const web = {
  get<T>(k: string, fallback: T): T {
    try {
      const raw = globalThis.localStorage?.getItem(`verso:${k}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch { return fallback; }
  },
  set(k: string, v: unknown) {
    try { globalThis.localStorage?.setItem(`verso:${k}`, JSON.stringify(v)); } catch { /* private mode */ }
  },
};

let dbp: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  if (!dbp) {
    dbp = SQLite.openDatabaseAsync('verso.db').then(async d => {
      await d.execAsync(`
        pragma journal_mode = WAL;
        create table if not exists verdict_cache (
          key        text primary key,
          payload    text not null,
          cached_at  integer not null
        );
        create table if not exists contribution (
          id          integer primary key autoincrement,
          gtin        text,
          market      text not null,
          ocr_text    text not null,
          image_uri   text,
          created_at  integer not null,
          uploaded_at integer
        );
        create table if not exists history (
          key          text primary key,
          title        text not null,
          market       text not null,
          origin       text not null,
          product_key  text,
          score        integer,
          headline     text not null,
          input        text not null,
          scanned_at   integer not null
        );
        create table if not exists setting (
          key    text primary key,
          value  text not null
        );`);
      return d;
    });
  }
  return dbp;
}

// Two independent 32-bit hashes plus the length. One 32-bit hash collides
// often enough across a whole Library to open the wrong product's verdict.
function hash(s: string) {
  let a = 5381, b = 2166136261;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = ((a << 5) + a + c) | 0;
    b = Math.imul(b ^ c, 16777619);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}${s.length.toString(36)}`;
}

export const cacheKey = (i: ScanInput) =>
  i.ingredientsText ? `ocr:${i.market}:${hash(i.ingredientsText)}` : `gtin:${i.gtin}@${i.market}`;

export async function readCache(input: ScanInput) {
  const key = cacheKey(input);
  let row: { payload: string; cached_at: number } | null;
  if (!NATIVE) {
    row = web.get<Record<string, { payload: string; cached_at: number }>>('cache', {})[key] ?? null;
  } else {
    const d = await db();
    row = await d.getFirstAsync<{ payload: string; cached_at: number }>(
      'select payload, cached_at from verdict_cache where key = ?', key);
  }
  if (!row) return null;
  return {
    verdict: JSON.parse(row.payload) as VerdictResult,
    cachedAt: row.cached_at,
    stale: Date.now() - row.cached_at > TTL_MS,
  };
}

export async function writeCache(input: ScanInput, verdict: VerdictResult) {
  const key = cacheKey(input);
  if (!NATIVE) {
    const all = web.get<Record<string, unknown>>('cache', {});
    all[key] = { payload: JSON.stringify(verdict), cached_at: Date.now() };
    web.set('cache', all);
    return;
  }
  const d = await db();
  await d.runAsync(
    'insert or replace into verdict_cache (key, payload, cached_at) values (?, ?, ?)',
    key, JSON.stringify(verdict), Date.now());
}

// --- Library ---

/** A readable title: the catalogue name, a sample's name, or the label's first items. */
export function titleFor(v: Verdict, fallback?: string) {
  if (v.product?.name) return v.product.brand ? `${v.product.name} · ${v.product.brand}` : v.product.name;
  if (fallback) return fallback;
  const names = [...v.ingredients].sort((a, b) => a.rank - b.rank).slice(0, 3).map(i => i.displayName);
  return names.length ? `${names.join(', ')}${v.ingredients.length > 3 ? '…' : ''}` : 'Unreadable label';
}

export async function saveHistory(e: HistoryEntry) {
  if (!NATIVE) {
    const all = web.get<HistoryEntry[]>('history', []).filter(x => x.key !== e.key);
    web.set('history', [e, ...all].slice(0, 200));
    return;
  }
  const d = await db();
  await d.runAsync(
    `insert or replace into history
       (key, title, market, origin, product_key, score, headline, input, scanned_at)
     values (?,?,?,?,?,?,?,?,?)`,
    e.key, e.title, e.market, e.origin, e.productKey, e.score, e.headline,
    JSON.stringify(e.input), e.scannedAt);
}

export async function listHistory(): Promise<HistoryEntry[]> {
  if (!NATIVE) return web.get<HistoryEntry[]>('history', []);
  const d = await db();
  const rows = await d.getAllAsync<{
    key: string; title: string; market: string; origin: HistoryEntry['origin'];
    product_key: string | null; score: number | null; headline: string; input: string; scanned_at: number;
  }>('select * from history order by scanned_at desc limit 200');
  return rows.map(r => ({
    key: r.key, title: r.title, market: r.market, origin: r.origin, productKey: r.product_key,
    score: r.score, headline: r.headline, input: JSON.parse(r.input), scannedAt: r.scanned_at,
  }));
}

// --- settings ---

export async function getSetting(key: string): Promise<string | null> {
  if (!NATIVE) return web.get<Record<string, string>>('settings', {})[key] ?? null;
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('select value from setting where key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  if (!NATIVE) {
    web.set('settings', { ...web.get<Record<string, string>>('settings', {}), [key]: value });
    return;
  }
  const d = await db();
  await d.runAsync('insert or replace into setting (key, value) values (?, ?)', key, value);
}

// --- contributions ---

// The contribution loop. Coverage and engagement have the same solution: every
// confirmed OCR extraction becomes a catalogue entry. Queued locally so a scan
// in a basement still counts once signal returns.
export async function queueContribution(c: {
  gtin?: string; market: string; ocrText: string; imageUri?: string }) {
  if (!NATIVE) {
    const all = web.get<{ gtin?: string; market: string; ocr_text: string }[]>('contributions', []);
    web.set('contributions', [...all, { gtin: c.gtin, market: c.market, ocr_text: c.ocrText }]);
    return;
  }
  const d = await db();
  await d.runAsync(
    'insert into contribution (gtin, market, ocr_text, image_uri, created_at) values (?,?,?,?,?)',
    c.gtin ?? null, c.market, c.ocrText, c.imageUri ?? null, Date.now());
}

export async function pendingContributions() {
  if (!NATIVE) {
    return web.get<{ gtin?: string; market: string; ocr_text: string }[]>('contributions', [])
      .map((c, id) => ({ id, gtin: c.gtin ?? null, market: c.market, ocr_text: c.ocr_text }));
  }
  const d = await db();
  return d.getAllAsync<{ id: number; gtin: string | null; market: string; ocr_text: string }>(
    'select id, gtin, market, ocr_text from contribution where uploaded_at is null order by created_at limit 50');
}
