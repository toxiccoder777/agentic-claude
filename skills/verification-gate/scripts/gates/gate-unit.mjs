#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig, gateConfig } from '../lib/config.mjs';
import { readBaselineJson } from '../lib/baseline.mjs';
import { checkSilence } from '../lib/silence.mjs';
import { runGate, blocked, addBlocking, addNonBlocking } from '../lib/result.mjs';
import { parseTap, parseWith } from '../lib/tap.mjs';

function args() {
  const argv = process.argv.slice(2);
  const out = { project: process.cwd(), id: 'unit' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--id') out.id = argv[++i];
  }
  return out;
}

const { project, id } = args();
const config = loadConfig(project);
const gate = gateConfig(config, id);

await runGate(id, config.statePath, async (result) => {
  if (!gate.command) return blocked(result, 'no "command" configured for this gate');

  const run = spawnSync(gate.command, {
    shell: true,
    cwd: config.projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  let text;
  if (gate.resultsFile) {
    const file = resolve(config.projectRoot, gate.resultsFile);
    if (!existsSync(file)) {
      return blocked(result, `results file ${gate.resultsFile} was not produced — the runner did not complete`);
    }
    text = readFileSync(file, 'utf8');
  } else {
    text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  }

  const parsed =
    gate.format === 'custom'
      ? await parseWith(resolve(config.projectRoot, gate.parser), run.stdout ?? '', run.stderr ?? '')
      : parseTap(text);

  const observed = parsed.specs.length;
  const baseline = readBaselineJson(config, gate.baseline ?? 'test-baseline.json');
  if (!baseline?.specs) {
    return blocked(
      result,
      `no frozen test baseline at ${gate.baseline ?? 'test-baseline.json'} — freeze one before gating against it`
    );
  }

  const baselineCount = Object.keys(baseline.specs).length;

  const silence = checkSilence(observed, {
    minObserved: gate.minObserved ?? 1,
    expected: baselineCount,
    shrinkTolerance: gate.shrinkTolerance ?? 0.1,
  });
  if (!silence.ok) return blocked(result, silence.reason);

  // A plan that disagrees with what was reported means the run was cut short.
  if (parsed.plan !== null && parsed.plan !== observed) {
    return blocked(
      result,
      `TAP plan announced ${parsed.plan} tests but ${observed} were reported — the run was truncated`
    );
  }

  const quarantineFile = gate.quarantine ?? 'quarantine.json';
  const quarantine = new Map(
    (readBaselineJson(config, quarantineFile)?.quarantined ?? []).map((q) => [q.spec, q.reason])
  );

  const seen = new Set();
  let regressions = 0;

  for (const spec of parsed.specs) {
    seen.add(spec.name);
    if (spec.status !== 'fail') continue;

    if (quarantine.has(spec.name)) {
      addNonBlocking(result, {
        what: spec.name,
        where: 'quarantined',
        reason: quarantine.get(spec.name),
      });
      continue;
    }

    const was = baseline.specs[spec.name];
    if (was === 'pass') {
      regressions++;
      addBlocking(result, { what: spec.name, where: 'regression', reason: 'passed in baseline, fails now' });
    } else if (was === undefined) {
      addBlocking(result, { what: spec.name, where: 'new', reason: 'new spec, failing' });
    } else {
      addNonBlocking(result, { what: spec.name, where: 'pre-existing', reason: 'already red in baseline' });
    }
  }

  // A spec that vanished stopped protecting anything, which reads identically
  // to a pass unless it is called out.
  for (const [name, status] of Object.entries(baseline.specs)) {
    if (status === 'pass' && !seen.has(name) && !quarantine.has(name)) {
      addBlocking(result, { what: name, where: 'missing', reason: 'passed in baseline, absent from this run' });
    }
  }

  result.stats = {
    observed,
    baseline: baselineCount,
    regressions,
    quarantined: quarantine.size,
    exit: run.status ?? 'null',
  };
});
