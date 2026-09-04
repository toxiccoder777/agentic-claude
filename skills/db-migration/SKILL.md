---
name: db-migration
description: Guidance for planning and safely executing database migrations — cloning a database, deep-diffing schemas between two databases, building and atomically running migration scripts, syncing reference/lookup data between environments, and auditing legacy SQL scripts before executing them. Use this whenever a user asks to clone or sync a database, compare/diff two database schemas or environments, migrate data onto a new structure, backfill or refresh reference data from another environment, or review a folder of old migration/fix scripts before running them — even if they don't say "migration" explicitly (e.g. "copy prod's data onto the new schema", "sync these lookup tables", "check these scripts and run them against staging", "clone this DB and bring it up to date"). Especially relevant for Postgres, but the principles generalize.
license: MIT
metadata:
  version: "1.0.0"
  domain: database
  role: specialist
  scope: execution
---

# Database migration

Database migrations are high-stakes and hard to reverse: a bad write can silently corrupt data that nothing will flag until much later. The instructions below are less about SQL syntax and more about the *sequencing and verification discipline* that keeps a migration safe — figure out exactly what you're allowed to touch, understand your tools before trusting them, diff exhaustively rather than assuming, and treat anything ambiguous as a question for the user rather than a guess.

## 1. Nail down scope before touching anything

