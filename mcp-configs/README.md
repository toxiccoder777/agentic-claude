# MCP server templates

Copy-paste starting points for MCP servers that pair well with this plugin's DB-focused skills
(`db-migration`) and gate captures (`verification-gate`'s `integration` gate).

## Why these aren't auto-loaded

Claude Code plugins auto-load MCP servers from a single `.mcp.json` at the plugin root. Putting a real
server there means it starts for **every user who installs this plugin**, whether or not they have
`DATABASE_URL` or `GITHUB_TOKEN` set — which means a crash-looping, credential-less server on every
session start for anyone who installed this plugin for `verification-gate` alone and has no database
in the picture.

That's exactly the kind of unverified, silently-misbehaving component this repo argues against
elsewhere (see `docs/architecture.md`). So these stay as templates: copy the one you need into your
own project's `.mcp.json`, or your user-level MCP config, and fill in the placeholders yourself.

## Templates

| File | Server | Needs |
|---|---|---|
| `postgres.json` | `@modelcontextprotocol/server-postgres` | `DATABASE_URL` |
| `github.json` | `@modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| `filesystem.json` | `@modelcontextprotocol/server-filesystem` | nothing beyond the path itself |

## Using one

```bash
cat mcp-configs/postgres.json  # copy the object into your project's .mcp.json
```

Or reference it directly with `claude mcp add-json` — check `claude mcp --help` for the current
syntax, since MCP CLI flags are a surface that shifts between releases.
