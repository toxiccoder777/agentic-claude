# The resolution manifest

```json
{
  "resolutions": [
    {
      "path": "src/client.ts",
      "strategy": "interleaved",
      "rationale": "upstream added retry/backoff, the feature branch added request IDs; both are wanted and they touch different parts of the same call."
    },
    {
      "path": "logo.png",
      "strategy": "ours-wholesale",
      "rationale": "binary asset, cannot be merged; kept main's copy after checking with design."
    }
  ]
}
```

One entry per conflicted path. Every path in the snapshot needs one; an entry for a path that was never
in conflict is also an error, since it usually means the manifest drifted from reality.

## Strategies, and how each is checked

The `strategy` is the enforced field, because it is the part that can be **contradicted by the blobs**.

| Strategy | Claim | How it's checked |
|---|---|---|
| `ours-wholesale` | took `:2:` entirely, dropped the other side | file must be byte-identical to `:2:` |
| `theirs-wholesale` | took `:3:` entirely, dropped the other side | file must be byte-identical to `:3:` |
| `union` | both sides' content is present | file must **not** equal either side alone |
| `interleaved` | combined the two, line by line | file must **not** equal either side alone |
| `rewritten` | wrote something neither side had | relaxes the out-of-hunk and EOL checks |
| `deleted` | the file should not exist | file must be absent |

A file byte-identical to `:2:` while the manifest says `union` fails. That is the whole design: the
declaration is only worth something if reality can disagree with it.

`rewritten` is deliberately permissive, and deliberately conspicuous. It is the escape hatch for a
resolution that genuinely had to restructure the file, and it turns off two checks — so it should be
rare, and a reviewer seeing it should look closer.

## Why the prose isn't the enforced part

An obvious design is to require a rationale and reject short or generic ones. That doesn't work.
Whatever the threshold — length, keyword, "non-triviality" — it is trivially satisfied by boilerplate,
and it gates nothing. Checking that `"merged both sides"` is at least forty characters long does not
make it true.

So `rationale` is required and otherwise unpoliced, for the human who reads this merge later. The
machine-checked part is the strategy claim.

This mirrors `verification-gate`'s rule that a classification rule without a reason **won't compile**:
there, the reason gates a behaviour change, so a missing one is load-bearing. Here, the strategy gates
which blob comparison must hold. In both cases the enforced thing is falsifiable.

## Paths that can't be verified

Binary, submodule, symlink and delete-conflict paths carry no markers and can't be diffed against a
merged result (`conflict-types.md`). They still need manifest entries — that's the whole point, since
the decision is a human one — and the verifier accepts them **on the manifest's word**, printing:

```
note  logo.png: binary, resolved by declared "ours-wholesale" — not mechanically verifiable, taken on the manifest's word
```

Being explicit that a check was skipped is the difference between an honest pass and a silent one.

## During a rebase

`ours`/`theirs` are inverted (`rebase-inversion.md`), so a rationale using those bare words is rejected
during a rebase. Name the commit or branch instead.
