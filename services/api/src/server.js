import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import { pool } from '../../../packages/db/src/db.js';
import { buildVerdict, describeIngredients } from '../../../packages/verdict/src/build.js';
import { SOURCES } from '../../../packages/evidence/src/sources/index.js';
import { compareLabels } from '../../../packages/verdict/src/compare.js';
import { METHOD_VERSION } from '../../../packages/verdict/src/templates.js';
import { transcribeLabel, ocrConfigured, describeOcr, identifyLabelTerms } from './ocr/index.js';
import { scheduleDailySync } from '../../../packages/evidence/src/sync.js';

// 'info' by default: at 'warn' a successful request logs nothing, so "did the
// phone even reach us?" was unanswerable — which is exactly the question that
// matters when a device hangs.
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Fastify defaults bodyLimit to 1MB, which silently 413s a phone photo — an
  // iPhone panel shot is several MB even at reduced quality. The app downscales
  // before sending; this is headroom, not the expected size.
  bodyLimit: 25 * 1024 * 1024,
});
// CORS exists only for the web build during development — a native app sends
// no Origin and needs none. Scoped to loopback and private-range origins so
// enabling it for `expo start --web` does not hand every website on the
// internet a browser-side proxy into this unauthenticated API.
const DEV = process.env.NODE_ENV !== 'production';
if (DEV) {
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);   // native / curl
      const ok = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin);
      cb(ok ? null : new Error('origin not allowed'), ok);
    },
  });
}

await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 1 } });

// Accept a raw image body as well as multipart. React Native's spec-compliant
// fetch rejects the legacy {uri,name,type} FormData shorthand ("unsupported
// formDataPart implementation"), and posting raw bytes sidesteps multipart
// entirely rather than fighting Blob construction on the device.
app.addContentTypeParser(
  ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
  { parseAs: 'buffer' },
  (_req, body, done) => done(null, body),
);
const db = pool();   // pooled: survives a database restart

app.get('/health', async () => ({ ok: true, methodVersion: METHOD_VERSION, ocr: describeOcr() }));

const verdictSchema = {
  body: {
    type: 'object',
    properties: {
      gtin: { type: 'string' },
      market: { type: 'string', pattern: '^[A-Z]{2}$' },
      ingredientsText: { type: 'string' },
    },
    // market is REQUIRED. It decides whether a ban counts as home or foreign,
    // and omitting it silently scored a local ban 13 points too lenient — a
    // wrong answer rather than an error, which is the worse failure here.
    required: ['market'],
    anyOf: [{ required: ['gtin'] }, { required: ['ingredientsText'] }],
  },
};

// One endpoint, two entry paths. A barcode hit and a raw OCR panel produce the
// same shape — the app must not care which it got, because outside the EU and
// US it will usually be the second.
app.post('/v1/verdict', { schema: verdictSchema }, async (req, reply) => {
  const { gtin, market, ingredientsText } = req.body;
  const verdict = await buildVerdict(db, { gtin, market, ingredientsText, identify: identifyLabelTerms });

  // Field-quality instrumentation for OCR. On-device ML Kit never touches this
  // server, so the transcription it produced is only visible here, in the text
  // the app sends on. Logging what was read alongside how much of it resolved
  // is the only way to judge whether on-device OCR is good enough on real
  // packaging — which is a question about labels in the wild, not fixtures.
  if (ingredientsText) {
    const matched = verdict.found ? verdict.ingredients.length : 0;
    const unresolved = verdict.found ? verdict.unresolved : [];
    req.log.info({
      scan: {
        market,
        chars: ingredientsText.length,
        matched,
        unresolvedCount: unresolved.length,
        resolveRate: matched + unresolved.length
          ? +(matched / (matched + unresolved.length)).toFixed(2) : 0,
        unresolved: unresolved.slice(0, 12),
        text: ingredientsText.slice(0, 500),
      },
    }, 'ocr scan');
  }

  if (!verdict.found) return reply.code(404).send(verdict);
  return verdict;
});

