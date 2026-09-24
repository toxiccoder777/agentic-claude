# Changelog

## v1.1.1

Fixes three silent passes in `merge-conflict-resolution` — found by an adversarial review of v1.1.0,
and all three the exact failure mode this repo exists to argue against.

- **A leftover bare `=======` passed the entire suite.** The guard that stops a Markdown setext
  heading underline from false-positiving also excused a real separator whenever the resolver had
  deleted the `<<<<<<<`/`>>>>>>>` lines. `verify-resolution` now scans strictly, since a path in the
  snapshot is known to have been conflicted and is owed no benefit of the doubt. The standalone
  scanner keeps the leniency but now reports ambiguous separators instead of dropping them.
- **`git merge-file`'s error read as a successful empty merge.** It exits 255 with a zero-length
  stdout, and an empty Buffer is truthy, so the `!run.stdout` guard never fired — checks 4 and 5 then
  asserted nothing, with no BLOCKED. Now keyed on the exit status (0–127 is the conflict count).
- **An unterminated conflict region silently swallowed the rest of the file.** `parseConflicted` set
  an `unterminated` flag that nothing read. It is now BLOCKED, and abandoned region lines return to
  context rather than being discarded.

Also:

- Check 4 now verifies context lines by **count as well as order** — a greedy subsequence match could
  be satisfied by a line the resolver wrote inside a hunk, hiding the deletion of the first context
  line after a region. The residual limitation is documented rather than papered over.
- An unrecognised `strategy` is rejected instead of quietly relaxing checks (`WHOLESALE` was a plain
  object, so `strategy: "constructor"` was truthy).
- Unexpected throws in all three conflict scripts now exit 2 (BLOCKED), not 1 (FAIL).
- All six gate scripts loaded config unguarded at module scope, so a missing config printed a stack
  trace and exited 1 — reporting "fix your code" for a fixture problem. Now BLOCKED.
- New `examples/merge-conflict-demo/run-checks.mjs`: 12 cases asserting verifier exit codes against
  generated fixtures. Verified against the pre-fix commit — the four regression cases fail there and
  pass here, and the eight pre-existing behaviours pass in both.

Docs corrected against the code: `baseline-capture`'s SKILL.md still documented the two-valued exit
contract its own `--help` had already outgrown; the schema's `baseRef` default and gate-resolution
order both disagreed with the implementation; the EOL claim overstated what gets skipped; two
documented commands could not run as written; and the README now names `db-migration` as the one
skill that ships no scripts rather than implying four-for-four.

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
