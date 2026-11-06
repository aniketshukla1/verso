import { pdfText } from './pdf.js';
import { splitIngredients } from '../../../shared/src/normalise.js';

// India's standards for edible oils: Food Safety and Standards (Food Products
// Standards and Food Additives) Regulations, 2011, regulation 2.2.1 "Oils",
// published by FSSAI chapter by chapter. Several copies of Chapter 2.2 sit on
// fssai.gov.in; this is the newest found on 2026-09-23, Version 3 (04.11.2024).
//
// A standard says what an oil must be to be sold under that name in India. It
// is not a safety evaluation, and it is shown as what it is.
export const source = {
  key: 'fssai-oils',
  body: 'FSSAI',
  title: 'Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011, regulation 2.2.1: Oils',
  url: 'https://fssai.gov.in/upload/uploadfiles/files/Chapter%202_2_Fats%20oils%20and%20fat%20emulsions.pdf',
  home: 'https://fssai.gov.in/upload/uploadfiles/files/Chapter%202_2_Fats%20oils%20and%20fat%20emulsions.pdf',
  ext: 'pdf',
  parse,
};

// Every standard is written "<n>. <Name> means ...". Amendments wrap the number
// in brackets and footnote marks: "[4. Flaxseed or Linseed oil (tisi ka tel)
// means", "[24. 77[Multi-Source Edible Oil] means", "[32. (1) Moringa oil means".
// A footnote number only ever stands right before a bracket ("77["); left
// optional on its own it swallowed the first digit of "10." and "12.".
// \f too: pdftotext starts each page with a form feed, and three standards
// (2, 8 and 22) open a page.
const ENTRY = /(?:^|\n)[ \t\f]*(?:\d{1,3}\[|\[)?[ \t]*(\d{1,2})\.[ \t]+(?:\(\d\)[ \t]*)?(?:\d{1,3}\[)?([^\n]*?)\]?[ \t]+means\b([^\n]*)/g;

export function parse(buf) {
  return parseText(pdfText(buf));
}

export function parseText(text) {
  const start = text.search(/\n\s*2\.2\.1\s+OILS/i);
  if (start < 0) throw new Error('FSSAI: regulation "2.2.1 OILS" not found');
  const end = text.slice(start + 10).search(/\n\s*2\.2\.2\b/);
  const section = end > 0 ? text.slice(start, start + 10 + end) : text.slice(start);

  const version = /Version\s*[-–]?\s*([IVX\d]+)\s*\((\d{2}\.\d{2}\.\d{4})\)/i.exec(text.slice(0, 2000));
  const records = [];
  const seen = new Set();
  for (const m of section.matchAll(ENTRY)) {
    const number = Number(m[1]);
    // "Refined vegetable oil.-(1) Refined Vegetable Oil" -> "Refined vegetable oil"
    const name = m[2].replace(/\.-\(\d\).*$/, '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
    // A sub-clause inside a standard also reads "<n>. ... means": only a name
    // that is an oil or a palm fraction is a standard. Checking before marking
    // the number seen, or a sub-clause claims it and the real standard is lost
    // (it hid 2, cotton seed oil, and 22, sunflower seed oil).
    if (!/oil|olein|stearin/i.test(name)) continue;
    if (seen.has(number)) continue;   // the first definition under a number is the standard
    seen.add(number);
    // "Rapeseed or mustard oil-low erucic acid" covers low erucic acid rapeseed
    // oil and low erucic acid mustard oil, and needs those names: without them
    // canola matched the ordinary rapeseed and mustard oil standard (2.2.1(6)).
    const qualified = /^(.*?)\s*[-–]\s*(low erucic acid)$/i.exec(name);
    const variants = qualified
      ? splitIngredients(qualified[1]).filter(n => /oil$/i.test(n)).map(n => `${qualified[2]} ${n}`)
      : [];
    records.push({
      record_key: `2.2.1(${number})`,
      name,
      // "Maize (corn) oil" -> maize oil, corn oil; "Flaxseed or Linseed oil (tisi
      // ka tel)" -> flaxseed oil, linseed oil, tisi ka tel: the label splitter
      // already reads these shapes.
      names: [name, ...splitIngredients(name), ...variants],
      cas: [],
      url: source.url,
      payload: {
        regulation: `2.2.1(${number})`,
        // the definition's first printed line only: the rest wraps across lines,
        // tables and page breaks. Not for quoting; the reader has the PDF.
        definition: `${name} means${m[3]}`.replace(/\s+/g, ' ').trim(),
      },
    });
  }
  // Olive oil (8) is written in another shape: "[ 8 (1) Description: (i) Olive
  // oil is the oil obtained solely from the fruit of the olive tree ...", with
  // its grades as further "(ii) Virgin olive oils are ..." clauses.
  for (const m of section.matchAll(/(?:^|\n)[ \t\f]*(?:\d{1,3}\[|\[)?[ \t]*(\d{1,2})[ \t]*\(1\)[ \t]*Description:\s*\(i\)[ \t]*([A-Z][^\n]*?)\s+is\b([^\n]*)/g)) {
    const number = Number(m[1]);
    if (seen.has(number)) continue;
    seen.add(number);
    const block = section.slice(m.index, m.index + 4000);
    const grades = [...block.matchAll(/\((?:ii|iii|iv|v)\)[ \t]*([A-Z][A-Za-z -]*?oils?)[ \t]+(?:is|are)\b/g)]
      .map(g => g[1].replace(/oils$/, 'oil').trim());
    const name = m[2].trim();
    records.push({
      record_key: `2.2.1(${number})`,
      name,
      names: [name, ...grades],
      cas: [],
      url: source.url,
      payload: { regulation: `2.2.1(${number})`, definition: `${name} is${m[3]}`.replace(/\s+/g, ' ').trim() },
    });
  }
  records.sort((x, y) => x.payload.regulation.localeCompare(y.payload.regulation, 'en', { numeric: true }));

  return {
    published: version ? `Version ${version[1]} (${version[2]})` : null,
    records,
  };
}
