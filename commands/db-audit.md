---
description: Audit a folder of legacy/inherited SQL scripts before running them
argument-hint: <folder of scripts> [target description]
---

Invoke the **db-migration-auditor** agent against the folder in `$ARGUMENTS` (first token). Anything
after it is context about the target database (environment, whether it holds real data) — pass that
through verbatim rather than paraphrasing, since "does this target hold data worth keeping" changes
the agent's recommendation on any destructive operation it finds.

If `$ARGUMENTS` gives no folder, ask which folder rather than guessing — auditing the wrong directory
and reporting "no destructive operations found" would be worse than asking.

The agent triages for `DROP`/`TRUNCATE`/unqualified `DELETE` first, then classifies every remaining
script against the target's actual current state. It does not execute anything.
