# Changelog

## v1.1.0

`merge-conflict-resolution` skill and `git-pilot` agent — scope and provenance enforcement for
conflict resolutions. Proves a resolution stayed inside the conflict hunks, didn't silently drop a
side or revert to the merge base, didn't get staged with markers still in it, and matches the strategy
it claims. Handles the conflict types that carry no markers at all (delete/modify, binary, submodule)
by reporting them BLOCKED rather than passing them.

Also fixed in `baseline-capture`:

- Six sites printed `BLOCKED:` but exited `1`, collapsing "fix your fixture" into "fix your code".
  They now exit `2`, matching the three-valued contract the rest of the repo uses.
- `scripts/lib/records.mjs` contained literal NUL bytes where spaces were intended, which made git
  treat a source file as binary and produce no readable diffs for it. The sentinel is now `<missing>`
  and the file is plain ASCII.

## v1.0.0

`baseline-capture` skill — determinism tooling for the capture half `verification-gate` deliberately
leaves to each project. Two tools: a structural lint, and an idempotency check that runs a capture
twice against unchanged state and diffs it, because determinism is a claim about repeated behaviour
and can't be seen in a single run.

## v0.4.0

Slash commands, session hooks, MCP server templates. Hooks surface an unfinished gate chain at session
start and before context compaction, and stay silent otherwise. MCP configs ship as copy-paste
templates rather than auto-loaded servers — a plugin that auto-starts a credentialed server for
everyone who installs it is a worse default.

## v0.3.0

Six agents: `verification-orchestrator`, `migration-planner`, `baseline-auditor`,
`db-migration-auditor`, `code-reviewer`, `security-scanner`. Each paired to a skill; an agent with no
skill behind it is a stub.

## v0.2.0

Flagship `verification-gate` skill plus a runnable, dependency-free demo project covering every guard
including the ones that are supposed to fail.

## v0.1.0

Repo scaffolding, plugin manifest, and the `db-migration` skill.
