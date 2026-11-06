-- LAYER 4 — VERDICT. Proprietary, derived, reproducible from layers 2 and 3.
--
-- BOUNDARY RULE: products are referenced by OPAQUE TEXT (`product_ref`), never by
-- foreign key into product.*. That single decision is what keeps the join in the
-- application layer and off disk. Do not "improve" this into a real FK.

create schema if not exists verdict;

create table verdict.product_verdict (
  id            bigserial primary key,
  product_ref   text        not null,   -- 'gtin:08901491101837@IN' — NOT a foreign key
  hazard_score  integer     check (hazard_score between 0 and 100),
  nutrition_score integer   check (nutrition_score between 0 and 100),
  method_version text       not null,
  computed_at   timestamptz not null default now(),
  unique (product_ref, method_version)
);
create index verdict_ref_idx on verdict.product_verdict (product_ref);

create type verdict.confidence as enum ('low','medium','high');

create table verdict.comparison (
  id              bigserial primary key,
  brand_key       text        not null,
  product_key     text        not null,
  market_a        text        not null,
  market_b        text        not null,
  product_ref_a   text        not null,   -- opaque, as above
  product_ref_b   text        not null,
  confidence      verdict.confidence not null,
  published       boolean     not null default false,  -- false below threshold
  method_version  text        not null,
  computed_at     timestamptz not null default now(),
  unique (brand_key, product_key, market_a, market_b, method_version)
);
create index comparison_lookup_idx on verdict.comparison (brand_key, product_key);

-- One row per difference the DETERMINISTIC diff engine found. A model may only
-- write prose about rows that already exist here. It may never insert one.
create table verdict.comparison_delta (
  id             bigserial primary key,
  comparison_id  bigint not null references verdict.comparison(id) on delete cascade,
  ingredient_id  bigint references canon.ingredient(id),
  present_in_a   boolean not null,
  present_in_b   boolean not null,
  rank_a         integer,
  rank_b         integer,
  severity       integer not null default 0,
  unique (comparison_id, ingredient_id)
);

-- Every claim ever shown to a user, reconstructable exactly as shown.
create table verdict.claim_version (
  id            bigserial primary key,
  subject_kind  text        not null check (subject_kind in ('verdict','comparison')),
  subject_id    bigint      not null,
  body          text        not null,
  template_id   text        not null,   -- see docs/claim-templates.md
  source_refs   jsonb       not null,   -- artifacts backing this exact wording
  published_at  timestamptz not null default now(),
  retracted_at  timestamptz
);
create index claim_subject_idx on verdict.claim_version (subject_kind, subject_id);
