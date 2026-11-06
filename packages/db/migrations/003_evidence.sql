-- LAYER 3 — EVIDENCE. Proprietary.
--
-- Every row in this schema carries a citation. That is not a convention here,
-- it is a NOT NULL constraint: a claim without a source cannot be inserted.

create schema if not exists evidence;

create table evidence.citation (
  id           bigserial primary key,
  source_key   text        not null,   -- 'iarc','prop65','eu_1333_2008','fda_color','fssai','courtlistener'
  title        text        not null,
  url          text,
  published_on date,
  retrieved_at timestamptz not null default now(),
  unique (source_key, title)
);

create type evidence.reg_status as enum (
  'banned',            -- may not be sold in food
  'not_authorised',    -- never approved (distinct from withdrawn)
  'restricted',        -- permitted only in named categories or below a limit
  'warning_required',  -- permitted with a mandatory label warning
  'permitted'
);

create table evidence.regulatory_status (
  id             bigserial primary key,
  ingredient_id  bigint not null references canon.ingredient(id) on delete cascade,
  jurisdiction   text   not null,        -- 'EU','US','US-CA','IN','GB'
  status         evidence.reg_status not null,
  scope          text   not null default 'all_food',
  limit_note     text,
  effective_from date,
  citation_id    bigint not null references evidence.citation(id),
  unique (ingredient_id, jurisdiction, scope)
);
create index reg_status_ingredient_idx on evidence.regulatory_status (ingredient_id);
create index reg_status_jurisdiction_idx on evidence.regulatory_status (jurisdiction, status);

-- Tiers per docs/methodology.md. D never reaches a score; it is display-only.
create type evidence.grade as enum ('A','B','C','D');

create table evidence.hazard_finding (
  id            bigserial primary key,
  ingredient_id bigint not null references canon.ingredient(id) on delete cascade,
  body          text   not null,      -- 'IARC','EFSA','JECFA','NTP','OEHHA'
  endpoint      text   not null,      -- 'carcinogenicity','reproductive_toxicity', ...
  finding       text   not null,      -- VERBATIM classification. Never paraphrase upward.
  grade         evidence.grade not null,
  citation_id   bigint not null references evidence.citation(id),
  unique (ingredient_id, body, endpoint)
);
create index hazard_ingredient_idx on evidence.hazard_finding (ingredient_id);

create type evidence.case_status as enum ('filed','ongoing','settled','dismissed','judgment');

create table evidence.litigation (
  id            bigserial primary key,
  ingredient_id bigint references canon.ingredient(id) on delete cascade,
  brand         text,
  case_name     text   not null,
  court         text   not null,
  docket        text   not null,      -- verified against CourtListener before publish
  status        evidence.case_status not null,
  filed_on      date,
  summary       text   not null,
  verified_at   timestamptz,          -- null => not publishable
  citation_id   bigint not null references evidence.citation(id),
  unique (court, docket)
);
create index litigation_ingredient_idx on evidence.litigation (ingredient_id);
