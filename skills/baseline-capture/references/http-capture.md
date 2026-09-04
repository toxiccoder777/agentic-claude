# Capturing HTTP traffic into NDJSON

For `verification-gate`'s `integration` gate. The gate reads NDJSON and diffs by key — this is about
producing that NDJSON safely.

## Minimum viable approach: a recording proxy

Point the app under test at a small proxy (or use your HTTP client's own interceptor/middleware layer
if one exists) that logs each request/response pair as one NDJSON record, then run your normal
smoke/E2E pass through it. You don't need a purpose-built tool — a few dozen lines around whatever
HTTP client or reverse proxy you already have is enough.

Per-record shape, matching what `gate-integration.mjs` expects by default:

```json
{"route": "GET /api/users/:id", "method": "GET", "url": "/api/users/42", "status": 200, "headerKeys": "content-type,x-request-id", "bodyShape": "object{id,name,email}"}
```

## Field-by-field guidance

- **`route`** (the key) — the *templated* path (`/api/users/:id`), not the literal request URL
  (`/api/users/42`). If you key on the literal URL, every record with a different ID becomes a
  different key, and the baseline never accumulates real coverage of the endpoint. Deriving the
  template usually means matching the request against your router's own route table rather than
  guessing with regex.
- **`headerKeys`** not raw headers — compare the *set* of header names (sorted, joined), not values.
  Header values routinely carry request IDs, dates, and session tokens; the set of headers present is
  what actually indicates a contract change (a header quietly dropped or added).
- **`bodyShape`** not the literal body — a structural fingerprint (sorted top-level key names, or a
  shallow type signature) rather than the actual response payload. Comparing literal bodies makes
  every record-with-real-data noisy (see `determinism.md`) and buries genuine shape changes in noise
  from data changes.
- **`status`** — safe to compare directly, it's genuinely deterministic for a given request against
  unchanged code.

## Coverage, honestly

An HTTP capture will almost never cover 100% of an app's routes on the first pass — it only sees what
your smoke/E2E run actually exercised. That's fine: it's exactly the situation
`verification-gate`'s coverage-aware partitioning exists for (see the skill's
`references/coverage-partitioning.md`). Don't try to fabricate coverage by hand-writing fixture
records for routes you didn't actually exercise — an unexercised route belongs in "uncovered,"
honestly, not in a baseline that claims to have verified it.

## Before freezing

Run `idempotency-check.mjs` against your capture command using the same smoke/E2E pass, twice, before
committing the resulting baseline. A proxy that logs full ISO timestamps or per-request trace IDs into
a field you intend to `compare` will fail this immediately — that's the point.
