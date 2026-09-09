#!/usr/bin/env node
/**
 * The actual test of "is this capture deterministic": run it N times against
 * whatever state exists right now — unchanged between runs, by construction,
 * since nothing else executes in between — and diff every compare field per
 * key. Anything that differs between two runs of the identical command
 * against identical state cannot possibly be a valid regression signal; it is
 * noise that will show up as a permanent, unfixable "regression" in the gate
 * the moment someone finally captures a baseline and compares against it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readRecords, keyOf, valueOf, parseFieldList } from './lib/records.mjs';

function args() {
  const argv = process.argv.slice(2);
  const out = { format: 'ndjson', runs: 2, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--command') out.command = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--format') out.format = argv[++i];
    else if (a === '--runs') out.runs = Number(argv[++i]);
    else if (a === '--cwd') out.cwd = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`idempotency-check — proves (or disproves) a capture command is deterministic

  --command "<cmd>"   the capture command to run, unmodified, N times
  --output <path>      file the command writes, read fresh after each run
  --key <fields>       comma-separated key fields
  --compare <fields>   comma-separated fields to check for stability
  --runs <n>            default 2 — how many times to run the command
  --format ndjson|json (default: ndjson)
  --cwd <dir>           working directory for the capture command

Exit 0: every compare field was identical across all runs, for every key.
Exit 1: at least one field varied — name it, and do not put it in a gate's
"compare" list until the capture is fixed to normalize or omit it.
Exit 2: a run produced nothing usable, so determinism could not be judged.
`);
}

function main() {
  const opts = args();
  if (opts.help || !opts.command || !opts.output || !opts.key || !opts.compare) {
    usage();
    return opts.help ? 0 : 1;
  }
  if (opts.runs < 2) {
    console.error('--runs must be at least 2 — determinism is a claim about repeated runs');
    return 1;
  }

  const keyFields = parseFieldList(opts.key);
  const compareFields = parseFieldList(opts.compare);
  const outputPath = resolve(opts.cwd, opts.output);

  const captures = [];

  for (let attempt = 0; attempt < opts.runs; attempt++) {
    const run = spawnSync(opts.command, { shell: true, cwd: opts.cwd, encoding: 'utf8' });
    if (!existsSync(outputPath)) {
      console.error(`BLOCKED: run ${attempt + 1} produced no ${opts.output}${run.stderr ? ` (${run.stderr.trim().split('\n')[0]})` : ''}`);
      return 2;
    }
    let records;
    try {
      records = readRecords(outputPath, opts.format);
    } catch (err) {
      console.error(`BLOCKED: run ${attempt + 1} output unreadable: ${err.message}`);
      return 2;
    }
    if (records.length === 0) {
      console.error(`BLOCKED: run ${attempt + 1} produced zero records`);
      return 2;
    }
    captures.push(new Map(records.map((r) => [keyOf(r, keyFields), r])));
  }

  const allKeys = new Set(captures.flatMap((m) => [...m.keys()]));
  let stableFields = 0;
  let flakyFields = 0;
  let missingKeys = 0;
  const flaky = [];

  for (const key of allKeys) {
    const presentIn = captures.filter((m) => m.has(key)).length;
    if (presentIn !== captures.length) {
      missingKeys++;
      console.log(`warn  ${key} present in ${presentIn}/${captures.length} runs — the capture itself is not stable in which records it returns`);
      continue;
    }

    for (const field of compareFields) {
      const values = captures.map((m) => valueOf(m.get(key), field));
      const distinct = new Set(values);
      if (distinct.size === 1) {
        stableFields++;
      } else {
        flakyFields++;
        flaky.push({ key, field, values });
      }
    }
  }

  for (const f of flaky) {
    console.error(`FAIL  ${f.key}.${f.field} varied across runs: ${f.values.map((v) => `"${v.slice(0, 40)}"`).join(' vs ')}`);
  }

  const failed = flakyFields > 0 || missingKeys > 0;
  console.log(`${failed ? 'FAIL' : 'PASS'} (runs=${opts.runs} keys=${allKeys.size} stable-fields=${stableFields} flaky-fields=${flakyFields} unstable-keys=${missingKeys})`);
  return failed ? 1 : 0;
}

process.exit(main());
