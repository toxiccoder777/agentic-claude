# Why executable gates instead of prose checklists

Most Claude Code verification skills are markdown documents that tell an agent which commands to run
and how to format a report. They typically read something like:

> **Phase 4: Tests**
> Run `npm test -- --coverage 2>&1 | tail -50`.
> If any test fails, STOP and fix it before continuing.

That is a reasonable instruction and a poor mechanism. Three things go wrong with it, and they are
not edge cases — they are the normal operating conditions of a real project.

## 1. "STOP and fix it" is advice, not enforcement

An instruction in a skill file is read by a model that is trying to be helpful and has just spent
twenty minutes on a change it believes is correct. When the output is ambiguous — a test that fails
for what looks like an environmental reason, a diff that seems cosmetic — the instruction competes
with the model's judgment, and judgment is very good at winning. Nothing structural prevents the
chain from continuing.

The alternative is not a stricter instruction. It is removing the decision: a script exits non-zero,
a runner reads the exit code, and the next stage does not execute. There is no sentence for a model
to interpret because there is no sentence.

## 2. `tail -50` of a crashed run looks exactly like success

This is the failure mode worth caring about most, because it is silent. If the test runner dies on
startup — browser fails to launch, port in use, OOM — it emits no failures. A gate whose logic is
"fail if any test failed" passes. So does a prose checklist whose instruction is to read the last
fifty lines and report.

The empty run and the perfect run produce the same verdict, and infrastructure breaks far more often
than tests produce subtly wrong answers. Any gate that counts things must declare how many it
expected to see. See [silence-detection](../skills/verification-gate/references/silence-detection.md).

## 3. Comparing against "current" compares the change to itself

A checklist that says "run the tests" compares the code to whatever the tests currently assert. If
the change also modified the tests, or a test stopped running, there is no fixed point. Verification
requires a frozen artifact captured *before* the change and committed, so the comparison has a
reference that the change could not have moved.

And the frozen artifact needs its own check, because a baseline captured while logged out, or against
the wrong port, or from a run that died halfway, will still compare cleanly against anything. See
[fixture-freshness](../skills/verification-gate/references/fixture-freshness.md).

## What this repo does instead

| | Prose checklist | `verification-gate` |
|---|---|---|
| Form | Markdown telling an agent which commands to run | Node scripts with process exit codes |
| Enforcement | The agent's compliance | `gate-runner.mjs` refuses to advance the stage |
| Reference | Whatever the suite says right now | Committed baseline + a validity report vouching for it |
| Empty run | Reads as clean | BLOCKED — an empty scan is not a clean scan |
| Partial coverage | Binary pass/fail, so it fails everything and gets disabled | Split: covered blocks, uncovered reports and says so |
| Excused finding | Silent allowlist | Rule that will not compile without a stated cause |
| Flaky spec | Quarantine on first red | pass@k / pass^k separates flaky from broken |
| Interrupted chain | Start over | `state.json` + `--resume` |

## The verdict that most systems are missing

Two outcomes is not enough. PASS and FAIL cannot express *the gate could not judge this*, so systems
with only two outcomes are forced to encode "I don't know" as one of them — and it is almost always
encoded as PASS.

This repo's gates return three:

- `0` PASS — compared something real, found no unexplained difference
- `1` FAIL — regression on covered ground. Fix your code.
- `2` BLOCKED — could not form an opinion. Fix your fixture.

The distinction is operational, not philosophical. Exit 1 sends someone to the diff. Exit 2 sends
them to the baseline, the runner, or the capture. Collapsing them wastes the first person's time and,
far worse, lets a broken fixture accumulate green checkmarks indefinitely.

## What is deliberately not here

**Capture.** Gates diff; projects capture. Screenshotting an Angular app, recording HTTP traffic
through a proxy, fingerprinting a DOM — all of it is irreducibly framework- and project-specific, and
pulling it into the skill would make the skill about Angular. The project owns a capture command that
emits keyed NDJSON; the skill owns keying, diffing, partitioning, classification, and freshness. That
boundary is why `integration` and `visual` are twenty lines each on top of one shared differ.

**Breadth.** There is one flagship skill here, not two hundred. A skill that cannot say what it
enforces and how you would verify it worked is a blog post, and this repo would rather have six
things that hold than sixty that read well.
