import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { create as createAnthropic } from './anthropic.js';
import { create as createOpenAI } from './openai-compatible.js';

/**
 * Provider selection for label transcription.
 *
 * The OCR backend is configuration, not code. Which vendor reads the label is a
 * deployment decision — not something that requires editing a module. Set in
 * .env (the API is started with --env-file-if-exists=.env):
 *
 *   VERSO_OCR_PROVIDER   gemini | opencode | anthropic | openai | auto (default)
 *   VERSO_OCR_MODEL      model id
 *   VERSO_OCR_BASE_URL   for openai-compatible endpoints
 *   VERSO_OCR_API_KEY    falls back to GEMINI_API_KEY / OPENCODE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
 *
 * Examples:
 *   Gemini (free) VERSO_OCR_PROVIDER=gemini GEMINI_API_KEY=...   (key: aistudio.google.com/apikey)
 *   OpenCode Zen  VERSO_OCR_PROVIDER=opencode            (Claude models, key below)
 *                 VERSO_OCR_MODEL=claude-opus-5          (optional; default claude-sonnet-5)
 *   Anthropic     ANTHROPIC_API_KEY=...                  (nothing else needed)
 *   OpenRouter    VERSO_OCR_PROVIDER=openai VERSO_OCR_BASE_URL=https://openrouter.ai/api/v1 ...
 *   Local         VERSO_OCR_PROVIDER=openai VERSO_OCR_BASE_URL=http://127.0.0.1:1234/v1 \
 *                 VERSO_OCR_MODEL=qwen2-vl        (no key needed)
 */

// OpenCode Zen serves Claude models through an Anthropic-compatible Messages
// endpoint (<base>/v1/messages), so they go through the official SDK unchanged.
// That endpoint authenticates like Anthropic's own — the x-api-key header; a
// bearer token gets "401 Missing API key". Other Zen models speak OpenAI chat
// completions with a bearer token.
const ZEN = 'https://opencode.ai/zen';
const OPENCODE_DEFAULT_MODEL = 'claude-sonnet-5';

// The OpenCode app keeps its API key here after `opencode auth login`. Reading
// it means the key never has to be copied into another file or pasted anywhere.
// Used only when VERSO_OCR_PROVIDER=opencode and no key is set in the
// environment; the key itself is never logged or reported.
const OPENCODE_AUTH = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
function opencodeStoredKey() {
  try {
    const entry = JSON.parse(readFileSync(OPENCODE_AUTH, 'utf8'))?.opencode;
    return entry?.type === 'api' && typeof entry.key === 'string' && entry.key ? entry.key : null;
  } catch {
    return null;
  }
}

function opencode(model) {
  const env = process.env;
  const fromEnv = env.VERSO_OCR_API_KEY ? 'VERSO_OCR_API_KEY' : env.OPENCODE_API_KEY ? 'OPENCODE_API_KEY' : null;
  const key = fromEnv ? env[fromEnv] : opencodeStoredKey();
  const keySource = fromEnv ?? (key ? 'opencode auth file' : null);
  const name = model ?? OPENCODE_DEFAULT_MODEL;

  return name.startsWith('claude-')
    ? createAnthropic({ apiKey: key, model: name, baseUrl: ZEN, id: 'opencode', keySource })
    : createOpenAI({ apiKey: key, model: name, baseUrl: `${ZEN}/v1`, id: 'opencode', keySource });
}

// Google's Gemini API has a free tier that reads images, and an OpenAI-compatible
// endpoint, so it goes through the same adapter as any chat-completions server.
// Free-tier content is used by Google to improve its products; the paid tier's
// is not. OpenCode's own free models cannot stand in here: Zen answers 403
// "free tier can only be used from within OpenCode" to any other client.
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

// The free tier sheds load unpredictably: on 2026-09-22 two of seven free
// models answered 503 "high demand", one took 57 s, and that evening flash-lite
// took 70 s for a read it had done in 2 s that morning. Asking one model and
// then the other made a slow minute cost 30 s before the phone gave up. So both
// are asked at once, the first good answer wins and the other is cancelled, and
// the pair gets 20 s: the phone then reads on-device, well inside its 30 s wait.
// It spends two free-tier requests per scan.
const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_ATTEMPT_MS = 20_000;

