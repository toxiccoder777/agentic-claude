# Why "no conflict markers left" proves almost nothing

Searching for `<<<<<<<` is the standard conflict check — a pre-commit hook, a CI grep, a quick look
before committing. It is worth having. It is nowhere near sufficient, and its insufficiency is the
dangerous kind: it fails by reporting success.

## Failure 1: entire conflict classes carry no markers

Delete/modify, both-deleted, binary, submodule and symlink conflicts never produce a marked-up file
(see `conflict-types.md`). A marker scan over a repo with an unresolved `DU` prints nothing and exits
zero. It examined the file and had no opinion, but the output is indistinguishable from "verified
clean."

This is the same shape as an empty test run reporting no failures — the
[architecture doc](../../../docs/architecture.md)'s central complaint, one layer over.

## Failure 2: `git add` erases the evidence

This is the one worth internalising:

```bash
# file still contains <<<<<<< HEAD
git add conflicted-file.txt
git status          # clean. no conflict. no warning.
git ls-files -u     # empty — the path is no longer unmerged
```

Staging a file **clears its unmerged status regardless of its contents**. Markers and all, it is now
an ordinary staged change ready to commit. Git will not stop you; `git commit` succeeds and the markers
land in history.

A marker scan can still catch this if it runs over the working tree afterwards — but only if it runs,
only if it covers that path, and only if nobody trusted `git status` looking clean. Checking the
*index* instead catches it at the cause: every path that was unmerged must **still** be unmerged when
the resolution is handed over. A shrinking unmerged set means something got staged.

## Failure 3: marker-free and still wrong

A resolution with no markers can still:

- be byte-identical to the merge base, discarding **both** sides' work
- be byte-identical to one side, silently dropping the other
- have quietly edited lines outside the conflict region, which git had already merged and nobody was
  disputing
- have dropped a line both sides independently agreed on
- have rewritten every line by changing the file's line endings, burying the real change in a
  whole-file diff

None of these leave a marker behind. All of them are detectable by comparing against the three stages
git already has.

## Failure 4: false positives train people to ignore it

A naive scan flags a bare `=======` anywhere — including a Markdown setext heading underline, ASCII
art, and a line of exactly seven equals signs in a test fixture. Git's own rule is narrower than most
hand-rolled greps: *exactly* the marker size (7 unless `conflict-marker-size` says otherwise), followed
by whitespace or end of line. Eight equals signs is not a marker.

Requiring a separator to sit between a start and an end marker removes the remaining ambiguity. A
checker that cries wolf gets disabled, and a disabled checker has a 100% false-negative rate.

## What to do instead

Keep the marker scan — it is cheap and it catches the common case. Just don't mistake it for
verification. Pair it with checks against the three stages, and make the no-marker conflict types
report BLOCKED rather than passing quietly.
