# The seven conflict types

`git status --porcelain=v2` reports unmerged paths on lines beginning `u `:

```
u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
```

`m1/m2/m3` and `h1/h2/h3` are the mode and blob OID of stages 1, 2 and 3. A mode of `000000` with an
all-zero OID means **that stage does not exist**. This matters more than it sounds.

There are exactly seven unmerged `XY` codes:

| Code | Meaning | Stage 1 (base) | Stage 2 (ours) | Stage 3 (theirs) | Markers? |
|---|---|---|---|---|---|
| `UU` | both modified | yes | yes | yes | **yes** |
| `AA` | both added | **no** | yes | yes | **yes** |
| `DD` | both deleted | yes | no | no | no |
| `AU` | added by us | no | yes | no | no |
| `UA` | added by them | no | no | yes | no |
| `DU` | deleted by us | yes | no | yes | no |
| `UD` | deleted by them | yes | yes | no | no |

## Why the missing stages matter

`git show :1:path` **exits non-zero** when that stage doesn't exist — it does not return empty content.
Tooling that treats a failed read as "empty file" will silently produce nonsense for `AA` (no ancestor)
and for every delete-conflict.

Where an empty ancestor is genuinely the right input — regenerating the conflicted output for `AA`, for
instance, where both sides created the file from nothing — that has to be a deliberate choice, not a
side effect of a swallowed error.

## The five types with no markers

Only `UU` and `AA` produce a conflicted file with markers in it. The rest are not content conflicts at
all — they are **existence** conflicts, and there is nothing in the file to edit:

- **`DU` / `UD` (delete/modify).** One side deleted the file; the other changed it. The question is
  "should this file exist," which no amount of text merging answers. Deleting it discards the other
  side's work; keeping it may resurrect a file deliberately removed. This needs whoever owns the code.
- **`DD` (both deleted).** Usually resolved by staging the deletion, but if both sides also moved the
  content somewhere different, that move needs reconciling first.
- **`AU` / `UA` (added by one side).** One side added a file the other doesn't know about, and there is
  a conflicting state around it.

Add to these the paths that *are* `UU` but still carry no markers, because git will not merge them as
text:

- **Binary files** — git writes one side into the working tree and leaves the other in the index.
  The working file *looks* fine, which is exactly the trap.
- **Submodules** (mode `160000`) — the conflict is over which commit the submodule points at.
- **Symlinks** (mode `120000`) — the conflict is over the link target.

## Consequence for tooling

A conflict-marker scan reports these as clean while having judged nothing. Any check that reports PASS
on a repo containing an unresolved `DU` has produced a false pass, and false passes on merges are how
work silently disappears.

The scripts here classify these as `needsHumanDecision` and report **BLOCKED** (exit 2), which is not a
failure and is emphatically not a pass — it means the decision has to be recorded by a person. Once
recorded as a declared strategy in the manifest, the path is accepted *on the manifest's word*, and the
verifier says so in its output rather than implying it verified something it couldn't.
