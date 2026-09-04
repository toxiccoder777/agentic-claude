---
description: Break a legacy modernization or framework upgrade into verifiable hops
argument-hint: <what you're migrating>
---

Invoke the **migration-planner** agent to design a hop-by-hop plan for: $ARGUMENTS

The agent surveys the current codebase, proposes hop boundaries that are each independently
verifiable (not just "compiles" but "provably equivalent to before, for the surface this hop
touches"), and specifies which `verification-gate` stages check each hop. It does not write
implementation code or execute anything — its output is the plan.

If `$ARGUMENTS` is empty, ask what's being migrated rather than guessing scope from the repository
alone; migration scope is a decision the user needs to state, not one to infer.
