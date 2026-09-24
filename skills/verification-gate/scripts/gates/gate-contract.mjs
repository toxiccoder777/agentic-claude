#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { loadConfig, gateConfig } from '../lib/config.mjs';
import { matchAny } from '../lib/files.mjs';
import { runGate, addBlocking, addNonBlocking, blocked } from '../lib/result.mjs';

function args() {
  const argv = process.argv.slice(2);
  const out = { project: process.cwd(), id: 'contract' };
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
  const baseRef = gate.baseRef ?? 'HEAD~1';

  const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', baseRef], {
    cwd: config.projectRoot,
    encoding: 'utf8',
  });
  if (diff.status !== 0) {
    return blocked(
      result,
      `git diff against "${baseRef}" failed — this gate reads history and cannot judge without it${
        diff.stderr ? ` (${diff.stderr.trim().split('\n')[0]})` : ''
      }`
    );
  }

  const changed = diff.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (changed.length === 0) {
    addNonBlocking(result, { what: 'no files changed against ' + baseRef, reason: 'nothing to gate' });
    result.stats = { changed: 0 };
    return;
  }

  const sourceChanged = changed.filter((f) => matchAny(f, gate.sourceGlobs ?? []));
  const testsChanged = changed.filter((f) => matchAny(f, gate.testGlobs ?? []));

  // The weak version of this rule is "did any test change". The strong version
  // names the specific spec a given kind of change is supposed to be covered by,
  // so a token edit to an unrelated test cannot satisfy it.
  for (const rule of gate.requiredSpecs ?? []) {
    const triggers = sourceChanged.filter((f) => matchAny(f, [rule.when]));
    if (triggers.length === 0) continue;
    if (!testsChanged.includes(rule.spec)) {
      addBlocking(result, {
        what: `${rule.spec} was not updated`,
        where: triggers[0],
        reason: rule.reason ?? `changes matching ${rule.when} must be covered by ${rule.spec}`,
      });
    }
  }

  if (sourceChanged.length > 0 && testsChanged.length === 0) {
    addBlocking(result, {
      what: `${sourceChanged.length} source file(s) changed with no accompanying test change`,
      where: sourceChanged.slice(0, 3).join(', ') + (sourceChanged.length > 3 ? ', …' : ''),
      reason: 'a change that adds no test cannot demonstrate it did what it claims',
    });
  }

  if (sourceChanged.length === 0 && testsChanged.length > 0) {
    addNonBlocking(result, {
      what: 'tests changed without source changes',
      reason: 'test-only change, nothing to enforce',
    });
  }

  result.stats = { changed: changed.length, source: sourceChanged.length, tests: testsChanged.length };
});
