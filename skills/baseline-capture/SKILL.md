---
name: baseline-capture
description: Use when writing or reviewing a capture script for verification-gate's integration or visual gates — HTTP traffic, DOM/render fingerprints, or any keyed comparable-record capture. Use when someone asks "why does this gate keep failing even though nothing changed", "is this baseline safe to compare against", "how do I capture a baseline for this", or when a captured field needs to be checked for determinism before it's added to a gate's compare list. Not for running the gates themselves — that's verification-gate; this is about producing the fixture they compare against.
license: MIT
metadata:
  version: "1.0.0"
  domain: verification
  role: specialist
  scope: tooling
---

# Baseline capture

`verification-gate`'s `SKILL.md` puts it plainly: **gates diff, projects
capture.** Screenshotting an app, proxying its HTTP traffic, fingerprinting its DOM — all of it is
irreducibly project-specific, which is why the skill doesn't try to own it. This skill exists to fill
that gap: guidance and two small tools for making a capture script actually trustworthy, so the gate
that consumes it is verifying something real.

## The failure this skill exists to prevent

A capture script that isn't deterministic produces a baseline that fails the gate every single run,
even when nothing changed — because the "regression" is really just capture noise (a timestamp, a
request ID, animation timing). The standard response to a gate that cries wolf is to disable it. A
gate disabled because its fixture was noisy is functionally identical to a gate that was never
written, and it took real effort to get there.

## What this enforces

A capture is fit to freeze only if:

1. **It's structurally sound** — non-empty, every record has its key and compare fields, no duplicate
   keys silently colliding in the gate's key→record map.
2. **It's actually deterministic** — running the identical command against unchanged state twice
   produces identical values for every field you intend to `compare`.

Both are mechanically checkable, and this skill ships the checks rather than describing them in
prose.

## Tools

### `scripts/capture-lint.mjs` — structural check, one run

```bash
node scripts/capture-lint.mjs --file surface-baseline.ndjson --key route --compare kind,arity
```

Checks: file exists and parses; non-empty; every record has its key and compare fields; no duplicate
keys. Also warns (non-blocking) when a compare field's value looks like a timestamp, UUID, port, or
PID — a strong hint it doesn't belong in `compare` without normalization first. Exit 0 structurally
sound, exit 1 not fit to freeze, exit 2 could not judge it at all — missing, unreadable or empty.

### `scripts/idempotency-check.mjs` — the real determinism test

```bash
node scripts/idempotency-check.mjs \
  --command "node tools/capture-surface.mjs" \
  --output surface-current.ndjson \
  --key route --compare kind,arity \
  --runs 2
```

Runs the capture command `--runs` times (default 2), reads the output fresh each time, and diffs
every compare field per key across all runs. Anything that differs **cannot** be a valid regression
signal — nothing else ran in between. Exit 0 means every compare field was stable across every run;
exit 1 names exactly which field, on which key, varied and how; exit 2 means a run produced nothing
usable, so determinism could not be judged — which is not the same as it being stable.

**This is the check that matters.** `capture-lint.mjs` catches structural mistakes; only
`idempotency-check.mjs` proves determinism, because determinism is a claim about repeated behavior,
not something visible in a single run's output.

## Workflow

1. Write the capture script for your project (see `references/http-capture.md` or
   `references/dom-capture.md` for field-by-field guidance on what to capture and what to leave out).
2. Run `idempotency-check.mjs` against it before writing a single line of gate config. Fix every
   flagged field — usually by normalizing it (round geometry, template a URL path) or dropping it from
   `compare` entirely (see `references/determinism.md` for the common culprits).
3. Run `capture-lint.mjs` against the resulting file as a final structural check.
4. Only then freeze it as a baseline and write `validity-report.json`
   (`verification-gate`'s `references/fixture-freshness.md` covers that half).

## Demonstration

`examples/verification-gate-demo/tools/capture-surface.mjs` is a real capture that passes both
checks cleanly. `tools/capture-surface-flaky.mjs` in the same demo is a deliberately broken one — it
stamps a wall-clock timestamp into every record — kept specifically to show `idempotency-check.mjs`
catching it:

```bash
cd examples/verification-gate-demo
node ../../skills/baseline-capture/scripts/idempotency-check.mjs \
  --command "node tools/capture-surface-flaky.mjs" \
  --output surface-current.ndjson --key route --compare kind,arity,capturedAt
```

Fails on `capturedAt`, every time, by design. Drop it from `--compare` and the same command passes.

## Reference

- `references/determinism.md` — what makes a field safe to compare, and how to fix the common cases
- `references/http-capture.md` — field-by-field guidance for capturing HTTP traffic
- `references/dom-capture.md` — field-by-field guidance for capturing DOM/render fingerprints
