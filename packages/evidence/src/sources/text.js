// Readers for the formats official lists actually arrive in. No dependencies,
// and nothing downloaded is ever executed: IARC ships its list inside a
// JavaScript bundle, and running a file fetched daily from the internet would
// hand that website our database credentials.

// RFC 4180: a quoted field may hold commas, doubled quotes and newlines. A quote
// opens a quoted field only at the start of one; elsewhere it is a character.
// FDA's export is full of unquoted =T("172.515") cells, and treating that inner
// quote as an opener silently strips it.
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, fresh = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
      continue;
    }
    if (ch === '"' && fresh) { quoted = true; fresh = false; continue; }
    fresh = ch === ',' || ch === '\n';
    if (ch === '"') field += ch;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// A JavaScript object or array literal, as minifiers print it: unquoted keys,
// !0 / !1 for true / false, void 0 for undefined. Returns { value, end }.
export function parseLiteral(src, start) {
  let i = start;
  const fail = what => { throw new Error(`${what} at offset ${i}: ${JSON.stringify(src.slice(i, i + 40))}`); };
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };

  function string() {
    const q = src[i++];
    let out = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] !== '\\') { out += src[i++]; continue; }
      const e = src[++i];
      if (e === 'u') { out += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16)); i += 5; continue; }
      if (e === 'x') { out += String.fromCharCode(parseInt(src.slice(i + 1, i + 3), 16)); i += 3; continue; }
      out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
      i++;
    }
    if (src[i] !== q) fail('unterminated string');
    i++;
    return out;
  }

  function value() {
    ws();
    const ch = src[i];
    if (ch === '{') {
      i++;
      const obj = {};
      for (;;) {
        ws();
        if (src[i] === '}') { i++; return obj; }
        let key;
        if (src[i] === '"' || src[i] === "'") key = string();
        else {
          const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(src.slice(i, i + 200));
          if (!m) fail('expected a key');
          key = m[0];
          i += key.length;
        }
        ws();
        if (src[i++] !== ':') fail('expected ":"');
        obj[key] = value();
        ws();
        if (src[i] === ',') i++;
        else if (src[i] !== '}') fail('expected "," or "}"');
      }
    }
    if (ch === '[') {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; return arr; }
        arr.push(value());
        ws();
        if (src[i] === ',') i++;
        else if (src[i] !== ']') fail('expected "," or "]"');
      }
    }
    if (ch === '"' || ch === "'") return string();
    if (src.startsWith('!0', i)) { i += 2; return true; }
    if (src.startsWith('!1', i)) { i += 2; return false; }
    if (src.startsWith('void 0', i)) { i += 6; return undefined; }
    for (const [word, v] of [['true', true], ['false', false], ['null', null]]) {
      if (src.startsWith(word, i)) { i += word.length; return v; }
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
    if (num) { i += num[0].length; return Number(num[0]); }
    return fail('unexpected token');
  }

  const v = value();
  return { value: v, end: i };
}

// Names on official lists carry markup ("<i>Helicobacter pylori</i>",
// "Colours at <em>quantum satis</em>") and HTML entities.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', diams: '♦', mu: 'µ', micro: 'µ' };
export function plainText(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
        : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

export const CAS = /^\d{2,7}-\d{2}-\d$/;
