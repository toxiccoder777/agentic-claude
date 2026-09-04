import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const CONFIG_NAME = 'verification-gate.config.json';

const DEFAULTS = {
  baselineDir: '.verification-baseline',
  stateDir: '.gate-state',
  freshness: {
    validityReport: 'validity-report.json',
    maxAgeHours: 24,
    required: true,
  },
  stages: [],
  gates: {},
};

const GATE_DEFAULTS = {
  enabled: true,
  required: true,
  requiresBaseline: false,
};

export class ConfigError extends Error {}

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

export function loadConfig(startDir = process.cwd()) {
  const path = findConfig(startDir);
  if (!path) {
    throw new ConfigError(
      `No ${CONFIG_NAME} found in ${resolve(startDir)} or any parent directory.`
    );
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${err.message}`);
  }

  const projectRoot = dirname(path);
  const config = {
    ...DEFAULTS,
    ...raw,
    freshness: { ...DEFAULTS.freshness, ...(raw.freshness ?? {}) },
    gates: raw.gates ?? {},
    projectRoot,
    configPath: path,
  };

  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    throw new ConfigError(`${path}: "stages" must be a non-empty array of gate ids.`);
  }
  for (const id of config.stages) {
    if (!config.gates[id]) {
      throw new ConfigError(
        `${path}: stage "${id}" has no matching entry under "gates".`
      );
    }
  }

  config.baselinePath = resolve(projectRoot, config.baselineDir);
  config.statePath = resolve(projectRoot, config.stateDir);
  return config;
}

export function gateConfig(config, gateId) {
  const gate = config.gates[gateId];
  if (!gate) throw new ConfigError(`No configuration for gate "${gateId}".`);
  return { ...GATE_DEFAULTS, ...gate, id: gateId };
}

export function enabledStages(config) {
  return config.stages.filter((id) => gateConfig(config, id).enabled !== false);
}
