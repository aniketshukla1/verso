-- LAYER 3 — EVIDENCE. Contaminants that processing forms in an ingredient.
--
-- Context, like composition (005): shown and cited, never a score input and
-- never evidence coverage. The label declares the oil, not the contaminant; how
-- much forms depends on how the oil was refined; and the same contaminants form
-- in other refined oils too, at lower levels. So a row here says what a body
-- found about the ingredient, in its own words, and what limit a regulation
-- sets, in its own words. It never says the ingredient is banned or hazardous.
--
-- The contaminant's own classifications (IARC group, Prop 65 listing) are not
-- copied here: they are read live from the mirrored lists by CAS number, so a
-- reclassification reaches the app the day the list changes.

create table evidence.process_contaminant (
  id                bigserial primary key,
  ingredient_id     bigint not null references canon.ingredient(id) on delete cascade,
  contaminant       text   not null,       -- as the finding names it
  contaminant_cas   text   not null,       -- the substance the IARC and Prop 65 entries classify
  finding           text   not null,       -- VERBATIM from the source behind citation_id
  citation_id       bigint not null references evidence.citation(id),
  limit_note        text   not null,       -- the regulation's limit, in its own terms
  limit_citation_id bigint not null references evidence.citation(id),
  unique (ingredient_id, contaminant_cas)
);
create index process_contaminant_ingredient_idx on evidence.process_contaminant (ingredient_id);