Before running a single write, be explicit (to yourself and, if there's any doubt, to the user) about:
- Which database(s) are the **source of truth** (read-only — never write here) vs the **target** (safe to write).
- Whether the target already exists, and in what state. Don't assume "create a new DB" means it doesn't already exist — check first (`SELECT datname FROM pg_database`). If it already has objects in it, stop and find out whether that's someone's in-progress work before overwriting it.
- What "old data, new structure" (or whatever the user's framing is) actually means table-by-table. It usually isn't uniform: some new tables are pure reference/config data that should be seeded from the new environment; some are transactional data that has no equivalent in the old dataset and should stay empty; some represent a normalization of an old column into a new join table and need an actual data transformation, not just an empty CREATE TABLE.

## 2. Understand your tools before trusting them

- If you're given a DB query tool, check what it can actually do: is it read-only? Which single database is it connected to (`SELECT current_database()`)? Postgres doesn't allow cross-database queries without `dblink`/`postgres_fdw` — a tool connected to one database can't see another's schema at all, even on the same server.
- Look for `psql`/`pg_dump`/`pg_restore` locally even if they're not on PATH — check common install locations (e.g. on Windows, `Program Files\PostgreSQL\*\bin`, or bundled inside a pgAdmin installation's `runtime` folder). A GUI DB tool being installed often means its CLI binaries are sitting right next to it.
- **Match client major version to server major version.** `pg_dump`/`pg_restore` refuse to talk to a server with a *newer* major version than themselves ("server version mismatch, aborting"). A client that's the same or newer than the server works; older does not. If you find multiple Postgres installs on a machine (e.g. from different app installers), check each one's `--version` — the newest is usually the one to use.
- If a tunnel/proxy is involved (port-forward, SSH tunnel, Cloud SQL proxy), remember it's just forwarding TCP bytes to a server — the *database name* you connect to is chosen by your client in the connection request, not baked into the tunnel. A tunnel set up for one database on a shared server will usually let you reach any other database on that same server too.
- If a tunnel drops mid-task, that's an external dependency outside your control — report it and ask the user to restart it rather than trying to route around it or spin up your own replacement tunnel blind.

## 3. Cloning a database

Two approaches, pick based on the situation:
- **`CREATE DATABASE new_db WITH TEMPLATE source_db`** — fast, exact, no client tool needed (pure SQL). But it requires **zero other active connections to the source** at the moment of copy, which live/shared databases usually don't satisfy (check `SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname`). Don't kill other sessions' connections to force this through — that disrupts a shared system.
- **`pg_dump` (custom format, `-Fc`) + `pg_restore`** — works against a live database via a normal MVCC-consistent snapshot, no exclusive lock needed. This is almost always the right default for cloning something that's actively in use.

## 4. Diff schemas exhaustively, not by eyeballing

A "full diff" between two schemas means checking *every* object type — it's easy to only check tables and functions and miss something:
- Tables (existence)
- Columns (name, type, length/precision/scale, nullability, default) — via `information_schema.columns`
- Constraints (PK/FK/UNIQUE/CHECK) — via `pg_get_constraintdef`, not raw text comparison of two dumps (formatting can differ cosmetically for identical semantics)
- Indexes — via `pg_get_indexdef`
- Functions/procedures — via `pg_get_functiondef`, comparing full body text. **Watch for false positives from line-ending differences (`\r`/CRLF) if SQL text passed through a Windows tool chain** — strip and re-hash before concluding a function body actually changed.
- Sequences, views, triggers, row-level security policies, extensions — easy to forget entirely; explicitly check whether any exist in either database rather than assuming zero.

Prefer live catalog queries (`pg_get_functiondef(oid)`, `pg_dump --schema-only -t <table>` for one table at a time) over hand-parsing a giant schema dump's text — a full-database dump is easy to slice incorrectly (multi-line blocks, embedded semicolons in defaults, dollar-quoted function bodies).

## 5. Classifying new tables: seed vs. leave empty vs. real migration

When a new environment has tables the old one didn't:
- **Pure reference/lookup tables** (small, stable, config-shaped: codes, names, display order, `is_active`) — safe to copy wholesale from the newer environment, since this is effectively part of the "structure" the app needs to function, not case-specific business data.
- **Transactional/business tables** (foreign keys to owner/user/order/whatever-the-domain-entity, timestamps, workflow state) — do **not** blindly copy the new environment's rows. They reference IDs from *that* environment's own dataset, which won't exist in your target's data. Leave them empty unless there's a real mapping.
- **Normalized-out columns** (an old single column replaced by a new join/mapping table) — check whether the *old* environment had data in that column. If so, this needs an actual `INSERT ... SELECT` from the target's own old data into the new table, carrying the old values forward, before dropping the old column. This is different from "seeding" — it's migrating the target's own data, not copying from elsewhere.
- When a column changes domain entirely (e.g. old column pointed to a person, new column points to a company lookup with no old equivalent), there is often **no valid automatic mapping**. Don't fabricate one — ask the user how they want it handled (leave empty, free-text fallback, etc.).

## 6. Matching reference/lookup rows between two environments: use the natural key, not the primary key

If two environments seeded the same lookup table independently, the "same" logical row (e.g. a breed name, a role name) can have **different primary key UUIDs** in each. Diffing by PK to decide "is this row missing" will be wrong — it'll either insert duplicates or fail to insert genuinely new rows. Match by the natural/business key instead (name, code — case-insensitive and trimmed), and:
- When you insert a genuinely missing row, carry over the **source environment's own primary key**, not a freshly generated one — this matters if other tables you're also syncing (e.g. a permission-mapping table) reference that row by ID.
- When a row matches by natural key but other attributes differ, don't silently overwrite — report it as a conflict for a human decision.
- **Inspect the actual row content before bulk-copying "new" reference rows** — a lookup table that grew in the source environment may have grown with dev/QA test junk (names like "Test Brand", "Testing Department 1", roles literally named "Testing", mostly `is_active=false`) mixed in with real additions. Read a sample before assuming every new row belongs in the target.

## 7. Executing the migration safely

- Assemble the full migration as one script and run it in a **single transaction with stop-on-error**: `psql -v ON_ERROR_STOP=1 -1 -f migration.sql`. If anything fails partway through, the whole thing rolls back and the target is left exactly as it was — never half-migrated. This is far safer than running statements one at a time and hoping.
- Order matters: additive column changes → new tables (in FK-dependency order) → data migrations that populate the new tables from old columns → drop the now-migrated old columns → seed reference data → (re)create functions last, after everything they might reference exists.
- `CREATE OR REPLACE FUNCTION` cannot change an existing function's return-row-type/OUT-parameters — Postgres requires `DROP FUNCTION` first in that case. If a batch of function updates errors on this, prepend `DROP FUNCTION IF EXISTS <exact signature>` before the replacements that changed shape.
- After success, verify with real numbers: row counts for the tables you migrated data into (do they match the count of eligible old rows?), row counts for seeded tables (do they match the source?), and re-confirm the source database(s) are completely unchanged.

## 8. Auditing legacy/inherited migration scripts before running them

If asked to review and run a folder of historical fix/migration scripts:
1. **Triage for destructive operations first** — grep for `DROP TABLE`, `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE`, unqualified `DELETE FROM`. A "complete setup" or "cleanup" script that drops everything before recreating it is a common pattern for bootstrapping a fresh dev database — never run one of those against a target that holds data worth keeping, no matter what else the user asked for.
2. For everything else, don't just run them — classify each script against the target's **actual current state**: is what it does already reflected there (common if the target's structure was already synced from wherever these scripts were applied)? Does it target something that was later superseded or renamed? Is it a real data fix that the target's own data might still need (test the script's own `WHERE` condition as a read-only `SELECT count(*)` against the target first to see how many rows would actually be affected)?
3. Only execute what's genuinely still needed, and verify each fix's effect afterward rather than trusting that it ran cleanly.

## 9. Keep heavy investigation out of your main context

Schema diffs, row-by-row data audits, and script classification produce a lot of intermediate SQL output that isn't worth keeping around once you've extracted the conclusion. If your environment supports background/forked subagents, delegate the mechanical grinding (running dozens of comparison queries, extracting DDL, building the migration file) to one, and have it report back a structured summary — table/object name plus what differs — rather than raw dumps. Keep the judgment calls (what's ambiguous, what needs a human decision, what's safe to execute) in your own hands.

## 10. When in doubt, stop and ask

Treat these as hard stops, not judgment calls to make alone: any mapping with no automatically-correct answer (old column pointed to a fundamentally different kind of entity than the new one), any operation that would drop or overwrite data you can't reconstruct, and any case where "is this reference data or test junk" isn't obvious from inspecting the actual rows. A wrong guess here compounds — later steps get built on top of it.
