-- LAYER 3 — EVIDENCE. Mirrors of official lists, re-checked daily.
--
-- Each whole-list source (the EU additives database, FDA's Substances Added to
-- Food, IARC's classifications, California's Prop 65 list) is downloaded as
-- published, hashed, and kept as a dated file in data/sources/. Its rows are
-- mirrored here so a lookup never waits on a government website, and every
-- difference between two downloads is logged: a reclassification or a new
-- listing is exactly what the content lead needs to see.
--
-- Nothing here is a claim about an ingredient. Claims are derived at query time
-- by matching canon ingredients to these records on CAS number, E number or
-- exact name, and each one carries the record's own source link.

create table evidence.source_snapshot (
  id            bigserial primary key,
  source_key    text        not null,
  url           text        not null,
  retrieved_at  timestamptz not null default now(),
  sha256        text        not null,
  bytes         integer     not null,
  file_path     text        not null,
  published     text,                  -- the source's own "last updated" label
  record_count  integer     not null default 0,
  added         integer     not null default 0,
  changed       integer     not null default 0,
  removed       integer     not null default 0,
  unchanged     boolean     not null default false   -- byte-identical to the previous snapshot
);
create index source_snapshot_key_idx on evidence.source_snapshot (source_key, retrieved_at desc);

create table evidence.source_record (
  source_key        text   not null,
  record_key        text   not null,      -- stable identity within the source
  name              text   not null,
  names_normalised  text[] not null default '{}',   -- normalise() of every name, for exact matching
  cas               text[] not null default '{}',
  e_number          text,                 -- 'E551' form; EU records only
  url               text,                 -- the record's own public page, or the list's
  payload           jsonb  not null,      -- the source's fields, as published
  hash              text   not null,      -- of everything above: a new hash is a changed record
  first_seen        bigint not null references evidence.source_snapshot(id),
  last_seen         bigint not null references evidence.source_snapshot(id),
  removed_in        bigint references evidence.source_snapshot(id),   -- null while listed
  primary key (source_key, record_key)
);
create index source_record_cas_idx   on evidence.source_record using gin (cas);
create index source_record_names_idx on evidence.source_record using gin (names_normalised);
create index source_record_e_idx     on evidence.source_record (e_number) where e_number is not null;

create table evidence.source_change (
  id           bigserial primary key,
  snapshot_id  bigint not null references evidence.source_snapshot(id),
  source_key   text   not null,
  record_key   text   not null,
  change       text   not null check (change in ('added', 'changed', 'removed')),
  before       jsonb,
  after        jsonb
);
create index source_change_snapshot_idx on evidence.source_change (snapshot_id);
