# verification-gate demo

A dependency-free project that exercises every guard in the `verification-gate` skill. No framework,
no npm install — a tiny cart module, a hand-rolled TAP runner, and a capture script.

`DEMO_FAULT` injects the failure modes the gates exist to catch, so each scenario below is runnable
as-is rather than requiring you to hand-break something.

## Setup

```bash
cd examples/verification-gate-demo
node tools/capture-baseline.mjs
```

That freezes `test-baseline.json` and `surface-baseline.ndjson`, and writes the `validity-report.json`
that vouches for them. It refuses to freeze an empty or truncated run.

Throughout, `RUNNER=../../skills/verification-gate/scripts/gate-runner.mjs`.

## Scenarios

### 1. Clean run

```bash
node $RUNNER --project .
```
```
[chain] baseline validated, 0.0h old
[secrets] PASS (scanned=5 findings=0)
[unit] PASS (observed=7 baseline=7 regressions=0 quarantined=1 exit=0)
[integration] PASS (observed=4 baseline=4 blocking=0 explained=0 uncovered=0)
[chain] PASS — 3 stage(s) cleared.
```
Exit `0`.

### 2. A real regression — exit 1

```bash
DEMO_FAULT=regression node $RUNNER --project .
```
```
[unit] FAIL (observed=7 baseline=7 regressions=1 quarantined=1)
  BLOCKING  total composes discount and tax [regression] — passed in baseline, fails now
[chain] halted at "unit" (FAIL). Later stages did not run.
```

### 3. The runner produces nothing — exit 2, not 0

```bash
DEMO_FAULT=silence node $RUNNER --project .
```
```
[unit] BLOCKED: run produced zero results — the runner almost certainly failed to start,
       and "no failures" from an empty run is not a pass
```
This is the scenario a naive "fail if any spec failed" gate passes. See
`references/silence-detection.md`.

### 4. A truncated run — exit 2

```bash
DEMO_FAULT=truncated node $RUNNER --project .
```
Three of seven specs report. Below `minObserved`, so the gate refuses to judge.

### 5. An untrustworthy baseline stops the chain before any gate runs

```bash
node -e "const fs=require('fs'),p='.verification-baseline/validity-report.json';
const r=JSON.parse(fs.readFileSync(p)); r.capturedAt=new Date(Date.now()-48*3600e3).toISOString();
fs.writeFileSync(p,JSON.stringify(r,null,2));"

node $RUNNER --project .
```
```
[chain] BLOCKED: baseline is 48.0h old, limit is 24h — recapture it
  No gate ran. An untrustworthy baseline cannot clear anything.
```
Setting `"verdict": "INVALID"` or deleting the report blocks the same way. Restore with
`node tools/capture-baseline.mjs`.

### 6. Resume

```bash
DEMO_FAULT=regression node $RUNNER --project .   # halts at unit
node $RUNNER --project . --resume                # secrets skipped, unit re-runs
```
```
[secrets] skipped (already PASS in state.json)
[unit] PASS (observed=7 baseline=7 regressions=0 quarantined=1)
```

### 7. Coverage partitioning — the same edit blocks or reports depending on baseline coverage

Add a new export to `src/cart.mjs`:

```js
export function shippingCost(weightKg) { return weightKg * 2.5; }
```
```
[integration] PASS (observed=5 baseline=4 blocking=0 explained=0 uncovered=1)
  reported  cart.shippingCost has no baseline entry — no baseline coverage for this key
```

Now instead change an export the baseline *does* cover — `subtotal(items)` to `subtotal(items, currency)`:

```
[integration] FAIL (observed=4 baseline=4 blocking=1 explained=0 uncovered=0)
  BLOCKING  arity changed [cart.subtotal]
```

Same kind of edit, opposite verdicts, because the gate only claims authority where it has data.

### 8. A classified finding reports instead of blocking

`withTax` has a classification rule in the config. Change it to `withTax(amount, rate, precision)`:

```
[integration] PASS (observed=4 baseline=4 blocking=0 explained=1 uncovered=0)
  reported  arity changed [cart.withTax] — withTax gained an optional rounding argument in the
            2.x refactor; confirmed backward compatible by hand (known-arity-shift)
```
The reason prints every run. A rule without one is rejected at load.

### 9. Secrets

```bash
cat > src/leak-probe.mjs <<'EOF'
export const config = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE' };
export function dump() { console.log(config); }
EOF
node $RUNNER --project . --only secrets
rm src/leak-probe.mjs
```
```
[secrets] FAIL (scanned=6 findings=2)
  BLOCKING  AWS access key id [src/leak-probe.mjs:1]
  BLOCKING  stray console statement [src/leak-probe.mjs:2]
[chain] halted at "secrets" (FAIL). Later stages did not run.
```

### 10. pass@k separates flaky from broken

```bash
DEMO_FAULT=flaky node $RUNNER --project . --only flaky
```
```
[flaky] PASS (runs=5 specs=7 stable=6 flaky=1 broken=0)
  reported  known-flaky pricing probe [pass@5=1 pass^5=0] — passed 3/5 attempts (60%) —
            flaky, quarantine candidate rather than an automatic quarantine
```

## What the demo does not cover

The `contract` gate needs git history, which this demo has none of, so it ships disabled. Enable it
in a project with commits — see `references/` and the gate table in `SKILL.md`.
