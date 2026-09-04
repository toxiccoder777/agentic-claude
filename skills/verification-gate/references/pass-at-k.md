# pass@k, pass^k, and telling flaky from broken

A single test run answers one question: did this spec pass *that time*. Treating that answer as a
property of the spec is what makes flaky tests so corrosive — the same run, repeated, disagrees with
itself, and the gate reports whichever answer it happened to get.

Two metrics, borrowed from eval-harness practice, separate the cases:

- **pass@k** — passed at least once in k attempts. Measures whether it *can* pass.
- **pass^k** — passed all k attempts. Measures whether it *reliably* passes.

The interesting states are the corners:

| pass@k | pass^k | Meaning | Gate |
|---|---|---|---|
| 1 | 1 | Stable pass | fine |
| 0 | 0 | Fails every attempt — **broken** | blocks |
| 1 | 0 | Passes sometimes — **flaky** | reported with its rate |

## Why this matters for quarantine

The usual policy is quarantine-on-first-red. It cannot tell the second row from the third, so it
answers both with the same move: remove the spec from the gate. Applied to a broken spec that is
a genuine regression being hidden. Applied often enough, the quarantine list becomes larger than
the active suite and the gate is a formality.

Running k times first makes the distinction cheap:

```
[flaky] PASS (runs=5 specs=7 stable=6 flaky=1 broken=0)
  reported  known-flaky pricing probe [pass@5=1 pass^5=0] — passed 3/5 attempts (60%) —
            flaky, quarantine candidate rather than an automatic quarantine
```

A spec that fails all 5 is not a quarantine candidate at all; the `flaky` gate blocks on it, because
"fails every time" is just failing.

## Choosing k

k=3 catches gross unreliability cheaply. k=5 gives a usable rate. Past that you are paying real time
for precision you will not act on differently — a spec at 60% and one at 70% get the same treatment.

Cost is the constraint: k runs of the full suite. Run this gate on a suspect subset, or on a schedule,
rather than in the per-change chain. It answers "is this spec trustworthy", which changes far more
slowly than "did this change break something".

## What a rate is for

The percentage is evidence for a decision a human makes. A spec at 95% is probably worth fixing; one
at 40% is barely testing anything and may deserve deletion rather than quarantine. Record the rate in
the quarantine entry's `reason` when you do quarantine — it is the difference between "flaky, ignore"
and "passed 3/5 on 2026-09-04, races with the fixture clock, tracked in #412".
