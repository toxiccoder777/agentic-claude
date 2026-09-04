---
description: Scan for hardcoded secrets and stray debug statements, without a full gate chain
argument-hint: [path, default: .]
---

Run the `verification-gate` skill's secrets module directly against `$ARGUMENTS` (default `.`) —
this is a standalone check, not the full chain, for a quick pass before a commit.

If the target has a `verification-gate.config.json` with a `secrets` gate already defined, use its
`include`/`debugGlobs` as configured:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/verification-gate/scripts/modules/gate-secrets.mjs" --project <path> --id secrets
```

If there's no config, create a minimal temporary one scoped to source files under the given path
(don't scan `node_modules`, build output, or `.git`) rather than skipping the check — matching zero
files is itself treated as blocked by the gate, so an empty scope will surface as an error rather than
a false "clean."

Report every BLOCKING finding verbatim: file, line, and rule. For a broader OWASP-class review beyond
pattern matching, invoke the **security-scanner** agent instead — this command is the fast mechanical
pass only.
