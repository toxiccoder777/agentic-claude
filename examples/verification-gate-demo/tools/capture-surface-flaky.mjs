#!/usr/bin/env node
// Deliberately broken capture for the baseline-capture skill's demo: it stamps
// a wall-clock timestamp onto every record and randomizes ordering, which is
// exactly what idempotency-check.mjs exists to catch. Never do this in a real
// capture script.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mod = await import(`file://${join(root, 'src', 'cart.mjs')}`);

const records = Object.entries(mod).map(([exportName, value]) => ({
  route: `cart.${exportName}`,
  kind: typeof value,
  arity: typeof value === 'function' ? value.length : 0,
  capturedAt: new Date().toISOString(), // <- non-deterministic, on purpose
}));

const target = process.env.SURFACE_OUT ?? join(root, 'surface-current.ndjson');
writeFileSync(target, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`captured ${records.length} record(s)`);
