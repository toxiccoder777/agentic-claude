# What makes a field safe to compare

A `verification-gate` diff gate (`integration`, `visual`) trusts every field it's told to `compare`.
If a field varies between two runs of the *same* code against *unchanged* state, the gate will report
a difference every single time it runs — a permanent false regression that trains everyone to ignore
the gate. This is the capture-side mirror of the skill's own silence problem: instead of a false pass,
it's a false fail, and it's just as corrosive because the fix people reach for is disabling the gate.

## The test, not a checklist

Don't try to eyeball source for "does this look non-deterministic." Run the capture command twice
against state that hasn't changed and diff the output — `idempotency-check.mjs` does exactly this.
Anything that differs is disqualified from `compare`, full stop, regardless of how meaningful it
looks.

## Common sources of noise, and what to do about them

- **Timestamps.** `capturedAt`, `generatedAt`, request/response timing — obviously never comparable.
  Fine to *store* per-record (useful for debugging), never to *compare*.
- **Random/generated identifiers.** Request IDs, trace IDs, session tokens, freshly-minted UUIDs.
  Same treatment: store, don't compare.
- **Ordering.** If the capture iterates a `Map`/`Set`/filesystem listing whose order isn't guaranteed,
  two runs can produce the same records in different sequence. This doesn't matter for a keyed diff
  (`diffgate.mjs` looks records up by key, not position) but matters enormously if your own capture
  script derives anything from position — an index, a "first N" truncation, anything ordinal.
- **Ports, hostnames, PIDs.** Meaningful in absolute terms but often different across the two
  environments being compared (dev vs. CI, your machine vs. someone else's). If the field must stay
  useful, normalize it — replace `localhost:53211` with `localhost:<port>` — rather than comparing raw.
- **Floating-point noise.** A geometry or timing measurement that differs in the fourth decimal place
  between runs isn't lying, it's just too precise to be useful. Round to the precision that's
  meaningful before capture, not after.

## Normalize at capture time, not compare time

Every one of the above is best fixed by not writing the noisy value into compare fields in the first
place — replace it with a normalized form, or drop it from the captured record and log it elsewhere.
Pushing normalization into the gate's compare logic means every project reinvents it and every gate
gets slightly different bugs. `capture-lint.mjs`'s pattern warnings exist to catch exactly this before
it becomes a baseline someone commits and then has to explain three weeks later.
