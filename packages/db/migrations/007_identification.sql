-- LAYER 2 — CANON. Label terms the canon did not know, identified on demand.
--
-- When a scanned label names something the canon has never seen ("Hing",
-- "Amchur", "Ajinomoto"), a model proposes what it is and Verso checks the
-- proposal against identifiers it already trusts (packages/canon/src/identify.js).
-- Every answer, including "not an ingredient", is kept here, so each term is
-- looked up once and every later scan resolves it from this table instantly.
--
-- `verified_by` says what confirmed the identification: the EU list's name for
-- the proposed E number, a CAS number confirmed by the canon or an official
-- list, or an existing canon name. NULL means only the model said so; those
-- ingredients are shown as identified automatically and never scored.

alter table canon.ingredient
  add column origin text not null default 'curated' check (origin in ('curated', 'auto')),
  add column verified boolean not null default true;

create table canon.identification (
  normalised    text primary key,          -- normalise(term): the lookup key
  term          text not null,             -- as the label printed it
  outcome       text not null check (outcome in ('matched', 'created', 'not_ingredient', 'unknown')),
  ingredient_id bigint references canon.ingredient(id) on delete cascade,
  name          text,                      -- the model's standard English name
  kind          text,
  e_number      text,
  cas           text,
  verified_by   text check (verified_by in ('e_number', 'cas', 'canon_name')),
  model         text not null,
  identified_at timestamptz not null default now()
);
create index identification_ingredient_idx on canon.identification (ingredient_id);
