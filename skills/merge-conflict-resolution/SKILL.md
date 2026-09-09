---
name: merge-conflict-resolution
description: Use when resolving git merge, rebase, cherry-pick or stash conflicts — and especially when checking that a resolution already made is actually safe. Use when someone asks to "fix these conflicts", "help me merge this", "resolve the rebase", or asks whether a conflict resolution dropped something it shouldn't have. Also use when a merge looks resolved but you want proof it stayed in scope, didn't silently discard one side, and didn't get staged with markers still in it. Covers the conflict types that carry no markers at all — delete/modify, binary, submodule — which a marker scan passes without judging.
license: MIT
metadata:
  version: "1.0.0"
  domain: version-control
  role: specialist
  scope: execution
---

# Merge conflict resolution

## What this can and cannot prove

It **cannot** prove a merge is semantically correct. Nothing can, short of understanding the program —
two changes can combine into marker-free, compiling, test-passing code that is still wrong. Any tool
claiming otherwise is lying.

What it **can** prove, because git hands over all three parents (`:1:` base, `:2:` ours, `:3:` theirs),
is **scope and provenance**:

- the resolution stayed inside the conflict hunks
- it didn't silently discard a side, or revert to the merge base
- it didn't get staged while still conflicted
- it matches the strategy it claims to have used

That is a smaller claim than "this merge is correct," and it is an honest one. It is also the claim
nobody checks.

## Why "no conflict markers left" is not enough

The obvious check — scan for `<<<<<<<` — is **vacuously green** on a large share of real conflicts:

| Conflict | Code | Markers written? |
|---|---|---|
| Both modified | `UU` | yes |
| Added by both | `AA` | yes |
| Deleted by us / by them | `DU` / `UD` | **no** |
| Both deleted | `DD` | **no** |
| Binary file | `UU` | **no** |
| Submodule / symlink | `UU` | **no** |

For every "no" row, a marker scan reports clean while having judged nothing at all. That is the
`silence is not success` failure this repo's [architecture doc](../../docs/architecture.md) exists to
argue against. Those paths are reported **BLOCKED**, never passed — see `references/conflict-types.md`.

## The exit contract

| Exit | Meaning |
|---|---|
| `0` | The resolution stayed in scope and its claims hold. |
| `1` | The resolution is wrong in a specific, named way. **Fix the resolution.** |
| `2` | Cannot judge — no snapshot, stale snapshot, or a path carrying no markers. **Fix the inputs.** |

## Workflow

**1. Snapshot before touching anything.**

```bash
node scripts/snapshot-conflicts.mjs --cwd <repo>
```

Records every unmerged path, its stage blob OIDs, the operation in progress, and which paths carry no
markers and therefore need a human decision. Written to `<git-dir>/conflict-state/snapshot.json` —
*inside* `.git/`, so a `git add -A` mid-merge cannot commit it into the merge it describes.

This must run **before** resolving. Afterwards the original stage OIDs are still in the index, but the
"was this staged during resolution" check has nothing to compare against.

**2. Read all three sides per file**, not just the marked-up working copy:

```bash
git show :1:path   # base — what both sides started from
git show :2:path   # ours
git show :3:path   # theirs
```

The working copy shows you what changed; the base tells you *why*. Resolving from the marked-up file
alone is how one side's intent gets dropped. Note that some stages legitimately don't exist — `AA` has
no base, `DU` has no `:2:`.

**3. Resolve, then record what you did** in a manifest (`references/manifest-format.md`).

**4. Verify.**

```bash
node scripts/verify-resolution.mjs --cwd <repo> --manifest manifest.json
node scripts/verify-manifest.mjs   --cwd <repo> --manifest manifest.json
```

## The six checks

1. **Index untouched.** Every snapshot path must *still* be unmerged. `git add` clears a file's
   conflicted status **even with markers still in it** — so a shrinking unmerged set is that bug caught
   at its cause rather than its symptom.
2. **No leftover markers**, using git's own rule: a run of *exactly* the marker size (7 by default,
   `conflict-marker-size` can change it) followed by whitespace or end of line. Eight equals signs is
   not a marker. A bare `=======` only counts when bracketed by a start and end marker, so a Markdown
   heading underline doesn't false-positive.
3. **Not degenerate to one parent.** Byte-identical to the **base** means both sides' changes were
   discarded — never correct, always a failure. Byte-identical to ours or theirs is a wholesale
   side-drop: legal, but only when declared.
4. **No out-of-hunk edits.** Regenerates git's own conflicted output and asserts every line git had
   *already merged* survives, in order. Those lines were never in dispute; editing them while
   "resolving a conflict" is scope creep that hides in a merge commit.
5. **Both-sides-agreed lines kept.** When a line appears identically in both alternatives *inside* a
   conflict region, dropping it is almost always an accident of hand-editing.
6. **Line endings and final newline** unchanged, unless git manages them (`core.autocrlf`, a `text`
   attribute) — in which case the check is skipped and says so, because then the worktree's EOL is
   git's doing and not the resolver's.

## The manifest enforces claims, not prose

A rationale policed for length is ceremony — an arms race the writer wins immediately, gating nothing.
So the enforced part is the structured `strategy`, because a claim can be **contradicted by the
blobs**: a file byte-identical to `:2:` while the manifest says `union` is a detectable lie, and
`verify-manifest.mjs` fails on it. Free-text rationale stays required, for whoever reads the merge in
six months — it just isn't what the exit code rests on.

Same shape as `verification-gate`'s rule that a classification rule without a reason won't compile.

## Rebase inverts the sides

During a rebase, `:2:`/"ours" is the branch you are rebasing **onto** — usually upstream — and `:3:`/
"theirs" is **your own replayed work**. This is backwards from how nearly everyone reads it, and it is
the single most common way a rebase resolution silently throws away the work being rebased. The
snapshot records the operation and warns; the manifest rejects bare "ours"/"theirs" wording during a
rebase and makes you name the commit. See `references/rebase-inversion.md`.

## Reference

- `references/conflict-types.md` — the seven codes, which stages exist for each, what carries markers
- `references/why-markers-are-not-enough.md` — the vacuous-green problem in full
- `references/rebase-inversion.md` — why "ours" isn't yours during a rebase
- `references/manifest-format.md` — strategies, and how each is checked against the blobs
