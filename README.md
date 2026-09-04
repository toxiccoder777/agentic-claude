# agentic-claude

Claude Code skills and agents for **verified legacy modernization** — migrations that prove they
didn't break anything.

> **Status: v1.0.0.** Three skills, six agents, seven commands, session hooks. This repo grows
> slowly on purpose — see [Philosophy](#philosophy).

## Install

```
/plugin marketplace add https://github.com/toxiccoder777/agentic-claude
/plugin install agentic-claude@agentic-claude
```

Or from a local clone:

```
/plugin marketplace add /path/to/agentic-claude
/plugin install agentic-claude@agentic-claude
```

## What's here

### Skills

| Skill | What it's for |
|---|---|
| [`verification-gate`](skills/verification-gate/) | Executable verification gates that prove a change broke nothing: six gates, frozen baselines, coverage-aware partitioning, a resumable stage machine, and a three-valued exit contract that can say *I could not judge this*. |
| [`db-migration`](skills/db-migration/) | Planning and safely executing database migrations — cloning, exhaustive schema diffing, classifying new tables, matching reference data by natural key, atomic execution, auditing inherited SQL scripts before running them. Postgres-focused, principles generalize. |
| [`baseline-capture`](skills/baseline-capture/) | Fills the gap `verification-gate` leaves open on purpose ("gates diff, projects capture"): two tools that prove a capture script is structurally sound and actually deterministic, by running it twice and diffing — not by eyeballing it. |

Run the gates against a working, dependency-free project in
[`examples/verification-gate-demo`](examples/verification-gate-demo/) — ten scenarios covering every
guard, including the ones that are supposed to fail.

### Agents

| Agent | What it's for |
|---|---|
| `verification-orchestrator` | Runs the verification-gate chain and interprets the result — distinguishes FAIL (fix the code) from BLOCKED (fix the fixture), never reports a blocked chain as passing. |
| `migration-planner` | Breaks a legacy modernization into small, independently verifiable hops, each with a named gate that would falsify it. |
| `baseline-auditor` | Judges whether a captured baseline is actually trustworthy before it's frozen — the human-quality check the mechanical freshness gate can't do. |
| `db-migration-auditor` | Reviews a folder of inherited SQL scripts before execution: triages for destructive operations first, then classifies each against the target's real state. |
| `code-reviewer` | Fresh-context correctness review of a diff — no memory of why the change was made, only what it does. |
| `security-scanner` | Runs the verification-gate secrets module directly, then a judgment-based OWASP-class pass the mechanical scan can't do. |

### Commands

| Command | Runs |
|---|---|
| `/verify-gate [path] [--resume] [--only <gate>]` | The gate chain via `verification-orchestrator` |
| `/gate-resume [path]` | A resume, after checking nothing changed earlier in the chain than the last recorded pass |
| `/plan-migration <what>` | `migration-planner` to design verifiable hops |
| `/review-diff [scope]` | `code-reviewer` on the current diff |
| `/db-audit <folder>` | `db-migration-auditor` on a folder of legacy SQL |
| `/secret-scan [path]` | The secrets gate standalone, without a full chain |
| `/skill-new <name> <purpose>` | Scaffolds a new skill in *this* repo — refuses if it can't answer CONTRIBUTING.md's two questions |

### Hooks

Two, both silent unless there's something to say: a `SessionStart` and `PreCompact` hook that surface
an unfinished `verification-gate` chain (which stage it halted at, and whether it's a FAIL or a
BLOCKED) so it isn't lost across a session restart or context compaction. See `hooks/hooks.json`.

### MCP server templates

`mcp-configs/` holds copy-paste `.mcp.json` templates for Postgres/GitHub/filesystem servers that
pair with the DB skills — not auto-loaded (see `mcp-configs/README.md` for why: a plugin that
auto-starts a credentialed server for every installer is a worse default than a template).

## Philosophy

Most Claude Code skill collections optimize for breadth: hundreds of files, one per topic, each a
markdown checklist telling an agent which shell commands to type. That pattern has a failure mode —
**an instruction is not an enforcement mechanism.** "STOP and fix this" in a markdown file is a
suggestion the agent can talk itself out of, and usually does when the output is ambiguous.

This repo takes the opposite bet. It stays small, and every skill in it has to answer two questions:

1. **What does it actually enforce?** Not "what does it advise" — what fails, loudly, when the rule
   is broken?
2. **How would you verify it worked?** If the answer is "the agent says it did," that's not a skill.

Concretely, for verification work that means real scripts with real exit codes wired into a stage
machine that refuses to advance, compared against frozen versioned baselines — not `npm test` output
read by an agent that wants to be helpful.

Corollaries that fall out of taking this seriously:

- **Silence is not success.** A test run that produced *zero* results because the runner crashed
  satisfies "no failures found." That's the most dangerous false pass there is, and it has to fail
  loudly rather than sail through.
- **Coverage-aware, not binary.** Real projects have partial baseline coverage. A gate that
  hard-fails on ground it has no baseline for gets disabled by week two. Split findings into
  "covered → hard fail" and "uncovered → report, never fail," and be honest about which is which.
- **The baseline itself can be broken.** Captured against the wrong port, unauthenticated, or three
  weeks stale. Gates should refuse to run against a fixture they can't vouch for.

## Roadmap

| Version | Contents |
|---|---|
| `v0.1.0` | Repo scaffolding, plugin manifest, `db-migration` skill |
| `v0.2.0` | Flagship `verification-gate` skill + runnable demo project |
| `v0.3.0` | Agents: verification-orchestrator, migration-planner, baseline-auditor, db-migration-auditor, code-reviewer, security-scanner |
| `v0.4.0` | Slash commands, session hooks, MCP server templates |
| `v1.0.0` | `baseline-capture` skill — determinism tooling for the capture half `verification-gate` leaves to each project |

**Deliberately not built:** a framework-hop-migration skill and a legacy-API-modernization skill were
considered and dropped — both would have mostly restated what `migration-planner` (planning) and
`verification-gate` (enforcement) already do, which is exactly the "references doc, not a new skill"
case `CONTRIBUTING.md` calls out. A mobile skill was dropped too: there's no demonstrated mobile
expertise behind this repo, and a skill that can't draw on real experience is a worse bet than no
skill at all.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The bar for a new skill is the two questions above.

## License

MIT — see [LICENSE](LICENSE). All content in this repo is original work.
