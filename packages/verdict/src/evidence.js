// Layers 2 and 3, read on their own. Shared by the verdict and the comparison
// so both explain an ingredient from exactly the same rows.
//
// Nothing here touches schema `product`: see the ODbL boundary note in build.js.

export async function evidenceFor(client, ingredientIds) {
  const reg = new Map(), haz = new Map(), comp = new Map(), pc = new Map();
  if (!ingredientIds.length) return { reg, haz, comp, pc };

  const push = (map, row) => {
    if (!map.has(row.ingredient_id)) map.set(row.ingredient_id, []);
    map.get(row.ingredient_id).push(row);
  };

  const r = await client.query(
    `select rs.ingredient_id, rs.jurisdiction, rs.status, rs.scope, rs.limit_note,
            rs.effective_from, rs.citation_id, c.title as instrument, c.url
     from evidence.regulatory_status rs
     join evidence.citation c on c.id = rs.citation_id
     where rs.ingredient_id = any($1) order by rs.jurisdiction`, [ingredientIds]);
  for (const row of r.rows) push(reg, row);

  const h = await client.query(
    `select hf.ingredient_id, hf.body, hf.endpoint, hf.finding, hf.grade,
            hf.citation_id, c.title as instrument, c.url
     from evidence.hazard_finding hf
     join evidence.citation c on c.id = hf.citation_id
     where hf.ingredient_id = any($1) order by hf.grade, hf.body`, [ingredientIds]);
  for (const row of h.rows) push(haz, row);

  const k = await client.query(
    `select x.ingredient_id, x.component, x.range_text, x.low::float as low, x.high::float as high,
            x.basis, x.citation_id, c.title as instrument, c.url
     from evidence.composition x
     join evidence.citation c on c.id = x.citation_id
     where x.ingredient_id = any($1) order by x.component`, [ingredientIds]);
  for (const row of k.rows) push(comp, row);

  // Process contaminants: context, never scored (008_process_contaminants.sql).
  const p = await client.query(
    `select x.ingredient_id, x.contaminant, x.contaminant_cas, x.finding, x.limit_note, x.context_quotes,
            c.title as instrument, c.url, l.title as limit_instrument, l.url as limit_url
     from evidence.process_contaminant x
     join evidence.citation c on c.id = x.citation_id
     join evidence.citation l on l.id = x.limit_citation_id
     where x.ingredient_id = any($1) order by x.contaminant_cas`, [ingredientIds]);
  for (const row of p.rows) push(pc, row);

  return { reg, haz, comp, pc };
}

// Saturated fat as a BOUND: the sum of the lower limits and the sum of the upper
// limits of every saturated fatty acid (Cn:0) the standard lists. Any oil that
// meets the standard lies inside it. Rounded outward so the bound is never
// tightened by rounding; capped at 100 because a sum of upper limits can pass it.
export function saturatedBound(rows) {
  const sat = (rows ?? []).filter(r => /^C\d+:0$/.test(r.component));
  if (!sat.length) return null;
  const low = sat.reduce((a, r) => a + r.low, 0);
  const high = sat.reduce((a, r) => a + r.high, 0);
  return {
    low: Math.floor(low + 1e-9),
    high: Math.min(100, Math.ceil(high - 1e-9)),
    basis: sat[0].basis,
    instrument: sat[0].instrument,
    sourceUrl: sat[0].url,
    citationId: sat[0].citation_id,
  };
}
