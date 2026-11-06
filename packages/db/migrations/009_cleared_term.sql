-- LAYER 2 — CANON. Terms cleared from the content lead's work queue.
--
-- The seeder clears a queued term once the resolver handles it
-- (packages/canon/src/resolve.js, clearResolved). The row is copied here in the
-- same statement that deletes it: its hits and dates are the record of how often
-- a label printed it, and `resolved_to` is what the canon read it as when it was
-- cleared, so every clear can be checked and, if it was wrong, undone.

create table canon.cleared_term (
  id            bigserial primary key,
  unresolved_id bigint      not null,   -- its id in canon.unresolved_term
  normalised    text        not null,
  sample_term   text        not null,
  hit_count     integer     not null,
  first_seen    timestamptz not null,
  last_seen     timestamptz not null,
  resolved_to   text[]      not null,   -- canon slugs in label order; empty if no item is left
  cleared_at    timestamptz not null default now()
);
