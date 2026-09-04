# Root-cause classification

Some findings on covered ground are real differences that are nevertheless not regressions: a
framework upgrade renamed a generated class, an animation was mid-flight at capture, a bundler
reordered attributes. Left alone they block forever. The usual response is an allowlist — and an
allowlist is where a gate quietly dies.

The failure is that a plain allowlist records *what* to ignore and never *why*. Six months later
nobody can tell an entry that documents a confirmed, harmless cause from one someone added at 6pm to
get a build through. Both look identical, so the whole list becomes untrustworthy, and the honest
move — deleting it — is unavailable because nobody knows which half was load-bearing.

## The rule

A finding may be excused from blocking only by a rule that states its confirmed cause. `compileRules`
in `lib/partition.mjs` **throws** on a rule with no `reason`, and throws on an empty `when` — a rule
that matches everything is an off switch wearing a costume.

```json
{
  "id": "known-arity-shift",
  "when": { "where": "^cart\\.withTax$", "field": "^arity$" },
  "reason": "withTax gained an optional rounding argument in the 2.x refactor; confirmed backward compatible by hand"
}
```

Excused findings move to the reported half and print their reason and rule id on every run:

```
reported  arity changed [cart.withTax] — withTax gained an optional rounding argument in the 2.x
          refactor; confirmed backward compatible by hand (known-arity-shift)
```

They never disappear. Someone reading the output sees both the difference and the claim being made
about it, and can challenge the claim.

## Writing rules that stay honest

- **Scope tightly.** `when` matches all listed fields as regexes. Anchor them. `"where": "cart"`
  excuses the entire module; `"where": "^cart\\.withTax$"` excuses one thing.
- **The reason is evidence, not a category.** "framework difference" explains nothing. "Angular 17
  emits `ng-star-inserted` on structural directives; verified identical rendered output on 12 routes"
  can be checked by someone else.
- **Rules expire.** A rule written for a migration hop should be deleted when that hop lands. Rules
  that outlive their cause are how a gate ends up excusing a real regression.
- **If you cannot write the reason, it is not classified.** It is unexplained, and unexplained
  findings block. That is the point.
