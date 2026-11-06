-- LAYER 2 — INGREDIENT CANON. Proprietary.
--
-- One canonical entity per substance plus a synonym graph. "E102", "tartrazine",
-- "FD&C Yellow 5" and "INS 102" are one molecule and four unmatched strings;
-- resolving that is the precondition for every regulatory lookup and every diff.

create schema if not exists canon;
create extension if not exists vector;
create extension if not exists pg_trgm;

create type canon.ingredient_kind as enum (
  'colour','preservative','antioxidant','sweetener','emulsifier','stabiliser',
  'flavour_enhancer','acidity_regulator','anticaking','flour_treatment',
  'oil_fat','humectant','raising_agent','contaminant','base','other'
);

create table canon.ingredient (
  id           bigserial primary key,
  slug         text unique not null,
  display_name text        not null,
  kind         canon.ingredient_kind not null,
  ins_number   text,                    -- Codex INS digits, e.g. '102'
  e_number     text,                    -- EU prefixed form, e.g. 'E102'
  cas_number   text,
  function     text        not null,    -- what it does in food, plain language
  notes        text,
  created_at   timestamptz not null default now()
);

create unique index ingredient_e_number_idx on canon.ingredient (e_number) where e_number is not null;
create index ingredient_ins_idx            on canon.ingredient (ins_number) where ins_number is not null;

-- kind of synonym matters: an e_number match is exact, a 'local' match may be ambiguous
create type canon.synonym_kind as enum (
  'common','e_number','ins_number','cas','iupac','local','abbrev','trade','misspelling'
);

create table canon.synonym (
  id            bigserial primary key,
  ingredient_id bigint not null references canon.ingredient(id) on delete cascade,
  term          text   not null,          -- as written on a label
  normalised    text   not null,          -- casefolded, punctuation-stripped
  lang          text   not null default 'en',
  kind          canon.synonym_kind not null,
  unique (normalised, lang)
);

create index synonym_normalised_idx on canon.synonym (normalised);
create index synonym_trgm_idx       on canon.synonym using gin (normalised gin_trgm_ops);
create index synonym_ingredient_idx on canon.synonym (ingredient_id);

-- Populated in Phase 1; structure lands now so the resolver has a stable target.
create table canon.ingredient_embedding (
  ingredient_id bigint primary key references canon.ingredient(id) on delete cascade,
  embedding     vector(1024) not null,
  model         text         not null,
  created_at    timestamptz  not null default now()
);

-- Terms seen on labels that resolved to nothing. The content lead's work queue,
-- and the honest measure of how good the canon actually is.
create table canon.unresolved_term (
  id          bigserial primary key,
  normalised  text        not null unique,
  sample_term text        not null,
  hit_count   integer     not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index unresolved_hits_idx on canon.unresolved_term (hit_count desc);
