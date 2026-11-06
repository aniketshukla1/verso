// The whole-list sources, mirrored daily by packages/evidence/src/sync.js.
// Each module exports `source`: { key, body, title, url, home, ext, parse }.
// parse(buffer) -> { published, records: [{ record_key, name, names, cas,
// e_number?, url, payload }] }.
import { source as eu } from './eu.js';
import { source as fda } from './fda.js';
import { source as iarc } from './iarc.js';
import { source as prop65 } from './prop65.js';
import { source as fssaiOils } from './fssai-oils.js';
import { source as codexOils } from './codex-oils.js';

export const SOURCES = [eu, fda, iarc, prop65, fssaiOils, codexOils];
