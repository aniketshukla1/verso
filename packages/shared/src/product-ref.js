// The ODbL boundary marker.
//
// Layers 3 and 4 refer to products by this opaque string, never by foreign key
// into product.*. Resolving a ref back to a row is an application-layer join.
// See docs/PLAN.md §04 — do not replace this with a real FK.

export function productRef({ gtin, source, sourceRef, market }) {
  if (!market) throw new Error('productRef requires a market');
  if (gtin) return `gtin:${gtin}@${market}`;
  if (source && sourceRef) return `${source}:${sourceRef}@${market}`;
  throw new Error('productRef requires either a gtin or a source + sourceRef');
}

export function parseProductRef(ref) {
  const m = /^([a-z0-9_]+):(.+)@([A-Z]{2})$/.exec(ref);
  if (!m) throw new Error(`malformed product_ref: ${ref}`);
  const [, scheme, id, market] = m;
  return scheme === 'gtin'
    ? { gtin: id, market }
    : { source: scheme, sourceRef: id, market };
}

// GTIN-8/12/13 -> GTIN-14, so the same product matches across sources.
export function normaliseGtin(code) {
  const digits = String(code).replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits.padStart(14, '0');
}
