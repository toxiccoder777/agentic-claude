---
name: verification-gate
description: Set up or run executable verification gates that prove a change did not break anything — frozen baselines, coverage-aware pass/fail, resumable stage machine. Use when a migration, refactor, framework upgrade or risky change needs to be verified rather than eyeballed; when someone asks to "check nothing broke", "verify this hop", "compare against the baseline", or wants a CI gate that cannot be talked out of failing; and when deciding whether a test failure is a real regression, a pre-existing red, or a flaky spec. Also use when a verification step passed suspiciously easily and you need to know whether it actually ran.
license: MIT
metadata:
  version: "1.0.0"
  domain: verification
  role: specialist
  scope: execution
---

# Verification gate

Most "verification" in an agentic workflow is a checklist telling the agent which commands to run
and how to summarize them. That is not verification — it is a suggestion, and an agent that wants to
be helpful will talk itself past an ambiguous result nearly every time.

This skill is the opposite: gates are **scripts with exit codes**, run by a stage machine that
refuses to advance when one returns non-zero. The agent's opinion is not an input.

## When to use this

- Migrating or upgrading something incrementally, and each step must prove it changed nothing it
  wasn't supposed to.
- A refactor where "the tests pass" is not sufficient evidence, because the tests themselves may
  have stopped running.
- Deciding whether a red spec is a regression, an already-known red, or a flaky one.
- Any moment where a check passed and you cannot say *what it actually compared*.

## The exit-code contract

Three outcomes, and the third is the one most systems get wrong:

| Exit | Verdict | Means |
|---|---|---|
| `0` | PASS | The gate compared something real and found no unexplained difference. |
| `1` | FAIL | A regression on ground the baseline covers. **Fix your code.** |
| `2` | BLOCKED | The gate could not form an opinion — stale fixture, crashed runner, missing baseline. **Fix your fixture.** |

BLOCKED is never a pass. A gate that cannot judge a change has not cleared it.

## Six principles

1. **Exit codes, not prose.** "STOP and fix this" in a markdown file is advice. A non-zero exit that
   halts the chain is enforcement.
2. **Frozen, versioned baselines.** Compare against a committed artifact, never against whatever the
   suite happens to say right now. Otherwise you are comparing the change to itself.
3. **Silence is not success.** A runner that crashed on startup produced zero failures. So did a
   perfect run. Every counting gate declares how many results it expected and fails loudly when the
   count collapses. See `references/silence-detection.md`.
4. **Coverage-aware partitioning.** Split findings into "the baseline covers this, so a difference is
   a regression" (blocks) and "no baseline data here" (reported, never blocks). A gate that
   hard-fails on uncovered ground gets switched off within a week, and then it protects nothing.
   See `references/coverage-partitioning.md`.
5. **Fixture freshness is gated.** The baseline itself can be wrong — captured unauthenticated,
   against the wrong port, or three weeks stale. The chain refuses to start against a fixture
   nothing vouches for. See `references/fixture-freshness.md`.
6. **Resumable.** State lives in `state.json`; `--resume` skips stages already recorded PASS, so a
   transient failure does not restart a long chain. See `references/stage-machine.md`.

## Quick start

1. Write `verification-gate.config.json` in the project root:

```json
{
  "baselineDir": ".verification-baseline",
  "stateDir": ".gate-state",
  "stages": ["secrets", "unit"],
  "gates": {
    "secrets": { "include": ["src/**/*.ts"], "debugGlobs": ["src/**/*.ts"] },
    "unit": {
      "requiresBaseline": true,
      "command": "npm test -- --reporter tap",
      "format": "tap",
      "minObserved": 50
    }
  }
}
```

2. Freeze a baseline. Capture is project-specific — write a small script that runs the suite,
   writes `.verification-baseline/test-baseline.json`, and records a `validity-report.json` vouching
   for it. `examples/verification-gate-demo/tools/capture-baseline.mjs` is a working example, and it
   refuses to freeze an empty or truncated run.

3. Run the chain:

```bash
node scripts/gate-runner.mjs --project .
node scripts/gate-runner.mjs --project . --resume     # after fixing a failure
node scripts/gate-runner.mjs --project . --only unit  # one gate, ad hoc
node scripts/gate-runner.mjs --project . --list
```

## Gates

| Gate | What it enforces | Needs |
|---|---|---|
| `unit` | No spec that passed in the baseline fails or disappears now. Quarantined specs report but never block. | test command emitting TAP (or a custom parser) + frozen `test-baseline.json` |
| `contract` | A change that touched source added no test → fail. `requiredSpecs` can name the *specific* spec a kind of change must be covered by, so editing an unrelated test does not satisfy it. | git history |
| `integration` | Request/response parity against a frozen capture, keyed per route, partitioned by coverage. | project capture command emitting NDJSON + frozen baseline |
| `visual` | Rendered-output fingerprint diff — element count, geometry, color, typography — not pixels. | same shape as `integration` |
| `secrets` | No credentials or stray debug statements in the scanned set. Scanning zero files is BLOCKED, not clean. | nothing |
| `flaky` | Runs the suite k times. Failing all k is broken and blocks; passing some is flaky and reports a measured rate. | test command |

`integration` and `visual` share one differ (`lib/diffgate.mjs`) — they differ only in what the
project captures. **Gates diff; projects capture.** Capture is where the framework-specific mess
lives, so it stays outside the skill.

## Writing a new gate

Import `runGate` from `lib/result.mjs` and the exit-code contract is handled for you:

```js
await runGate(id, config.statePath, async (result) => {
  if (cannotJudge) return blocked(result, 'why this gate cannot form an opinion');
  addBlocking(result, { what, where, reason });     // exit 1
  addNonBlocking(result, { what, where, reason });  // reported, still exit 0
  result.stats = { observed, baseline };
});
```

Two rules: a gate that counts things must call `checkSilence`, and a finding excused from blocking
must carry a `reason`. `lib/partition.mjs` refuses to compile a classification rule without one —
unexplained exclusions are how a gate quietly stops working.

## Reference

- `references/stage-machine.md` — stage ordering, state, resume semantics
- `references/baseline-format.md` — baseline and validity-report shapes
- `references/coverage-partitioning.md` — why binary pass/fail fails on real projects
- `references/fixture-freshness.md` — validating the thing you validate against
- `references/silence-detection.md` — the empty-run false pass
- `references/root-cause-classification.md` — excusing a finding without hiding it
- `references/pass-at-k.md` — telling flaky apart from broken
- `config/verification-gate.schema.json` — every configurable key
