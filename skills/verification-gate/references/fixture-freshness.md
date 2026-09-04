# Fixture freshness

Every comparison gate has a silent dependency: the baseline is correct. Almost nothing checks it.

A baseline can be wrong in ways that leave it looking perfectly well-formed:

- captured while logged out, so every "page" is the login screen and every route matches beautifully
- captured against the wrong port, and therefore the wrong build, or another app entirely
- captured from a run that crashed partway, freezing a fraction of the surface as if it were all of it
- captured three weeks and forty commits ago, so it describes software that no longer exists

In each case the gate runs, compares, and passes. It is comparing the change against a fiction.

## The rule

The chain validates the fixture **once, before any gate runs**, and refuses to start if it cannot
vouch for it. Not per gate, and not as a warning — a partial verdict against an untrustworthy
baseline is worse than no verdict, because it gets recorded as a pass.

`.verification-baseline/validity-report.json`:

```json
{
  "verdict": "VALID",
  "reason": "captured from a clean run of the full suite, authenticated as an admin user",
  "capturedAt": "2026-09-04T17:56:13.363Z",
  "specCount": 580
}
```

`checkFreshness` in `lib/baseline.mjs` blocks the chain when the report is missing, unparseable,
`verdict !== "VALID"`, has no timestamp, or is older than `freshness.maxAgeHours` (default 24). All
five paths exit 2 with a reason naming which one tripped.

## Who writes the report

The capture script, and it must be capable of writing `INVALID`. A report that always says `VALID` is
a rubber stamp and adds nothing. Whatever your capture knows that a later gate cannot — that the
session was authenticated, that the app under the port was the right one, that the suite finished —
belongs in `verdict` and `reason` at capture time, because by gate time the evidence is gone.

The demo's `capture-baseline.mjs` shows the minimum: it refuses to freeze an empty or truncated run
at all, and records `INVALID` with a count when specs were already failing at capture.

## On the age limit

24 hours is a default, not a principle — tune it to how fast the thing you are gating moves. The
point is not that old baselines are wrong, it is that *nobody re-checks them*. An expiry converts
silent staleness into a loud, cheap prompt to recapture.
