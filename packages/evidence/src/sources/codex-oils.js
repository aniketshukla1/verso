import { pdfText } from './pdf.js';
import { splitIngredients } from '../../../shared/src/normalise.js';

// Codex Alimentarius (FAO/WHO) Standard for Named Vegetable Oils, CXS 210-1999.
// FAO serves the current edition only to a browser, so the sync takes the 2015
// edition it publishes as a plain file, and says so in `published`.
export const source = {
  key: 'codex-oils',
  body: 'Codex Alimentarius',
  title: 'Standard for Named Vegetable Oils, CXS 210-1999',
  url: 'https://www.fao.org/input/download/standards/336/CXS_210e_2015.pdf',
  home: 'https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/',
  ext: 'pdf',
  parse,
};

export function parse(buf) {
  return parseText(pdfText(buf));
}

export function parseText(raw) {
  const text = raw.replace(/\r/g, '');
  const start = text.search(/\n\s*2\.1\s+Product definitions/i);
  if (start < 0) throw new Error('Codex: "2.1 Product definitions" not found');
  const end = text.slice(start + 10).search(/\n\s*(2\.2|3\.)\s+[A-Z]/);
  const lines = (end > 0 ? text.slice(start, start + 10 + end) : text.slice(start)).split('\n').slice(1);

  // One definition per paragraph: it starts with a capital letter and names the
  // oil before " is " ("Maize oil (corn oil) is derived from maize germ ...").
  // Synonyms are "in brackets immediately following the name of the oil".
  // A new one starts only once the previous has ended with a full stop: the
  // name or its synonyms can wrap ("Rapeseed oil - low erucic acid (... canola
  // oil) is" / "produced from ..."), so a line need not contain " is ".
  const paras = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^\(Note:/i.test(line)) continue;
    const open = paras.length && !/\.$/.test(paras[paras.length - 1]);
    if (/^[A-Z]/.test(line) && !open) paras.push(line);
    else if (paras.length) paras[paras.length - 1] += ` ${line}`;
  }
  const records = paras.filter(p => /^.*?\s+is\s/.test(p)).map(p => {
    const [, head] = /^(.*?)\s+is\s/.exec(p);
    const syn = /\(([^)]*)\)\s*$/.exec(head);
    const name = syn ? head.slice(0, syn.index).trim() : head.trim();
    const synonyms = syn ? syn[1].split(';').map(s => s.trim()).filter(Boolean) : [];
    return {
      record_key: name,
      name,
      names: [name, ...synonyms, ...splitIngredients(name)],
      cas: [],
      url: source.url,
      payload: { section: '2.1', definition: p.replace(/\s+/g, ' ') },
    };
  });
  const amended = /Amendment:[^.]*?(\d{4})\.?\s*$/m.exec(text.slice(0, 3000))?.[1];
  return { published: amended ? `${amended} edition` : null, records };
}
