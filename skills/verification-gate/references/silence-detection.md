# Silence is not success

The most dangerous result a verification step can produce is nothing at all.

Consider a gate whose logic is "fail if any spec failed." Now consider a run where the browser never
launched, the runner exited before the first test, or the results file was written empty. Zero specs
failed. The gate passes. It has verified nothing, and it reports that in exactly the same words it
uses for a perfect run.

This is not a hypothetical failure mode; it is the normal one. Test infrastructure breaks far more
often than it produces a subtly wrong answer, and every "no failures found" check treats
infrastructure death as good news.

## The rule

Every gate that counts things must declare how many it expected, and treat a collapse as BLOCKED —
never as a pass. `lib/silence.mjs` implements three escalating checks:

1. **Zero results.** Nothing ran. There is no ambiguity here and no tolerance to tune.
2. **Below `minObserved`.** A floor you set from knowing the project. The default of `1` only catches
   a total crash, so set it deliberately — a suite of 400 specs that reports 6 has not shrunk, it has
   broken.
3. **Collapsed against the baseline.** If the frozen baseline holds 400 specs and this run reported
   80, that is not a smaller suite, it is a broken one. `shrinkTolerance` (default 10%) sets how much
   honest shrinkage is allowed before the gate stops believing the run.

The unit gate adds a fourth, specific to TAP: if the plan announces `1..400` and only 312 results
arrive, the run was truncated mid-flight. The plan is a promise the runner made and did not keep.

## Why BLOCKED rather than FAIL

A collapsed run tells you nothing about the code. Reporting it as FAIL sends someone to debug a
regression that may not exist; reporting it as PASS is the bug this whole document is about. BLOCKED
is the honest third answer: *the gate could not judge this change.* It exits 2, halts the chain, and
sends the reader at the fixture rather than the diff.

## The same failure at other layers

- **A scan that matched no files.** The secrets gate treats an empty `include` match as BLOCKED for
  this reason — a glob that stopped matching after a directory rename reports "clean" forever.
- **A capture that produced no records.** The diff gate refuses a capture file that does not exist,
  and applies the same count checks to the records inside it.
- **A baseline frozen from a broken run.** Guard the capture too. The demo's capture script refuses to
  freeze an empty or truncated suite, because a baseline recorded from a crashed run makes every
  future comparison meaningless — and it will look clean while doing it.