// Two labels, one deterministic diff (CLAUDE.md rule 2). Each side is label
// text or a catalogue barcode; `origin` is an enum so a source is never named
// from free text on the request.
const compareSide = {
  type: 'object',
  properties: {
    market: { type: 'string', pattern: '^[A-Z]{2}$' },
    gtin: { type: 'string', maxLength: 20 },
    ingredientsText: { type: 'string', maxLength: 5000 },
    origin: { type: 'string', enum: ['scan', 'sample'] },
    date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
  },
  required: ['market'],
  anyOf: [{ required: ['gtin'] }, { required: ['ingredientsText'] }],
};

app.post('/v1/compare', {
  schema: { body: { type: 'object', properties: { a: compareSide, b: compareSide }, required: ['a', 'b'] } },
}, async (req, reply) => {
  // a and b only, as /v1/verdict picks its fields: the body schema lets extra
  // keys through, and `queue` or `today` are for callers in code, not clients.
  const { a, b } = req.body;
  const out = await compareLabels(db, { a, b });
  if (!out.found) return reply.code(404).send(out);
  return out;
});

// One ingredient, explained exactly as a verdict explains it: identity, every
// curated finding and every official-list check, each with its source link.
app.get('/v1/ingredients/:slug', {
  schema: {
    params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[\\p{L}\\p{N}-]{1,80}$' } }, required: ['slug'] },
  },
}, async (req, reply) => {
  const { rows: [i] } = await db.query(
    `select i.id, i.slug, i.display_name, i.kind, i.e_number, i.ins_number, i.cas_number, i.function,
            array(select s.term from canon.synonym s
                  where s.ingredient_id = i.id and s.kind in ('common', 'local', 'abbrev', 'trade')
                  order by s.lang = 'en' desc, s.term limit 12) as also_called
     from canon.ingredient i where i.slug = $1`, [req.params.slug]);
  if (!i) return reply.code(404).send({ found: false, error: 'unknown ingredient' });

  const matched = [{ id: i.id, slug: i.slug, display_name: i.display_name, e_number: i.e_number,
    kind: i.kind, rank: 0, position: 0, confidence: 'exact' }];
  const { ingredients: [ing], claims, sources, note } = await describeIngredients(db, matched);
  return {
    found: true,
    ingredient: { slug: i.slug, displayName: i.display_name, kind: i.kind, eNumber: i.e_number,
      insNumber: i.ins_number, cas: i.cas_number, function: i.function, alsoCalled: i.also_called },
    regulatory: ing.regulatory, hazards: ing.hazards, composition: ing.composition,
    processContaminants: ing.processContaminants, checks: ing.checks,
    claims, sources, note, methodVersion: METHOD_VERSION,
  };
});

// The official lists Verso mirrors: what each is, where it lives, when it was
// last checked and how much of it changed in the past 30 days.
app.get('/v1/sources', async () => {
  const { rows: latest } = await db.query(
    `select distinct on (source_key) source_key, retrieved_at, published, record_count
     from evidence.source_snapshot order by source_key, id desc`);
  const { rows: changes } = await db.query(
    `select c.source_key, count(*)::int as n
     from evidence.source_change c join evidence.source_snapshot s on s.id = c.snapshot_id
     where s.retrieved_at > now() - interval '30 days' group by c.source_key`);
  const last = new Map(latest.map(r => [r.source_key, r]));
  const changed = new Map(changes.map(r => [r.source_key, r.n]));
  return {
    sources: SOURCES.map(src => ({
      key: src.key, body: src.body, title: src.title, home: src.home,
      published: last.get(src.key)?.published ?? null,
      checkedAt: last.get(src.key)?.retrieved_at ?? null,
      records: last.get(src.key)?.record_count ?? 0,
      changesLast30Days: changed.get(src.key) ?? 0,
    })),
  };
});

// Catalogue search by name — the way forward when the camera is refused.
// Layer 1 only, and attribution travels with every row (ODbL).
app.get('/v1/products', {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string', minLength: 2, maxLength: 80 },
        market: { type: 'string', pattern: '^[A-Z]{2}$' },
      },
      required: ['q'],
    },
  },
}, async req => {
  const { q, market } = req.query;
  // escape LIKE metacharacters so "100%" searches for a percent sign
  const like = '%' + q.trim().replace(/[\\%_]/g, ch => '\\' + ch) + '%';
  const { rows } = await db.query(
    `select p.gtin, p.market, p.brand, p.name, p.ingredients_raw is not null as has_ingredients,
            s.name as source, s.attribution, s.license
     from product.product p join product.source s on s.id = p.source_id
     where p.name ilike $1 or p.brand ilike $1
     order by ($2::text is not null and p.market = $2) desc, p.name
     limit 20`, [like, market ?? null]);
  return {
    products: rows.map(r => ({
      gtin: r.gtin, market: r.market, brand: r.brand, name: r.name,
      hasIngredients: r.has_ingredients, source: r.source,
      attribution: r.attribution, license: r.license,
    })),
  };
});

