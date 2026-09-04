#!/usr/bin/env node
// Freezes the current suite as the baseline and vouches for it. Capture is
// project-specific by nature; the gates only ever consume what this produces.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTap } from '../../../skills/verification-gate/scripts/lib/tap.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baselineDir = join(root, '.verification-baseline');

const run = spawnSync(process.execPath, [join(root, 'tests', 'run.mjs')], {
  encoding: 'utf8',
  env: { ...process.env, DEMO_FAULT: 'none' },
});

const { specs, plan } = parseTap(run.stdout ?? '');

if (specs.length === 0) {
  console.error('refusing to freeze an empty baseline — the suite produced nothing');
  process.exit(1);
}
if (plan !== null && plan !== specs.length) {
  console.error(`refusing to freeze a truncated run — plan ${plan}, reported ${specs.length}`);
  process.exit(1);
}
const failing = specs.filter((s) => s.status === 'fail');

mkdirSync(baselineDir, { recursive: true });

const capturedAt = new Date().toISOString();

writeFileSync(
  join(baselineDir, 'test-baseline.json'),
  JSON.stringify(
    { capturedAt, specs: Object.fromEntries(specs.map((s) => [s.name, s.status])) },
    null,
    2
  ) + '\n'
);

writeFileSync(
  join(baselineDir, 'validity-report.json'),
  JSON.stringify(
    {
      verdict: failing.length === 0 ? 'VALID' : 'INVALID',
      reason:
        failing.length === 0
          ? 'captured from a clean run of the full suite'
          : `${failing.length} spec(s) were already failing at capture time`,
      capturedAt,
      specCount: specs.length,
    },
    null,
    2
  ) + '\n'
);

const surface = spawnSync(process.execPath, [join(root, 'tools', 'capture-surface.mjs')], {
  encoding: 'utf8',
  env: { ...process.env, SURFACE_OUT: join(baselineDir, 'surface-baseline.ndjson') },
});
if (surface.status !== 0) {
  console.error('surface capture failed — refusing to freeze a partial baseline');
  process.exit(1);
}

console.log(`froze ${specs.length} spec(s) at ${capturedAt}`);
