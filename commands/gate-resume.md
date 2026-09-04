---
description: Resume a previously-interrupted verification-gate chain from state.json
argument-hint: [project-path]
---

Resume an interrupted `verification-gate` chain. `$ARGUMENTS` is the project path (default `.`).

Before resuming, check `<project>/.gate-state/state.json` (path from that project's
`verification-gate.config.json`'s `stateDir`, default `.gate-state`) for `lastStage` and whether
anything under `src/`, `tests/`, or other gate-relevant paths changed **since** that stage's `at`
timestamp — resume trusts every recorded PASS as still valid, so re-running a stage whose inputs
changed after it passed is the caller's job, not the runner's.

If nothing changed since the last recorded PASS, invoke the **verification-orchestrator** agent to run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/verification-gate/scripts/gate-runner.mjs" --project <path> --resume
```

If something did change earlier in the chain than `lastStage`, say so and recommend a full run instead
of `--resume` — don't resume silently over stale evidence.
