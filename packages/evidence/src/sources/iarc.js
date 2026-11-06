import { parseLiteral, plainText, CAS } from './text.js';

// IARC publishes its list of classifications as a data block inside the
// JavaScript that renders monographs.iarc.who.int/list-of-classifications.
// There is no CSV endpoint; the page's CSV button builds one in the browser
// from this same block.
export const source = {
  key: 'iarc',
  body: 'IARC',
  title: 'Agents Classified by the IARC Monographs',
  url: 'https://webapi.iarc.who.int/loc/loc.app.js',
  home: 'https://monographs.iarc.who.int/list-of-classifications/',
  ext: 'js',
  parse,
};

// The groups in IARC's own words (Preamble). Quoted, never paraphrased upward:
// 2B is "possibly carcinogenic to humans", not "linked to cancer".
export const IARC_GROUPS = {
  '1': 'Carcinogenic to humans',
  '2A': 'Probably carcinogenic to humans',
  '2B': 'Possibly carcinogenic to humans',
  '3': 'Not classifiable as to its carcinogenicity to humans',
};

export function parse(buf) {
  const js = buf.toString('utf8');
  const at = js.indexOf('agents:[');
  if (at < 0) throw new Error('IARC: data block "agents:[" not found; the page script has changed');
  const { value: agents } = parseLiteral(js, at + 'agents:'.length);
  if (!Array.isArray(agents)) throw new Error('IARC: "agents" is not a list');

  const lastUpdate = /last_update:"([^"]+)"/.exec(js)?.[1];
  const lastVolume = /last_volume:"([^"]+)"/.exec(js)?.[1];

  const records = agents.map(a => {
    const name = plainText(a.name);
    const cas = (a.cas ?? []).map(c => String(c).trim()).filter(c => CAS.test(c));
    // Entries without a group are cross-references, not classifications:
    // "Acetaminophen (see Paracetamol)", "Antimony trioxide, see Trivalent antimony".
    const see = /^(.*?)(?:\s*\(see\s+(.+)\)|,\s*see\s+(.+))$/i.exec(name);
    const group = String(a.group ?? '').trim() || null;
    return {
      record_key: `${name}|${cas.join(',')}`,
      name,
      names: [name, ...(see ? [see[1]] : [])],
      cas,
      url: source.home,
      payload: {
        group,
        see: !group && see ? (see[2] ?? see[3]).trim() : null,
        volumes: (a.volume ?? []).map(String),
        published: a.in_prep ? 'in preparation' : a.year != null ? String(a.year) : null,
        evaluated: a.yeareval != null ? String(a.yeareval) : null,
        comment: a.comment ? plainText(a.comment) : null,
      },
    };
  });

  return {
    published: lastUpdate ? `Last updated ${lastUpdate}, Volumes 1–${lastVolume}` : null,
    records,
  };
}