// Server-side vision transcription. The app's OCR fallback for the frames
// on-device ML Kit cannot handle: glare, curvature, dense multilingual panels.
app.post('/v1/ocr', async (req, reply) => {
  // Validate the REQUEST before reporting server configuration. The other order
  // answered "no image supplied" with 503 ocr_unconfigured, which sends a client
  // bug chasing an unrelated server setting.
  let buf = null;
  let mime = req.headers['content-type'] || 'image/jpeg';
  if (Buffer.isBuffer(req.body)) {
    buf = req.body;
  } else {
    const file = await req.file();
    if (file) { buf = await file.toBuffer(); mime = file.mimetype || mime; }
  }
  if (!buf || buf.length === 0) return reply.code(400).send({ error: 'no image supplied' });

  if (!ocrConfigured()) {
    return reply.code(503).send({
      error: 'ocr_unconfigured',
      message: 'Server transcription is not configured. Set VERSO_OCR_PROVIDER / '
        + 'VERSO_OCR_MODEL / VERSO_OCR_BASE_URL / VERSO_OCR_API_KEY, or ANTHROPIC_API_KEY. '
        + 'On-device OCR does not need any of this.',
      ocr: describeOcr(),
    });
  }

  try {
    const started = Date.now();
    const out = await transcribeLabel(buf, mime);
    // Every AI read costs money: log what it cost and how long it took, so the
    // per-scan price is measured rather than estimated.
    req.log.info({
      ocrAi: {
        provider: describeOcr().provider, model: out.model, ms: Date.now() - started,
        bytes: buf.length, legible: out.legible, structured: out.structured,
        chars: out.ingredientsText.length, usage: out.usage,
      },
    }, 'ai transcription');
    if (!out.legible) {
      return reply.code(422).send({
        error: 'illegible', notes: out.notes,
        message: 'The panel could not be read. Move closer, avoid glare, and keep the text flat.',
      });
    }
    return { text: out.ingredientsText, language: out.language, notes: out.notes };
  } catch (err) {
    req.log.error({ err }, 'transcription failed');
    const status = err?.status && err.status >= 400 && err.status < 500 ? 400 : 502;
    return reply.code(status).send({ error: 'transcription_failed', message: err.message });
  }
});

// The content lead's work queue, straight out of the resolver.
app.get('/v1/unresolved', async (req, reply) => {
  // Number('abc') is NaN and Math.min(NaN, 200) is NaN, which reached Postgres
  // as a bind parameter and 500'd; a negative limit did the same.
  const raw = Number(req.query.limit ?? 50);
  if (!Number.isFinite(raw) || raw < 1) {
    return reply.code(400).send({ error: 'bad_limit', message: 'limit must be a positive number' });
  }
  const limit = Math.min(Math.floor(raw), 200);
  const { rows } = await db.query(
    `select sample_term, hit_count, last_seen from canon.unresolved_term
     order by hit_count desc, last_seen desc limit $1`, [limit]);
  return { terms: rows };
});

// Loopback by default. This API has no auth yet, so binding it to every
// interface puts an open endpoint on whatever network the laptop is joined to.
// Device testing needs LAN access, so that is an explicit opt-in: `pnpm api:lan`.
// Not 3000 or 3001: Next.js dev servers take 3001 whenever 3000 is busy, and
// one did — mid-session, while this API was restarting.
const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
console.log(`verso api on http://${host}:${port}`);

// Re-check the official lists once a day (packages/evidence/src/sync.js).
// Opt-in, so a test run or a second API process never downloads anything.
if (process.env.VERSO_SOURCE_SYNC === 'daily') scheduleDailySync(db, app.log);
if (host === '0.0.0.0') {
  console.warn('WARNING: bound to all interfaces with no authentication. ' +
               'Development and a trusted network only.');
}
