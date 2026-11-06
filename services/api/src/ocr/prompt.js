// The single source of truth for what the model is asked to do.
//
// This is CLAUDE.md rule 2 applied at the earliest possible point: the model
// TRANSCRIBES, it does not interpret. If it were allowed to normalise "Edible
// Vegetable Oil (Palmolein)" into "palm oil", every downstream regulatory claim
// would inherit that error and no amount of deterministic diffing later would
// catch it. The Ingredient Canon does the resolving.
//
// Both providers share this verbatim. A provider that quietly used a softer
// prompt would be a correctness bug, not a configuration difference.

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'ingredientsText', 'language', 'notes'],
  properties: {
    legible: { type: 'boolean',
      description: 'false if the panel cannot be read well enough to transcribe' },
    ingredientsText: { type: 'string',
      description: 'The ingredient declaration transcribed VERBATIM, in the language printed on the pack. Preserve spelling, punctuation, brackets, percentages and E/INS codes exactly. Do not translate. Do not expand abbreviations. Do not reorder. Empty string if not legible.' },
    language: { type: 'string', description: 'ISO 639-1 code of the printed text, or "und".' },
    notes: { type: 'string',
      description: 'Short note on capture problems (glare, crop, blur). Empty string if none.' },
  },
};

export const SYSTEM = [
  'You transcribe ingredient declarations from photographs of food packaging.',
  'Transcribe exactly what is printed. Never translate, normalise, expand, correct,',
  'reorder or interpret an ingredient name. "Palmolein" is not "palm oil".',
  'If part of the panel is unreadable, transcribe what you can and say so in notes',
  'rather than guessing. If you cannot read the panel at all, set legible to false.',
].join(' ');

export const USER_TEXT =
  'Transcribe the ingredient declaration from this packaging photograph.';

/**
 * Coerce a model response into the schema shape.
 *
 * Frontier models honour a JSON schema; smaller and cheaper ones — exactly the
 * ones you would switch to in order to save money — often return prose, a
 * fenced code block, or JSON with commentary wrapped around it. Failing the
 * whole scan on that would make the cheap providers unusable, so parse
 * defensively and record HOW the answer was obtained.
 */
export function coerceTranscription(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('empty transcription response');

  const attempts = [
    text,
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1],
    text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1),
  ].filter(Boolean);

  for (const candidate of attempts) {
    try {
      const o = JSON.parse(candidate);
      if (o && typeof o === 'object' && typeof o.ingredientsText === 'string') {
        return {
          legible: o.legible !== false,
          ingredientsText: o.ingredientsText,
          language: typeof o.language === 'string' ? o.language : 'und',
          notes: typeof o.notes === 'string' ? o.notes : '',
          structured: true,
        };
      }
    } catch { /* try the next shape */ }
  }

  // No JSON anywhere. Treat the reply as the transcription, but say so: a
  // caller that cares about provenance can see this was not schema-checked,
  // and it will show up in the notes rather than pretending to be clean.
  return {
    legible: true,
    ingredientsText: text,
    language: 'und',
    notes: 'model did not return structured output; response used verbatim',
    structured: false,
  };
}

// --- identifying label terms the canon does not know ---
//
// The model names what a term is; it decides nothing else. Its E and CAS
// numbers are only proposals: packages/canon/src/identify.js accepts one only
// when the canon or an official list holds it under a matching name.
export const IDENTIFY_SYSTEM = [
  'You identify ingredients printed on food labels.',
  'For each term give: the standard English name of the substance it names;',
  'its kind: food, additive, flavouring, vitamin_mineral, or not_an_ingredient',
  '(addresses, company names, nutrition-table text, instructions);',
  'its E number only if it is a food additive that has one;',
  'and its CAS number only if it is a single defined chemical.',
  'Name the substance the term names: "Dried Ginger Powder" is ginger, "Mint Leaves" is mint,',
  '"Besan" is chickpea flour. Never guess: use null when unsure.',
  'Reply with JSON only: {"items":[{"term":"...","name":"...","kind":"...","e_number":null,"cas":null}]}',
].join(' ');

export const identifyUserText = (terms, market) =>
  `Market: ${market ?? 'unknown'}. Terms:\n${terms.map(t => `- ${t}`).join('\n')}`;

const KINDS = new Set(['food', 'additive', 'flavouring', 'vitamin_mineral', 'not_an_ingredient']);

// Defensive like coerceTranscription: a cheap model may wrap the JSON in prose.
export function coerceIdentification(raw) {
  const text = String(raw ?? '').trim();
  for (const candidate of [text, text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter(Boolean)) {
    try {
      const o = JSON.parse(candidate);
      const items = Array.isArray(o) ? o : o?.items;
      if (!Array.isArray(items)) continue;
      return items
        .filter(i => i && typeof i.term === 'string')
        .map(i => ({
          term: i.term,
          name: typeof i.name === 'string' && i.name.trim() ? i.name.trim() : null,
          kind: KINDS.has(i.kind) ? i.kind : null,
          e_number: typeof i.e_number === 'string' && i.e_number.trim() ? i.e_number.trim() : null,
          cas: typeof i.cas === 'string' && i.cas.trim() ? i.cas.trim() : null,
        }));
    } catch { /* next shape */ }
  }
  return [];
}
