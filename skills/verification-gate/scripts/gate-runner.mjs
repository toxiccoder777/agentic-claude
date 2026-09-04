#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, gateConfig, enabledStages, ConfigError } from './lib/config.mjs';
import { checkFreshness } from './lib/baseline.mjs';
import { EXIT, VERDICT } from './lib/result.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = 'state.json';

function parseArgs(argv) {
  const args = { resume: false, list: false, from: null, only: null, project: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--resume') args.resume = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--from') args.from = argv[++i];
    else if (arg === '--only') args.only = argv[++i];
    else if (arg === '--project') args.project = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new ConfigError(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  console.log(`gate-runner — run a verification gate chain

  --project <dir>   project root to gate (default: cwd)
  --resume          skip stages already recorded PASS in state.json
  --from <stage>    start at this stage
  --only <stage>    run exactly one stage
  --list            print the resolved stage order and exit
`);
}

function resolveGateScript(config, gate) {
  if (gate.script) return resolve(config.projectRoot, gate.script);
  for (const dir of ['gates', 'modules']) {
    const candidate = join(HERE, dir, `gate-${gate.id}.mjs`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readState(statePath) {
  const file = join(statePath, STATE_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(statePath, state) {
  mkdirSync(statePath, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(join(statePath, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

function verdictFor(exitCode) {
  if (exitCode === EXIT.PASS) return VERDICT.PASS;
  if (exitCode === EXIT.FAIL) return VERDICT.FAIL;
  return VERDICT.BLOCKED;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return EXIT.BLOCKED;
  }
  if (args.help) {
    usage();
    return EXIT.PASS;
  }

  let config;
  try {
    config = loadConfig(args.project);
  } catch (err) {
    console.error(`config: ${err.message}`);
    return EXIT.BLOCKED;
  }

  let stages = enabledStages(config);
  if (args.only) {
    // Deliberately not limited to enabled stages — running one gate ad hoc,
    // including one switched off in the chain, is a normal thing to want.
    if (!config.gates[args.only]) {
      console.error(`--only ${args.only}: no such gate (have: ${Object.keys(config.gates).join(', ')})`);
      return EXIT.BLOCKED;
    }
    stages = [args.only];
  } else if (args.from) {
    const index = stages.indexOf(args.from);
    if (index === -1) {
      console.error(`--from ${args.from}: not an enabled stage (have: ${stages.join(', ')})`);
      return EXIT.BLOCKED;
    }
    stages = stages.slice(index);
  }

  if (args.list) {
    console.log(stages.join('\n'));
    return EXIT.PASS;
  }

  // Freshness is checked once, before any gate runs. A stale fixture does not
  // produce a partial verdict — it means the chain cannot start at all.
  const needsBaseline = stages.some((id) => gateConfig(config, id).requiresBaseline);
  if (needsBaseline) {
    const freshness = checkFreshness(config);
    if (!freshness.ok) {
      console.error(`[chain] BLOCKED: ${freshness.reason}`);
      console.error('  No gate ran. An untrustworthy baseline cannot clear anything.');
      return EXIT.BLOCKED;
    }
    if (!freshness.skipped) {
      console.log(`[chain] baseline validated, ${freshness.ageHours.toFixed(1)}h old`);
    }
  }

  const prior = args.resume ? readState(config.statePath) : null;
  const state = prior ?? {
    startedAt: new Date().toISOString(),
    updatedAt: null,
    stages: {},
    complete: false,
  };
  state.complete = false;

  for (const id of stages) {
    const gate = gateConfig(config, id);

    if (args.resume && state.stages[id]?.verdict === VERDICT.PASS) {
      console.log(`[${id}] skipped (already PASS in state.json)`);
      continue;
    }

    const script = resolveGateScript(config, gate);
    if (!script) {
      console.error(`[${id}] BLOCKED: no gate script found — expected gates/gate-${id}.mjs or a "script" path in config`);
      state.stages[id] = { verdict: VERDICT.BLOCKED, exitCode: EXIT.BLOCKED, at: new Date().toISOString() };
      writeState(config.statePath, state);
      return EXIT.BLOCKED;
    }

    const run = spawnSync(process.execPath, [script, '--project', config.projectRoot, '--id', id], {
      stdio: 'inherit',
    });
    const exitCode = run.status ?? EXIT.BLOCKED;
    const verdict = verdictFor(exitCode);
    state.stages[id] = { verdict, exitCode, at: new Date().toISOString() };
    state.lastStage = id;
    writeState(config.statePath, state);

    if (exitCode !== EXIT.PASS) {
      if (gate.required) {
        console.error(`[chain] halted at "${id}" (${verdict}). Later stages did not run.`);
        console.error(`[chain] fix, then: gate-runner --resume`);
        return exitCode;
      }
      console.log(`[chain] "${id}" ${verdict} but is not required — continuing.`);
    }
  }

  state.complete = true;
  writeState(config.statePath, state);
  console.log(`[chain] PASS — ${stages.length} stage(s) cleared.`);
  return EXIT.PASS;
}

process.exit(main());
