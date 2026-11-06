-- LAYER 3 — EVIDENCE. The source's own sentences behind every statement made
-- about a process contaminant.
--
-- The app explained palm oil's contaminants in Verso's words ("other refined
-- oils contain them too, at lower levels"). Each point was true, and EFSA says
-- each one, but a claim with no quotation and no link beside it is exactly what
-- this schema exists to prevent. These are further sentences from the SAME
-- source as citation_id, verbatim, shown as quotations.
alter table evidence.process_contaminant
  add column context_quotes text[] not null default '{}';
