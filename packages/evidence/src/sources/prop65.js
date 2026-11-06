import { parseCsv, CAS } from './text.js';

// OEHHA republishes the list in place. The CSV's folder says 2025-01, but the
// file is updated with each revision; the list's own date is inside it.
export const source = {
  key: 'prop65',
  body: 'OEHHA',
  title: 'Proposition 65 List of chemicals known to the State of California to cause cancer or reproductive toxicity',
  url: 'https://oehha.ca.gov/sites/default/files/media/2025-01/p65chemicalslist.csv',
  home: 'https://oehha.ca.gov/proposition-65/proposition-65-list',
  ext: 'csv',
  parse,
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "1-Jan-90" -> "1990-01-01". The list began in 1987, so a two-digit year of 87
// or later is 19xx.
export function listDate(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(String(s ?? '').trim());
  const month = m && MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const yy = Number(m[3]);
  return `${yy >= 87 ? 1900 + yy : 2000 + yy}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function parse(buf) {
  const rows = parseCsv(buf.toString('utf8'));
  const h = rows.findIndex(r => r[0]?.trim() === 'Chemical' && /type of toxicity/i.test(r[1] ?? ''));
  if (h < 0) throw new Error('Prop 65: header row "Chemical, Type of Toxicity" not found');
  const listed = rows.slice(0, h).map(r => listDate(r[0])).find(Boolean) ?? null;

  const records = [];
  for (const r of rows.slice(h + 1)) {
    const [chemical, toxicity, mechanism, cas, dateListed, limit] = r.map(s => (s ?? '').replace(/\s+/g, ' ').trim());
    if (!chemical || !toxicity) continue;   // blank lines and trailing footnotes
    // One chemical can be listed twice (cancer, and separately developmental
    // toxicity), each with its own date: two records.
    records.push({
      record_key: `${chemical}|${toxicity}`,
      name: chemical,
      names: [chemical],
      cas: cas.split(/[\s,;]+/).filter(c => CAS.test(c)),
      url: source.home,
      payload: {
        toxicity,
        mechanism: mechanism || null,
        listed: listDate(dateListed) ?? (dateListed || null),
        limit: limit || null,   // NSRL or MADL, µg/day
      },
    });
  }
  return { published: listed ? `List dated ${listed}` : null, records };
}
