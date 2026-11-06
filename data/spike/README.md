# Coverage spike basket

`basket.json` here is a **smoke test of the tooling**, not the Phase 0
measurement. Three barcodes prove the request path, the hit path and the miss
path work.

The real spike is a shelf-collection exercise and cannot be done from a desk:
**60 products per market, scanned off actual supermarket shelves**, weighted to
what people really buy rather than what is easy to find. Sampling barcodes *from*
Open Food Facts would return a 100% hit rate by construction and measure nothing.

Markets to cover before Phase 1 sizing: IN, US, GB, DE, and one of ID/BR/NG.

The column that decides Phase 1 is **usable ingredients**, not barcode hit — a
barcode that resolves to a record with no ingredient text still forces the OCR
path, which is the expensive one to build.
