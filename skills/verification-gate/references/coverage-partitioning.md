# Coverage-aware partitioning

A comparison gate can only judge ground its baseline actually covers. Pretending otherwise produces
one of two useless gates.

**The naive strict gate** treats every difference as a regression. On a real project with partial
baseline coverage — 106 of 580 routes captured, say — it fails on the first run and every run after.
Nobody debugs 474 phantom regressions twice. It gets disabled, and then it protects nothing at all.
A gate that is switched off has a false-negative rate of 100%.

**The naive lenient gate** only compares what both sides have and stays quiet about the rest. It
passes constantly, and the passes are worthless: you cannot tell "compared 580 routes, all matched"
from "compared 3 routes, ignored 577."

## The rule

Partition every finding, and report both halves separately:

- **Covered** — the baseline has an entry for this key. A difference here is a regression. It blocks.
- **Uncovered** — no baseline entry. The gate cannot judge it. It is reported, with the reason
  stated, and it never blocks.

`lib/diffgate.mjs` does this by key: records whose key is absent from the baseline become
non-blocking findings tagged `no baseline coverage for this key`. The stats line always prints both
counts, so a gate that is only judging a sliver of the surface says so out loud every run:

```
[integration] PASS (observed=580 baseline=106 blocking=0 explained=0 uncovered=474)
```

That is an honest pass. It says: I compared 106 routes, they all matched, and I know nothing about
the other 474. Compare it to a lenient gate's `PASS` and the difference is the entire value.

## The disappearance case

Partitioning is per key, so a key in the baseline that is *missing* from the current capture is
covered ground — the baseline has data, the current run does not. That blocks. A route or view that
vanished is a regression that reads exactly like a clean pass unless you look for it.

## Growing coverage

Uncovered findings are a worklist. The count only shrinks when someone captures more baseline, which
makes the gate's honest weakness visible and actionable rather than hidden. Resist the urge to
convert uncovered to blocking before the baseline exists — that just recreates the strict gate.
