# "Ours" is not yours during a rebase

In a **merge**, the sides read the way you expect:

- `:2:` / "ours" — the branch you are on, your work
- `:3:` / "theirs" — the branch being merged in

In a **rebase**, they are inverted:

- `:2:` / "ours" — the branch you are rebasing **onto** (usually upstream/main)
- `:3:` / "theirs" — **your own commit**, being replayed on top

Git's own documentation states this. It is not a quirk of any particular tool.

## Why it happens

A rebase replays your commits one at a time onto the new base. During each replay, git has checked out
the *upstream* branch and is applying *your* commit to it. From git's position, the checked-out
thing — upstream — is "ours," and the patch being applied — yours — is "theirs."

## Why it matters

The instinct during a conflict is "keep ours, that's my work." During a rebase that instinct
**discards the work being rebased**. Worse, it fails quietly: the rebase completes, the branch looks
fine, tests may well pass, and the commit you were replaying has silently become a no-op. It usually
surfaces days later as "wasn't this fixed already?"

`git checkout --ours <file>` during a rebase does the same thing, which is why reaching for it as a
quick unblock is risky.

## What the tooling does about it

- `snapshot-conflicts.mjs` records the operation and prints an explicit warning when it is a rebase.
- `verify-manifest.mjs` **rejects** a rationale containing bare "ours"/"theirs" during a rebase, and
  makes you name the commit or branch instead. `"kept theirs"` is ambiguous; `"kept the version from
  a1b2c3d (add retry to the client)"` cannot be misread six months later.

The wording rule is not pedantry. During a rebase, a note saying "kept ours" is either wrong or means
the opposite of what the next reader will assume.

## Detecting the operation reliably

Probe order matters: an interactive rebase sets `CHERRY_PICK_HEAD` while replaying a pick, so checking
for a cherry-pick first misreports a rebase as a cherry-pick. Check the rebase state directories
(`rebase-merge/`, `rebase-apply/`) **before** `CHERRY_PICK_HEAD`.

Locate these with `git rev-parse --git-path <name>`, never by joining onto `.git/` — inside a worktree
or submodule, `.git` is a *file* pointing elsewhere, and path-joining silently probes the wrong repo.
The answer is relative to the repository, so resolve it against the repo rather than the current
process's working directory.

Also: conflicts can exist with **no** operation state file at all — `git stash pop`, `git apply -3`,
`git checkout -m`. That is a legitimate conflict state, not an error. Treat an unrecognised operation
as `unknown` and carry on; the stage blobs are all the verification actually needs.
