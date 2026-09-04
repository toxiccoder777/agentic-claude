# Contributing

## The bar for a new skill

Before opening a PR that adds a skill, answer both of these in the PR description:

1. **What does it enforce?** Not what it advises — what fails, loudly, when the rule is broken.
2. **How would you verify it worked?** "The agent says it did" is not an answer.

A skill that can't answer both is a blog post. There are good places to publish those; this isn't
one. This repo stays small on purpose.

## Skill structure

```
skills/<name>/
├── SKILL.md          # required: frontmatter (name, description) + the guidance itself
├── references/       # optional: deep-dive docs the skill points to
├── scripts/          # optional: executable helpers
└── config/           # optional: JSON schema for per-project configuration
```

Frontmatter requires `name` and `description`. The `description` is what Claude matches against to
decide whether to load the skill, so write it as *when to use this*, with concrete trigger phrasing —
not a summary of the contents.

## Rules

- **Original work only.** Don't vendor skills from other repos, even permissively licensed ones. If
  an idea came from elsewhere, cite it in prose and write your own implementation.
- **No employer or client code.** Reimplement patterns from documented principles rather than
  copying files out of a work repo.
- **No machine-specific content.** No absolute paths, no personal identifiers, no internal project
  names. CI greps for these.
- **Scripts must be framework-agnostic.** Anything project-specific belongs in a config file the
  consuming repo supplies, not hardcoded.

## Before you push

```bash
git grep -nEi 'C:\\\\Users|E:\\\\projects|/home/[a-z]+/' -- . && echo "FAIL: absolute paths found"
```

Run the plugin locally and confirm it loads in a fresh Claude Code session:

```
/plugin marketplace add /path/to/agentic-claude
/plugin install agentic-claude@agentic-claude
```
