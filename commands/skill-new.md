---
description: Scaffold a new skill in this repo, held to CONTRIBUTING.md's bar
argument-hint: <skill-name> <one-line purpose>
---

Scaffold `skills/$1/` for a new skill in **this** repo (`claude-tool`), where `$1` is the first token
of `$ARGUMENTS` and the rest describes its purpose.

Before creating anything, answer both questions from `CONTRIBUTING.md` yourself, out loud in your
response — don't scaffold first and rationalize after:

1. **What does it enforce?** Not what it advises — what fails, loudly, when the rule is broken?
2. **How would you verify it worked?** "The agent says it did" is not an answer.

If you can't answer both concretely for the proposed skill, say so and stop — recommend the idea
become a `references/` doc under an existing skill, or a plain markdown note, instead of a new skill
that can't meet the bar.

If both answers hold, create:

```
skills/$1/
├── SKILL.md       # frontmatter: name, description (written as *when to use this*, with concrete
│                  # trigger phrasing — not a summary of contents), license: MIT
└── references/    # only if the guidance is long enough to need splitting out
```

Write `SKILL.md`'s `description` field to match how `verification-gate`'s and `db-migration`'s
descriptions are written — concrete triggers ("use when X asks for Y"), not a one-line abstract.

After scaffolding, run the leak check from `CONTRIBUTING.md` against the new files:

```bash
git grep -nEi 'C:\\\\Users|E:\\\\projects|/home/[a-z]+/' -- skills/$1/
```

Do not add the new skill to `README.md`'s skill table until it's actually written and passes that
check — an entry pointing at a stub is worse than no entry.
