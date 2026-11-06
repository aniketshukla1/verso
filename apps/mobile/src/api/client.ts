import Constants from 'expo-constants';
import type { VerdictResult, Comparison, CatalogueProduct } from '../types/verdict';

export const API_PORT = Number(process.env.EXPO_PUBLIC_API_PORT ?? 4310);

/**
 * Finding the server has broken repeatedly, each time for a different reason:
 * the Mac's DHCP lease moved it to a new IP, another dev server owned port 3000,
 * and Metro silently reverted to advertising 127.0.0.1 (which, on a phone, means
 * the phone). Hardcoding one address cannot survive any of those.
 *
 * So instead of trusting a single source, we try every address the server could
 * plausibly be at, health-check each, and remember the first that answers.
 * `.local` is in the list on purpose: a Bonjour name is stable across DHCP
 * changes, which a raw IP is not.
 */
function candidates(): string[] {
  const out: string[] = [];
  const push = (base?: string | null) => {
    if (base && !out.includes(base)) out.push(base);
  };

  // 1. An explicit override always wins.
  push(process.env.EXPO_PUBLIC_API_BASE ?? null);

  // 2. Whatever host served us the JS bundle — usually right, but it is
  //    127.0.0.1 when Metro is in localhost mode, which is useless on device.
  const uri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = uri?.split(':')[0];
  if (host && host !== '127.0.0.1' && host !== 'localhost') push(`http://${host}:${API_PORT}`);

  // 3. The Bonjour name of the machine that built this bundle. Survives DHCP.
  push(process.env.EXPO_PUBLIC_DEV_HOSTNAME
    ? `http://${process.env.EXPO_PUBLIC_DEV_HOSTNAME}:${API_PORT}`
    : null);

  // 4. Simulator / emulator loopbacks, last because they are wrong on a phone.
  push(`http://127.0.0.1:${API_PORT}`);
  push(`http://10.0.2.2:${API_PORT}`);   // Android emulator's host alias

  return out;
}

let resolved: string | null = null;
let inFlight: Promise<string> | null = null;

async function reachable(base: string, ms = 2500): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${base}/health`, { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why a request failed, in the terms a screen needs to choose what to say.
 * The raw message is kept for logs and dev builds only: "Network request
 * failed" on a consumer screen was a design-review finding.
 *
 *   network  never reached Verso (offline, wrong Wi-Fi, server down)
 *   server   reached Verso and it failed — not something the user can fix
 */
export class VersoError extends Error {
  constructor(readonly kind: 'network' | 'server', message: string, readonly status?: number) {
    super(message);
  }
}

export async function apiBase(): Promise<string> {
  if (resolved) return resolved;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const tried = candidates();
    for (const base of tried) {
      if (await reachable(base)) {
        resolved = base;
        return base;
      }
    }
    inFlight = null;
    // Name every address actually tried — "could not connect" with no detail is
    // what made this take three rounds to diagnose.
    throw new VersoError('network',
      `Cannot reach the Verso API. Tried: ${tried.join(', ')}. ` +
      'Check the API is running and the phone is on the same Wi-Fi.');
  })();

  return inFlight;
}

/** Forget the cached host — call after a network change. */
export function resetApiBase() {
  resolved = null;
  inFlight = null;
}

// One place that turns fetch's failure modes into VersoError kinds.
async function request(path: string, init: RequestInit, okStatuses: number[] = []) {
  const base = await apiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, init);
  } catch (err) {
    resetApiBase();   // host may have moved; re-resolve next time
    throw new VersoError('network', err instanceof Error ? err.message : 'request failed');
  }
  if (!res.ok && !okStatuses.includes(res.status)) {
    if (res.status >= 500) resetApiBase();
    throw new VersoError('server', `${path} failed with ${res.status}`, res.status);
  }
  return res;
}

export async function fetchVerdict(
  input: { gtin?: string; market: string; ingredientsText?: string },
  signal?: AbortSignal,
): Promise<VerdictResult> {
  // 404 is a real answer (barcode not in the catalogue), not a failure.
  const res = await request('/v1/verdict', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  }, [404]);
  return (await res.json()) as VerdictResult;
}

export interface CompareSideInput {
  market: string;
  gtin?: string;
  ingredientsText?: string;
  origin: 'scan' | 'sample';
  date?: string;
}

export async function fetchComparison(
  a: CompareSideInput, b: CompareSideInput, signal?: AbortSignal,
): Promise<Comparison | { found: false; code: string; side?: 'a' | 'b' }> {
  const res = await request('/v1/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a, b }),
    signal,
  }, [404]);
  return res.json();
}

/** The server's claim-wording version, for "Method 0.2.0" lines outside a verdict. */
export async function fetchMethodVersion(): Promise<string | null> {
  try {
    const res = await request('/health', {});
    return ((await res.json()) as { methodVersion?: string }).methodVersion ?? null;
  } catch {
    return null;
  }
}

export async function searchProducts(q: string, market: string, signal?: AbortSignal) {
  const qs = `q=${encodeURIComponent(q)}&market=${encodeURIComponent(market)}`;
  const res = await request(`/v1/products?${qs}`, { signal });
  return ((await res.json()) as { products: CatalogueProduct[] }).products;
}
