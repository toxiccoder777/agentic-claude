# Baseline formats

Everything under `baselineDir` is committed. A baseline that is not versioned is not frozen — it is
just a file that happened to be there, and you cannot tell what it described three commits ago.

## `test-baseline.json` — unit gate

```json
{
  "capturedAt": "2026-09-04T17:56:13.363Z",
  "specs": {
    "subtotal sums price times quantity": "pass",
    "known-broken currency rounding": "fail"
  }
}
```

Spec names are the key, so they must be stable across runs — a runner that numbers or timestamps
test names cannot be baselined this way. Recording `fail` matters as much as `pass`: it is what lets
the gate tell a pre-existing red apart from a regression you just caused.

The unit gate reads four cases out of this:

| Baseline | Now | Verdict |
|---|---|---|
| `pass` | fail | **blocks** — regression |
| `pass` | absent | **blocks** — the spec vanished and stopped protecting anything |
| `fail` | fail | reported — already red, not your doing |
| absent | fail | **blocks** — new spec, failing |

## `quarantine.json` — unit gate

```json
{
  "quarantined": [
    {
      "spec": "known-flaky pricing probe",
      "reason": "races with the fixture clock; tracked in #412",
      "addedAt": "2026-09-04T00:00:00.000Z"
    }
  ]
}
```

Quarantined specs report but never block, in either direction. The `reason` is not decoration — a
quarantine list without reasons becomes a list nobody dares delete from. Before quarantining, run the
`flaky` gate: it distinguishes a spec that is unreliable from one that is simply broken, and only the
first belongs here.

## NDJSON captures — integration and visual gates

One JSON object per line, one line per keyed thing:

```
{"route":"cart.subtotal","kind":"function","arity":1}
{"route":"cart.total","kind":"function","arity":1}
```

NDJSON because captures are appended as they are observed, are diffed line-wise by git, and stay
readable at 50k records where one giant JSON array does not.

Requirements: `key` fields must be present and stable on every record, and `compare` fields must be
deterministic. Anything containing a timestamp, a request id, or an ordering that varies between runs
will report a difference every time and train everyone to ignore the gate. Normalize at capture time
— that is what the capture script is for.

## `validity-report.json`

See `fixture-freshness.md`. Written by the capture script, read once by the runner before any gate.

## Refreezing

Refreeze deliberately, never to make a red gate green. The commit that updates a baseline should
contain only the baseline and a message explaining what changed about the world — reviewing "why did
the expected output change" is the entire point of committing it.
