---
description: Run the verification-gate chain against a project and interpret the result
argument-hint: [project-path] [--resume] [--only <gate>]
---

Run the `verification-gate` skill's stage machine and interpret what it finds, using the
**verification-orchestrator** agent rather than acting as a thin wrapper around the exit code.

Parse `$ARGUMENTS` flag-independently: the project path is the first non-flag token (default `.`).
`--resume` and `--only <gate>` may appear anywhere and pass straight through.

Invoke the verification-orchestrator agent with the resolved path and flags. It runs
`${CLAUDE_PLUGIN_ROOT}/skills/verification-gate/scripts/gate-runner.mjs` and reports:
- the chain's final exit code and what it means (PASS / FAIL — fix the code / BLOCKED — fix the fixture)
- every blocking finding, verbatim
- if `--resume` was passed, which stages were skipped as already-passing

If the target has no `verification-gate.config.json`, say so and point at
`${CLAUDE_PLUGIN_ROOT}/skills/verification-gate/SKILL.md`'s Quick Start rather than guessing at a
configuration.
