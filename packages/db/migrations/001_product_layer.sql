-- LAYER 1 — PRODUCT. Derived from ODbL / public-domain sources.
--
-- BOUNDARY RULE: nothing in this schema may reference canon/evidence/verdict,
-- and nothing in those schemas may reference this one via a foreign key, view,
-- or materialized view. Open Food Facts is ODbL; share-alike attaches to a
-- *derivative* database. Keeping this schema referentially independent keeps
-- the estate a *collective* database. Enforced by `pnpm lint:layers`.

create schema if not exists product;

create table product.source (
  id           text primary key,
  name         text        not null,
  license      text        not null,
  license_url  text        not null,
  attribution  text        not null,
  share_alike  boolean     not null,
  added_at     timestamptz not null default now()
);

comment on column product.source.attribution is
  'Verbatim attribution string that must be rendered wherever this data is shown.';

create table product.product (
  id              bigserial primary key,
  source_id       text        not null references product.source(id),
  source_ref      text        not null,
  market          text        not null,           -- ISO 3166-1 alpha-2
  gtin            text,                           -- normalised to GTIN-14
  brand           text,
  name            text        not null,
  ingredients_raw text,                           -- verbatim label string
  retrieved_at    timestamptz not null,
  unique (source_id, source_ref, market)
);

create index product_gtin_idx        on product.product (gtin) where gtin is not null;
create index product_brand_mkt_idx   on product.product (lower(brand), market);
create index product_market_idx      on product.product (market);

create table product.product_image (
  id          bigserial primary key,
  product_id  bigint not null references product.product(id) on delete cascade,
  kind        text   not null check (kind in ('front','ingredients','nutrition','other')),
  uri         text   not null,
  captured_at timestamptz
);

-- Label images are evidence. This is what you produce when a brand's counsel writes.
create table product.label_capture (
  id           bigserial primary key,
  product_ref  text        not null,   -- opaque; see packages/shared/src/product-ref.js
  image_uri    text        not null,
  ocr_text     text,
  captured_at  timestamptz not null default now(),
  contributor  text
);
create index label_capture_ref_idx on product.label_capture (product_ref);
