#!/usr/bin/env node
// Rendered-output fingerprint diff. Compares structural and computed-style
// facts per view rather than pixels, so it survives antialiasing but still
// catches a layout or color regression.
import { loadConfig, gateConfig } from '../lib/config.mjs';
import { runGate } from '../lib/result.mjs';
import { runDiffGate } from '../lib/diffgate.mjs';

function args() {
  const argv = process.argv.slice(2);
  const out = { project: process.cwd(), id: 'visual' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--id') out.id = argv[++i];
  }
  return out;
}

const { project, id } = args();
const config = loadConfig(project);
const gate = gateConfig(config, id);

await runGate(id, config.statePath, (result) =>
  runDiffGate(result, {
    config,
    gate: {
      key: ['view'],
      compare: ['elementCount', 'geometry', 'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'display'],
      baseline: 'dom-baseline.ndjson',
      ...gate,
    },
  })
);
