# merge-conflict-resolution demo

`make-fixture.mjs` generates a throwaway git repo containing one conflict of each shape the skill has
to handle. It is a generator rather than a checked-in fixture because a nested git repo can't live
inside this one, and a half-finished merge can't be committed.

```bash
FIXTURE=$(node examples/merge-conflict-demo/make-fixture.mjs)
cd "$FIXTURE"
git status --porcelain=v2 | grep '^u '
```

Six conflicts, deliberately covering the cases that break naive tooling:

| Path | Code | Why it's here |
|---|---|---|
| `both-modified.txt` | `UU` | the ordinary case, with a line **both** sides added and a line neither touched |
| `agreed-inside-region.txt` | `UU` | both sides rewrote the block but agreed on the middle line, so the agreed line lands *inside* the conflict region |
| `added-by-both.txt` | `AA` | **no stage 1** — there is no common ancestor |
| `deleted-by-us.txt` | `DU` | **no stage 2**, and **no conflict markers** |
| `image.bin` | `UU` | binary — **no conflict markers** |
| `whitespace.txt` | `UU` | the two sides differ only in indentation |

The fixture pins `core.autocrlf=false` locally so the line-ending check is exercised rather than
skipped as git-managed.

## Walking through it

```bash
S=../../skills/merge-conflict-resolution/scripts     # adjust to taste
node $S/snapshot-conflicts.mjs --cwd .
```

```
operation=merge conflicts=6 needs-human-decision=2 whitespace-only=1
  needs-decision  deleted-by-us.txt — missing stage (DU), no conflict markers exist to resolve
  needs-decision  image.bin — binary, no conflict markers exist to resolve
```

Note what that already tells you: two of six conflicts have **nothing to edit**. A `grep <<<<<<<`
check would report this repo clean the moment the other four are fixed.

Now verify before resolving anything — the markers are still in place:

```bash
node $S/verify-resolution.mjs --cwd .
```

Fails on the markers, and reports the two marker-free paths as BLOCKED rather than passing them.

## Failure modes worth reproducing

Each of these should be tried against a fresh fixture. They are the reason the skill exists.

**Staging a file that still has markers in it** — the headline case, because git allows it silently:

```bash
git add both-modified.txt
git status          # looks clean. no warning.
node $S/verify-resolution.mjs --cwd .
# FAIL [index-untouched] both-modified.txt: no longer unmerged — it was staged during resolution
```

**Resolving to the merge base**, discarding both sides:

```bash
git show :1:both-modified.txt > both-modified.txt
# FAIL [degenerate-base] — this discards BOTH sides' changes, which is never a correct resolution
```

**Taking one side wholesale without declaring it:**

```bash
git show :2:both-modified.txt > both-modified.txt
# FAIL [undeclared-side-drop] — legal, but it must be declared as "ours-wholesale"
```

**Editing a line outside the conflict hunk** — change `line one`, which git had already merged:

```
FAIL [out-of-hunk-edit] a line git had already merged outside any conflict region is missing
```

**Dropping a line both sides agreed on** — remove `AGREED-LINE` from `agreed-inside-region.txt`:

```
FAIL [dropped-agreed-line] both sides contained "AGREED-LINE" but the resolution dropped it
```

**Changing line endings** — rewrite a resolved file as CRLF:

```
FAIL [eol-changed] line endings changed lf -> crlf — this rewrites every line in the diff
```

**Claiming a strategy that isn't true** — set `added-by-both.txt` to exactly `:2:` while the manifest
says `union`:

```
FAIL added-by-both.txt: declared "union" — combining both sides — but the file is byte-identical to
     ours (:2:). One side was dropped wholesale; say so with "ours-wholesale".
```

**A false positive that must not fire** — a file containing a Markdown `=======` heading underline and
a line of eight equals signs is *not* flagged. Git's rule is a run of exactly the marker size, and a
separator only counts when bracketed by a start and end marker.

## Rebase

The inversion is easier to believe once seen. Build a small rebase conflict and snapshot it:

```
operation=rebase
NOTE rebase in progress — "ours" (:2:) is the branch you are rebasing ONTO, "theirs" (:3:) is your
     replayed work. The sides are inverted from what they read like.
```

A manifest whose rationale says "kept theirs" during a rebase is rejected — it is ambiguous at best
and backwards at worst. Name the commit instead.

## Cleaning up

The fixture is in a temp directory and owns nothing; delete it when done.

```bash
rm -rf "$FIXTURE"
```
