#!/usr/bin/env node
// Request/response parity against a frozen capture. Any delta in method, URL,
// header set or body shape on a route the baseline covers is a hard fail.
import { loadConfig, gateConfig } from '../lib/config.mjs';
import { runGate } from '../lib/result.mjs';
import { runDiffGate } from '../lib/diffgate.mjs';

function args() {
  const argv = process.argv.slice(2);
  const out = { project: process.cwd(), id: 'integration' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--id') out.id = argv[++i];
  }
  return out;
}

const { project, id } = args();
// Loading config at module scope means a missing or malformed config throws
// before runGate() exists to catch it. Unguarded, Node prints a stack trace and
// exits 1 — reporting "fix your code" for what is a fixture problem. These
// scripts are documented as standalone-invocable, so this path is reachable.
let config;
let gate;
try {
  config = loadConfig(project);
  gate = gateConfig(config, id);
} catch (err) {
  console.error(`BLOCKED: ${err.message}`);
  process.exit(2);
}

await runGate(id, config.statePath, (result) =>
  runDiffGate(result, {
    config,
    gate: {
      key: ['route'],
      compare: ['method', 'url', 'headerKeys', 'bodyShape', 'status'],
      baseline: 'http-baseline.ndjson',
      ...gate,
    },
  })
);
