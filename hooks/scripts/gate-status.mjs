#!/usr/bin/env node
/**
 * SessionStart / PreCompact hook for the verification-gate skill.
 *
 * Speaks up only when there is something to say: a gate chain that started
 * and did not finish. Silent everywhere else — a hook that prints on every
 * session regardless of relevance trains people to ignore its output, which
 * defeats the one time it matters.
 *
 * Never fails the session. Any error here is swallowed and treated as
 * "nothing to report" — a hook is not allowed to be the reason Claude Code
 * won't start.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CONFIG_NAME = 'verification-gate.config.json';
const preCompact = process.argv.includes('--pre-compact');

function findConfig(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const configPath = findConfig(projectDir);
  if (!configPath) return; // not a verification-gate project — say nothing

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return; // malformed config is the gate-runner's problem to report, not this hook's
  }

  const stateDir = resolve(dirname(configPath), config.stateDir ?? '.gate-state');
  const stateFile = join(stateDir, 'state.json');
  if (!existsSync(stateFile)) return; // no chain has ever run here

  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return;
  }

  if (state.complete) return; // last run finished clean — nothing to surface

  const entries = Object.entries(state.stages ?? {});
  const failing = entries.find(([, s]) => s.verdict !== 'PASS');
  if (!failing) return; // stages recorded but none failing — ambiguous, stay quiet rather than guess

  const [stageId, stageResult] = failing;
  const lines = [
    preCompact
      ? 'Before this context is compacted: an unfinished verification-gate chain exists for this project.'
      : 'This project has an unfinished verification-gate chain from a previous session.',
    `  Halted at stage "${stageId}" (${stageResult.verdict}) as of ${stageResult.at}.`,
    stageResult.verdict === 'BLOCKED'
      ? '  BLOCKED means the gate could not judge the change — check the fixture, not the code.'
      : '  Fix the underlying issue, then resume rather than restarting the whole chain:',
    `  node "\${CLAUDE_PLUGIN_ROOT}/skills/verification-gate/scripts/gate-runner.mjs" --project "${dirname(configPath)}" --resume`,
  ];

  console.log(lines.join('\n'));
}

try {
  main();
} catch {
  // swallow — see module doc comment
}
process.exit(0);
