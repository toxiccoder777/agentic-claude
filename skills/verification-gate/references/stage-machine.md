# The stage machine

`gate-runner.mjs` runs gates in the order given by `stages`, in separate processes, and reads their
exit codes. That last part is the whole design: the runner never inspects a gate's reasoning, only
its exit status. There is no place for an agent to argue.

## Order

Put cheap gates that fail often first. A secrets scan takes under a second; a visual capture can take
minutes. Halting on the cheap gate saves the expensive one.

`freshness` is checked before *any* gate, once, if any staged gate declares `requiresBaseline`. A
stale fixture does not produce a partial verdict — it means the chain cannot start.

## Halting

A non-zero exit from a `required` gate halts the chain. Later stages do not run, and the runner says
so explicitly rather than printing a summary that could be mistaken for a full pass:

```
[chain] halted at "unit" (FAIL). Later stages did not run.
```

A gate with `required: false` reports its verdict and the chain continues. Use it for a gate you are
still calibrating — not for one you find inconvenient.

## State and resume

After every stage the runner writes `<stateDir>/state.json`:

```json
{
  "startedAt": "2026-09-04T17:53:52.911Z",
  "updatedAt": "2026-09-04T17:53:53.339Z",
  "stages": {
    "secrets": { "verdict": "PASS", "exitCode": 0, "at": "..." },
    "unit":    { "verdict": "FAIL", "exitCode": 1, "at": "..." }
  },
  "complete": false,
  "lastStage": "unit"
}
```

`--resume` skips stages already recorded PASS and re-runs from the first that was not:

```
[secrets] skipped (already PASS in state.json)
[unit] PASS (observed=7 baseline=7 regressions=0 quarantined=1)
```

Each gate also writes `<stateDir>/gate-<id>-result.json` with its full findings — the machine-readable
artifact to attach to a CI run or feed to a reviewing agent.

**Resume trusts recorded passes.** That is the point of it on a chain where one stage takes twenty
minutes, and it is also its sharp edge: if you changed code after that stage passed, its result is
stale. Resume after fixing what the chain stopped on; run clean after changing anything earlier.

## Selecting stages

```bash
gate-runner --list                # resolved stage order
gate-runner --only unit           # one gate, ad hoc — works on disabled gates too
gate-runner --from integration    # skip ahead
gate-runner --resume              # continue after a failure
```

`--only` deliberately ignores `enabled`, because running a switched-off gate by hand is how you
calibrate it before staging it.

## Exit codes

The runner returns the exit code of the gate that halted it, so CI inherits the FAIL/BLOCKED
distinction: `1` sends someone to the diff, `2` sends them to the fixture.