function gemini(model) {
  const env = process.env;
  const keySource = env.VERSO_OCR_API_KEY ? 'VERSO_OCR_API_KEY' : env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : null;
  const make = name => createOpenAI({ apiKey: keySource ? env[keySource] : undefined, model: name,
    baseUrl: GEMINI, id: 'gemini', keySource, timeoutMs: GEMINI_ATTEMPT_MS });
  const primary = make(model ?? GEMINI_DEFAULT_MODEL);
  if (primary.model === GEMINI_FALLBACK_MODEL) return primary;
  const fallback = make(GEMINI_FALLBACK_MODEL);

  return {
    ...primary,
    // Naming unknown terms is plain text: flash-lite named all thirteen terms of
    // a real Indian label correctly in testing (besan, amchur, hing, Ajinomoto),
    // and one request per scan keeps the free-tier quota for reading photos.
    identifyTerms: (terms, ctx) => fallback.identifyTerms(terms, ctx),
    // The result's `model` names whichever one actually read the label.
    async transcribe(imageBuffer, mediaType) {
      const race = new AbortController();
      try {
        return await Promise.any([primary, fallback].map(p => p.transcribe(imageBuffer, mediaType, { signal: race.signal })));
      } catch (err) {
        // both failed: the primary's reason is the one worth reporting
        throw err instanceof AggregateError ? err.errors[0] : err;
      } finally {
        race.abort();   // cancel the slower request, if it is still running
      }
    },
  };
}

let provider = null;

function build() {
  const env = process.env;
  const explicit = (env.VERSO_OCR_PROVIDER ?? 'auto').toLowerCase();
  const model = env.VERSO_OCR_MODEL;
  const baseUrl = env.VERSO_OCR_BASE_URL;
  const key = env.VERSO_OCR_API_KEY;

  // opencode is opt-in by name (or an OPENCODE_API_KEY): never inferred from
  // the mere presence of the OpenCode app's auth file, which would spend money
  // on an account nobody asked this server to use.
  if (explicit === 'opencode' || (explicit === 'auto' && env.OPENCODE_API_KEY)) return opencode(model);
  // By name only: a GEMINI_API_KEY exported for other tools is not a request
  // to send label photos to Google.
  if (explicit === 'gemini') return gemini(model);

  // 'auto' otherwise picks whichever is actually configured: an
  // ANTHROPIC_API_KEY alone, or a base URL alone.
  const wantOpenAI = explicit === 'openai'
    || (explicit === 'auto' && Boolean(baseUrl) && !env.ANTHROPIC_API_KEY);

  return wantOpenAI
    ? createOpenAI({ apiKey: key ?? env.OPENAI_API_KEY, model, baseUrl,
        keySource: key ? 'VERSO_OCR_API_KEY' : env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : null })
    : createAnthropic({ apiKey: key ?? env.ANTHROPIC_API_KEY, model, baseUrl,
        keySource: key ? 'VERSO_OCR_API_KEY' : env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : null });
}

function get() {
  if (!provider) provider = build();
  return provider;
}

/** Test seam: forget the cached provider so env changes take effect. */
export function resetOcrProvider() { provider = null; }

export function ocrConfigured() {
  try { return get().configured(); } catch { return false; }
}

/** What /health reports, so the active backend is visible without reading env. Never the key. */
export function describeOcr() {
  try {
    const p = get();
    return { provider: p.id, model: p.model ?? null, baseUrl: p.baseUrl ?? null,
             keySource: p.keySource ?? null, configured: p.configured() };
  } catch (err) {
    return { provider: 'none', configured: false, error: err.message };
  }
}

// Names unknown label terms, or returns null when no configured provider can.
// Allowed a minute: the verdict stops waiting after a few seconds and lets this
// finish into the cache (packages/canon/src/identify.js). On 2026-09-22 the free
// tier took 12.7 s for four terms that it answers in about 2 s on a quiet day.
export async function identifyLabelTerms(terms, { market } = {}) {
  let p;
  try { p = get(); } catch { return null; }
  if (!p.configured() || !p.identifyTerms) return null;
  return p.identifyTerms(terms, { market, signal: AbortSignal.timeout(60_000) });
}

export async function transcribeLabel(imageBuffer, mediaType = 'image/jpeg') {
  return get().transcribe(imageBuffer, mediaType);
}
