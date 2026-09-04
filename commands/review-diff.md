---
description: Fresh-context correctness review of the current diff
argument-hint: [files or scope, default: git diff]
---

Invoke the **code-reviewer** agent on: $ARGUMENTS (default, if empty: unstaged changes via `git diff`).

The agent reviews with no memory of why the change was made — only what it does — which is
deliberate: it catches what the author's own context blinds them to. Report its findings as given;
don't pre-filter them yourself before the agent has had a chance to apply its own confidence
threshold.
