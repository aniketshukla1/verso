-- LAYER 3 — EVIDENCE, continued. Proprietary.
--
-- Compositional ranges from published food standards. These describe what a
-- SUBSTANCE is made of; they are not findings against it, so they never move
-- the hazard score (docs/methodology.md, "Two scores, never one"). They exist
-- because the formulation-gap story is often a story about composition — the
-- India and US Lay's labels differ by which oil they declare, and nothing on
-- either label is banned anywhere.
--
-- Cited like every other evidence row: citation_id is NOT NULL.

create schema if not exists evidence;

create table evidence.composition (
  id            bigserial primary key,
  ingredient_id bigint  not null references canon.ingredient(id) on delete cascade,
  component     text    not null,     -- as the standard names it: 'C16:0'
  range_text    text    not null,     -- verbatim from the source table: 'ND-0.6'
  low           numeric not null,     -- 'ND' (not detected) is stored as 0
  high          numeric not null,
  basis         text    not null,     -- '% of total fatty acids'
  citation_id   bigint  not null references evidence.citation(id),
  unique (ingredient_id, component),
  check (low <= high)
);
create index composition_ingredient_idx on evidence.composition (ingredient_id);
