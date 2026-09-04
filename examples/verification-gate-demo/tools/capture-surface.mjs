#!/usr/bin/env node
// Stands in for an HTTP-parity capture without needing a server: records the
// module's public surface as keyed NDJSON, which the diff gate consumes exactly
// the way it would consume captured requests.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const modules = ['cart'];

const records = [];
for (const name of modules) {
  const mod = await import(`file://${join(root, 'src', `${name}.mjs`)}`);
  for (const [exportName, value] of Object.entries(mod)) {
    records.push({
      route: `${name}.${exportName}`,
      kind: typeof value,
      arity: typeof value === 'function' ? value.length : 0,
    });
  }
}

records.sort((a, b) => a.route.localeCompare(b.route));

const target = process.env.SURFACE_OUT ?? join(root, 'surface-current.ndjson');
writeFileSync(target, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`captured ${records.length} surface record(s)`);
