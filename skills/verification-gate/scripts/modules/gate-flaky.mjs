#!/usr/bin/env node
/**
 * Repeated-trial reliability, borrowing the pass@k / pass^k framing from eval
 * harness work.
 *
 * A binary quarantine list cannot tell "broken" from "unreliable", so it
 * answers both with the same blunt instrument: quarantine on first red, and
 * lose the coverage. Running the suite k times separates them — a spec that
 * fails every attempt is broken and blocks; one that passes sometimes is flaky,
 * gets reported with its measured rate, and is a candidate for quarantine
 * rather than an automatic one.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig, gateConfig } from '../lib/config.mjs';
import { checkSilence } from '../lib/silence.mjs';
import { runGate, addBlocking, addNonBlocking, blocked } from '../lib/result.mjs';
import { parseTap, parseWith } from '../lib/tap.mjs';

function args() {
  const argv = process.argv.slice(2);
  const out = { project: process.cwd(), id: 'flaky' };
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

await runGate(id, config.statePath, async (result) => {
  if (!gate.command) return blocked(result, 'no "command" configured for this gate');

  const runs = gate.runs ?? 3;
  if (runs < 2) return blocked(result, `"runs" is ${runs} — repeated-trial analysis needs at least 2`);

  const passCount = new Map();
  const seenIn = new Map();

  for (let attempt = 0; attempt < runs; attempt++) {
    const run = spawnSync(gate.command, {
      shell: true,
      cwd: config.projectRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    let text;
    if (gate.resultsFile) {
      const file = resolve(config.projectRoot, gate.resultsFile);
      if (!existsSync(file)) return blocked(result, `attempt ${attempt + 1} produced no ${gate.resultsFile}`);
      text = readFileSync(file, 'utf8');
    } else {
      text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    }

    const parsed =
      gate.format === 'custom'
        ? await parseWith(resolve(config.projectRoot, gate.parser), run.stdout ?? '', run.stderr ?? '')
        : parseTap(text);

    const silence = checkSilence(parsed.specs.length, { minObserved: gate.minObserved ?? 1 });
    if (!silence.ok) return blocked(result, `attempt ${attempt + 1}: ${silence.reason}`);

    for (const spec of parsed.specs) {
      if (spec.status === 'skip') continue;
      seenIn.set(spec.name, (seenIn.get(spec.name) ?? 0) + 1);
      if (spec.status === 'pass') passCount.set(spec.name, (passCount.get(spec.name) ?? 0) + 1);
    }
  }

  let stable = 0;
  let flaky = 0;
  let broken = 0;

  for (const [name, attempts] of seenIn) {
    const passes = passCount.get(name) ?? 0;

    if (passes === attempts) {
      stable++;
      continue;
    }

    if (passes === 0) {
      broken++;
      addBlocking(result, {
        what: name,
        where: `pass@${attempts}=0`,
        reason: `failed all ${attempts} attempts — broken, not flaky`,
      });
      continue;
    }

    flaky++;
    const rate = ((passes / attempts) * 100).toFixed(0);
    addNonBlocking(result, {
      what: name,
      where: `pass@${attempts}=1 pass^${attempts}=0`,
      reason: `passed ${passes}/${attempts} attempts (${rate}%) — flaky, quarantine candidate rather than an automatic quarantine`,
    });
  }

  result.stats = { runs, specs: seenIn.size, stable, flaky, broken };
});
