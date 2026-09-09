---
description: Resolve git merge/rebase conflicts and prove the resolution stayed in scope
argument-hint: [repo path, default: .]
---

Invoke the **git-pilot** agent against the repository in `$ARGUMENTS` (default `.`).

It snapshots the conflict state first, reads all three stages of every conflicted file, resolves,
records a manifest of what it did, and runs both verifiers. It resolves file contents and **stops** —
it will not stage, commit, continue, abort, or push, so the operation stays yours to finish.

Before invoking, check whether a conflict actually exists (`git status --porcelain=v2 | grep '^u '`).
If nothing is unmerged, say so rather than sending the agent to look for work that isn't there.

Two things to carry through to the user in the agent's report, because they are the ones that get
missed:

- Whether this is a **rebase** — the sides are inverted there (`:2:` is the branch being rebased onto,
  `:3:` is the user's own replayed work), and a resolution made on the usual reading of "ours" throws
  away the work being rebased.
- Any path reported **BLOCKED** — delete/modify, binary, submodule and symlink conflicts carry no
  conflict markers, so they were accepted on the manifest's word rather than verified. That is not the
  same as passing, and it should be said plainly.

End by giving the user the exact command to finish the operation themselves.
